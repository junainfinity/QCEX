import test from "node:test";
import assert from "node:assert/strict";
import { MarketStore, candle, mergeCandles } from "./core.mjs";
const depth = (id = 1) => ({
  lastUpdateId: id,
  bids: [
    ["100", "2"],
    ["99", "3"],
  ],
  asks: [
    ["101", "4"],
    ["102", "5"],
  ],
});
test("partial-depth snapshots replace old levels and reject reordered updates", () => {
  const store = new MarketStore();
  store.ingest("btcusdt@depth20@100ms", depth(), 1000);
  store.ingest(
    "btcusdt@depth20@100ms",
    { lastUpdateId: 9, bids: [["98", "1"]], asks: [["104", "1"]] },
    1100,
  );
  assert.equal(store.ingest("btcusdt@depth20@100ms", depth(8), 1200), false);
  assert.deepEqual(store.snapshot("BTCUSDT", 1200).book.bids, [
    { price: "98", quantity: "1" },
  ]);
  assert.equal(store.snapshot("BTCUSDT", 1200).bookAt, 1100);
});
test("crossed, nonfinite, malformed and unsorted books cannot corrupt a valid book", () => {
  const store = new MarketStore();
  store.ingest("btcusdt@depth20@100ms", depth());
  for (const rows of [
    [["999", "1"]],
    [["NaN", "1"]],
    [["100", "0"]],
    [
      ["99", "1"],
      ["100", "1"],
    ],
  ])
    assert.throws(() =>
      store.ingest("btcusdt@depth20@100ms", { ...depth(2), bids: rows }),
    );
  assert.equal(store.snapshot("BTCUSDT").book.sequence, 1);
});
test("freshness requires both ticker and depth and expires even with a connected socket", () => {
  const store = new MarketStore();
  store.connected = true;
  const t = {
    s: "BTCUSDT",
    E: 1000,
    c: "100",
    h: "120",
    l: "90",
    v: "30",
    q: "3000",
    P: "2",
  };
  store.ingest("btcusdt@ticker", t, 1000);
  assert.notEqual(store.snapshot("BTCUSDT", 1100).status, "live");
  store.ingest("btcusdt@depth20@100ms", depth(), 1100);
  assert.equal(store.snapshot("BTCUSDT", 1200).status, "live");
  assert.equal(store.snapshot("BTCUSDT", 7000).status, "stale");
  store.connected = false;
  assert.equal(store.snapshot("BTCUSDT", 1200).status, "stale");
});
test("symbols remain isolated and unsupported markets never enter the cache", () => {
  const store = new MarketStore();
  assert.equal(store.ingest("solusdt@depth20", depth()), false);
  store.ingest("ethusdt@depth20", depth());
  assert.equal(store.snapshot("BTCUSDT").book, null);
  assert.throws(() => store.snapshot("SOLUSDT"));
});
test("trade tape is monotonic, deduplicated and bounded to 40 external trades", () => {
  const store = new MarketStore();
  for (let a = 1; a <= 100; a++)
    store.ingest("btcusdt@aggTrade", {
      a,
      s: "BTCUSDT",
      T: 1000 + a,
      p: "100",
      q: "1",
      m: a % 2 === 0,
    });
  assert.equal(
    store.ingest("btcusdt@aggTrade", {
      a: 99,
      s: "BTCUSDT",
      T: 1100,
      p: "50",
      q: "1",
      m: false,
    }),
    false,
  );
  const trades = store.snapshot("BTCUSDT").trades;
  assert.equal(trades.length, 40);
  assert.equal(trades[0].id, 100);
  assert.equal(trades[0].side, "SELL");
});
test("history and live candles merge by UTC open time without duplicate bars", () => {
  const c = candle([60000, "1", "3", "1", "2", "10"]),
    next = { ...c, close: "3", volume: "11" };
  assert.deepEqual(mergeCandles([c], [next]), [next]);
  assert.throws(() => candle([60000, "4", "3", "1", "2", "10"]));
  assert.equal(
    mergeCandles(
      Array.from({ length: 700 }, (_, i) => ({ ...c, time: i })),
      [],
    ).length,
    600,
  );
});
test("old live candles and wrong interval payloads are rejected", () => {
  const store = new MarketStore(),
    payload = {
      E: 120000,
      s: "BTCUSDT",
      k: {
        i: "1m",
        t: 60000,
        o: "1",
        h: "3",
        l: "1",
        c: "2",
        v: "10",
        x: false,
      },
    };
  assert.equal(store.ingest("btcusdt@kline_1m", payload), true);
  assert.equal(store.ingest("btcusdt@kline_5m", payload), false);
  assert.equal(
    store.ingest("btcusdt@kline_1m", { ...payload, E: 1000 }),
    false,
  );
});
