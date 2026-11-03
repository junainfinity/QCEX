import { request } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Deliberately public credentials for this local, synthetic-funds demo only.
const credentials = { handle: 'qcex_demo', password: 'QCEX_Demo_2026!', demoCode: '123456' };
const client = await request.newContext({ baseURL: process.env.QCEX_BASE_URL || 'http://127.0.0.1:3100' });
async function json(response) {
  const body = await response.json();
  assert(response.ok(), `${response.status()}: ${JSON.stringify(body)}`);
  return body;
}
async function get(path) { return json(await client.get(`/api/${path}`)); }
async function post(path, data) { return json(await client.post(`/api/${path}`, { data })); }
async function command(key, path, data) {
  const commandId = `qcex_demo_v1_${key}`;
  const existing = await get(`commands/${commandId}`);
  if (existing.found) return { ...existing.order, id: existing.resultId };
  return post(path, { commandId, ...data });
}
try {
  const login = await client.post('/api/auth/login', { data: credentials });
  if (login.status() === 401) await post('auth/register', credentials);
  else await json(login);

  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    const book = await get(`book/${symbol}`);
    assert(book.asks.length && book.bids.length, `${symbol}: local liquidity required`);
    const quantity = symbol === 'BTCUSDT' ? '0.001' : '0.01';
    const bid = book.bids[0].price, ask = book.asks[0].price;
    // Round whole prices away from the book; both instruments accept whole ticks.
    const low = String(Math.floor(Number(bid) * 0.8));
    const high = String(Math.ceil(Number(ask) * 1.2));
    const order = (key, side, type, timeInForce, price) => command(`${symbol}_${key}`, 'orders', {
      symbol, side, type, timeInForce, price, quantity,
    });
    await order('limit_fill', 'BUY', 'LIMIT', 'GTC', ask);
    await order('market_fill', 'SELL', 'MARKET', 'IOC', bid);
    await order('fok_fill', 'BUY', 'LIMIT', 'FOK', ask);
    await order('ioc_cancel', 'BUY', 'LIMIT', 'IOC', low);
    await order('open_buy', 'BUY', 'LIMIT', 'GTC', low);
    await order('open_post_sell', 'SELL', 'LIMIT', 'POST', high);
    const cancelled = await order('cancelled', 'BUY', 'LIMIT', 'GTC', low);
    const current = (await get('account')).orders.find(o => o.id === cancelled.id);
    if (['NEW', 'PARTIALLY_FILLED'].includes(current.state)) await json(await client.delete(`/api/orders/${cancelled.id}`));
  }
  for (const [asset, amount] of [['USDT', '10000'], ['BTC', '0.05'], ['ETH', '0.5'], ['SOL', '10']]) {
    await command(`funding_${asset}`, 'transfers', { asset, amount, from: 'SPOT', to: 'FUNDING' });
  }
  await command('return_transfer', 'transfers', { asset: 'USDT', amount: '1000', from: 'FUNDING', to: 'SPOT' });
  for (const [asset, amount] of [['USDT', '5000'], ['BTC', '0.02'], ['ETH', '0.25'], ['SOL', '5']]) {
    await command(`earn_${asset}`, 'earn', { asset, amount });
  }
  const redeemed = await command('earn_redeemed', 'earn', { asset: 'USDT', amount: '500' });
  await post(`earn/${redeemed.id}/redeem`, {});
  // One-time v2 fixture: preserve all history/holds and adjust only free Spot funds.
  // Fixed snapshot: 47,020 USDT + .2 BTC*65,000 + 2 ETH*3,200 + 20 SOL*150 = $69,420.
  const atoms = value => { const [whole, fraction=''] = value.split('.'); return BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0')); };
  const decimal = value => `${value/100000000n}.${String(value%100000000n).padStart(8,'0')}`;
  for (const [asset, target] of [['USDT','47020'],['BTC','0.2'],['ETH','2'],['SOL','20']]) {
    const key=`wallet_v2_${asset}`;
    if ((await get(`commands/qcex_demo_v1_${key}`)).found) continue;
    const current=await get('account');
    const total=current.balances.filter(b=>b.asset===asset).reduce((sum,b)=>sum+atoms(b.available)+atoms(b.held),0n);
    const delta=atoms(target)-total;
    if(delta!==0n)await command(key,`wallet/${delta>0n?'deposit':'withdraw'}`,{asset,amount:decimal(delta>0n?delta:-delta),network:'QCEX-SIM',address:`QCEX-SIM-${asset}-demo-portfolio`,demoCode:'123456'});
  }
  const wallet = await get('wallet');
  const account = await get('account');
  const status = await get('status');
  assert.equal(status.ledger.balanced, true);
  assert(account.orders.length >= 14);
  assert(account.fills.length >= 6);
  assert(account.subscriptions.some(s => s.state === 'REDEEMED'));
  assert(account.subscriptions.filter(s => s.state === 'ACTIVE').length >= 4);
  const report = { handle: account.user.handle, walletTotalUsd: wallet.totalUsd, valuation: wallet.valuation, balances: account.balances,
    orders: account.orders.map(({ symbol, side, order_type, time_in_force, state }) => ({ symbol, side, order_type, time_in_force, state })),
    fills: account.fills.length, subscriptions: account.subscriptions.map(({asset, principal, state})=>({asset,principal,state})),
    historyKinds: [...new Set(account.history.map(h => h.kind))], ledger: status.ledger };
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/demo-account.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.post('/api/auth/logout');
  await client.dispose();
}
