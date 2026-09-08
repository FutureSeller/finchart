/** A point that knows its own positive floor: the log axis stands on it, not on its range's min. */
import { describe, expect, it } from "vitest";
import type { CoordinateAccessor, Range, Series } from "../../index";
import { createPlotModel, LogScale } from "../../index";

interface Span {
  x: number;
  low: number;
  high: number;
  /** The smallest positive value the span holds — what the range's `min` cannot say when `low` is not positive. */
  floor: number | null;
}

function spanSeries(withFloor: boolean): Series<Span> {
  const coordinates: CoordinateAccessor<Span> = {
    getX: (point) => point.x,
    getY: (point) => point.high,
    // With the door present, the range is never asked for the floor — a range that throws proves it.
    getYRange: withFloor
      ? () => {
          throw new Error("the range was asked for a floor the point already gave");
        }
      : (point) => ({ min: point.low, max: point.high }),
    ...(withFloor ? { getPositiveFloor: (point: Span) => point.floor } : {}),
  };
  return {
    coordinates,
    valueExtent(data) {
      let extent: Range | null = null;
      for (const point of data) {
        extent = extent === null ? { min: point.low, max: point.high } : { min: Math.min(extent.min, point.low), max: Math.max(extent.max, point.high) };
      }
      return extent;
    },
    draw() {},
  };
}

function fitted(withFloor: boolean): [number, number] {
  const model = createPlotModel({ size: { width: 800, height: 600 }, config: { showGrid: false } });
  const pane = model.plot.mainPane;
  pane.setYScale(new LogScale());
  pane.addSeries({ series: spanSeries(withFloor), data: [{ x: 0, low: -100, high: 5_000, floor: 1 }] });
  model.plot.render();
  return pane.yScale.getDomain();
}

describe("getPositiveFloor", () => {
  it("the log axis is fitted from the point's own floor when it has one", () => {
    const [min] = fitted(true);
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThanOrEqual(1);
  });

  it("without the door, a span dipping below zero is fitted from a constant, not from its lowest positive value", () => {
    const [min] = fitted(false);
    // The fallback stands three decades under the top — far above the value the span actually holds.
    expect(min).toBeGreaterThan(1);
  });

  it("the doors are asked in order, each only when the one before is absent: a door's null is an answer, a missing range falls to the value", () => {
    const calls: string[] = [];
    const fit = (coordinates: CoordinateAccessor<Span>): number => {
      // The extent dips below zero, so the log fit has to ask for a floor.
      const series: Series<Span> = { coordinates, valueExtent: () => ({ min: -100, max: 5_000 }), draw() {} };
      const model = createPlotModel({ size: { width: 800, height: 600 }, config: { showGrid: false } });
      const pane = model.plot.mainPane;
      pane.setYScale(new LogScale());
      pane.addSeries({ series, data: [{ x: 0, low: -100, high: 5_000, floor: 1 }] });
      model.plot.render();
      return pane.yScale.getDomain()[0];
    };
    // The door answers null: no positive floor — the range is not asked, the fit falls to the constant.
    const nulled = fit({
      getX: (p) => p.x,
      getY: (p) => p.high,
      getYRange: () => {
        calls.push("range");
        return { min: 2, max: 5_000 };
      },
      getPositiveFloor: () => {
        calls.push("door");
        return null;
      },
    });
    // The fit runs more than once (registration, then the frame); the range is never asked.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).not.toContain("range");
    expect(nulled).toBeGreaterThan(2);
    // No door, a range: the range's min is the floor.
    const ranged = fit({ getX: (p) => p.x, getY: () => 40, getYRange: () => ({ min: 2, max: 5_000 }) });
    expect(ranged).toBeLessThanOrEqual(2);
    expect(ranged).toBeGreaterThan(0.2);
    // No door, a range that says null: the value is the floor.
    const valued = fit({ getX: (p) => p.x, getY: () => 40, getYRange: () => null });
    expect(valued).toBeLessThanOrEqual(40);
    expect(valued).toBeGreaterThan(4);
  });
});
