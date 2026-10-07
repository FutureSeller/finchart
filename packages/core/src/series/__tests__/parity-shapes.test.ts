/**
 * Two parity items — hollow candles and the step line. Both are choices
 * about the shape drawn, not style tokens — a CSS variable's leaf only
 * carries a color or a number, so faking a boolean through it falls back
 * silently. So this follows the options-object precedent already set by
 * `baselineSeries(options)` and `histogramSeries(options)`.
 */
import { describe, expect, it } from "vitest";
import {
  fakeCanvasContext,
  filledCircles,
  filledRects,
  strokedPaths,
} from "../../__tests__/dom-fakes";
import type { PlotArea } from "../../primitives";
import type { LineDataPoint, OHLC } from "../../data";
import type { StyleReader } from "../../render";
import { CanvasRenderer } from "../../render";
import { continuousX, LinearScale } from "../../scale";
import { candleSeries } from "../candle-series";
import { lineSeries, stepLineSeries } from "../line-series";
import type { SeriesContext } from "../types";

const area: PlotArea = { left: 20, right: 780, top: 20, bottom: 580 };

function surface() {
  const context = fakeCanvasContext();
  return {
    context,
    renderer: new CanvasRenderer({ width: 800, height: 600, context }),
  };
}

function contextFor<T extends { x: number }>(
  data: T[],
  valueMin: number,
  valueMax: number,
): SeriesContext<T> {
  const readStyle: StyleReader = () => "";
  return {
    data,
    x: continuousX(new LinearScale(0, 100, area.left, area.right)),
    yScale: new LinearScale(valueMin, valueMax, area.bottom, area.top),
    area,
    readStyle,
  };
}

const candles: OHLC[] = [
  { x: 10, open: 100, high: 112, low: 98, close: 108 }, // up
  { x: 30, open: 108, high: 110, low: 94, close: 96 }, // down
];

describe("hollow candle body (hollow)", () => {
  it("defaults to filled — today's behavior stays if the option isn't given", () => {
    const { context, renderer } = surface();
    candleSeries().draw(renderer, contextFor(candles, 90, 115));
    renderer.commit();

    expect(filledRects(context)).toHaveLength(2);
  });

  it("with hollow, an up candle gets an outline while a down candle stays filled", () => {
    const { context, renderer } = surface();
    candleSeries(undefined, { hollow: true }).draw(
      renderer,
      contextFor(candles, 90, 115),
    );
    renderer.commit();

    // Only the down candle is filled.
    expect(filledRects(context)).toHaveLength(1);
    // The up candle's body is drawn as a closed stroke — two wicks plus
    // one body.
    expect(strokedPaths(context).length).toBe(3);
  });

  it("a hollow body is still **one command** — the four sides aren't drawn separately", () => {
    const { context, renderer } = surface();
    candleSeries(undefined, { hollow: true }).draw(
      renderer,
      contextFor([candles[0]], 90, 115),
    );
    renderer.commit();

    // 1 wick + 1 body. Drawing each of the four sides separately would
    // give 5.
    expect(strokedPaths(context).length).toBe(2);
    // It's a closed rectangle, so there are five points (the last one
    // returns to the first).
    const body = strokedPaths(context)[1].points;
    expect(body).toHaveLength(5);
    expect(body[0]).toEqual(body[4]);
  });

  it("the options are a door too", () => {
    expect(() => candleSeries(undefined, { hollow: "yes" } as never)).toThrow();
    expect(() => candleSeries(undefined, "yes" as never)).toThrow();
  });
});

const line: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 30 },
  { x: 100, y: 20 },
];

describe("step line (step)", () => {
  it("defaults to a straight line — three points stay three points", () => {
    const { context, renderer } = surface();
    lineSeries().draw(renderer, contextFor(line, 0, 40));
    renderer.commit();

    expect(strokedPaths(context)[0].points).toHaveLength(3);
  });

  it("with step, the value holds until the next x — three points become five", () => {
    const { context, renderer } = surface();
    stepLineSeries().draw(
      renderer,
      contextFor(line, 0, 40),
    );
    renderer.commit();

    const path = strokedPaths(context)[0].points;
    expect(path).toHaveLength(5);
    // horizontal first, then vertical — the corner point's y belongs to
    // the **preceding point**.
    expect(path[1].y).toBe(path[0].y);
    expect(path[1].x).toBe(path[2].x);
  });

  it("point markers stay at the data position — never at the step's corner", () => {
    const { context, renderer } = surface();
    stepLineSeries({ point: { radius: 3 } }).draw(
      renderer,
      contextFor(line, 0, 40),
    );
    renderer.commit();

    expect(filledCircles(context)).toHaveLength(3);
  });

  it("the door's rules match its sibling", () => {
    expect(() => stepLineSeries(42 as never)).toThrow();
  });
});
