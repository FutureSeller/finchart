/**
 * Volume Profile — assert against commands via headless rendering. Candle
 * bodies are rects too, so pick out only the VP bars by a sentinel color.
 */
import type { OHLC } from "@finchart/core";
import { candleSeries, createPlotModel } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { volumeProfile } from "../volume-profile";

const FILL = "#vp-fill";
const POC = "#vp-poc";

function mounted(candles: OHLC[], bins: number, widthFraction?: number) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: candleSeries(), data: candles },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  model.plot.mainPane.addDecoration(
    volumeProfile({
      source: { read: () => candles },
      bins,
      widthFraction,
      style: { fill: FILL, poc: POC },
    }),
  );
  return model;
}

const profileRects = (model: ReturnType<typeof mounted>) =>
  model
    .commands()
    .filter(
      (command) =>
        command.type === "drawShape" &&
        command.shape.shape === "rect" &&
        (command.shape.fill === FILL || command.shape.fill === POC),
    );

function bar(x: number, price: number, volume: number): OHLC {
  return { x, open: price, high: price + 1, low: price - 1, close: price, volume };
}

describe("volumeProfile", () => {
  it("should draw one bar per non-empty bin and paint the POC differently", () => {
    // Two price bands: ~10 (vol 10+20=30, POC), ~40 (vol 5). bins 4 →
    // two empty ranges.
    const model = mounted(
      [bar(0, 10, 10), bar(1, 10.5, 20), bar(2, 40, 5)],
      4,
    );

    const rects = profileRects(model);
    expect(rects).toHaveLength(2);

    const pocRects = rects.filter(
      (command) => command.type === "drawShape" && command.shape.fill === POC,
    );
    expect(pocRects).toHaveLength(1);
  });

  it("should size bars proportionally — the POC bar is the widest", () => {
    const model = mounted(
      [bar(0, 10, 10), bar(1, 10.5, 20), bar(2, 40, 5)],
      4,
    );

    const widths = profileRects(model).map((command) =>
      command.type === "drawShape" && command.shape.shape === "rect"
        ? command.shape.width
        : 0,
    );
    // POC(30) : the rest(5) = 6 : 1
    expect(Math.max(...widths) / Math.min(...widths)).toBeCloseTo(6, 6);
  });

  it("should paint the POC colour on the peak bucket when the peak is not the lowest price", () => {
    // ~10 (vol 5) lands in the lower bucket, ~40 (vol 30) in the upper one.
    const model = mounted([bar(0, 10, 5), bar(1, 40, 30)], 2);

    const shapes = profileRects(model).flatMap((command) =>
      command.type === "drawShape" && command.shape.shape === "rect" ? [command.shape] : [],
    );
    expect(shapes).toHaveLength(2);
    const [poc, rest] = [shapes.filter((s) => s.fill === POC), shapes.filter((s) => s.fill === FILL)];
    expect(poc).toHaveLength(1);
    expect(rest).toHaveLength(1);
    expect(poc[0].width).toBeGreaterThan(rest[0].width);
    // Higher price is higher on screen — a smaller pixel y.
    expect(poc[0].y).toBeLessThan(rest[0].y);
    model.plot.destroy();
  });

  it("should bucket a typical price into the range that contains it, not the nearest boundary", () => {
    // Prices span 9..41, so with two buckets the boundary is 25. A typical
    // price of 18 sits in the lower bucket even though it is past that
    // bucket's midpoint — together with ~10 it makes the lower bucket the peak.
    const model = mounted([bar(0, 10, 1), bar(1, 40, 1), bar(2, 18, 10)], 2);

    const shapes = profileRects(model).flatMap((command) =>
      command.type === "drawShape" && command.shape.shape === "rect" ? [command.shape] : [],
    );
    const poc = shapes.filter((s) => s.fill === POC);
    const rest = shapes.filter((s) => s.fill === FILL);
    expect(poc).toHaveLength(1);
    expect(rest).toHaveLength(1);
    // Lower prices sit lower on screen — a larger pixel y.
    expect(poc[0].y).toBeGreaterThan(rest[0].y);
    // 1 + 10 against 1.
    expect(poc[0].width / rest[0].width).toBeCloseTo(11, 6);
    model.plot.destroy();
  });

  it("should count a bar whose typical price is the range's very top in the top bucket", () => {
    // A flat bar (H = L = C) at the highest price puts its typical price
    // exactly on the upper bound of the range.
    const flatTop: OHLC = { x: 1, open: 20, high: 20, low: 20, close: 20, volume: 5 };
    const model = mounted([bar(0, 10, 5), flatTop], 2);

    const shapes = profileRects(model).flatMap((command) =>
      command.type === "drawShape" && command.shape.shape === "rect" ? [command.shape] : [],
    );
    expect(shapes).toHaveLength(2);
    expect(shapes[0].width).toBeCloseTo(shapes[1].width, 6);
    model.plot.destroy();
  });

  it("should stack the buckets edge to edge over the price range, right-aligned, with a 1px gap", () => {
    // Prices span 9..41, so two buckets meet at 25.
    const model = mounted([bar(0, 10, 5), bar(1, 40, 30)], 2);

    const shapes = profileRects(model).flatMap((command) =>
      command.type === "drawShape" && command.shape.shape === "rect" ? [command.shape] : [],
    );
    expect(shapes).toHaveLength(2);
    const [lower, upper] = shapes;
    const y = (price: number) => model.plot.mainPane.yScale.scale(price);
    expect(upper.y).toBeCloseTo(y(41), 6);
    expect(upper.height).toBeCloseTo(y(25) - y(41) - 1, 6);
    expect(lower.y).toBeCloseTo(y(25), 6);
    expect(lower.height).toBeCloseTo(y(9) - y(25) - 1, 6);
    // Bars of different lengths grow leftward from one shared right edge.
    expect(lower.width).not.toBeCloseTo(upper.width, 6);
    expect(lower.x + lower.width).toBeCloseTo(upper.x + upper.width, 6);
    model.plot.destroy();
  });

  it("should size the longest bar by widthFraction of the data area", () => {
    const candles = [bar(0, 10, 5), bar(1, 40, 30)];
    const longest = (widthFraction: number) => {
      const model = mounted(candles, 2, widthFraction);
      const widths = profileRects(model).flatMap((command) =>
        command.type === "drawShape" && command.shape.shape === "rect" ? [command.shape.width] : [],
      );
      model.plot.destroy();
      return Math.max(...widths);
    };

    expect(longest(0.4) / longest(0.2)).toBeCloseTo(2, 6);
  });

  it("should treat a null volume as absence — the halted day draws no bar", () => {
    const silent: OHLC[] = [
      { x: 0, open: 10, high: 11, low: 9, close: 10, volume: null },
      { x: 1, open: 10, high: 11, low: 9, close: 10, volume: null },
    ];
    const model = mounted(silent, 4);

    expect(profileRects(model)).toHaveLength(0);
  });

  it("should draw nothing when no candle carries volume — absence is absence", () => {
    const silent: OHLC[] = [
      { x: 0, open: 10, high: 11, low: 9, close: 10 },
      { x: 1, open: 10, high: 11, low: 9, close: 10 },
    ];
    const model = mounted(silent, 4);

    expect(profileRects(model)).toHaveLength(0);
  });
});

describe("volumeProfile extreme volume", () => {
  it('draws finite proportional profile rectangles when total volume overflows', () => {
    const data = [{ ...bar(0, 10, 1e308), high: 11, low: 9 }, { ...bar(1, 10, 1e308), high: 11, low: 9 }, { ...bar(2, 20, 1e308), high: 21, low: 19 }];
    const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series: candleSeries(), data } });
    model.plot.setVisibleRange(0, 2);
    model.plot.mainPane.setValueDomain(0, 30);
    model.plot.mainPane.addDecoration(volumeProfile({ source: { read: () => data }, bins: 2, style: { fill: '#audit', poc: '#audit' } }));
    model.plot.render();
    const widths = model.commands().flatMap(c => c.type === 'drawShape' && c.shape.shape === 'rect' && c.shape.fill === '#audit' ? [c.shape.width] : []);
    expect(widths).toHaveLength(2);
    expect(widths.every(Number.isFinite)).toBe(true);
    expect(Math.max(...widths) / Math.min(...widths)).toBeCloseTo(2);
    model.plot.destroy();
  });
});

describe("volumeProfile per frame", () => {
  it("reads the visible bars, not the whole history", () => {
    const history = Array.from({ length: 10_000 }, (_, x) => bar(x, 10 + (x % 7), 5));
    const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series: candleSeries(), data: history } });
    model.plot.setVisibleRange(9_900, 9_999);
    let reads = 0;
    // Counts index reads, the way a walk from index 0 would pay for every bar.
    const counted = new Proxy(history, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    model.plot.mainPane.addDecoration(volumeProfile({ source: { read: () => counted }, bins: 4 }));

    reads = 0;
    model.plot.render();

    expect(reads).toBeLessThan(500);
    model.plot.destroy();
  });
});
