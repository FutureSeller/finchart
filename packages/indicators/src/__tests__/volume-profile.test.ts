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

function mounted(candles: OHLC[], bins: number) {
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
