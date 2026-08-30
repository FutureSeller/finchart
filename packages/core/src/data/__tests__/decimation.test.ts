import { describe, expect, it } from "vitest";
import { LineDataAccessor } from "../accessors";
import { LttbDecimation, M4Decimation } from "../decimation";
import type { LineDataPoint } from "../types";

/** The full window — a test convenience for the range contract: `decimate(...whole(data), threshold)`. */
const whole = <T,>(data: T[]): [T[], { start: number; end: number }] => [
  data,
  { start: 0, end: data.length },
];


const m4 = () => new M4Decimation(new LineDataAccessor());

/** x is evenly spaced, y is sawtooth. Needed data where we know exactly where the extremes sit. */
function sawtooth(count: number): LineDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: i, y: i % 17 }));
}

describe("M4Decimation", () => {
  it("should return the data untouched when it already fits", () => {
    const data = sawtooth(20);
    expect(m4().decimate(...whole(data), 50)).toBe(data);
  });

  it("should keep the first and last point", () => {
    const data = sawtooth(1000);
    const decimated = m4().decimate(...whole(data), 100);

    expect(decimated[0]).toBe(data[0]);
    expect(decimated[decimated.length - 1]).toBe(data[data.length - 1]);
  });

  it("should stay within the threshold", () => {
    for (const threshold of [4, 40, 400]) {
      expect(m4().decimate(...whole(sawtooth(10_000)), threshold).length).toBeLessThanOrEqual(
        threshold,
      );
    }
  });

  /** If the budget doesn't cover even one column, it falls back to the two endpoints — even a budget of 1 gives 2 points. */
  it("should fall back to two endpoints below one column", () => {
    const data = sawtooth(100);

    for (const threshold of [0, 1, 2, 3]) {
      expect(m4().decimate(...whole(data), threshold)).toEqual([data[0], data[99]]);
    }
  });

  it("should emit points in x order", () => {
    const decimated = m4().decimate(...whole(sawtooth(5000)), 200);

    for (let i = 1; i < decimated.length; i++) {
      expect(decimated[i].x).toBeGreaterThanOrEqual(Number(decimated[i - 1].x));
    }
  });

  it("should select original points, not synthesized ones", () => {
    const data = sawtooth(1000);
    const decimated = m4().decimate(...whole(data), 100);

    expect(decimated.every((point) => data.includes(point))).toBe(true);
  });

  it("should never emit the same point twice", () => {
    const decimated = m4().decimate(...whole(sawtooth(1000)), 100);

    expect(new Set(decimated).size).toBe(decimated.length);
  });

  /** Grid and LTTB keep only one point per bucket, so a spike up and a spike down together lose one of them — that's why M4 exists. */
  it("should keep both spikes when they share a bucket", () => {
    const data: LineDataPoint[] = sawtooth(1000).map((point) => ({
      ...point,
      y: 0,
    }));
    data[500].y = 999;
    data[501].y = -999;

    const decimated = m4().decimate(...whole(data), 40);
    const ys = decimated.map((point) => point.y);

    expect(ys).toContain(999);
    expect(ys).toContain(-999);
  });

  it("should keep the extremes of every pixel column", () => {
    // One spike per column. Missing even one fails the test.
    const data: LineDataPoint[] = Array.from({ length: 1000 }, (_, i) => ({
      x: i,
      y: i % 100 === 50 ? 1 : 0,
    }));

    const decimated = m4().decimate(...whole(data), 40);

    expect(decimated.filter((point) => point.y === 1)).toHaveLength(10);
  });

  it("should bucket by x, not by index, when x is irregular", () => {
    // Points cluster in the first half. Dividing by index would clump the whole second half into one bucket.
    const dense: LineDataPoint[] = Array.from({ length: 900 }, (_, i) => ({
      x: i / 10,
      y: 0,
    }));
    const sparse: LineDataPoint[] = Array.from({ length: 100 }, (_, i) => ({
      x: 90 + i * 9,
      y: i % 2 === 0 ? 5 : -5,
    }));
    const data = [...dense, ...sparse];

    const decimated = m4().decimate(...whole(data), 40);
    const tail = decimated.filter((point) => Number(point.x) >= 90);

    // Dividing by x, the tail (90% of the x range) claims most of the buckets.
    expect(tail.length).toBeGreaterThan(decimated.length / 2);
  });

  it("should survive data that shares a single x", () => {
    const data: LineDataPoint[] = Array.from({ length: 100 }, (_, i) => ({
      x: 7,
      y: i,
    }));

    const decimated = m4().decimate(...whole(data), 8);

    expect(decimated.length).toBeGreaterThan(0);
    expect(decimated.map((point) => point.y)).toContain(99);
  });

  it("should degrade to endpoints for a threshold below one column", () => {
    const data = sawtooth(100);
    expect(m4().decimate(...whole(data), 3)).toEqual([data[0], data[99]]);
  });

  it("should never emit undefined entries", () => {
    for (let n = 100; n <= 1000; n += 137) {
      const decimated = m4().decimate(...whole(sawtooth(n)), 37);
      expect(decimated.every((point) => point !== undefined)).toBe(true);
    }
  });
});

/**
 * Even built with no coordinates, this gets the same `{x, y}` default
 * accessor as its siblings (grid, Simple) — without this default, an
 * untyped consumer's `new M4Decimation()` would blow up on the first
 * decimate with a raw TypeError leaking internal names.
 */
describe("default accessor", () => {
  it("works on {x, y} data even when M4/LTTB are built without coordinates", () => {
    const data = sawtooth(100);

    const byM4 = new M4Decimation().decimate(...whole(data), 8);
    const byLttb = new LttbDecimation().decimate(...whole(data), 8);

    expect(byM4.length).toBeGreaterThan(0);
    expect(byM4.length).toBeLessThanOrEqual(9);
    expect(byLttb).toHaveLength(8);
    // Same answer as with an explicit accessor — the default is exactly the shape of LineDataAccessor.
    expect(byM4).toEqual(m4().decimate(...whole(data), 8));
  });
});

/**
 * When the screen is a different space from x (a bar-index coordinate
 * system), buckets divide in that space instead — "a column is a place on
 * screen" enters through `screenXOf`.
 */
describe("screen-space bucketing (screenXOf)", () => {
  /** The first 15 are tightly packed and the last one is far away — a shape where x and index diverge sharply. */
  const clustered: LineDataPoint[] = [
    ...Array.from({ length: 15 }, (_, i) => ({ x: i, y: i })),
    { x: 1000, y: 15 },
  ];

  /** Stands in for a bar index: which position this x is at. Passed through the pass factory — because the contract is `screenXScan`. */
  const indexOf = () => (x: number): number =>
    clustered.findIndex((point) => point.x === x);

  it("should divide M4 buckets by the screen place, not by x", () => {
    // Budget 8 -> two buckets. Dividing by x gives [0..14 | 1000]; dividing by index gives [0..7 | 8..15].
    const byX = m4().decimate(...whole(clustered), 8);
    const byIndex = m4().decimate(...whole(clustered), 8, indexOf);

    expect(byX.map((point) => point.x)).toEqual([0, 14, 1000]);
    expect(byIndex.map((point) => point.x)).toEqual([0, 7, 8, 1000]);
  });

  it("should match decimating data whose x is already the screen place", () => {
    // Passing a transform and pre-transforming x ahead of time must give the same picture.
    const placed = clustered.map((point, i) => ({ x: i, y: point.y }));

    const viaTransform = m4().decimate(...whole(clustered), 8, indexOf);
    const viaData = m4().decimate(...whole(placed), 8);

    expect(viaTransform.map((point) => point.y)).toEqual(
      viaData.map((point) => point.y),
    );
  });

  it("should measure LTTB triangles on the screen place", () => {
    const lttb = new LttbDecimation<LineDataPoint>(new LineDataAccessor());
    const placed = clustered.map((point, i) => ({ x: i, y: point.y }));

    const viaTransform = lttb.decimate(...whole(clustered), 5, indexOf);
    const viaData = lttb.decimate(...whole(placed), 5);

    expect(viaTransform.map((point) => point.y)).toEqual(
      viaData.map((point) => point.y),
    );
  });

  it("should still cut at holes with a transform in play", () => {
    const holed: LineDataPoint[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ x: i, y: i })),
      { x: 8, y: null },
      ...Array.from({ length: 8 }, (_, i) => ({ x: 100 + i, y: i })),
    ];
    const place = (x: number): number => (x < 100 ? x : x - 92);

    const decimated = m4().decimate(...whole(holed), 12, () => place);

    // The hole stays put (the line breaks there); only the value ranges get decimated by screen place.
    expect(decimated.some((point) => point.y === null)).toBe(true);
  });
});
