import test from "node:test";
import assert from "node:assert/strict";
import { indicators, type Candle } from "../apps/web/app/indicators.ts";
const candles = (values: number[]): Candle[] =>
  values.map((n, i) => ({
    time: i * 60,
    open: String(n),
    high: String(n),
    low: String(n),
    close: String(n),
    volume: "1",
  }));
test("constant prices give exact bands, moving averages and neutral RSI", () => {
  const result = indicators(candles(Array(100).fill(25)));
  for (const field of [result.sma, result.ema, result.upper, result.lower])
    assert(field.every((p) => Math.abs(p.value - 25) < 1e-10));
  assert(result.rsi.every((p) => p.value === 50));
  assert.equal(result.sma.length, 81);
  assert.equal(result.ema.length, 51);
  assert.equal(result.rsi.length, 86);
});
test("arithmetic ramp matches independent closed-form SMA, population bands and EMA", () => {
  const result = indicators(
    candles(Array.from({ length: 60 }, (_, i) => i + 1)),
  );
  assert.equal(result.sma[0].value, 10.5);
  assert.equal(result.ema[0].value, 25.5);
  assert(Math.abs(result.ema[1].value - 26.5) < 1e-10);
  assert(
    Math.abs(result.upper[0].value - (10.5 + 2 * Math.sqrt(399 / 12))) < 1e-10,
  );
  assert(result.rsi.every((p) => p.value === 100));
});
test("Wilder RSI matches a published-style hand calculated mixed-price fixture", () => {
  const result = indicators(
    candles([
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
    ]),
  );
  assert(Math.abs(result.rsi[0].value - 70.46413502109705) < 1e-8);
  assert(Math.abs(result.rsi[1].value - 66.24961855355505) < 1e-8);
});
