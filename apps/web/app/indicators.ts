export type Candle = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};
export type Point = { time: number; value: number };
export function indicators(candles: Candle[]) {
  const sma: Point[] = [],
    ema: Point[] = [],
    upper: Point[] = [],
    lower: Point[] = [],
    rsi: Point[] = [];
  let emaValue = 0,
    gain = 0,
    loss = 0;
  const closes = candles.map((c) => Number(c.close));
  for (let i = 0; i < candles.length; i++) {
    const time = candles[i].time;
    if (i >= 19) {
      const window = closes.slice(i - 19, i + 1),
        mean = window.reduce((a, b) => a + b, 0) / 20;
      const deviation = Math.sqrt(
        window.reduce((a, b) => a + (b - mean) ** 2, 0) / 20,
      );
      sma.push({ time, value: mean });
      upper.push({ time, value: mean + 2 * deviation });
      lower.push({ time, value: mean - 2 * deviation });
    }
    if (i === 49)
      emaValue = closes.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    else if (i > 49) emaValue = closes[i] * (2 / 51) + emaValue * (49 / 51);
    if (i >= 49) ema.push({ time, value: emaValue });
    if (i > 0) {
      const change = closes[i] - closes[i - 1],
        up = Math.max(0, change),
        down = Math.max(0, -change);
      if (i <= 14) {
        gain += up / 14;
        loss += down / 14;
      } else {
        gain = (gain * 13 + up) / 14;
        loss = (loss * 13 + down) / 14;
      }
      if (i >= 14)
        rsi.push({
          time,
          value:
            gain === 0 && loss === 0
              ? 50
              : loss === 0
                ? 100
                : 100 - 100 / (1 + gain / loss),
        });
    }
  }
  return { sma, ema, upper, lower, rsi };
}
