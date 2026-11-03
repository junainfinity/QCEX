import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("only two pairs are exposed; live reference depth advances and unsupported queries fail", async ({
  request,
}) => {
  const markets = await (await request.get("/api/markets")).json();
  expect(markets.map((m: any) => m.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/reference/snapshot?symbol=${symbol}`)
            ).json()
          ).status,
      )
      .toBe("live");
    const before = await (
      await request.get(`/api/reference/snapshot?symbol=${symbol}`)
    ).json();
    expect(before.provider).toBe("Binance");
    expect(before.kind).toBe("REFERENCE");
    expect(before.book.bids).toHaveLength(20);
    expect(before.book.asks).toHaveLength(20);
    expect(+before.book.bids[0].price).toBeLessThan(+before.book.asks[0].price);
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/reference/snapshot?symbol=${symbol}`)
            ).json()
          ).book.sequence,
      )
      .toBeGreaterThan(before.book.sequence);
    for (const interval of ["1m", "5m", "15m", "1h", "4h", "1d"]) {
      const history = await request.get(
        `/api/reference/candles?symbol=${symbol}&interval=${interval}`,
      );
      expect(history.status()).toBe(200);
      const rows = (await history.json()).candles;
      expect(rows.length).toBeGreaterThanOrEqual(500);
      expect(
        rows.every((c: any, i: number) => !i || c.time > rows[i - 1].time),
      ).toBe(true);
    }
  }
  expect(
    (await request.get("/api/reference/snapshot?symbol=SOLUSDT")).status(),
  ).toBe(400);
  expect(
    (await request.get("/api/reference/candles?interval=2m")).status(),
  ).toBe(400);
});

test("live candles, indicators, pair changes and separate executable book work on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/");
  await expect(
    page.getByText("Binance live reference", { exact: false }),
  ).toBeVisible();
  const chart = page.getByTestId("live-chart");
  await expect
    .poll(async () => Number(await chart.getAttribute("data-candles")))
    .toBeGreaterThanOrEqual(500);
  expect(await chart.locator("canvas").count()).toBeGreaterThan(2);
  await page.getByRole("button", { name: "BB 20, 2", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "BB 20, 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "5m", exact: true }).click();
  await expect(chart).toHaveAttribute("data-interval", "5m");
  await expect
    .poll(async () => Number(await chart.getAttribute("data-candles")))
    .toBeGreaterThanOrEqual(500);
  await page.getByRole("button", { name: /☆.*ETH/ }).click();
  await expect(chart).toHaveAttribute("data-symbol", "ETHUSDT");
  await expect
    .poll(async () => Number(await chart.getAttribute("data-last-close")))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await chart.getAttribute("data-last-close")))
    .toBeLessThan(20000);
  await page.getByRole("button", { name: "Sandbox book", exact: true }).click();
  await expect(
    page.getByText("Funded sandbox counterparties", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use sandbox price", exact: true })
    .click();
  const book = await (await page.request.get("/api/book/ETHUSDT")).json();
  expect(
    Number(await page.getByLabel("Order price", { exact: true }).inputValue()),
  ).toBe(Number(book.asks[0].price));
  await page
    .getByRole("button", { name: "Binance reference", exact: true })
    .click();
  await page.screenshot({ path: "artifacts/live-desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: "artifacts/live-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("history failure is explicit and retry restores candles", async ({
  page,
}) => {
  await page.route("**/api/reference/candles?*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "History temporarily unavailable" },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Binance live reference", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("History temporarily unavailable", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/reference/candles?*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.getByTestId("live-chart").getAttribute("data-candles")),
    )
    .toBeGreaterThanOrEqual(500);
});

test("upstream network outage marks stale data and recovers without changing sandbox ledger", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const before = (await (await request.get("/api/status")).json()).ledger;
  await page.goto("/");
  await expect(
    page.getByText("Binance live reference", { exact: false }),
  ).toBeVisible();
  try {
    execFileSync(
      "docker",
      ["compose", "--profile", "preview", "pause", "market-data"],
      { stdio: "pipe" },
    );
    await expect(
      page.getByText("Reference feed stale / connecting", { exact: false }),
    ).toBeVisible({ timeout: 12000 });
  } finally {
    execFileSync(
      "docker",
      ["compose", "--profile", "preview", "unpause", "market-data"],
      { stdio: "pipe" },
    );
  }
  await expect(
    page.getByText("Binance live reference", { exact: false }),
  ).toBeVisible({ timeout: 25000 });
  expect((await (await request.get("/api/status")).json()).ledger).toEqual(
    before,
  );
});
