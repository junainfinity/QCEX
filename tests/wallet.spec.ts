import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('wallet ledger: authorization, duplicate retries, validation and conservation', async ({ playwright, baseURL, request }) => {
  const a=await playwright.request.newContext({baseURL}), b=await playwright.request.newContext({baseURL});
  try {
    for(const c of [a,b])expect((await c.post('/api/auth/register',{data:{handle:`w_${randomUUID().slice(0,15).replaceAll('-','')}`,password:'Wallet_Test_2026!'}})).status()).toBe(200);
    expect((await request.get('/api/wallet')).status()).toBe(401);
    const initial=await (await a.get('/api/wallet')).json();
    for(const [asset,amount] of [['USDT','10'],['BTC','0.001'],['ETH','0.01'],['SOL','0.1']]) {
      const data={commandId:randomUUID(),asset,amount,network:'QCEX-SIM',address:`QCEX-SIM-${asset}-test`,demoCode:'123456'};
      expect((await request.post('/api/wallet/deposit',{data})).status()).toBe(401);
      const results=await Promise.all(Array.from({length:4},()=>a.post('/api/wallet/deposit',{data})));
      const bodies=await Promise.all(results.map(async r=>{expect(r.status()).toBe(200);return r.json();}));
      expect(new Set(bodies.map(r=>r.id)).size).toBe(1);
      expect((await a.post('/api/wallet/deposit',{data:{...data,amount:'0.0001'}})).status()).toBe(409);
      expect((await (await b.get(`/api/commands/${data.commandId}`)).json()).found).toBe(false);
      expect((await a.post('/api/wallet/withdraw',{data:{...data,commandId:randomUUID()}})).status()).toBe(200);
    }
    const bad={asset:'USDT',amount:'1',network:'QCEX-SIM',address:'QCEX-SIM-USDT-test',demoCode:'123456'};
    for(const change of [{amount:'0'},{amount:'-1'},{amount:'1e3'},{amount:1},{amount:'100001'},{network:'ETH'},{asset:'FAKE'},{address:'0x1234567890'},{demoCode:'000000'}]) {
      expect((await a.post('/api/wallet/withdraw',{data:{...bad,...change,commandId:randomUUID()}})).status()).toBe(400);
    }
    expect((await a.post('/api/wallet/withdraw',{data:{...bad,asset:'BTC',amount:'1',address:'QCEX-SIM-BTC-test',commandId:randomUUID()}})).status()).toBe(400);
    const after=await(await a.get('/api/wallet')).json();
    expect(after.totalUsd).toBe(initial.totalUsd);
    expect(after.movements).toHaveLength(8);
    expect(after.assets.map((r:{total:string})=>r.total)).toEqual(initial.assets.map((r:{total:string})=>r.total));
    expect((await(await a.get('/api/status')).json()).ledger.balanced).toBe(true);
  } finally {await a.dispose();await b.dispose();}
});

for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844],['narrow',320,844]] as const) {
  test(`wallet snapshot and deposit-withdraw round trip: ${name}`, async({page})=>{
    await page.setViewportSize({width,height});
    await page.goto('/#assets');
    await page.getByRole('button',{name:'Log in',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByTestId('wallet-total')).toHaveText('$69,420.00');
    for(const asset of ['USDT','BTC','ETH','SOL']) {
      await expect(page.getByRole('button',{name:`Deposit ${asset}`,exact:true})).toHaveCount(1);
      await expect(page.getByRole('button',{name:`Withdraw ${asset}`,exact:true})).toHaveCount(1);
    }
    await page.screenshot({path:`artifacts/wallet-${name}.png`,fullPage:true});
    await page.getByRole('button',{name:'Deposit USDT',exact:true}).click();
    await expect(page.getByLabel('Demo deposit address')).toHaveValue(/^QCEX-SIM-USDT-/);
    await page.getByLabel('Wallet amount').fill('100');
    await page.screenshot({path:`artifacts/wallet-deposit-${name}.png`,fullPage:true});
    await page.getByRole('button',{name:'Simulate deposit',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('completed');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await expect(page.getByTestId('wallet-total')).toHaveText('$69,520.00');
    await page.getByRole('button',{name:'Withdraw USDT',exact:true}).click();
    await page.getByLabel('Wallet amount').fill('100');
    await page.getByRole('button',{name:'Review withdrawal',exact:true}).click();
    await page.screenshot({path:`artifacts/wallet-withdraw-${name}.png`,fullPage:true});
    await page.getByRole('button',{name:'Confirm simulated withdrawal',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('completed');
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await expect(page.getByTestId('wallet-total')).toHaveText('$69,420.00');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
