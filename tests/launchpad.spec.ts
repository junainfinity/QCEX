import { test, expect } from '@playwright/test';

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844], ['narrow-mobile', 320, 844]] as const) {
  test(`LaunchPad discovery, stages and read-only allocation: ${name}`, async ({ page }) => {
    const mutations: string[] = [], errors: string[] = [];
    page.on('request', r => { if (r.url().includes('/api/') && !['GET','HEAD'].includes(r.method())) mutations.push(r.url()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await page.goto('/#launchpad');
    await expect(page.getByRole('button', {name:'LaunchPad',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.locator('.lp-card')).toHaveCount(6);
    await expect(page.getByRole('button', {name:'Development',exact:true})).toHaveCount(0);
    await expect(page.locator('link[rel="icon"][href="https://quantellics.com/favicon.svg"]')).toHaveCount(1);
    await page.screenshot({path:`artifacts/launchpad-${name}.png`,fullPage:true});
    for (const [stage,count] of [['Upcoming',2],['Fundraising',2],['Allocation',1],['Ready to list',1]] as const) {
      await page.getByRole('button',{name:stage,exact:true}).click();
      await expect(page.locator('.lp-card')).toHaveCount(count);
    }
    await page.getByRole('button',{name:'View Lumen Mesh'}).click();
    await expect(page.getByText('No participation is available at this demo stage.')).toBeVisible();
    await expect(page.getByLabel('Hypothetical commitment (USDT)')).toHaveCount(0);
    await page.getByRole('button',{name:'← All projects'}).click();
    await page.getByRole('button',{name:'All',exact:true}).click();
    await page.getByLabel('Search LaunchPad projects').fill('missing');
    await expect(page.getByRole('heading',{name:'No matching projects'})).toBeVisible();
    await page.getByRole('button',{name:'Clear filters'}).click();
    await page.getByLabel('Search LaunchPad projects').fill('ORBT');
    await expect(page.locator('.lp-card')).toHaveCount(1);
    await page.getByRole('button',{name:'View Orbit Network'}).click();
    await expect(page.getByTestId('lp-estimate')).toHaveText('1,250 ORBT');
    const amount = page.getByLabel('Hypothetical commitment (USDT)');
    for (const invalid of ['0','-1','5001','abc','10.001']) {
      await amount.fill(invalid);
      await expect(page.getByRole('region',{name:'Allocation preview'}).getByRole('alert')).toBeVisible();
      await expect(page.getByTestId('lp-estimate')).toHaveText('— ORBT');
    }
    await amount.fill('100');
    await page.screenshot({path:`artifacts/launchpad-detail-${name}.png`,fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'← All projects'}).click();
    await page.getByLabel('Search LaunchPad projects').fill('Verdant');
    await page.getByRole('button',{name:'View Verdant Compute'}).click();
    // 8,000,000 * 100 / 2,450,100 = 326.517... tokens, below purchase cap of 400.
    await expect(page.getByTestId('lp-estimate')).toHaveText('326.52 VRDN');
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
