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

  it("should draw nothing when no candle carries volume — absence is absence", () => {
    const silent: OHLC[] = [
      { x: 0, open: 10, high: 11, low: 9, close: 10 },
      { x: 1, open: 10, high: 11, low: 9, close: 10 },
    ];
    const model = mounted(silent, 4);

    expect(profileRects(model)).toHaveLength(0);
  });
});
