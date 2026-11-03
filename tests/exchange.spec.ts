import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const password = "SyntheticOnly_2026!";
const unique = () => `t_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const atoms = (value: string) => {
  const [a, b = ""] = value.split(".");
  return BigInt(a) * 100000000n + BigInt(b.padEnd(8, "0"));
};
let alice: APIRequestContext, bob: APIRequestContext;
async function order(
  client: APIRequestContext,
  extra: Record<string, string> = {},
) {
  return client.post("/api/orders", {
    data: {
      commandId: randomUUID(),
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      timeInForce: "GTC",
      price: "65010",
      quantity: "0.001",
      ...extra,
    },
  });
}
const balance = (
  a: any,
  asset: string,
  wallet = "SPOT",
  bucket = "available",
) =>
  atoms(
    a.balances.find((b: any) => b.asset === asset && b.wallet === wallet)?.[
      bucket
    ] || "0",
  );
test.describe.serial("Financial and authorization gauntlet", () => {
  test.beforeAll(async ({ playwright, baseURL }) => {
    alice = await playwright.request.newContext({ baseURL });
    bob = await playwright.request.newContext({ baseURL });
    for (const c of [alice, bob])
      expect(
        (
          await c.post("/api/auth/register", {
            data: { handle: unique(), password },
          })
        ).status(),
      ).toBe(200);
  });
  test.afterAll(async () => {
    await alice?.dispose();
    await bob?.dispose();
  });
  test("rejects unauthenticated mutations and cross-site origins", async ({
    request,
  }) => {
    expect((await order(request)).status()).toBe(401);
    expect(
      (
        await alice.post("/api/transfers", {
          headers: { Origin: "https://example.invalid" },
          data: {},
        })
      ).status(),
    ).toBe(403);
  });
  test("settles against actual maker price with independently calculated atom balances", async () => {
    const before = await (await alice.get("/api/account")).json();
    const book = await (await alice.get("/api/book/BTCUSDT")).json();
    const makerPrice = atoms(book.asks[0].price),
      qty = 100000n,
      quote = (makerPrice * qty) / 100000000n,
      fee = (quote + 999n) / 1000n;
    const r = await order(alice, { price: book.asks[0].price });
    expect(r.status()).toBe(200);
    expect((await r.json()).state).toBe("FILLED");
    const after = await (await alice.get("/api/account")).json();
    expect(balance(after, "BTC") - balance(before, "BTC")).toBe(qty);
    expect(balance(before, "USDT") - balance(after, "USDT")).toBe(quote + fee);
    expect(balance(after, "USDT", "SPOT", "held")).toBe(0n);
  });
  test("parallel retries execute once and changed-payload retries conflict", async () => {
    const id = randomUUID(),
      before = await (await alice.get("/api/account")).json();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        order(alice, { commandId: id, price: "66000" }),
      ),
    );
    const data = await Promise.all(results.map((r) => r.json()));
    expect(results.every((r) => r.status() === 200)).toBe(true);
    expect(new Set(data.map((x) => x.id)).size).toBe(1);
    const after = await (await alice.get("/api/account")).json();
    expect(balance(after, "BTC") - balance(before, "BTC")).toBe(100000n);
    expect(
      (
        await order(alice, { commandId: id, price: "66000", quantity: "0.002" })
      ).status(),
    ).toBe(409);
  });
  test("resting orders reserve funds; cancellation is owned and repeatable", async () => {
    const before = await (await alice.get("/api/account")).json();
    const r = await order(alice, { price: "100", quantity: "1" });
    expect(r.status()).toBe(200);
    const o = await r.json();
    const reserved = await (await alice.get("/api/account")).json();
    expect(balance(reserved, "USDT", "SPOT", "held")).toBeGreaterThan(
      10000000000n,
    );
    expect((await bob.delete(`/api/orders/${o.id}`)).status()).toBe(400);
    expect((await alice.delete(`/api/orders/${o.id}`)).status()).toBe(200);
    expect((await alice.delete(`/api/orders/${o.id}`)).status()).toBe(200);
    const after = await (await alice.get("/api/account")).json();
    expect(balance(after, "USDT")).toBe(balance(before, "USDT"));
    expect(balance(after, "USDT", "SPOT", "held")).toBe(0n);
  });
  test("FOK and post-only reject before any economic effect", async () => {
    const before = await (await alice.get("/api/account")).json();
    expect(
      (
        await order(alice, { timeInForce: "FOK", price: "1", quantity: "10" })
      ).status(),
    ).toBe(400);
    expect(
      (await order(alice, { timeInForce: "POST", price: "66000" })).status(),
    ).toBe(400);
    const after = await (await alice.get("/api/account")).json();
    expect(after.balances).toEqual(before.balances);
  });
  test("IOC without eligible liquidity expires and releases all funds", async () => {
    const before = await (await alice.get("/api/account")).json();
    const r = await order(alice, {
      type: "MARKET",
      timeInForce: "IOC",
      price: "100",
      quantity: "1",
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).state).toBe("EXPIRED");
    expect((await (await alice.get("/api/account")).json()).balances).toEqual(
      before.balances,
    );
  });
  test("FOK sweeps price levels in order with independent fill/fee expectations", async () => {
    const book = await (await alice.get("/api/book/BTCUSDT")).json();
    const before = await (await alice.get("/api/account")).json();
    const target = atoms(book.asks[0].quantity) + 100000n;
    const amount = (Number(target) / 100000000).toFixed(8);
    let remaining = target,
      cost = 0n;
    for (const level of book.asks) {
      if (!remaining) break;
      const take =
        remaining < atoms(level.quantity) ? remaining : atoms(level.quantity);
      const quote = (atoms(level.price) * take) / 100000000n;
      cost += quote + (quote + 999n) / 1000n;
      remaining -= take;
    }
    expect(remaining).toBe(0n);
    const response = await order(alice, {
      price: book.asks[1].price,
      quantity: amount,
      timeInForce: "FOK",
    });
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.state).toBe("FILLED");
    const after = await (await alice.get("/api/account")).json();
    expect(balance(after, "BTC") - balance(before, "BTC")).toBe(target);
    expect(balance(before, "USDT") - balance(after, "USDT")).toBe(cost);
    expect(balance(after, "USDT", "SPOT", "held")).toBe(0n);
  });
  test("racing reservations cannot overspend the same wallet", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        order(bob, { price: "50000", quantity: "1" }),
      ),
    );
    expect(results.filter((r) => r.status() === 200).length).toBe(1);
    expect(results.filter((r) => r.status() === 400).length).toBe(7);
    for (const r of results)
      if (r.status() === 200)
        await bob.delete(`/api/orders/${(await r.json()).id}`);
    const a = await (await bob.get("/api/account")).json();
    expect(balance(a, "USDT")).toBe(10000000000000n);
    expect(balance(a, "USDT", "SPOT", "held")).toBe(0n);
  });
  test("transfers and Earn subscriptions have one economic effect on retries", async () => {
    const before = await (await alice.get("/api/account")).json();
    const transfer = {
      commandId: randomUUID(),
      asset: "USDT",
      amount: "123.45678901",
      from: "SPOT",
      to: "FUNDING",
    };
    for (let i = 0; i < 3; i++)
      expect(
        (await alice.post("/api/transfers", { data: transfer })).status(),
      ).toBe(200);
    const mid = await (await alice.get("/api/account")).json();
    expect(
      balance(mid, "USDT", "FUNDING") - balance(before, "USDT", "FUNDING"),
    ).toBe(12345678901n);
    const subscription = {
      commandId: randomUUID(),
      asset: "USDT",
      amount: "50",
    };
    const sub = await (
      await alice.post("/api/earn", { data: subscription })
    ).json();
    expect(
      (await (await alice.post("/api/earn", { data: subscription })).json()).id,
    ).toBe(sub.id);
    expect((await bob.post(`/api/earn/${sub.id}/redeem`)).status()).toBe(400);
    for (let i = 0; i < 2; i++)
      expect((await alice.post(`/api/earn/${sub.id}/redeem`)).status()).toBe(
        200,
      );
    const after = await (await alice.get("/api/account")).json();
    expect(after.balances.filter((b: any) => b.wallet !== "EARN")).toEqual(
      mid.balances.filter((b: any) => b.wallet !== "EARN"),
    );
  });
  test("decimal filters and insufficient funds roll back all postings", async () => {
    const before = await (await alice.get("/api/account")).json();
    for (const invalid of [
      { quantity: "1e2" },
      { quantity: "0.000001" },
      { price: "65000.001" },
      { quantity: "-1" },
      { quantity: "100" },
    ])
      expect((await order(alice, invalid)).status()).toBe(400);
    expect(
      (
        await alice.post("/api/orders", {
          data: {
            commandId: randomUUID(),
            symbol: "BTCUSDT",
            side: "BUY",
            type: "LIMIT",
            timeInForce: "GTC",
            price: 65010,
            quantity: 0.001,
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await alice.post("/api/transfers", {
          data: {
            commandId: randomUUID(),
            asset: "USDT",
            amount: 1,
            from: "SPOT",
            to: "FUNDING",
          },
        })
      ).status(),
    ).toBe(400);
    expect((await (await alice.get("/api/account")).json()).balances).toEqual(
      before.balances,
    );
  });
  test("reconciles every journal and balance after hostile schedules", async () => {
    const status = await (await alice.get("/api/status")).json();
    expect(status.ledger.balanced).toBe(true);
    expect(status.ledger.imbalancedJournals).toBe(0);
    expect(status.ledger.projectionMismatches).toBe(0);
    fs.mkdirSync("artifacts", { recursive: true });
    fs.writeFileSync(
      "artifacts/reconciliation.json",
      JSON.stringify(status, null, 2),
    );
  });
});

test("uncertain order survives reload and status lookup does not execute twice", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Market snapshots connected")).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Username").fill(unique());
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Order price", { exact: true }).fill("100");
  await page.getByLabel("Order amount", { exact: true }).fill("1");
  await page.route(
    "**/api/orders",
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Buy BTC", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check order status" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Unconfirmed order restored.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check order status" }).click();
  await expect(page.getByRole("status")).toContainText("Order recovered: new");
  const account = await (await page.request.get("/api/account")).json();
  expect(account.orders).toHaveLength(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Order canceled");
});

test("browser journey: account → order → cancel → transfer → Earn → redeem", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Market snapshots connected")).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Username").fill(unique());
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel("Order price", { exact: true }).fill("100");
  await page.getByLabel("Order amount", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Buy BTC", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("Order canceled; residual funds released."),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Assets", exact: true })
    .click();
  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await page.getByLabel("Transfer amount").fill("75");
  await page.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(page.getByRole("status")).toContainText("Transfer completed.");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Earn", exact: true })
    .click();
  await page.getByLabel("Subscription amount").fill("25");
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Redeem", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Redeem", exact: true }).click();
  await expect(page.getByText("Principal redeemed to Spot.")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Trade", exact: false })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
