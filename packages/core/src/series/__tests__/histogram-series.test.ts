import { describe, expect, it } from "vitest";
import type { HistogramPoint } from "../histogram-series";
import { histogramSeries } from "../histogram-series";
import { createPlotModel } from "../../plot";

const volume: HistogramPoint[] = [
  { x: 0, y: 100 },
  { x: 1, y: 250, color: "#16a34a" },
  { x: 2, y: null },
  { x: 3, y: 175 },
];

function mounted(baseline?: number, data = volume) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: histogramSeries({ baseline }), data },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });

  const bars = model
    .commands()
    .filter((c) => c.type === "drawShape" && c.shape.shape === "rect");
  return { model, bars };
}

describe("histogramSeries", () => {
  it("should grow every bar from the baseline", () => {
    const { model, bars } = mounted();

    // Three bars, minus one hole.
    expect(bars).toHaveLength(3);

    const baseY = model.plot.mainPane.yScale.scale(0);
    for (const bar of bars) {
      if (bar.type !== "drawShape" || bar.shape.shape !== "rect") continue;
      // The bar's bottom sits flush against the baseline (0).
      expect(bar.shape.y + bar.shape.height).toBeCloseTo(baseY, 6);
    }
  });

  it("should include the baseline in its value claim — volume starts at zero", () => {
    const extent = histogramSeries().valueExtent(volume);

    expect(extent).toEqual({ min: 0, max: 250 });
  });

  it("should let a point carry its own color", () => {
    const { bars } = mounted();

    const fills = bars.map((bar) =>
      bar.type === "drawShape" && bar.shape.shape === "rect"
        ? bar.shape.fill
        : "",
    );
    expect(fills[1]).toBe("#16a34a");
    // A point with no color falls back to the series default.
    expect(fills[0]).toBe(fills[2]);
  });

  it("should hang bars downward from a nonzero baseline", () => {
    const data: HistogramPoint[] = [
      { x: 0, y: 40 },
      { x: 1, y: 60 },
    ];
    const { model, bars } = mounted(50, data);

    const baseY = model.plot.mainPane.yScale.scale(50);
    const [below, above] = bars;
    if (below.type !== "drawShape" || below.shape.shape !== "rect") return;
    if (above.type !== "drawShape" || above.shape.shape !== "rect") return;

    // A value below the baseline grows downward from it; above grows up.
    expect(below.shape.y).toBeCloseTo(baseY, 6);
    expect(above.shape.y + above.shape.height).toBeCloseTo(baseY, 6);
  });

  it("should say nothing when everything is a hole", () => {
    expect(
      histogramSeries().valueExtent([{ x: 0, y: null }]),
    ).toBeNull();
  });
});
