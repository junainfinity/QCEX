"use client";
import { memo, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { indicators, type Candle, type Point } from "./indicators";
const intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
type Chart = {
  api: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  sma: ISeriesApi<"Line">;
  ema: ISeriesApi<"Line">;
  upper: ISeriesApi<"Line">;
  lower: ISeriesApi<"Line">;
  rsi: ISeriesApi<"Line">;
};
const lineData = (rows: Point[]) =>
  rows.map((p) => ({ ...p, time: p.time as UTCTimestamp }));
export default memo(function MarketChart({
  symbol,
  epoch,
  live,
  status,
}: {
  symbol: string;
  epoch: string;
  live: Record<string, Candle>;
  status: string;
}) {
  const container = useRef<HTMLDivElement>(null),
    chart = useRef<Chart | null>(null),
    prior = useRef<Candle[]>([]);
  const liveRef = useRef(live);
  liveRef.current = live;
  const [interval, setIntervalValue] = useState("1m"),
    [rows, setRows] = useState<Candle[]>([]),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const [showSma, setShowSma] = useState(true),
    [showEma, setShowEma] = useState(true),
    [showBands, setShowBands] = useState(false);
  const [cursor, setCursor] = useState<Candle | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const current = live[interval];
  useEffect(() => {
    if (!container.current) return;
    const api = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#101419" },
        textColor: "#848e9c",
        fontSize: 10,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#1b2027" },
        horzLines: { color: "#1b2027" },
      },
      rightPriceScale: { borderColor: "#252a32" },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#252a32",
        rightOffset: 6,
      },
      crosshair: { mode: 0 },
    });
    const candles = api.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
      borderVisible: false,
    });
    const line = (color: string) =>
      api.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    const sma = line("#f0b90b"),
      ema = line("#a78bfa"),
      upper = line("#5a9df9"),
      lower = line("#5a9df9");
    const volume = api.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    const rsi = api.addSeries(
      LineSeries,
      {
        color: "#a78bfa",
        lineWidth: 1,
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
        priceLineVisible: false,
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
        }),
      },
      2,
    );
    rsi.createPriceLine({
      price: 70,
      color: "#634d75",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: false,
      title: "70",
    });
    rsi.createPriceLine({
      price: 30,
      color: "#634d75",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: false,
      title: "30",
    });
    api.panes()[0].setStretchFactor(5);
    api.panes()[1].setStretchFactor(1);
    api.panes()[2].setStretchFactor(1.4);
    api.subscribeCrosshairMove((param) => {
      const point = param.seriesData.get(candles);
      if (point && "close" in point)
        setCursor(
          rowsRef.current.find((c) => c.time === Number(point.time)) || null,
        );
      else setCursor(null);
    });
    chart.current = { api, candles, volume, sma, ema, upper, lower, rsi };
    return () => {
      chart.current = null;
      api.remove();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    setCursor(null);
    prior.current = [];
    fetch(`/api/reference/candles?symbol=${symbol}&interval=${interval}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok)
          throw Error(payload.error || "Candle history unavailable");
        if (
          payload.symbol !== symbol ||
          payload.interval !== interval ||
          !Array.isArray(payload.candles)
        )
          throw Error("Invalid candle history");
        const latest = liveRef.current[interval],
          merged = new Map<number, Candle>(
            (payload.candles as Candle[]).map((c) => [c.time, c]),
          );
        if (latest) merged.set(latest.time, latest);
        setRows([...merged.values()].sort((a, b) => a.time - b.time));
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [symbol, interval, epoch, retry]);
  useEffect(() => {
    if (!current || loading || error) return;
    setRows((old) => {
      if (!old.length || current.time < old[old.length - 1].time) return old;
      return current.time === old[old.length - 1].time
        ? [...old.slice(0, -1), current]
        : [...old, current].slice(-600);
    });
  }, [
    current?.time,
    current?.close,
    current?.high,
    current?.low,
    current?.volume,
    loading,
    error,
  ]);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const data = rows.map((row) => ({
      time: row.time as UTCTimestamp,
      open: +row.open,
      high: +row.high,
      low: +row.low,
      close: +row.close,
    }));
    const volume = rows.map((row) => ({
      time: row.time as UTCTimestamp,
      value: +row.volume,
      color: +row.close >= +row.open ? "#0ecb8166" : "#f6465d66",
    }));
    const previous = prior.current;
    if (
      previous.length &&
      rows.length &&
      previous[0].time === rows[0].time &&
      rows.length >= previous.length &&
      rows.length <= previous.length + 1
    ) {
      c.candles.update(data[data.length - 1]);
      c.volume.update(volume[volume.length - 1]);
    } else {
      c.candles.setData(data);
      c.volume.setData(volume);
    }
    const values = indicators(rows);
    c.sma.setData(lineData(values.sma));
    c.ema.setData(lineData(values.ema));
    c.upper.setData(lineData(values.upper));
    c.lower.setData(lineData(values.lower));
    c.rsi.setData(lineData(values.rsi));
    if (!previous.length && rows.length)
      c.api
        .timeScale()
        .setVisibleLogicalRange({
          from: Math.max(0, rows.length - 100),
          to: rows.length + 5,
        });
    prior.current = rows;
  }, [rows]);
  useEffect(() => {
    const c = chart.current;
    c?.sma.applyOptions({ visible: showSma });
    c?.ema.applyOptions({ visible: showEma });
    c?.upper.applyOptions({ visible: showBands });
    c?.lower.applyOptions({ visible: showBands });
  }, [showSma, showEma, showBands]);
  const last = cursor || rows[rows.length - 1];
  return (
    <div
      className="live-chart"
      data-testid="live-chart"
      data-symbol={symbol}
      data-interval={interval}
      data-candles={rows.length}
      data-last-time={rows.at(-1)?.time || ""}
      data-last-close={rows.at(-1)?.close || ""}
    >
      <div className="chart-toolbar" aria-label="Chart interval">
        {intervals.map((i) => (
          <button
            key={i}
            aria-pressed={interval === i}
            onClick={() => setIntervalValue(i)}
          >
            {i}
          </button>
        ))}
        <button
          className="chart-fit"
          onClick={() => chart.current?.api.timeScale().fitContent()}
        >
          Fit
        </button>
      </div>
      <div className="indicator-toolbar">
        <button aria-pressed={showSma} onClick={() => setShowSma(!showSma)}>
          SMA 20
        </button>
        <button aria-pressed={showEma} onClick={() => setShowEma(!showEma)}>
          EMA 50
        </button>
        <button
          aria-pressed={showBands}
          onClick={() => setShowBands(!showBands)}
        >
          BB 20, 2
        </button>
        <span>VOL · RSI 14</span>
      </div>
      <div className="ohlc-readout">
        {last ? (
          <>
            <span>O {Number(last.open).toFixed(2)}</span>
            <span>H {Number(last.high).toFixed(2)}</span>
            <span>L {Number(last.low).toFixed(2)}</span>
            <span>C {Number(last.close).toFixed(2)}</span>
          </>
        ) : (
          <span>Loading Binance candles…</span>
        )}
      </div>
      <div
        className="chart-canvas"
        ref={container}
        role="img"
        aria-label={`${symbol} Binance candlestick chart with volume and RSI`}
      />
      {(loading || error) && (
        <div className="chart-message" role="status">
          {loading ? (
            "Loading candle history…"
          ) : (
            <>
              {error}{" "}
              <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
            </>
          )}
        </div>
      )}
      <div className="chart-credit">
        <span className={status === "live" ? "positive" : "negative"}>
          ●{" "}
          {status === "live"
            ? "Binance live reference"
            : "Reference feed stale / connecting"}
        </span>
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noreferrer"
          title="TradingView Lightweight Charts™. Copyright (с) 2025 TradingView, Inc."
        >
          TradingView Lightweight Charts™ · © 2025 TradingView, Inc.
        </a>
      </div>
    </div>
  );
});
