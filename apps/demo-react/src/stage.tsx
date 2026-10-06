/** What every chart shares — the same wiring and formatting across all of them. */
import { barIndexX, timeTicks, type Plot } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import type { PlotOptions } from "@finchart/react";
import { PriceLine, Watermark } from "@finchart/react";
import { memo } from "react";
import { timeLabel, wonDetail } from "./format";

export const DEPS = browserDeps({
  autoSize: true,
  createXMapping: barIndexX,
  pointer: { kineticScroll: true },
});

export const X_TICKS = timeTicks({ timeZone: "UTC", locale: "en-US" });
export const CROSSHAIR_FORMAT = { x: timeLabel, y: wonDetail };

/**
 * The live options — the window follows when a new bar arrives, with room to
 * the right of the last bar. One value for every chart, handed to
 * `<ChartContainer options>`; it lands before the first series registers, so
 * the offset shapes the first fit.
 *
 * Every chart may turn the follow on: the core's live-target clamp is what
 * stops a sync group from advancing twice.
 */
export const STAGE_OPTIONS: PlotOptions = { shiftVisibleRangeOnNewBar: true, rightOffset: 5 };

/** Opening/timeframe view only; live ticks and user pan/zoom retain their window. */
export function focusRecent(plot: Plot, data: readonly { x: number }[], onApplied?: () => void): () => void {
  if (data.length < 2) return () => {};
  let off = () => {};
  const apply = (): boolean => {
    const area = plot.mainPane.area;
    const width = area.right - area.left;
    if (width <= 0) return false;
    off();
    const count = Math.min(data.length, Math.max(2, Math.floor(width / 8)));
    plot.setVisibleRange(data[data.length - count].x, data[data.length - 1].x);
    plot.scrollToRealTime();
    onApplied?.();
    return true;
  };
  // Browser layout is committed on render, not when the plot is constructed.
  off = plot.on("render", apply);
  if (!apply()) plot.requestRender();
  return off;
}

// A decoration is rebuilt when its props reference changes (see the wrapper's
// README), so these are wrapped to render only when a value really changes —
// the price line every tick, the watermark once.
export const TickPriceLine = memo(PriceLine);
export const StillWatermark = memo(Watermark);
