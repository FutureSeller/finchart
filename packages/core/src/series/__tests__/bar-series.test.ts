import { describe, expect, it } from "vitest";
import type { OHLC } from "../../data";
import { createPlotModel } from "../../plot";
import { barSeries } from "../bar-series";

const bars: OHLC[] = [
  { x: 0, open: 100, high: 110, low: 95, close: 105 },
  { x: 1, open: 105, high: 112, low: 101, close: 102 },
];

describe("barSeries", () => {
  it("should draw three strokes per bar — spine, open tick, close tick", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: barSeries(), data: bars },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });

    const lines = model.commands().filter((c) => c.type === "drawLine");
    expect(lines).toHaveLength(bars.length * 3);
  });

  it("should color by direction", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: barSeries(), data: bars },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });

    const colors = new Set(
      model
        .commands()
        .filter((c) => c.type === "drawLine")
        .map((c) => (c.type === "drawLine" ? c.style.color : "")),
    );
    // one up bar plus one down bar.
    expect(colors.size).toBe(2);
  });

  it("should claim low~high like the candle", () => {
    expect(barSeries().valueExtent(bars)).toEqual({ min: 95, max: 112 });
  });
});
