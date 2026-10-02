import { describe, expect, it } from "vitest";
import {
  computation,
  type DataManagerFactory,
  type DataView,
  type LineDataPoint,
  type OHLC,
  SimpleDataManager,
  SimpleDecimation,
} from "../../data";
import { DataError } from "../../primitives";
import { createEntry } from "../../registration";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel } from "../model";

const bar = (x: number, close = x, volume = 1): OHLC => ({
  x,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume,
});
const bars = (...xs: number[]) => xs.map((x) => bar(x));
const closes = (points: readonly OHLC[]) => points.map((point) => point.close);

/** A three-bar moving average of the close — the derivation every oracle reads. */
const sma3 = (source: DataView<OHLC>): LineDataPoint[] =>
  source.slice(2).map((point, i) => ({
    x: point.x,
    y: (source[i].close + source[i + 1].close + point.close) / 3,
  }));

function chart(data: OHLC[]) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
  });
  const handle = model.plot.mainPane.addSeries({ series: candleSeries(), data });
  // The derivation reads the handle the way an indicator does — through a
  // computation node, so a tail change is seen as one by identity.
  const node = computation({ inputs: [handle], calc: (source: DataView<OHLC>) => ({ sma: sma3(source) }) });
  const derived = model.plot.mainPane.addSeries({ series: lineSeries(), input: node.out.sma });
  model.plot.render();
  return { model, handle, derived };
}

const withManager: DataManagerFactory = (coordinates) =>
  new SimpleDataManager({ decimation: new SimpleDecimation(), coordinates });
/**
 * The default manager with its `merge` hidden — what a custom manager
 * written before the door looks like to the entry.
 */
const withoutMerge: DataManagerFactory = (coordinates) =>
  new Proxy(new SimpleDataManager({ decimation: new SimpleDecimation(), coordinates }), {
    get: (target, key, receiver) => (key === "merge" ? undefined : Reflect.get(target, key, receiver)),
  });

/**
 * **A snapshot is one call, and what it does not name it leaves.** The
 * oracles are other doors: a gap plus a corrected tail is what `append`
 * then `updateLast` would have made, and a correction anywhere is what
 * `setData` of the merged array would have drawn.
 */
describe("SeriesHandle.upsert — merged by x", () => {
  it("is append then updateLast, in one call", () => {
    const one = chart(bars(1, 2, 3));
    const two = chart(bars(1, 2, 3));

    one.handle.upsert([bar(4), bar(5, 55)]);
    two.handle.append([bar(4), bar(5)]);
    two.handle.updateLast(bar(5, 55));

    expect(one.handle.read()).toEqual(two.handle.read());
    expect(one.handle.xRange).toEqual(two.handle.xRange);
    expect(one.derived.read()).toEqual(two.derived.read());
  });

  it.each([
    ["one bar", [bar(5, 50)]],
    ["three bars", [bar(4, 40), bar(5, 50), bar(6, 60)]],
    ["a bar between two held", [bar(4.5, 45)]],
    ["a tail past the end", [bar(11), bar(12)]],
  ])("draws what setData of the merged array draws — %s", (_name, snapshot) => {
    const live = chart(bars(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    live.handle.upsert(snapshot);

    const merged = [...bars(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)]
      .filter((held) => !snapshot.some((point) => point.x === held.x))
      .concat(snapshot)
      .sort((a, b) => a.x - b.x);
    const whole = chart(merged);

    expect(live.handle.read()).toEqual(whole.handle.read());
    expect(live.derived.read()).toEqual(whole.derived.read());
  });

  it("replaces the bars it names and keeps the ones it does not — a sparse correction is not a deletion", () => {
    const { handle } = chart(bars(1, 2, 3, 4, 5, 6));
    handle.upsert([bar(4, 40), bar(6, 60)]);

    expect(closes(handle.read())).toEqual([1, 2, 3, 40, 5, 60]);
  });

  it("keeps the bars beyond the last it names — a snapshot older than the tail cuts nothing", () => {
    const { handle } = chart(bars(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    handle.upsert([bar(4, 40), bar(5, 50), bar(6, 60)]);

    expect(closes(handle.read())).toEqual([1, 2, 3, 40, 50, 60, 7, 8, 9, 10]);
  });

  /**
   * The point of the door over `setData`: history the loader prepended
   * keeps its objects and its place.
   */
  it("keeps the prepended past, and the objects before the first x it names", () => {
    const { handle } = chart(bars(10, 11, 12, 13, 14, 15));
    handle.prepend(bars(5, 6, 7, 8, 9));
    const before = handle.read();

    handle.upsert([bar(13, 130)]);
    const after = handle.read();

    expect(handle.xRange).toEqual({ min: 5, max: 15 });
    for (let i = 0; i < 8; i++) expect(after[i]).toBe(before[i]);
    expect(after[8].close).toBe(130);

    // The contrast: setData of the same correction drops the past.
    const other = chart(bars(10, 11, 12, 13, 14, 15));
    other.handle.prepend(bars(5, 6, 7, 8, 9));
    other.handle.setData([bar(13, 130)], { refit: false });
    expect(other.handle.xRange).toEqual({ min: 13, max: 13 });
  });

  it("refuses an x before the first point held, and names the door the past comes through", () => {
    const { handle } = chart(bars(10, 11));

    expect(() => handle.upsert([bar(8), bar(10, 100)])).toThrow(DataError);
    expect(() => handle.upsert([bar(8), bar(10, 100)])).toThrow(/prepend/);
    // Nothing was committed by the refusal, and the past still comes in through its own door.
    expect(closes(handle.read())).toEqual([10, 11]);
    handle.prepend(bars(8, 9));
    expect(handle.xRange).toEqual({ min: 8, max: 11 });
  });

  it("leaves the window where the user put it, the way append does", () => {
    const { model, handle } = chart(bars(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    model.plot.pan(0.5);
    const viewing = model.plot.getVisibleRange();

    handle.upsert([bar(9, 90), bar(10, 100), bar(11), bar(12)]);

    expect(model.plot.getVisibleRange()).toEqual(viewing);
  });

  it("does nothing with an empty chunk", () => {
    const { handle } = chart(bars(1, 2, 3));
    const before = handle.read();
    handle.upsert([]);
    expect(handle.read()).toBe(before);
  });

  it("gives a manager without the door the merged array, and holds the same", () => {
    const withDoor = createEntry({ series: candleSeries(), data: bars(1, 2, 3, 4, 5, 6) }, withManager);
    const without = createEntry({ series: candleSeries(), data: bars(1, 2, 3, 4, 5, 6) }, withoutMerge);
    const snapshot = [bar(4, 40), bar(6, 60), bar(7)];

    expect(without.upsert(snapshot)).toBe(withDoor.upsert(snapshot));
    expect(without.read()).toEqual(withDoor.read());
    expect(without.xRange()).toEqual(withDoor.xRange());
    expect(without.read().map((point) => point.x)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  /**
   * **A manager without the door accepts exactly what one with it accepts.**
   * The default walks the chunk and refuses an endpoint without a value;
   * `setData` of the merged array would have read that same point as
   * whitespace between two neighbours and let it through. The fallback
   * walks the chunk first, so the two disagree on nothing.
   */
  it("refuses in the fallback what the door refuses — a chunk whose end has no value", () => {
    const line = (): LineDataPoint[] => [{ x: 1, y: 1 }, { x: 3, y: 3 }];
    const withDoor = createEntry({ series: lineSeries(), data: line() }, withManager);
    const without = createEntry({ series: lineSeries(), data: line() }, withoutMerge);
    // A point without a value — whitespace by contract, but not as a chunk's endpoint.
    const whitespaceOnly = [{ x: 2 }] as unknown as LineDataPoint[];

    expect(() => withDoor.upsert(whitespaceOnly)).toThrow(DataError);
    expect(() => without.upsert(whitespaceOnly)).toThrow(DataError);
    expect(without.read()).toEqual(line());
  });

  it("refuses a point that is not one anywhere in the chunk, as a data error naming the door", () => {
    const chunk = [bar(4, 40), null] as unknown as OHLC[];
    for (const factory of [withManager, withoutMerge]) {
      const entry = createEntry({ series: candleSeries(), data: bars(1, 2, 3) }, factory);
      expect(() => entry.upsert(chunk)).toThrow(DataError);
      expect(() => entry.upsert(chunk)).toThrow(/upsert\(points\)/);
      expect(entry.read().map((point) => point.x)).toEqual([1, 2, 3]);
    }
    // And on a derivation, whose chunk is walked by the entry itself.
    const model = createPlotModel({ size: { width: 400, height: 300 }, config: { showGrid: false } });
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(1, 2, 3),
      derive: (source: DataView<OHLC>) => source.map((point) => ({ x: point.x, y: point.close })),
    });
    expect(() => derived.upsert(chunk)).toThrow(DataError);
    expect(() => derived.upsert(chunk)).toThrow(/upsert\(points\)/);
  });

  it("names the door and the chunk's own index whatever the chunk got wrong", () => {
    for (const factory of [withManager, withoutMerge]) {
      const entry = createEntry({ series: candleSeries(), data: bars(1, 2, 3) }, factory);
      expect(() => entry.upsert([bar(4), bar(Number.NaN)])).toThrow(/upsert\(points\).*index 1/);
      expect(() => entry.upsert([bar(4), bar(3)])).toThrow(/upsert\(points\).*index 1/);
      expect(() => entry.upsert([bar(4), bar(4)])).toThrow(/upsert\(points\).*index 1/);
    }
  });

  /**
   * The entry keeps two aliases of the same array — the drawn points and
   * the source a derivation reads — and the door has to advance both, or
   * the next tick is judged against a tail that is no longer there.
   */
  it("moves the tail that updateLast is judged against", () => {
    const { handle } = chart(bars(1, 2, 3));
    handle.upsert([bar(3, 30), bar(4), bar(5)]);

    expect(() => handle.updateLast(bar(4, 44))).toThrow(DataError);
    handle.updateLast(bar(5, 55));
    expect(closes(handle.read())).toEqual([1, 2, 30, 4, 55]);
  });
});

describe("upsert on a derivation — its source has to be sorted to merge into", () => {
  const sortedByX = (source: DataView<OHLC>): LineDataPoint[] =>
    [...source].sort((a, b) => a.x - b.x).map((point) => ({ x: point.x, y: point.close }));

  it("refuses when the source it holds is out of order, however well the output sorts", () => {
    const model = createPlotModel({ size: { width: 400, height: 300 }, config: { showGrid: false } });
    // A derivation that sorts its output passes every door on the way in.
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: [bar(5), bar(1), bar(4), bar(6)],
      derive: sortedByX,
    });
    model.plot.render();

    expect(() => handle.upsert([bar(5, 50)])).toThrow(DataError);
    expect(() => handle.upsert([bar(5, 50)])).toThrow(/not sorted/);
  });

  it("refuses when the source holds an x that is not finite, however the derivation hides it", () => {
    const model = createPlotModel({ size: { width: 400, height: 300 }, config: { showGrid: false } });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: [bar(1), bar(Number.NaN), bar(4)],
      derive: (source: DataView<OHLC>) =>
        source.filter((point) => Number.isFinite(point.x)).map((point) => ({ x: point.x, y: point.close })),
    });
    model.plot.render();

    expect(() => handle.upsert([bar(4, 40)])).toThrow(DataError);
  });

  /**
   * A derivation may skip what it cannot read, so its retained source can
   * hold a point that is no point at all — and the door reads the first
   * of them to decide whether the chunk reaches before it.
   */
  it("refuses, as a data error, a retained source whose first point is not one", () => {
    const model = createPlotModel({ size: { width: 400, height: 300 }, config: { showGrid: false } });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: [null, bar(2)] as unknown as OHLC[],
      derive: (source: DataView<OHLC>) =>
        source.filter((point) => point !== null).map((point) => ({ x: point.x, y: point.close })),
    });
    model.plot.render();
    const before = handle.read();

    expect(() => handle.upsert([bar(3)])).toThrow(DataError);
    expect(() => handle.upsert([bar(3)])).toThrow(/upsert\(points\)/);
    expect(handle.read()).toBe(before);
  });

  it("merges into a sorted source and redraws the derivation whole", () => {
    const model = createPlotModel({ size: { width: 400, height: 300 }, config: { showGrid: false } });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(1, 2, 3, 4, 5),
      derive: sortedByX,
    });
    model.plot.render();

    handle.upsert([bar(3, 30), bar(6, 60)]);

    expect(handle.read().map((point) => point.y)).toEqual([1, 2, 30, 4, 5, 60]);
  });
});

/**
 * **The x signal is what the frame reads to decide whether to recount.**
 * A same-x correction of a few bars is not a new set of x values; a gap
 * filled or a tail extended is.
 */
describe("upsert — whether the set of x values changed", () => {
  const entry = (data: OHLC[]) => createEntry({ series: candleSeries(), data }, withManager);

  it("is false for a same-x correction and true where an x was added", () => {
    const same = entry(bars(1, 2, 3, 4, 5));
    expect(same.upsert([bar(3, 30), bar(4, 40)])).toBe(false);

    const filled = entry(bars(1, 2, 4, 5));
    expect(filled.upsert([bar(3)])).toBe(true);

    const extended = entry(bars(1, 2, 3));
    expect(extended.upsert([bar(3, 30), bar(4)])).toBe(true);
  });
});
