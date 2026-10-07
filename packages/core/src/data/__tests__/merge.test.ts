import { describe, expect, it } from "vitest";
import { DataError } from "../../primitives";
import { LineDataAccessor, OHLCAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import { SimpleDecimation } from "../decimation";
import type { LineDataPoint, OHLC } from "../types";

const bar = (x: number, close = x): OHLC => ({ x, open: 1, high: 2, low: 0.5, close });
const closes = (points: readonly OHLC[]) => points.map((point) => point.close);

function candles(...xs: number[]) {
  const m = new SimpleDataManager<OHLC>({ decimation: new SimpleDecimation(), coordinates: new OHLCAccessor() });
  m.setData(xs.map((x) => bar(x)));
  return m;
}
function lines(points: LineDataPoint[]) {
  const m = new SimpleDataManager<LineDataPoint>({ decimation: new SimpleDecimation(), coordinates: new LineDataAccessor() });
  m.setData(points);
  return m;
}

/**
 * **The reconciliation door.** A REST snapshot names some bars: those
 * become the snapshot's, every other bar keeps what it had, and nothing
 * the series holds is dropped by omission — a sparse correction is not a
 * deletion, and a snapshot that ends before the live tail does not cut it.
 */
describe("SimpleDataManager.merge — the x it names are its own, the rest stay", () => {
  // The union itself is pinned case by case on `mergeByX`; this checks the
  // door hands its held array and accessor to it, through an interior seam.
  it("replaces the bars it names and keeps the ones it does not", () => {
    const m = candles(1, 2, 3, 4, 5, 6);
    m.merge([bar(4, 40), bar(6, 60)]);

    expect(closes(m.read())).toEqual([1, 2, 3, 40, 5, 60]);
  });

  it("does nothing with an empty chunk", () => {
    const m = candles(1, 2, 3);
    const before = m.read();
    m.merge([]);

    expect(m.read()).toBe(before);
  });

  it("refuses a chunk that is not in order, or that repeats an x the accessor holds unique", () => {
    expect(() => candles(1, 2, 3).merge([bar(4), bar(3)])).toThrow(DataError);
    expect(() => candles(1, 2, 3).merge([bar(4), bar(4)])).toThrow(DataError);
    // A line accessor allows the repeat inside the chunk.
    expect(() => lines([{ x: 1, y: 1 }]).merge([{ x: 4, y: 1 }, { x: 4, y: 2 }])).not.toThrow();
  });

  it("refuses a point that is not one before it reads where the chunk begins", () => {
    const m = candles(1, 2, 3);
    expect(() => m.merge([bar(Number.NaN)])).toThrow(DataError);
    expect(() => m.merge([{ x: 4 } as unknown as OHLC])).toThrow(DataError);
    // Nothing was committed by the refusal.
    expect(closes(m.read())).toEqual([1, 2, 3]);
  });
});
