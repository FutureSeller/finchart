import { describe, expect, it } from "vitest";
import type { ContextCall } from "../../__tests__/dom-fakes";
import {
  fakeCanvasContext,
  filledCircles,
  filledRects,
  strokedPaths,
} from "../../__tests__/dom-fakes";
import type { PlotArea } from "../../primitives";
import type { BaseDataPoint, LineDataPoint, OHLC } from "../../data";
import { OHLCAccessor } from "../../data";
import type { StyleReader } from "../../render";
import { CanvasRenderer } from "../../render";
import { continuousX, LinearScale } from "../../scale";
import { CandleSeries, candleSeries, DEFAULT_CANDLE_STYLE } from "../candle-series";
import { DEFAULT_LINE_STYLE, LineSeries, lineSeries } from "../line-series";
import type { SeriesContext } from "../types";

const area: PlotArea = { left: 20, right: 780, top: 20, bottom: 580 };
/** The same x mapping `contextFor` hands the series, computed independently. */
const xPixel = (x: number) => new LinearScale(0, 100, area.left, area.right).scale(x);

function surface() {
  const context = fakeCanvasContext();
  return { context, renderer: new CanvasRenderer({ width: 800, height: 600, context }) };
}

function contextFor<T extends BaseDataPoint>(
  data: T[],
  valueMin: number,
  valueMax: number,
  readStyle: StyleReader = () => "",
): SeriesContext<T> {
  return {
    data,
    x: continuousX(new LinearScale(0, 100, area.left, area.right)),
    yScale: new LinearScale(valueMin, valueMax, area.bottom, area.top),
    area,
    readStyle,
  };
}

/** A series receives a way to read, not the DOM — you can just pass the variables directly. */
const cssVars =
  (vars: Record<string, string>): StyleReader =>
  (name) =>
    vars[name] ?? "";

const lineData: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 30 },
  { x: 100, y: 20 },
];

describe("LineSeries", () => {
  it("should report a value extent from the y values", () => {
    expect(lineSeries().valueExtent(lineData)).toEqual({ min: 10, max: 30 });
  });

  it("should report no extent at all for empty data", () => {
    // It used to be { min: 0, max: 0 }. "There's nothing to measure" and
    // "measuring 0" are different, and once each series gets its own
    // data, that 0 drags the union toward it.
    expect(lineSeries().valueExtent([])).toBeNull();
  });

  it("should draw one polyline and one circle per point", () => {
    const { renderer, context } = surface();

    lineSeries().draw(renderer, contextFor(lineData, 10, 30));
    renderer.commit();

    expect(strokedPaths(context)).toHaveLength(1);
    expect(strokedPaths(context)[0].points).toHaveLength(3);
    expect(filledCircles(context)).toHaveLength(3);
  });

  it("should skip points when the radius is zero", () => {
    const { renderer, context } = surface();

    lineSeries({ point: { radius: 0, color: "#000" } }).draw(
      renderer,
      contextFor(lineData, 10, 30),
    );
    renderer.commit();

    expect(filledCircles(context)).toHaveLength(0);
  });

  it("should not draw a line for fewer than two points", () => {
    const { renderer, context } = surface();

    lineSeries().draw(renderer, contextFor([lineData[0]], 10, 30));
    renderer.commit();

    expect(strokedPaths(context)).toHaveLength(0);
  });

  it("should read colors from CSS variables", () => {
    const { renderer, context } = surface();
    const read = cssVars({ "--chart-line": "#123123", "--chart-line-width": "7" });

    lineSeries().draw(renderer, contextFor(lineData, 10, 30, read));
    renderer.commit();

    expect(strokedPaths(context)[0]).toMatchObject({
      color: "#123123",
      width: 7,
    });
  });

  it("should let explicit style beat CSS variables", () => {
    const { renderer, context } = surface();
    const read = cssVars({ "--chart-line": "#123123", "--chart-line-width": "7" });

    lineSeries({ line: { width: 3 } }).draw(
      renderer,
      contextFor(lineData, 10, 30, read),
    );
    renderer.commit();

    expect(strokedPaths(context)[0]).toMatchObject({
      color: "#123123",
      width: 3,
    });
  });

  it("should fall back to defaults when nothing is declared", () => {
    const { renderer, context } = surface();

    lineSeries().draw(renderer, contextFor(lineData, 10, 30));
    renderer.commit();

    expect(strokedPaths(context)[0].width).toBe(DEFAULT_LINE_STYLE.line.width);
  });

  it("should work over OHLC data through an accessor", () => {
    const series = new LineSeries({ coordinates: new OHLCAccessor() });
    const candles: OHLC[] = [
      { x: 0, open: 1, high: 9, low: 0, close: 4 },
      { x: 100, open: 4, high: 9, low: 3, close: 8 },
    ];

    // The line only looks at close.
    expect(series.valueExtent(candles)).toEqual({ min: 4, max: 8 });
  });
});

const candles: OHLC[] = [
  { x: 0, open: 10, high: 30, low: 5, close: 20 },
  { x: 50, open: 20, high: 40, low: 15, close: 18 },
  { x: 100, open: 18, high: 25, low: 2, close: 24 },
];

describe("CandleSeries", () => {
  it("should span low to high, not just close", () => {
    expect(candleSeries().valueExtent(candles)).toEqual({ min: 2, max: 40 });
  });

  it("should report no extent at all for empty data", () => {
    // It used to be { min: 0, max: 0 }. "There's nothing to measure" and
    // "measuring 0" are different, and once each series gets its own
    // data, that 0 drags the union toward it.
    expect(candleSeries().valueExtent([])).toBeNull();
  });

  it("should draw one vertical wick per candle at the candle's x", () => {
    const { renderer, context } = surface();
    const seriesContext = contextFor(candles, 2, 40);

    candleSeries().draw(renderer, seriesContext);
    renderer.commit();

    const wickXs = strokedPaths(context).map((p) => [p.points[0].x, p.points[1].x]);
    expect(wickXs).toEqual(
      candles.map((c) => {
        const x = xPixel(c.x);
        return [x, x];
      }),
    );
  });

  it("should centre each body on its x and span open to close", () => {
    const { renderer, context } = surface();
    const seriesContext = contextFor(candles, 2, 40);
    const y = (value: number) => seriesContext.yScale.scale(value);

    candleSeries().draw(renderer, seriesContext);
    renderer.commit();

    const rects = filledRects(context);
    expect(rects).toHaveLength(candles.length);
    const bodyAt = (candle: OHLC) => {
      const centre = xPixel(candle.x);
      const rect = rects.find((r) => r.x + r.width / 2 === centre);
      if (rect === undefined) throw new Error(`no body centred on ${centre}`);
      return rect;
    };

    // Up candle (open 10 → close 20): close is higher, so its pixel is the top.
    const up = bodyAt(candles[0]);
    expect(up.y).toBeCloseTo(y(20));
    expect(up.height).toBeCloseTo(y(10) - y(20));

    // Down candle (open 20 → close 18): open is higher, so its pixel is the top.
    const down = bodyAt(candles[1]);
    expect(down.y).toBeCloseTo(y(20));
    expect(down.height).toBeCloseTo(y(18) - y(20));
  });

  it("should colour a rising candle up, a falling candle down, and a doji up", () => {
    const { renderer, context } = surface();
    const withDoji: OHLC[] = [
      ...candles,
      { x: 75, open: 22, high: 25, low: 15, close: 22 },
    ];

    candleSeries().draw(renderer, contextFor(withDoji, 2, 40));
    renderer.commit();

    const colors = strokedPaths(context).map((p) => p.color);
    const { up, down } = DEFAULT_CANDLE_STYLE;
    // close >= open is up, so a doji (close === open) counts as up.
    expect(colors).toEqual([up, down, up, up]);
  });

  it("should keep the wick spanning high to low", () => {
    const { renderer, context } = surface();
    const seriesContext = contextFor(candles, 2, 40);

    candleSeries().draw(renderer, seriesContext);
    renderer.commit();

    const [wick] = strokedPaths(context);
    expect(wick.points[0].y).toBeCloseTo(seriesContext.yScale.scale(30));
    expect(wick.points[1].y).toBeCloseTo(seriesContext.yScale.scale(5));
  });

  it("should give a doji a minimum body height", () => {
    const { renderer, context } = surface();
    const doji: OHLC[] = [{ x: 0, open: 20, high: 25, low: 15, close: 20 }];

    new CandleSeries().draw(renderer, contextFor(doji, 15, 25));
    renderer.commit();

    const rect = context.calls.find((c) => c.method === "fillRect");
    expect(rect?.args[3]).toBeGreaterThanOrEqual(1);
  });

  it("should read colors from CSS variables", () => {
    const { renderer, context } = surface();
    const read = cssVars({ "--chart-candle-up": "#00ff00" });

    candleSeries().draw(renderer, contextFor(candles, 2, 40, read));
    renderer.commit();

    expect(strokedPaths(context)[0].color).toBe("#00ff00");
  });

  it("should read the body ratio from a CSS variable", () => {
    const read = cssVars({ "--chart-candle-body-ratio": "0.3" });

    const tuned = surface();
    candleSeries().draw(tuned.renderer, contextFor(candles, 2, 40, read));
    tuned.renderer.commit();

    const base = surface();
    candleSeries().draw(base.renderer, contextFor(candles, 2, 40));
    base.renderer.commit();

    // Half of the default 0.6, so the body is half as wide too.
    const width = (calls: ContextCall[]) =>
      Number(calls.find((c) => c.method === "fillRect")?.args[2]);

    expect(width(tuned.context.calls)).toBeCloseTo(width(base.context.calls) / 2);
  });
});
