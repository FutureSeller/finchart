import { describe, expect, it } from "vitest";
import { LineDataAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import {
  SimpleDecimation,
  LttbDecimation,
} from "../decimation";
import type { DataView, LineDataPoint, Viewport } from "../types";

/** The full window — a test convenience for the range contract: `decimate(...whole(data), threshold)`. */
const whole = <T,>(data: T[]): [T[], { start: number; end: number }] => [
  data,
  { start: 0, end: data.length },
];


function series(count: number): LineDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: i, y: i % 17 }));
}

function manager(options: { maxPoints?: number; pointsPerPixel?: number } = {}) {
  return new SimpleDataManager<LineDataPoint>({
    decimation: new SimpleDecimation(),
    coordinates: new LineDataAccessor(),
    ...options,
  });
}

const viewport = (width: number, endX = 100000): Viewport => ({
  startX: 0,
  endX,
  width,
  height: 600,
});

describe("SimpleDataManager", () => {
  it("should report the x range", () => {
    const dataManager = manager();
    dataManager.setData(series(50));

    expect(dataManager.getXRange()).toEqual({ min: 0, max: 49 });
  });

  it("should report no range at all for empty data", () => {
    // Not { min: 0, max: 0 }. "Nothing to measure" is different from
    // "measures to 0", and since each series carries its own data, that 0
    // would leak into the union.
    expect(manager().getXRange()).toBeNull();
  });

  it("should filter by the viewport x window", () => {
    const dataManager = manager();
    dataManager.setData(series(100));

    const visible = dataManager.getVisibleData({
      startX: 10,
      endX: 20,
      width: 800,
      height: 600,
    });

    expect(visible[0].x).toBe(10);
    expect(visible[visible.length - 1].x).toBe(20);
  });

  it("should copy data instead of aliasing", () => {
    const dataManager = manager();
    const input = series(5);

    dataManager.setData(input);
    input.push({ x: 999, y: 0 });

    expect(dataManager.getXRange()?.max).toBe(4);
  });

  /**
   * The array is copied; the points are not. Pins the handoff contract:
   * a point is the caller's value, handed over **by reference** and read
   * from then on — no per-point copy on a door that takes 100,000 points
   * per `setData`. The other half of that contract is on the caller: a
   * point isn't edited after the handoff.
   */
  it("should hand points over by reference, not copy them", () => {
    const dataManager = manager();
    const input = series(3);

    dataManager.setData(input);

    expect(dataManager.read()).not.toBe(input);
    expect(dataManager.read()[0]).toBe(input[0]);
  });
});

describe("width-aware decimation", () => {
  it("should keep fewer points on a narrow plot", () => {
    const dataManager = manager();
    dataManager.setData(series(10000));

    const narrow = dataManager.getVisibleData(viewport(200)).length;
    const wide = dataManager.getVisibleData(viewport(800)).length;

    expect(narrow).toBeLessThan(wide);
  });

  it("should target roughly pointsPerPixel per pixel", () => {
    const dataManager = manager({ pointsPerPixel: 1, maxPoints: 100000 });
    // Not a multiple of the budget, so the step has to round up to stay
    // within it.
    dataManager.setData(series(10050));

    const visible = dataManager.getVisibleData(viewport(400));

    // 400px * 1 = a 400 point budget, plus the guaranteed last point.
    expect(visible.length).toBeLessThanOrEqual(401);
    expect(visible.length).toBeGreaterThan(380);
  });

  it("should never exceed maxPoints however wide the plot is", () => {
    const dataManager = manager({ maxPoints: 100 });
    dataManager.setData(series(10000));

    expect(dataManager.getVisibleData(viewport(4000)).length).toBeLessThanOrEqual(
      101,
    );
  });

  it("should not decimate when the data already fits", () => {
    const dataManager = manager();
    const data = series(50);
    dataManager.setData(data);

    expect(dataManager.getVisibleData(viewport(800))).toHaveLength(50);
  });

  it("should round a fractional point budget up", () => {
    const thresholds: number[] = [];
    const dataManager = new SimpleDataManager<LineDataPoint>({
      decimation: {
        decimate: (data, range, threshold) => {
          thresholds.push(threshold);
          return data.slice(range.start, range.end);
        },
      },
      coordinates: new LineDataAccessor(),
      pointsPerPixel: 1,
    });
    dataManager.setData(series(1000));

    // A layout width is not always whole pixels: 100.5px asks for 101 points.
    dataManager.getVisibleData(viewport(100.5));

    expect(thresholds).toEqual([101]);
  });

  it("should fall back to the endpoints on a zero-width viewport", () => {
    const dataManager = manager();
    dataManager.setData(series(100));

    // A zero budget is floored to one, and step decimation always keeps
    // the last point.
    expect(
      dataManager.getVisibleData(viewport(0)).map((point) => point.x),
    ).toEqual([0, 99]);
  });
});

describe("LttbDecimation edge cases", () => {
  const lttb = () => new LttbDecimation(new LineDataAccessor());

  it("should return the data untouched when it already fits", () => {
    const data = series(10);
    expect(lttb().decimate(...whole(data), 50)).toBe(data);
  });

  it("should degrade to endpoints for a tiny threshold", () => {
    const data = series(100);
    expect(lttb().decimate(...whole(data), 2)).toEqual([data[0], data[99]]);
  });
});

describe("SimpleDecimation", () => {
  const simple = () => new SimpleDecimation<LineDataPoint>();

  it("should return the data untouched when it already fits", () => {
    const data = series(20);
    expect(simple().decimate(...whole(data), 50)).toBe(data);
  });
});

describe("viewport slicing", () => {
  const window = (startX: number, endX: number): Viewport => ({
    startX,
    endX,
    width: 100000, // generous enough that decimation doesn't touch the result
    height: 600,
  });

  const xs = (points: DataView<LineDataPoint>) => points.map((point) => point.x);

  it("should include both ends of the window", () => {
    const dataManager = manager();
    dataManager.setData(series(100));

    expect(xs(dataManager.getVisibleData(window(10, 20)))).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it("should keep every point with the same x at a boundary", () => {
    const dataManager = manager();
    dataManager.setData([
      { x: 0, y: 0 },
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
      { x: 9, y: 4 },
    ]);

    const visible = dataManager.getVisibleData(window(5, 5));

    expect(visible.map((point) => point.y)).toEqual([1, 2, 3]);
  });

  it("should return nothing for a window past the data", () => {
    const dataManager = manager();
    dataManager.setData(series(10));

    expect(dataManager.getVisibleData(window(100, 200))).toEqual([]);
    expect(dataManager.getVisibleData(window(-200, -100))).toEqual([]);
  });

  it("should return everything for a window around the data", () => {
    const dataManager = manager();
    dataManager.setData(series(10));

    expect(dataManager.getVisibleData(window(-50, 50))).toHaveLength(10);
  });

  it("should land on the window edge when no point sits on it", () => {
    const dataManager = manager();
    dataManager.setData([
      { x: 0, y: 0 },
      { x: 10, y: 1 },
      { x: 20, y: 2 },
      { x: 30, y: 3 },
    ]);

    expect(xs(dataManager.getVisibleData(window(5, 25)))).toEqual([10, 20]);
  });

  it("should read x a handful of times, not once per point", () => {
    let reads = 0;
    const counting = new (class {
      getX(point: LineDataPoint) {
        reads += 1;
        return Number(point.x);
      }
      getY(point: LineDataPoint) {
        return point.y;
      }
    })();

    const dataManager = new SimpleDataManager<LineDataPoint>({
      decimation: new SimpleDecimation(),
      coordinates: counting,
      maxPoints: 100000,
    });

    dataManager.setData(series(100_000));
    reads = 0; // don't count setData's sortedness check

    dataManager.getVisibleData(window(50_000, 50_100));

    // Two binary searches = 2 * log2(100000) ~= 34. A full scan would be 100,000.
    expect(reads).toBeLessThan(100);
  });
});

describe("sorted x contract", () => {
  it("should reject data that goes backwards", () => {
    expect(() =>
      manager().setData([
        { x: 0, y: 0 },
        { x: 5, y: 1 },
        { x: 3, y: 2 },
      ]),
    ).toThrow(/sorted by x/);
  });

  it("should name the offending index", () => {
    expect(() =>
      manager().setData([
        { x: 0, y: 0 },
        { x: 10, y: 1 },
        { x: 20, y: 2 },
        { x: 1, y: 3 },
      ]),
    ).toThrow(/index 3/);
  });

  it("should accept repeated x on line data (no uniqueX)", () => {
    expect(() =>
      manager().setData([
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).not.toThrow();
  });

  it("should accept empty and single-point data", () => {
    expect(() => manager().setData([])).not.toThrow();
    expect(() => manager().setData([{ x: 5, y: 1 }])).not.toThrow();
  });

});
