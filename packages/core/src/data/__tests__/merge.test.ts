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
  it("replaces the bars it names and keeps the ones it does not", () => {
    const m = candles(1, 2, 3, 4, 5, 6);
    m.merge([bar(4, 40), bar(6, 60)]);

    expect(closes(m.read())).toEqual([1, 2, 3, 40, 5, 60]);
  });

  it("keeps the bars beyond the last it names — a snapshot older than the tail cuts nothing", () => {
    const m = candles(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    m.merge([bar(4, 40), bar(5, 50), bar(6, 60)]);

    expect(closes(m.read())).toEqual([1, 2, 3, 40, 50, 60, 7, 8, 9, 10]);
  });

  it("puts a bar it did not hold where it belongs, and appends past the end", () => {
    const m = candles(1, 3, 5);
    m.merge([bar(2), bar(4), bar(6), bar(7)]);

    expect(m.read().map((point) => point.x)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(m.getXRange()).toEqual({ min: 1, max: 7 });
  });

  it("is append when everything it names lies past the end", () => {
    const a = candles(1, 2, 3);
    const b = candles(1, 2, 3);
    a.merge([bar(4), bar(5)]);
    b.append([bar(4), bar(5)]);

    expect(a.read()).toEqual(b.read());
  });

  it("keeps the object identity of every bar outside the runs it replaces", () => {
    const m = candles(1, 2, 3, 4, 5);
    const before = m.read();
    m.merge([bar(3, 30)]);
    const after = m.read();

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[3]).toBe(before[3]);
    expect(after[4]).toBe(before[4]);
    expect(after[2]).not.toBe(before[2]);
  });

  /**
   * Where x is not unique a key holds a run, and the run is replaced
   * whole: `[4a, 4b]` is not paired with `[4c, 4d, 4e]` one to one.
   */
  it("replaces a whole run at an x where the accessor allows duplicates", () => {
    const m = lines([{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 6, y: 6 }]);
    m.merge([{ x: 4, y: 3 }, { x: 4, y: 4 }, { x: 4, y: 5 }]);

    expect(m.read().map((point) => point.y)).toEqual([3, 4, 5, 6]);
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
