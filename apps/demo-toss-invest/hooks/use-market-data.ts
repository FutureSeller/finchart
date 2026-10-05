"use client";

import { OHLCAccessor, type OHLC } from "@finchart/core";
import { useInfiniteHistory, type InfiniteHistoryState } from "@finchart/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyTrade, mergeSnapshot, toBars, type CandleResponse, type Interval } from "../lib/candles";
import { fetchCandles } from "../lib/candle-client";
import { useRealtimeTrades, type RealtimeState, type RealtimeTrade } from "./use-realtime-trades";

const COORDINATES = new OHLCAccessor();
const REFRESH_MS = 15_000;

export interface MarketDataState {
  readonly history: InfiniteHistoryState<OHLC, string>;
  readonly bars: OHLC[];
  readonly result: CandleResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly historyRequests: number;
  readonly realtime: RealtimeState;
  readonly currentTrade: RealtimeTrade | null;
  clearHistoryRequests(): void;
}

/** Owns one market's bars, paging cursor, live trades, and REST reconciliation. */
export function useMarketData(symbol: string, interval: Interval): MarketDataState {
  const history = useInfiniteHistory<OHLC, string>({ coordinates: COORDINATES });
  const { data: bars, setData: setBars, reset } = history;
  const [result, setResult] = useState<CandleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyRequests, setHistoryRequests] = useState(0);
  const clearHistoryRequests = useCallback(() => setHistoryRequests(0), []);
  // A REST refresh can only write to the load it was requested under.
  const generation = useRef(0);
  const liveInterval = result?.interval ?? interval;
  const onTrade = useCallback((trade: RealtimeTrade) => {
    setBars((current) => applyTrade(current, trade.tick, liveInterval));
  }, [liveInterval, setBars]);
  const realtimeSymbol = result?.source === "toss" ? result.symbol : null;
  const { latest, status: realtime } = useRealtimeTrades(realtimeSymbol, onTrade);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchCandles({ symbol, interval }, controller.signal);
        if (controller.signal.aborted) return;
        const loaded = toBars(payload.candles, interval);
        setResult(payload);
        generation.current += 1;
        clearHistoryRequests();
        // Each paging closure belongs to its load; chart remounts retain the cursor.
        reset(loaded, {
          next: payload.nextBefore,
          fetchPage: async (before) => {
            setHistoryRequests((count) => count + 1);
            const page = await fetchCandles({ symbol: payload.symbol, interval, before });
            return { bars: toBars(page.candles, interval), next: page.nextBefore };
          },
        });
      } catch (cause) {
        if (controller.signal.aborted) return;
        generation.current += 1;
        setResult(null);
        reset([], null);
        setError(cause instanceof Error ? cause.message : "Could not load candles.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [symbol, interval, reset, clearHistoryRequests]);

  useEffect(() => {
    if (!result || result.source !== "toss") return;
    const controller = new AbortController();
    const owner = generation.current;
    const refresh = async () => {
      try {
        const payload = await fetchCandles({ symbol: result.symbol, interval: result.interval }, controller.signal);
        if (controller.signal.aborted || generation.current !== owner) return;
        const fresh = toBars(payload.candles, result.interval);
        setBars((current) => mergeSnapshot(current, fresh));
      } catch {
        // Trades keep flowing between successful REST reconciliations.
      }
    };
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [result, setBars]);

  return {
    history, bars, result, error, loading, historyRequests, realtime, clearHistoryRequests,
    currentTrade: latest?.symbol === result?.symbol ? latest : null,
  };
}
