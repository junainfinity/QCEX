import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.beforeAll(() => {
  execFileSync(process.execPath, ['scripts/seed-demo.mjs'], { stdio: 'pipe' });
});

test('demo verification is enforced by API and demo account opens in browser', async ({ request, page }) => {
  const credentials = { handle: 'qcex_demo', password: 'QCEX_Demo_2026!' };
  for (const demoCode of [undefined, '000000']) {
    const result = await request.post('/api/auth/login', { data: { ...credentials, demoCode } });
    expect(result.status()).toBe(401);
    expect(result.headers()['set-cookie']).toBeUndefined();
  }
  expect((await request.post('/api/auth/login', { data: { ...credentials, password: 'IncorrectPassword!', demoCode: '123456' } })).status()).toBe(401);
  await page.goto('/#roadmap');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Development', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Built in verified steps.' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'BTC/USDT', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(credentials.handle);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(credentials.password);
  await expect(page.getByLabel('Demo verification code')).toHaveValue('123456');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.user-handle')).toHaveText('qcex_demo');
  const account = await (await page.request.get('/api/account')).json();
  expect(account.orders.length).toBeGreaterThanOrEqual(14);
  expect(account.fills.length).toBeGreaterThanOrEqual(6);
  expect(account.subscriptions.some((s: {state:string}) => s.state === 'ACTIVE')).toBe(true);
  for (const name of ['Assets', 'Earn', 'Trade']) {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
    await page.screenshot({ path: `artifacts/demo-${name.toLowerCase()}.png`, fullPage: true });
  }
});
