import http from "node:http";
import {
  MarketStore,
  SYMBOLS,
  INTERVALS,
  candle,
  mergeCandles,
} from "./core.mjs";

const store = new MarketStore(),
  cache = new Map(),
  pending = new Map();
const REST = "https://data-api.binance.vision/api/v3";
const streams = SYMBOLS.flatMap((s) =>
  [
    "depth20@100ms",
    "ticker",
    "aggTrade",
    ...INTERVALS.map((i) => `kline_${i}`),
  ].map((c) => `${s.toLowerCase()}@${c}`),
);
let socket,
  reconnect,
  rotation,
  attempts = 0,
  stopped = false,
  blockedUntil = 0;
function connect() {
  if (stopped) return;
  socket = new WebSocket(
    `wss://data-stream.binance.vision/stream?streams=${streams.join("/")}`,
  );
  const ws = socket;
  const handshake = setTimeout(() => ws.close(), 12000);
  ws.onopen = () => {
    clearTimeout(handshake);
    store.connected = true;
    store.epoch++;
    store.lastMessage = Date.now();
    cache.clear();
    for (const m of store.markets.values()) {
      m.bookAt = 0;
      m.tickerAt = 0;
    }
    console.log(
      JSON.stringify({
        event: "upstream_connected",
        provider: "Binance",
        epoch: store.epoch,
        symbols: SYMBOLS,
      }),
    );
    rotation = setTimeout(() => ws.close(), 23 * 60 * 60 * 1000);
  };
  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.data?.e === "serverShutdown") {
        ws.close();
        return;
      }
      if (store.ingest(payload.stream || "", payload.data)) attempts = 0;
    } catch {
      /* Invalid upstream records never replace a validated snapshot. */
    }
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    clearTimeout(handshake);
    clearTimeout(rotation);
    store.connected = false;
    if (!stopped) {
      const delay =
        Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) +
        Math.random() * 500;
      reconnect = setTimeout(connect, delay);
    }
  };
}
connect();
const watchdog = setInterval(() => {
  if (store.connected && Date.now() - store.lastMessage > 15000) socket.close();
}, 1000);
async function history(symbol, interval) {
  const key = `${symbol}:${interval}`,
    existing = cache.get(key);
  if (existing && Date.now() - existing.at < 30000) return existing.rows;
  if (pending.has(key)) return pending.get(key);
  if (Date.now() < blockedUntil)
    throw Error("History provider cooling down; retry shortly");
  const generation = store.epoch;
  const request = (async () => {
    const response = await fetch(
      `${REST}/klines?symbol=${symbol}&interval=${interval}&limit=500`,
      { signal: AbortSignal.timeout(8000), redirect: "error" },
    );
    if (response.status === 429 || response.status === 418)
      blockedUntil =
        Date.now() +
        Math.max(
          60000,
          Number(response.headers.get("retry-after") || 60) * 1000,
        );
    if (!response.ok)
      throw Error(`History provider unavailable (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload) || !payload.length || payload.length > 500)
      throw Error("Invalid history response");
    const rows = payload.map(candle);
    for (let i = 1; i < rows.length; i++)
      if (rows[i].time <= rows[i - 1].time)
        throw Error("Invalid candle chronology");
    if (generation === store.epoch) cache.set(key, { at: Date.now(), rows });
    return rows;
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
const clients = new Set();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"),
    symbol = url.searchParams.get("symbol") || "BTCUSDT";
  const json = (code, value) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  if (req.method !== "GET")
    return json(405, { error: "Read-only market-data service" });
  if (url.pathname === "/health")
    return json(200, {
      service: "market-data",
      connected: store.connected,
      epoch: store.epoch,
    });
  if (!SYMBOLS.includes(symbol))
    return json(400, { error: "Only BTCUSDT and ETHUSDT are supported" });
  if (url.pathname === "/snapshot") return json(200, store.snapshot(symbol));
  if (url.pathname === "/candles") {
    const interval = url.searchParams.get("interval") || "1m";
    if (!INTERVALS.includes(interval))
      return json(400, { error: "Unsupported interval" });
    try {
      const rows = await history(symbol, interval),
        latest = store.markets.get(symbol).candles[interval];
      return json(200, {
        provider: "Binance",
        symbol,
        interval,
        epoch: store.epoch,
        candles: mergeCandles(rows, latest ? [latest] : []),
      });
    } catch (e) {
      return json(503, { error: e.message });
    }
  }
  if (url.pathname !== "/stream") return json(404, { error: "Not found" });
  if (clients.size >= 64)
    return json(503, { error: "Stream capacity reached" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const client = { res, symbol };
  clients.add(client);
  res.write(`data: ${JSON.stringify(store.snapshot(symbol))}\n\n`);
  res.on("close", () => clients.delete(client));
});
const broadcast = setInterval(() => {
  const snapshots = new Map();
  for (const client of clients) {
    if (!snapshots.has(client.symbol))
      snapshots.set(
        client.symbol,
        `data: ${JSON.stringify(store.snapshot(client.symbol))}\n\n`,
      );
    if (!client.res.write(snapshots.get(client.symbol))) {
      client.res.destroy();
      clients.delete(client);
    }
  }
}, 250);
server.listen(
  Number(process.env.PORT || 8090),
  process.env.HOST || "0.0.0.0",
  () => console.log("Market-data relay listening on 8090"),
);
function shutdown() {
  stopped = true;
  clearTimeout(reconnect);
  clearTimeout(rotation);
  clearInterval(watchdog);
  clearInterval(broadcast);
  socket?.close();
  for (const c of clients) c.res.end();
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
