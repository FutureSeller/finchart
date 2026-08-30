/** What every chart shares — the same wiring and formatting across all of them. */
import { barIndexX, timeTicks } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import { PriceLine, useChartPlot, Watermark } from "@finchart/react";
import { memo, useEffect } from "react";
import { timeLabel, wonDetail } from "./format";

export const DEPS = browserDeps({
  autoSize: true,
  createXMapping: barIndexX,
  pointer: { kineticScroll: true },
});

export const X_TICKS = timeTicks({ timeZone: "UTC", locale: "en-US" });
export const CROSSHAIR_FORMAT = { x: timeLabel, y: wonDetail };

/**
 * The live option — the window follows when a new bar arrives. Applied from
 * inside the container.
 *
 * Every chart may turn it on: the core's live-target clamp is what stops a sync
 * group from advancing twice.
 */
export function StageOptions() {
  const plot = useChartPlot();
  useEffect(() => {
    plot.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 5 });
  }, [plot]);
  return null;
}

// A decoration is rebuilt when its props reference changes (see the wrapper's
// README), so these are wrapped to render only when a value really changes —
// the price line every tick, the watermark once.
export const TickPriceLine = memo(PriceLine);
export const StillWatermark = memo(Watermark);
