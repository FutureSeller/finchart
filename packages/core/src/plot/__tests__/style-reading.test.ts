import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import type { StyleReader, StyleReaderFactory } from "../../render";
import {
  areaSeries,
  barSeries,
  baselineSeries,
  candleSeries,
  histogramSeries,
  lineSeries,
} from "../../series";
import { crosshairLine } from "../../extensions/crosshair";
import { markers, priceLine, span, watermark } from "../../extensions/standard";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** Counts how many times the computed style was captured. */
function countingReader(vars: Record<string, string> = {}) {
  let built = 0;

  const create: StyleReaderFactory = () => {
    built += 1;
    const read: StyleReader = (name) => vars[name] ?? "";
    return read;
  };

  return {
    create,
    get built() {
      return built;
    },
  };
}

function mount(reader: StyleReaderFactory) {
  return mountPlot({ deps: testBrowserDeps({ createStyleReader: reader }), series: lineSeries(), config: defaultConfig });
}

describe("style reading", () => {
  it("should grab the computed style once per render", () => {
    const reader = countingReader();
    const { plot, handle } = mount(reader.create);

    handle.setData(data);
    expect(reader.built).toBe(1);

    plot.render();
    expect(reader.built).toBe(2);
  });

  it("should not grab it again for each extra series", () => {
    const reader = countingReader();
    const { plot, handle } = mount(reader.create);
    handle.setData(data);

    // One grid plus four series share the same reader.
    for (let i = 0; i < 3; i++) plot.mainPane.addSeries(lineSeries());
    plot.render();

    const before = reader.built;
    plot.render();

    expect(plot.mainPane.getSeries()).toHaveLength(4);
    expect(reader.built - before).toBe(1);
  });

  it("should hand the same reader to the grid and the series", () => {
    const reader = countingReader({
      "--chart-grid": "#111111",
      "--chart-line": "#222222",
    });
    const { plot, handle, layers } = mount(reader.create);

    handle.setData(data);
    plot.render();

    const colors = layers.context.calls
      .filter((call) => call.method === "set:strokeStyle")
      .map((call) => call.args[0]);

    // Both came from the same single read.
    expect(colors).toContain("#111111");
    expect(colors).toContain("#222222");
    expect(reader.built).toBe(2);
  });

  it("should draw without a reader of its own in a DOM-less environment", () => {
    const { layers } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data });

    // Without getComputedStyle, it draws using the defaults.
    expect(layers.context.calls.length).toBeGreaterThan(0);
  });

  /**
   * A sentinel sweep — feed a unique sentinel into every declared color
   * variable, draw one frame, and assert: every sentinel shows up in the
   * commands, and none of the default colors remain.
   */
  it("should paint every declared color variable and no default", () => {
    const sentinels: Record<string, string> = {
      "--chart-line": "#s01",
      "--chart-point": "#s02",
      "--chart-grid": "#s03",
      "--chart-area": "#s04",
      "--chart-area-line": "#s05",
      "--chart-candle-up": "#s06",
      "--chart-candle-down": "#s07",
      "--chart-bar-up": "#s08",
      "--chart-bar-down": "#s09",
      "--chart-histogram": "#s10",
      "--chart-baseline-top": "#s11",
      "--chart-baseline-bottom": "#s12",
      "--chart-baseline-top-fill": "#s13",
      "--chart-baseline-bottom-fill": "#s14",
      "--chart-price-line": "#s15",
      "--chart-marker": "#s16",
      "--chart-watermark": "#s17",
      "--chart-span": "#s18",
      "--chart-crosshair": "#s19",
    };
    const defaults = [
      "#3b82f6",
      "#e5e7eb",
      "rgba(59, 130, 246, 0.16)",
      "#16a34a",
      "#dc2626",
      "rgba(22, 163, 74, 0.16)",
      "rgba(220, 38, 38, 0.16)",
      "#94a3b8",
      "#f59e0b",
      "rgba(100, 116, 139, 0.14)",
      "rgba(59, 130, 246, 0.08)",
      // Badge text color (BADGE_TEXT_COLOR) — a code constant with no
      // variable, so it can't be fed a sentinel. If it leaks into a canvas
      // command, it's caught here (S1 — closing the blind spot).
      "#ffffff",
    ];

    const reader: StyleReaderFactory = () => (name) => sentinels[name] ?? "";
    const { plot, layers } = mountPlot({
      // Labels are excluded — the canvas label path legitimately paints
      // with the badge text color (#ffffff, a code constant), and that
      // must not get mixed into the "no default remains" check. What's
      // measured here is series and decoration painting only.
      deps: testBrowserDeps({
        createStyleReader: reader,
        createAxisLabels: undefined,
      }),
      series: lineSeries(),
      data,
      config: defaultConfig,
    });

    const ohlc: OHLC[] = [
      { x: 0, open: 12, high: 21, low: 11, close: 20 }, // up
      { x: 50, open: 20, high: 21, low: 11, close: 12 }, // down
      { x: 100, open: 12, high: 21, low: 11, close: 20 }, // up
    ];
    const crossing: LineDataPoint[] = [
      { x: 0, y: 18 },
      { x: 50, y: 12 },
      { x: 100, y: 18 },
    ];
    plot.mainPane.addSeries({ series: areaSeries(), data });
    plot.mainPane.addSeries({ series: candleSeries(), data: ohlc });
    plot.mainPane.addSeries({ series: barSeries(), data: ohlc });
    plot.mainPane.addSeries({ series: histogramSeries(), data });
    plot.mainPane.addSeries({
      series: baselineSeries({ baseline: 15 }),
      data: crossing,
    });

    plot.mainPane.addDecoration(priceLine({ value: 15 }));
    plot.mainPane.addDecoration(markers([{ x: 50, price: 15, text: "m" }]));
    plot.addDecoration(watermark({ text: "w" }));
    plot.addDecoration(span({ from: 0, to: 100 }));
    const cross = crosshairLine();
    cross.follow({ x: 400, y: 300 });
    plot.addDecoration(cross);

    plot.render();

    const painted = new Set(
      layers.context.calls
        .filter(
          ({ method }) =>
            method === "set:strokeStyle" || method === "set:fillStyle",
        )
        .map(({ args }) => args[0]),
    );

    for (const [cssVar, sentinel] of Object.entries(sentinels)) {
      expect.soft([...painted], `${cssVar} was not painted`).toContain(sentinel);
    }
    for (const value of defaults) {
      expect.soft([...painted], `default value ${value} is still present`).not.toContain(value);
    }
  });
});
