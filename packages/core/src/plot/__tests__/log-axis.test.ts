/**
 * Checks that the log axis actually holds up on data that needs it —
 * ranges spanning more than an 11x ratio (BTC 3,000->70,000, a 10-year
 * stock 10->300, etc.) used to throw. The arithmetic is covered by
 * scale/__tests__/log-expand.test.ts; this file checks that the whole
 * stage actually draws a frame.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { createPlotModel } from "../model";
import { LogScale } from "../../scale";
import { candleSeries, lineSeries } from "../../series";

function chartOf(values: number[]) {
  return createPlotModel({
    size: { width: 800, height: 600 },
    series: {
      series: lineSeries(),
      data: values.map((y, x) => ({ x, y })),
    },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
}

describe("the paths the migration guide walks through", () => {
  it.each([
    ["BTC 3,000->70,000 (23x)", [3_000, 45_000, 70_000, 52_000]],
    ["10-year stock 10->300 (30x)", [10, 45, 120, 300, 210]],
    ["extreme 1->1,000 (1000x)", [1, 10, 100, 1_000]],
    ["narrow range 50->60 (1.2x)", [50, 55, 60, 52]],
  ])("should render a log chart for %s", (_label, values) => {
    const model = chartOf(values);

    expect(() => {
      model.plot.mainPane.setYScale(new LogScale());
      model.plot.render();
    }).not.toThrow();

    // Not throwing isn't enough — it actually has to draw.
    expect(model.commands().length).toBeGreaterThan(0);

    const [min, max] = model.plot.mainPane.yScale.getDomain();
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThanOrEqual(Math.min(...values));
    expect(max).toBeGreaterThanOrEqual(Math.max(...values));
  });

  /** autoScale only measures the visible range, so a bug where zooming in
   * and then out past an 11x ratio threw. */
  it("should survive zooming out into a wider ratio", () => {
    const model = chartOf([1, 5, 25, 125, 625, 3_125]);
    model.plot.mainPane.setYScale(new LogScale());

    model.plot.setVisibleRange(4, 5); // narrow — 625~3,125 (5x)
    model.plot.render();

    expect(() => {
      model.plot.setVisibleRange(0, 5); // full — 1~3,125 (3125x)
      model.plot.render();
    }).not.toThrow();

    expect(model.plot.mainPane.yScale.getDomain()[0]).toBeGreaterThan(0);
  });

  /** A streaming append goes through the same path. */
  it("should survive a streaming append that widens the ratio", () => {
    const model = chartOf([100, 110, 105]);
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: [
        { x: 0, y: 100 },
        { x: 1, y: 110 },
        { x: 2, y: 105 },
      ],
    });
    model.plot.mainPane.setYScale(new LogScale());
    model.plot.render();

    expect(() => {
      handle.append([{ x: 3, y: 9_000 }]); // widens to a 90x ratio
      model.plot.fitDomains();
      model.plot.render();
    }).not.toThrow();

    expect(model.plot.mainPane.yScale.getDomain()[0]).toBeGreaterThan(0);
  });
});

/**
 * How the stage reacts to data that can't go on a log scale (zero or
 * negative mixed in, or everything non-positive). Where such values come
 * from: an unfilled/halted bar's close: 0, negative settlement prices,
 * MACD/return panes.
 */
describe("log axis — data with non-positive values mixed in", () => {
  const stage = (values: number[]) => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false },
    });
    const pane = model.plot.mainPane;
    pane.addSeries({
      series: lineSeries(),
      data: values.map((y, x) => ({ x, y })),
    });
    return { model, pane };
  };

  it.each([
    ["a zero is mixed in", [10, 0, 120]],
    ["a negative is mixed in", [10, -37, 20]],
  ])("should still draw when %s", (_label, values) => {
    const { model, pane } = stage(values);
    expect(() => pane.setYScale(new LogScale())).not.toThrow();
    expect(() => model.commands()).not.toThrow();
    expect(model.commands().length).toBeGreaterThan(0);
  });

  /** With nothing positive at all, it can't be drawn — the error message
   * must name LogScale, not just say "NaN," or the consumer ends up
   * searching their own data for a value that isn't there. */
  it("should name the log door when nothing is positive", () => {
    const { pane } = stage([-1, -2, -3]);
    let thrown: unknown;
    try {
      pane.setYScale(new LogScale());
    } catch (error) {
      thrown = error;
    }
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("LogScale");
    expect(message).not.toContain("finite");
  });

  /**
   * A rejected toggle must not kill the stage. setYScale used to swap in
   * this.scale before the fallback, so if the fallback also threw, the
   * pane was left holding a new axis with an invalid domain, and every
   * subsequent render kept throwing the same exception.
   */
  it("should keep the stage alive after a rejected toggle", () => {
    const { model, pane } = stage([-50, -30, -10]);
    const before = model.commands().length;
    expect(before).toBeGreaterThan(0);

    expect(() => pane.setYScale(new LogScale())).toThrow();

    // The old axis must remain — a rejection changes nothing.
    expect(pane.yScale.getDomain()).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );
    expect(() => model.commands()).not.toThrow();
    expect(model.commands().length).toBe(before);

    // The second frame must survive too — that's where a permanent break would show up.
    expect(() => model.commands()).not.toThrow();
  });
  /**
   * One halted bar must not get to invent the axis. When expand's lower
   * bound was non-positive, it used to unconditionally fall back to
   * max/1000 as the floor, so a single close: 0 bar rewrote the entire
   * domain and squeezed the real bars into 5.3% of the axis height. Now
   * the scale asks back for the real minimum positive value through a
   * deferred callback (ExpandHints.minPositive).
   */
  it("should fit the real bars, not the invented floor", () => {
    const { model, pane } = stage([120, 0, 100, 150, 130]);
    pane.setYScale(new LogScale());
    model.commands();

    const [low, high] = pane.yScale.getDomain();

    // The floor came from the data — near 100, not 0.1.
    expect(low).toBeGreaterThan(50);
    expect(high).toBeLessThan(300);

    // And the real bars actually fill the axis.
    const span = Math.abs(pane.yScale.scale(150) - pane.yScale.scale(100));
    const height = pane.area.bottom - pane.area.top;
    expect(span / height).toBeGreaterThan(0.5);
  });

  /**
   * With nothing positive at all, asking back gets no answer — that's when
   * it falls back to the old constant. A call that can't supply a hint
   * (calling `expand` directly) lands in the same place.
   */
  it("should fall back to the decade floor when nothing positive exists", () => {
    const scale = new LogScale();
    // Called with no hint — the shape of a unit test or a third-party call.
    const [low, high] = scale.expand([0, 150], 0.05);

    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(1);
    expect(high).toBeGreaterThan(150);
  });

  /**
   * minPositive costs a scan over every visible point, so it must not be
   * charged to a frame that isn't even on a log axis — it's supplied as a
   * callback, not a value. Measuring the accessor call count as a
   * multiple of the point count catches a regression where it scans and
   * hands over the value eagerly too (call count alone wouldn't catch it
   * — both would be zero on a linear axis).
   */
  it("should not scan the data when the axis is linear", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false },
    });
    const pane = model.plot.mainPane;

    const count = 400;
    const data = Array.from({ length: count }, (_, x) => ({
      x,
      y: x === 5 ? 0 : 100 + (x % 40),
    }));

    let reads = 0;
    pane.addSeries({
      series: lineSeries(),
      data,
      // Count the positive-floor operation directly: ingestion must validate getY independently.
      coordinates: {
        getX: (point: LineDataPoint) => point.x,
        getY: (point: LineDataPoint) => point.y,
        getPositiveFloor: (point: LineDataPoint) => {
          reads += 1;
          return point.y !== null && point.y > 0 ? point.y : null;
        },
      },
    });

    model.commands();
    const linear = reads / count;

    reads = 0;
    pane.setYScale(new LogScale());
    model.commands();
    const log = reads / count;

    // A linear axis never asks for the positive floor.
    expect(linear).toBe(0);
    // Log plus a non-positive floor is when the scan gets added (equal would mean the callback was never invoked).
    expect(log).toBeGreaterThan(linear);
  });

  /**
   * One halted bar must not cut off every other bar's lower wick. The
   * domain's upper bound came from getYRange.max (the high), but the
   * lower bound came only from getY (a candle's close), so normal bars
   * whose low sat below their close all got pushed under the domain and
   * had their bottoms clipped off.
   */
  it("should keep the low wick of every bar on a log axis", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false },
    });
    const pane = model.plot.mainPane;

    // Normal bars have low 90 / high 150, and one halted bar is entirely zero.
    const bars = [
      { x: 0, open: 100, high: 150, low: 90, close: 120 },
      { x: 1, open: 0, high: 0, low: 0, close: 0 },
      { x: 2, open: 120, high: 150, low: 90, close: 140 },
      { x: 3, open: 140, high: 150, low: 95, close: 130 },
    ];
    pane.addSeries({ series: candleSeries(), data: bars });
    pane.setYScale(new LogScale());
    model.commands();

    // The domain's lower bound must come from the **low**, not the close (120) — it must sit below 90.
    expect(pane.yScale.getDomain()[0]).toBeLessThanOrEqual(90);

    // And that low actually has to be visible on screen.
    const pixel = pane.yScale.scale(90);
    expect(pixel).toBeLessThanOrEqual(pane.area.bottom);
    expect(pixel).toBeGreaterThanOrEqual(pane.area.top);
  });
});
