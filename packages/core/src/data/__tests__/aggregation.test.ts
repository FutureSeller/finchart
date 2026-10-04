import { describe, expect, it } from "vitest";
import { OhlcAggregation } from "../aggregation";
import { OHLCAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import type { OHLC } from "../types";
import { DataError } from "../../primitives";

/** The full window — a test convenience for the range contract: `decimate(...whole(data), threshold)`. */
const whole = <T,>(data: T[]): [T[], { start: number; end: number }] => [
  data,
  { start: 0, end: data.length },
];


const aggregation = () => new OhlcAggregation();

/** Sawtooth candles. Needed data where we know exactly where the high/low sit. */
function candles(count: number): OHLC[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i,
    open: 100 + (i % 7),
    high: 110 + (i % 13),
    low: 90 - (i % 11),
    close: 100 + ((i + 3) % 7),
  }));
}

describe("OhlcAggregation", () => {
  it("should return the data untouched when it already fits", () => {
    const data = candles(20);
    expect(aggregation().decimate(...whole(data), 50)).toBe(data);
  });

  it("should stay within the threshold", () => {
    for (const threshold of [1, 10, 100, 997]) {
      expect(
        aggregation().decimate(...whole(candles(10_000)), threshold).length,
      ).toBeLessThanOrEqual(threshold);
    }
  });

  it("keeps an off-grid visible window within the threshold", () => {
    const data = candles(12);
    for (const threshold of [1, 5]) {
      const out = aggregation().decimate(data, { start: 1, end: 11 }, threshold);
      expect(out.length).toBeLessThanOrEqual(threshold);
      expect(out[0].open).toBe(data[1].open);
      expect(out.at(-1)?.close).toBe(data[10].close);
    }
  });

  /**
   * This is where aggregation diverges from decimation. Picking a single
   * candle from the bucket would lose the high/low of the rest of the
   * candles. Merging keeps them.
   */
  it("should keep the highest high and the lowest low of the bucket", () => {
    const data = candles(100);
    data[42].high = 9999;
    data[57].low = -9999;

    const merged = aggregation().decimate(...whole(data), 10);

    expect(merged.map((candle) => candle.high)).toContain(9999);
    expect(merged.map((candle) => candle.low)).toContain(-9999);
  });

  it("should open at the first candle and close at the last", () => {
    const data = candles(100);
    const merged = aggregation().decimate(...whole(data), 10);

    expect(merged[0].open).toBe(data[0].open);
    expect(merged[merged.length - 1].close).toBe(data[99].close);
  });

  it("should place the merged candle at the x of the bucket's first candle", () => {
    const merged = aggregation().decimate(...whole(candles(100)), 10);

    expect(merged[0].x).toBe(0);
    expect(merged[1].x).toBe(10);
  });

  it("should keep merged candles consistent", () => {
    const merged = aggregation().decimate(...whole(candles(1000)), 50);

    for (const candle of merged) {
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
    }
  });

  /**
   * Checks that the window is covered with no gaps. Skipping every
   * other bar would still leave "global high, first x, last close"
   * unchanged, so a test that only checks those three catches nothing.
   * This reconstructs the bucket boundaries directly — whole buckets on
   * the grid from index 0, the edge ones clipped to the window — and
   * compares against them.
   */
  it("should cover every candle exactly once", () => {
    const data = candles(1000);
    const threshold = 37;
    const range = { start: 5, end: 1000 };
    const merged = aggregation().decimate(data, range, threshold);

    const size = Math.ceil((range.end - range.start) / threshold);
    const bounds = [range.start];
    for (let b = size; b < range.end; b += size) if (b > range.start) bounds.push(b);
    bounds.push(range.end);
    if (bounds.length - 1 > threshold) bounds.splice(1, 1);
    expect(merged).toHaveLength(bounds.length - 1);

    let covered = 0;

    merged.forEach((candle, i) => {
      const start = bounds[i];
      const end = bounds[i + 1];
      const slice = data.slice(start, end);

      expect(slice.length).toBeGreaterThan(0);
      expect(candle.x).toBe(data[start].x);
      expect(candle.open).toBe(data[start].open);
      expect(candle.close).toBe(data[end - 1].close);
      expect(candle.high).toBe(Math.max(...slice.map((c) => c.high)));
      expect(candle.low).toBe(Math.min(...slice.map((c) => c.low)));

      covered += slice.length;
    });

    // Summing all the buckets gives back the window — no bar missed, none counted twice.
    expect(covered).toBe(range.end - range.start);
  });

  it("should emit candles in x order", () => {
    const merged = aggregation().decimate(...whole(candles(500)), 30);

    for (let i = 1; i < merged.length; i++) {
      expect(Number(merged[i].x)).toBeGreaterThan(Number(merged[i - 1].x));
    }
  });

  it("should sum volume when the data carries it", () => {
    const data = candles(100).map((candle) => ({ ...candle, volume: 2 }));
    const merged = aggregation().decimate(...whole(data), 10);

    expect(merged[0].volume).toBe(20);
  });

  it("should skip a null volume as a gap — including a null on the first bar", () => {
    const data = candles(100).map((candle, i) => ({
      ...candle,
      volume: i % 10 === 0 ? null : 2,
    }));
    const merged = aggregation().decimate(...whole(data), 10);
    // Nine bars of 2 per bucket; the bucket's first bar is a gap, not a 0 seed.
    expect(merged[0].volume).toBe(18);
  });

  it("should leave volume absent when every bar in the bucket is a gap", () => {
    const data = candles(100).map((candle) => ({ ...candle, volume: null }));
    const merged = aggregation().decimate(...whole(data), 10);
    expect(merged[0].volume).toBeUndefined();
  });

  it("should leave volume alone when the data has none", () => {
    const merged = aggregation().decimate(...whole(candles(100)), 10);

    expect(merged[0].volume).toBeUndefined();
  });

  it("should not mutate the input", () => {
    const data = candles(100);
    const before = JSON.stringify(data);

    aggregation().decimate(...whole(data), 10);

    expect(JSON.stringify(data)).toBe(before);
  });

  it("should survive a threshold of one", () => {
    const data = candles(100);
    const merged = aggregation().decimate(...whole(data), 1);

    expect(merged).toHaveLength(1);
    expect(merged[0].open).toBe(data[0].open);
    expect(merged[0].close).toBe(data[99].close);
  });
});

it("OHLC aggregation refuses overflowing volume without altering its input", () => {
  const data = [0, 1].map(x => Object.freeze({ x, open: 1, high: 2, low: 0, close: 1, volume: Number.MAX_VALUE }));
  expect(() => new OhlcAggregation().decimate(data, { start: 0, end: 2 }, 1)).toThrow(DataError);
  expect(data.map(p => p.volume)).toEqual([Number.MAX_VALUE, Number.MAX_VALUE]);
  const finite = data.map(p => ({ ...p, volume: Number.MAX_VALUE / 4 }));
  expect(new OhlcAggregation().decimate(finite, { start: 0, end: 2 }, 1)[0].volume).toBe(Number.MAX_VALUE / 2);
});

/**
 * Buckets were counted from the first visible index, so a one-bar pan
 * moved every boundary and the whole zoomed-out chart shimmered — bodies,
 * colours and wicks changed on each move.
 */
describe("OhlcAggregation buckets stay put while panning", () => {
  it("leaves every candle away from the window edges unchanged after a one-bar pan", () => {
    const data = candles(50_000);
    const before = aggregation().decimate(data, { start: 10_000, end: 40_000 }, 800);
    const after = aggregation().decimate(data, { start: 10_001, end: 40_001 }, 800);
    const byX = new Map(after.map((candle) => [candle.x, candle]));

    for (const candle of before.slice(1, -1)) {
      expect(byX.get(candle.x)).toEqual(candle);
    }
  });
});

describe("OhlcAggregation buckets stay put as history changes", () => {
  it.each([false, true])("retains the visible groups after prepend, setData and append (tiered=%s)", (tiered) => {
    const manager = new SimpleDataManager<OHLC>({
      decimation: new OhlcAggregation(),
      coordinates: new OHLCAccessor(),
      pointsPerPixel: 1,
      tiered,
    });
    const original = candles(tiered ? 6000 : 60);
    const view = tiered
      ? { startX: 1000, endX: 4000, width: 10, height: 100 }
      : { startX: 10, endX: 39, width: 10, height: 100 };
    manager.setData(original);
    const before = manager.getVisibleData(view);

    const older = { ...original[0], x: -1 };
    manager.prepend([older]);
    expect(manager.getVisibleData(view)).toEqual(before);

    const oldest = { ...older, x: -2 };
    manager.setData([oldest, older, ...original]);
    expect(manager.getVisibleData(view)).toEqual(before);

    manager.append([{ ...original.at(-1)!, x: original.length }]);
    expect(manager.getVisibleData(view)).toEqual(before);
  });
});
