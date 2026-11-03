"use client";
import { useEffect, useRef, useState } from "react";
import type { Candle } from "./indicators";
export type Reference = {
  provider: "Binance";
  symbol: string;
  status: "live" | "stale" | "connecting";
  epoch: number;
  session: number;
  revision: number;
  serverTime: number;
  bookAgeMs: number | null;
  tickerAgeMs: number | null;
  ticker: {
    price: string;
    high: string;
    low: string;
    volume: string;
    quoteVolume: string;
    change: string;
  } | null;
  book: {
    sequence: number;
    bids: { price: string; quantity: string }[];
    asks: { price: string; quantity: string }[];
  } | null;
  trades: {
    id: number;
    price: string;
    quantity: string;
    time: number;
    side: string;
  }[];
  candles: Record<string, Candle & { receivedAt: number; eventTime: number }>;
  markets: { symbol: string; ticker: Reference["ticker"]; status: string }[];
};
export function useReference(symbol: string) {
  const [data, setData] = useState<Reference | null>(null);
  const received = useRef(0);
  useEffect(() => {
    setData(null);
    received.current = 0;
    let session = 0;
    const source = new EventSource(`/api/reference/stream?symbol=${symbol}`);
    source.onopen = () => {
      session++;
    };
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as Reference;
        if (next.symbol === symbol && next.provider === "Binance") {
          received.current = Date.now();
          setData({ ...next, session });
        }
      } catch {
        /* Keep the last validated state. */
      }
    };
    const stale = () =>
      setData((old) =>
        old?.status === "live" ? { ...old, status: "stale" } : old,
      );
    source.onerror = stale;
    const timer = setInterval(() => {
      if (received.current && Date.now() - received.current > 5000) stale();
    }, 1000);
    return () => {
      source.close();
      clearInterval(timer);
    };
  }, [symbol]);
  return data?.symbol === symbol ? data : null;
}
