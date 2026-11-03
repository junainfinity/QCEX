import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const primary = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];
for (const size of primary)
  test(`complete visual QA and navigation: ${size.name}`, async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(size);
    await page.goto("/");
    await expect
      .poll(async () =>
        Number(
          await page.getByTestId("live-chart").getAttribute("data-candles"),
        ),
      )
      .toBeGreaterThanOrEqual(500);
    const dir = `artifacts/ui/${size.name}`;
    fs.mkdirSync(dir, { recursive: true });
    async function shot(name: string) {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name}: document overflow`,
      ).toBe(true);
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    }
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const trade = nav.getByRole("button", { name: "Trade", exact: true });
    await expect(trade).toHaveAttribute("aria-current", "page");
    expect((await trade.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await trade.textContent()).toBe("Trade");
    await shot("01-trade");
    for (const [name, selector] of [
      ["02-chart", ".chart-panel"],
      ["03-orderbook", ".orderbook"],
      ["04-ticket", ".ticket-panel"],
      ["05-pairs-tape", ".right-column"],
    ])
      await page.locator(selector).screenshot({ path: `${dir}/${name}.png` });
    const chartBox = (await page.locator(".chart-panel").boundingBox())!,
      ticketBox = (await page.locator(".ticket-panel").boundingBox())!;
    expect(ticketBox.y).toBeGreaterThanOrEqual(
      chartBox.y + chartBox.height - 1,
    );
    const overlap = await page
      .getByRole("button", { name: "Use sandbox price", exact: true })
      .evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return top === el || el.contains(top);
      });
    expect(overlap).toBe(true);
    await page
      .getByLabel("Trading pair", { exact: true })
      .selectOption("ETHUSDT");
    await expect(page.getByTestId("live-chart")).toHaveAttribute(
      "data-symbol",
      "ETHUSDT",
    );
    await page
      .getByLabel("Trading pair", { exact: true })
      .selectOption("BTCUSDT");
    await nav.getByRole("button", { name: "Markets", exact: true }).click();
    await shot("06-markets");
    await nav.getByRole("button", { name: "Earn", exact: true }).click();
    await shot("07-earn-guest");
    await page.goBack();
    await expect(
      nav.getByRole("button", { name: "Markets", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await nav.getByRole("button", { name: "Assets", exact: true }).focus();
    await page.keyboard.press("Enter");
    await shot("08-assets-guest");
    await expect(nav.getByRole("button", { name: "Development", exact: true })).toHaveCount(0);
    await nav.getByRole("button", { name: "Trade", exact: true }).focus();
    await page.keyboard.press("Space");
    await shot("09-trade-keyboard");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await shot("10-login");
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await shot("11-register");
    const dialog = page.getByRole("dialog"),
      handle = `qa_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await dialog.getByLabel("Username").fill(handle);
    await dialog
      .getByLabel("Password", { exact: true })
      .fill("SyntheticOnly_2026!");
    await dialog
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await nav.getByRole("button", { name: "Assets", exact: true }).click();
    await shot("12-assets-account");
    await page.getByRole("button", { name: "Transfer", exact: true }).click();
    await shot("13-transfer");
    await page.getByLabel("Transfer amount").fill("100");
    await page
      .getByRole("button", { name: "Confirm transfer", exact: true })
      .click();
    await nav.getByRole("button", { name: "Earn", exact: true }).click();
    await page.getByLabel("Subscription amount").fill("25");
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Redeem", exact: true }),
    ).toBeVisible();
    await shot("14-earn-account");
    await page.getByRole("button", { name: "Redeem", exact: true }).click();
    await trade.click();
    await page.getByLabel("Order price", { exact: true }).fill("100");
    await page.getByLabel("Order amount", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Buy BTC", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    await shot("15-open-orders");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Use sandbox price", exact: true })
      .click();
    await page.getByLabel("Order amount", { exact: true }).fill("0.001");
    await page.getByRole("button", { name: "Buy BTC", exact: true }).click();
    await page
      .getByRole("button", { name: "Trade history", exact: true })
      .click();
    await shot("16-fill-history");
    await page.getByLabel("Order type", { exact: true }).selectOption("MARKET");
    await shot("17-protected-order");
    expect(errors).toEqual([]);
  });

for (const size of [
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "narrow-mobile", width: 320, height: 844 },
])
  test(`boundary layout: ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect
      .poll(async () =>
        Number(
          await page.getByTestId("live-chart").getAttribute("data-candles"),
        ),
      )
      .toBeGreaterThanOrEqual(500);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const box = (await page.locator(".chart-panel").boundingBox())!,
      ticket = (await page.locator(".ticket-panel").boundingBox())!;
    expect(ticket.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    await page
      .getByRole("button", { name: "Use sandbox price", exact: true })
      .click();
    fs.mkdirSync("artifacts/ui/boundaries", { recursive: true });
    await page.screenshot({
      path: `artifacts/ui/boundaries/${size.name}.png`,
      fullPage: true,
    });
  });
