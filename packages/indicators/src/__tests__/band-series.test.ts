import type { OHLC } from "@finchart/core";
import { candleSeries, createPlotModel } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { bandSeries } from "../band-series";
import { bollingerBands } from "../factories";

function candle(x: number, close: number): OHLC {
  return { x, open: close, high: close + 1, low: close - 1, close };
}

const candles = Array.from({ length: 10 }, (_, i) =>
  candle(i, 100 + Math.sin(i) * 5),
);

describe("bandSeries", () => {
  /**
   * Proof that this flows without touching core: a compute node (Bollinger)
   * → a custom series (band) → a headless stage (createPlotModel) →
   * commands come out.
   */
  it("should paint the band as one polygon through a headless plot", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
    });
    const price = model.plot.mainPane.addSeries({
      series: candleSeries(),
      data: candles,
    });
    const boll = bollingerBands(price, { period: 3 });
    model.plot.mainPane.addSeries({
      series: bandSeries({ fill: "#abc" }),
      input: boll.out.band,
    });
    model.plot.render();

    const polygons = model
      .commands()
      .filter((c) => c.type === "drawShape" && c.shape.shape === "polygon");
    expect(polygons).toHaveLength(1);

    const polygon = polygons[0];
    if (polygon.type !== "drawShape" || polygon.shape.shape !== "polygon") return;
    // 8 points minus the two warmup ones, times upper/lower = a closed
    // outline of 16 vertices.
    expect(polygon.shape.points).toHaveLength(16);
    expect(polygon.shape.fill).toBe("#abc");
  });

  it("should split the fill at holes", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
    });
    model.plot.mainPane.addSeries({
      series: bandSeries(),
      data: [
        { x: 0, upper: 10, lower: 5 },
        { x: 1, upper: 11, lower: 6 },
        { x: 2, upper: null, lower: null },
        { x: 3, upper: 12, lower: 7 },
        { x: 4, upper: 13, lower: 8 },
      ],
    });
    model.plot.render();

    const polygons = model
      .commands()
      .filter((c) => c.type === "drawShape" && c.shape.shape === "polygon");
    // A hole splits the polygon — the fill must not cross the gap.
    expect(polygons).toHaveLength(2);
  });

  it("should claim the y axis for both edges", () => {
    const extent = bandSeries().valueExtent([
      { x: 0, upper: 10, lower: 5 },
      { x: 1, upper: 14, lower: 3 },
      { x: 2, upper: null, lower: null },
    ]);

    expect(extent).toEqual({ min: 3, max: 14 });
  });

  /**
   * **A band reads as both edges.** Registered with a name, it used to read
   * as its upper edge alone — one unlabelled number standing for a range.
   */
  it("describes its upper and lower edge, a gap as a dash", () => {
    const band = bandSeries();

    expect(band.describe?.({ x: 0, upper: 12, lower: 8 })).toEqual([
      { label: "U", value: 12 },
      { label: "L", value: 8 },
    ]);
    expect(band.describe?.({ x: 1, upper: null, lower: null })).toEqual([
      { label: "U", value: null },
      { label: "L", value: null },
    ]);
  });
});
