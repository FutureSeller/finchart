"use client";

import type { Plot } from "@finchart/core";
import type { DrawingToolsApi } from "@finchart/tools";
import { usePluginState } from "@finchart/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Interval } from "../lib/candles";

type DrawingLane = "price" | "rsi";
type DrawingSnapshot = { symbol: string; price: string | null; rsi: string | null };
type TimeWindow = { symbol: string; interval: Interval; min: number; max: number };

/** Keep a pane's completed drawings through a chart remount, before its tools are disposed. */
function drawingRecipient(
  store: { current: DrawingSnapshot },
  symbol: string,
  lane: DrawingLane,
  publish: (tools: DrawingToolsApi | null) => void,
): (tools: DrawingToolsApi | null) => void {
  let installed: DrawingToolsApi | null = null;

  return (tools) => {
    if (tools) {
      const saved = store.current.symbol === symbol ? store.current[lane] : null;
      if (saved) tools.load(saved);
      installed = tools;
      publish(tools);
      return;
    }

    // Plugin calls this before dispose. A late cleanup from the old chart
    // must not bring another symbol's lines back.
    if (installed && store.current.symbol === symbol) store.current[lane] = installed.serialize();
    installed = null;
    publish(null);
  };
}

const subscribeMode = (tools: DrawingToolsApi, onChange: () => void) => tools.modeChanges.subscribe(onChange);
const readMode = (tools: DrawingToolsApi) => tools.mode();

/** Page-owned drawings and time range survive conditional chart remounts. */
export function useChartSession(symbol: string, interval: Interval) {
  const plotRef = useRef<Plot | null>(null);
  const chartElement = useRef<HTMLDivElement | null>(null);
  const drawings = useRef<DrawingSnapshot>({ symbol, price: null, rsi: null });
  const timeWindow = useRef<TimeWindow | null>(null);
  const restoreFrame = useRef<number | null>(null);
  const [priceTools, setPriceTools] = useState<DrawingToolsApi | null>(null);
  const [rsiTools, setRsiTools] = useState<DrawingToolsApi | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const onRefused = useCallback((error: Error) => setRefused(error.message), []);
  const onPriceTools = useMemo(
    () => drawingRecipient(drawings, symbol, "price", setPriceTools), [symbol, interval],
  );
  const onRsiTools = useMemo(
    () => drawingRecipient(drawings, symbol, "rsi", setRsiTools), [symbol, interval],
  );
  const priceMode = usePluginState(priceTools, subscribeMode, readMode, null);
  const rsiMode = usePluginState(rsiTools, subscribeMode, readMode, null);
  const drawMode = [priceTools && `Price:${priceMode ?? "—"}`, rsiTools && `RSI:${rsiMode ?? "—"}`].filter(Boolean).join(" ") || "—";

  const clearTimeWindow = useCallback(() => {
    timeWindow.current = null;
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = null;
  }, []);
  useEffect(() => clearTimeWindow, [symbol, interval, clearTimeWindow]);

  const restoreTimeWindow = useCallback(() => {
    if (!timeWindow.current || restoreFrame.current !== null) return;
    // Let this mount's pane/series effects settle before replacing their fit.
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = null;
      const saved = timeWindow.current;
      const plot = plotRef.current;
      if (!saved || !plot) return;
      timeWindow.current = null;
      if (saved.symbol === symbol && saved.interval === interval) plot.setVisibleRange(saved.min, saved.max);
    });
  }, [symbol, interval]);

  function saveTimeWindow() {
    const range = plotRef.current?.getVisibleRange();
    timeWindow.current = range ? { symbol, interval, ...range } : null;
  }

  function resetForSymbol(nextSymbol: string) {
    drawings.current = { symbol: nextSymbol, price: null, rsi: null };
    clearTimeWindow();
  }

  function draw(tools: DrawingToolsApi | null, kind: "trend" | "fib") {
    tools?.begin(kind);
    chartElement.current?.focus();
  }

  return {
    plotRef, chartElement, priceTools, rsiTools, onPriceTools, onRsiTools, drawMode, refused, onRefused,
    draw, saveTimeWindow, clearTimeWindow, restoreTimeWindow, resetForSymbol,
  };
}

export type ChartSession = ReturnType<typeof useChartSession>;
