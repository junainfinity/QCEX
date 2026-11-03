export const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];
export const STALE_MS = 5000;
const decimal = (v, zero = false) =>
  typeof v === "string" &&
  /^\d+(\.\d{1,18})?$/.test(v) &&
  Number.isFinite(Number(v)) &&
  (zero ? Number(v) >= 0 : Number(v) > 0);
const stamp = (v) => Number.isSafeInteger(v) && v > 0;
export function candle(row) {
  const [time, open, high, low, close, volume] = row;
  if (
    !stamp(time) ||
    ![open, high, low, close].every((v) => decimal(v)) ||
    !decimal(volume, true) ||
    Number(low) > Math.min(Number(open), Number(close)) ||
    Number(high) < Math.max(Number(open), Number(close))
  )
    throw Error("Invalid candle");
  return { time: Math.floor(time / 1000), open, high, low, close, volume };
}
export function mergeCandles(history, live) {
  const rows = new Map(history.map((c) => [c.time, c]));
  for (const c of live) rows.set(c.time, c);
  return [...rows.values()].sort((a, b) => a.time - b.time).slice(-600);
}
export class MarketStore {
  constructor() {
    this.connected = false;
    this.epoch = 0;
    this.lastMessage = 0;
    this.revision = 0;
    this.markets = new Map(
      SYMBOLS.map((symbol) => [
        symbol,
        {
          symbol,
          ticker: null,
          book: null,
          trades: [],
          candles: {},
          tickerAt: 0,
          bookAt: 0,
        },
      ]),
    );
  }
  ingest(stream, data, now = Date.now()) {
    const [name, channel] = stream.split("@");
    const market = this.markets.get(name.toUpperCase());
    if (!market) return false;
    if (channel === "depth20") {
      if (
        !stamp(data.lastUpdateId) ||
        !Array.isArray(data.bids) ||
        !Array.isArray(data.asks)
      )
        return false;
      if (market.book && data.lastUpdateId <= market.book.sequence)
        return false;
      const side = (rows, descending) => {
        if (!rows.length || rows.length > 20) throw Error("Invalid depth size");
        const levels = rows.map(([price, quantity]) => {
          if (!decimal(price) || !decimal(quantity))
            throw Error("Invalid depth level");
          return { price, quantity };
        });
        for (let i = 1; i < levels.length; i++)
          if (
            descending
              ? Number(levels[i - 1].price) <= Number(levels[i].price)
              : Number(levels[i - 1].price) >= Number(levels[i].price)
          )
            throw Error("Unsorted depth");
        return levels;
      };
      const bids = side(data.bids, true),
        asks = side(data.asks, false);
      if (Number(bids[0].price) >= Number(asks[0].price))
        throw Error("Crossed depth");
      // Binance partial-depth messages are complete top-20 snapshots, not diffs.
      market.book = { sequence: data.lastUpdateId, bids, asks };
      market.bookAt = now;
    } else if (channel === "ticker") {
      if (
        data.s !== market.symbol ||
        !stamp(data.E) ||
        ![data.c, data.h, data.l].every((v) => decimal(v)) ||
        !decimal(data.v, true) ||
        !decimal(data.q, true) ||
        !Number.isFinite(Number(data.P))
      )
        return false;
      if (market.ticker && data.E < market.ticker.eventTime) return false;
      market.ticker = {
        price: data.c,
        high: data.h,
        low: data.l,
        volume: data.v,
        quoteVolume: data.q,
        change: data.P,
        eventTime: data.E,
      };
      market.tickerAt = now;
    } else if (channel === "aggTrade") {
      if (
        data.s !== market.symbol ||
        !stamp(data.a) ||
        !stamp(data.T) ||
        !decimal(data.p) ||
        !decimal(data.q) ||
        typeof data.m !== "boolean"
      )
        return false;
      if (market.trades[0] && data.a <= market.trades[0].id) return false;
      market.trades.unshift({
        id: data.a,
        price: data.p,
        quantity: data.q,
        time: data.T,
        side: data.m ? "SELL" : "BUY",
      });
      market.trades.length = Math.min(market.trades.length, 40);
    } else if (channel?.startsWith("kline_")) {
      const k = data.k,
        interval = channel.slice(6);
      if (
        !INTERVALS.includes(interval) ||
        data.s !== market.symbol ||
        k?.i !== interval ||
        !stamp(data.E)
      )
        return false;
      const c = candle([k.t, k.o, k.h, k.l, k.c, k.v]);
      const old = market.candles[interval];
      if (old && (c.time < old.time || data.E < old.eventTime)) return false;
      market.candles[interval] = {
        ...c,
        eventTime: data.E,
        receivedAt: now,
        closed: k.x === true,
      };
    } else return false;
    this.lastMessage = now;
    this.revision++;
    return true;
  }
  snapshot(symbol, now = Date.now()) {
    const m = this.markets.get(symbol);
    if (!m) throw Error("Unsupported symbol");
    const fresh =
      this.connected &&
      m.bookAt > 0 &&
      m.tickerAt > 0 &&
      now - m.bookAt < STALE_MS &&
      now - m.tickerAt < STALE_MS;
    return {
      provider: "Binance",
      kind: "REFERENCE",
      symbol,
      serverTime: now,
      epoch: this.epoch,
      revision: this.revision,
      status: fresh ? "live" : m.book ? "stale" : "connecting",
      bookAgeMs: m.bookAt ? now - m.bookAt : null,
      tickerAgeMs: m.tickerAt ? now - m.tickerAt : null,
      ...m,
      markets: SYMBOLS.map((s) => {
        const x = this.markets.get(s);
        return {
          symbol: s,
          ticker: x.ticker,
          status:
            this.connected && now - x.tickerAt < STALE_MS ? "live" : "stale",
        };
      }),
    };
  }
}
