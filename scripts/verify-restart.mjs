import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";

const url = "http://127.0.0.1:3100/api";
const credentials = {
  handle: `r_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
  password: randomUUID() + "!",
};
const login = await fetch(url + "/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(credentials),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
let transportRetries = 0;
async function request(path, method = "GET", data) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url + path, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: data ? JSON.stringify(data) : undefined,
      });
      const result = await r.json();
      if (!r.ok) throw Error(`HTTP ${r.status} at ${path}`);
      return result;
    } catch (error) {
      if (attempt === 3) throw error;
      transportRetries++;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
const order = {
  commandId: randomUUID(),
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  timeInForce: "GTC",
  price: "100",
  quantity: "1",
};
const resting = await request("/orders", "POST", order);
const subscription = await request("/earn", "POST", {
  commandId: randomUUID(),
  asset: "USDT",
  amount: "25",
});
const before = await request("/account");
const commands = Array.from({ length: 10 }, () => ({
  ...order,
  commandId: randomUUID(),
  price: "66000",
  quantity: "0.001",
}));
const uncertain = commands.map((c) =>
  request("/orders", "POST", c).catch(() => null),
);
execFileSync("docker", ["compose", "kill", "-s", "SIGKILL", "api"], {
  stdio: "pipe",
});
await Promise.all(uncertain);
execFileSync(
  "docker",
  ["compose", "--profile", "preview", "up", "-d", "--wait", "api"],
  { stdio: "pipe", timeout: 90000 },
);
const retried = [];
for (const c of commands) retried.push(await request("/orders", "POST", c));
const after = await request("/account");
assert.equal(new Set(retried.map((o) => o.id)).size, 10);
assert.equal(
  after.orders.filter((o) => retried.some((r) => r.id === o.id)).length,
  10,
);
assert.equal(after.fills.length - before.fills.length, 10);
assert.equal(after.orders.find((o) => o.id === resting.id).state, "NEW");
assert.equal(
  after.subscriptions.find((s) => s.id === subscription.id).state,
  "ACTIVE",
);
const beforeRestart = await request("/account");
execFileSync("docker", ["compose", "restart", "mysql"], {
  stdio: "pipe",
  timeout: 30000,
});
execFileSync(
  "docker",
  ["compose", "--profile", "preview", "up", "-d", "--wait"],
  { stdio: "pipe", timeout: 90000 },
);
const afterRestart = await request("/account");
assert.deepEqual(afterRestart, beforeRestart);
const status = await request("/status");
assert.equal(status.ledger.balanced, true);
await request(`/orders/${resting.id}`, "DELETE");
await request(`/earn/${subscription.id}/redeem`, "POST");
const result = {
  status: "PASS",
  date: new Date().toISOString(),
  apiFailure: "SIGKILL during 10 submissions; retry original IDs",
  distinctOrders: 10,
  distinctFills: 10,
  transportRetries,
  restingOrderPreserved: true,
  subscriptionPreserved: true,
  mysqlRestart: "Account state identical",
  reconciliation: status.ledger,
  limits:
    "Single-host process/database restart only. Not replicated failover or zone recovery.",
};
fs.writeFileSync(
  "artifacts/restart-result.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
