"use client";

import { useEffect, useRef, useState } from "react";
import type { TradeTick } from "../lib/candles";

export type RealtimeState = "off" | "connecting" | "connected" | "disconnected" | "error";

export interface RealtimeTrade {
  symbol: string;
  tick: TradeTick;
}

/**
 * Subscribes to `/api/realtime` for one symbol.
 *
 * `onTrade` runs for every tick as it arrives. `latest` is React state and
 * therefore batched — a burst between two renders only shows its last tick
 * there — so anything that must count every trade (bar aggregation) has to
 * hang off the callback, not the state.
 */
export function useRealtimeTrades(
  symbol: string | null,
  onTrade?: (trade: RealtimeTrade) => void,
) {
  const [status, setStatus] = useState<RealtimeState>("off");
  const [latest, setLatest] = useState<RealtimeTrade | null>(null);
  const onTradeRef = useRef(onTrade);
  onTradeRef.current = onTrade;

  useEffect(() => {
    setLatest(null);
    if (!symbol) {
      setStatus("off");
      return;
    }

    setStatus("connecting");
    const stream = new EventSource(`/api/realtime?symbol=${encodeURIComponent(symbol)}`);
    const onStatus = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as { state: RealtimeState };
      setStatus(payload.state);
    };
    const onMessage = (event: MessageEvent<string>) => {
      const trade = { symbol, tick: JSON.parse(event.data) as TradeTick };
      onTradeRef.current?.(trade);
      setLatest(trade);
    };
    const onHeartbeat = () => setStatus("connected");
    const onError = () => setStatus("error");

    stream.addEventListener("status", onStatus as EventListener);
    stream.addEventListener("trade", onMessage as EventListener);
    stream.addEventListener("heartbeat", onHeartbeat);
    stream.addEventListener("error", onError);
    return () => stream.close();
  }, [symbol]);

  return { latest, status } as const;
}
