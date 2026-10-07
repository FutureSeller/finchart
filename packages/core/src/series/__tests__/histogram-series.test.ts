import { describe, expect, it } from "vitest";
import type { HistogramPoint, HistogramSeriesStyleOverrides } from "../histogram-series";
import { DEFAULT_HISTOGRAM_STYLE, histogramSeries } from "../histogram-series";
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

  it("should reach up to a baseline that sits above every value", () => {
    const extent = histogramSeries({ baseline: 100 }).valueExtent([
      { x: 0, y: 40 },
      { x: 1, y: 60 },
    ]);

    expect(extent).toEqual({ min: 40, max: 100 });
  });

  it("should keep a bar that sits on the baseline one pixel tall", () => {
    const { model, bars } = mounted(undefined, [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
    ]);

    const [flat] = bars;
    if (flat.type !== "drawShape" || flat.shape.shape !== "rect") throw new Error("no bar drawn");
    expect(flat.shape.height).toBe(1);
    model.plot.destroy();
  });

  it("should centre each bar on its point's x", () => {
    const { model, bars } = mounted();

    const drawn = volume.filter((point) => point.y !== null);
    expect(bars).toHaveLength(drawn.length);
    for (const [i, bar] of bars.entries()) {
      if (bar.type !== "drawShape" || bar.shape.shape !== "rect") throw new Error("no bar drawn");
      expect(bar.shape.x + bar.shape.width / 2).toBeCloseTo(model.plot.pixelAtX(drawn[i].x), 6);
    }
    model.plot.destroy();
  });

  it("should say nothing when everything is a hole", () => {
    expect(
      histogramSeries().valueExtent([{ x: 0, y: null }]),
    ).toBeNull();
  });

  /**
   * Tone: the bar says which of the two colour slots it wears, the theme
   * says what colour that is. The order is CSS specificity's — the most
   * local explicit value wins: point.color, then a slot override, then one
   * explicit series colour, then the slot's variable. The plain colour is
   * the last step only for a bar without a tone.
   */
  describe("tone", () => {
    const toned: HistogramPoint[] = [
      { x: 0, y: 10, tone: "up" },
      { x: 1, y: 20, tone: "down" },
      { x: 2, y: 15 },
    ];
    const vars: Record<string, string> = {
      "--chart-histogram-up": "#0a0",
      "--chart-histogram-down": "#a00",
      "--chart-histogram": "#888",
    };

    function fillsWith(
      style?: HistogramSeriesStyleOverrides,
      variables: Record<string, string> = vars,
      data = toned,
    ) {
      const model = createPlotModel({
        size: { width: 800, height: 600 },
        series: { series: histogramSeries({ style }), data },
        config: {
          showGrid: false,
          axis: { x: { showLabels: false }, y: { showLabels: false } },
        },
        deps: { createStyleReader: () => (name) => variables[name] ?? "" },
      });
      return model
        .commands()
        .flatMap((c) =>
          c.type === "drawShape" && c.shape.shape === "rect" ? [c.shape.fill] : [],
        );
    }

    it("should read the slot's variable for a toned bar and the plain one otherwise", () => {
      expect(fillsWith()).toEqual(["#0a0", "#a00", "#888"]);
    });

    it("should fall back to the candle colours when no variable is set", () => {
      expect(fillsWith(undefined, {})).toEqual([
        DEFAULT_HISTOGRAM_STYLE.up,
        DEFAULT_HISTOGRAM_STYLE.down,
        DEFAULT_HISTOGRAM_STYLE.color,
      ]);
      expect(DEFAULT_HISTOGRAM_STYLE.up).toBe("#16a34a");
      expect(DEFAULT_HISTOGRAM_STYLE.down).toBe("#dc2626");
    });

    it("should let an explicit point colour beat its tone", () => {
      const data: HistogramPoint[] = [{ x: 0, y: 10, tone: "up", color: "#f0b" }];
      expect(fillsWith(undefined, vars, data)).toEqual(["#f0b"]);
    });

    it("should let one explicit series colour beat the slot variables", () => {
      // A consumer who wrote `style: { color }` asked for one colour — a
      // toned input must not silently take it away.
      expect(fillsWith({ color: "#f0b" })).toEqual(["#f0b", "#f0b", "#f0b"]);
    });

    it("should let a slot override beat the explicit series colour", () => {
      expect(fillsWith({ color: "#f0b", up: "#0f0" })).toEqual(["#0f0", "#f0b", "#f0b"]);
    });

    it("should leave the other slot on its variable when only one is overridden", () => {
      expect(fillsWith({ up: "#0f0" })).toEqual(["#0f0", "#a00", "#888"]);
    });

    it("should treat a null override as absent, the same way the resolver does", () => {
      // A props round trip turns undefined into null; neither says anything.
      expect(fillsWith({ color: null as never })).toEqual(["#0a0", "#a00", "#888"]);
      expect(fillsWith({ up: null as never, color: "#f0b" })).toEqual(["#f0b", "#f0b", "#f0b"]);
    });
  });
});
