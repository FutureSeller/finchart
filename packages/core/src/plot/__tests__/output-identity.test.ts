import { describe, expect, it } from "vitest";
import {
  computation,
  reuseUnchanged,
  type BaseDataPoint,
  type DataView,
  type LineDataPoint,
  type OHLC,
} from "../../data";
import { candleSeries, lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

/**
 * Downstream, a change's shape is read from point identity (`tailDelta`):
 * if every position is a fresh object, a one-bar tick reads as a full
 * change and each consumer re-validates and copies its whole array. A
 * node that recomputes wholesale can still hand its consumers the tail —
 * by keeping the unchanged output objects with `reuseUnchanged`. It is a
 * call the author makes, not a guess the node takes: only the author
 * knows their points are plain data records.
 */

const candles = (count: number): OHLC[] =>
  Array.from({ length: count }, (_, i) => ({
    x: i,
    open: 100 + i,
    high: 110 + i,
    low: 90 + i,
    close: 105 + i,
  }));

const line = (count: number): LineDataPoint[] =>
  Array.from({ length: count }, (_, i) => ({ x: i, y: i * 2 }));

describe("reuseUnchanged — the unit", () => {
  it("an appended branch keeps every earlier object; the new one stays new", () => {
    const previous = { out: line(5) };
    const next = { out: line(6) };
    const kept = reuseUnchanged(previous, next);
    for (let i = 0; i < 5; i++) expect(kept.out[i], `out[${i}]`).toBe(previous.out[i]);
    expect(kept.out[5]).toBe(next.out[5]);
    expect(kept.out).toHaveLength(6);
  });

  it("a replaced last point is the only new object", () => {
    const previous = { out: line(5) };
    const next = { out: line(5) };
    next.out[4] = { x: 4, y: 999 };
    const kept = reuseUnchanged(previous, next);
    for (let i = 0; i < 4; i++) expect(kept.out[i]).toBe(previous.out[i]);
    expect(kept.out[4]).toBe(next.out[4]);
  });

  it("neither argument is touched — the copy carries the reused objects", () => {
    const previous = { out: line(5) };
    const next = { out: line(6) };
    const fresh = [...next.out];
    const kept = reuseUnchanged(previous, next);
    expect(kept).not.toBe(next);
    expect(kept.out).not.toBe(next.out);
    expect(next.out).toEqual(fresh);
    for (let i = 0; i < 6; i++) expect(next.out[i], `next[${i}] untouched`).toBe(fresh[i]);
  });

  it("nothing to reuse returns next itself — branch arrays included", () => {
    const previous = { out: line(3) };
    const next = { out: [{ x: 0, y: 7 }, { x: 1, y: 7 }, { x: 2, y: 7 }] };
    expect(reuseUnchanged(previous, next)).toBe(next);
    expect(reuseUnchanged({ out: [] }, next)).toBe(next);
  });

  it("only branches present on both sides are judged", () => {
    const previous: Record<string, BaseDataPoint[]> = { a: line(2) };
    const next: Record<string, BaseDataPoint[]> = { a: line(2), b: line(2) };
    const kept = reuseUnchanged(previous, next);
    expect(kept.a[0]).toBe(previous.a[0]);
    expect(kept.b).toBe(next.b);
  });

  it("a frozen branch comes back frozen — and the frozen input is left alone", () => {
    const previous = { out: line(3) };
    // Frozen is a runtime fact; the declared output type is mutable.
    const next: { out: LineDataPoint[] } = { out: Object.freeze(line(3)) as never };
    const kept = reuseUnchanged(previous, next);
    expect(Object.isFrozen(kept.out)).toBe(true);
    expect(kept.out[0]).toBe(previous.out[0]);
    expect(next.out[0]).not.toBe(previous.out[0]);
  });

  it("a non-record on either side is not judged — next comes back as is", () => {
    const next = { out: line(2) };
    expect(reuseUnchanged(null as never, next)).toBe(next);
    expect(reuseUnchanged("abc" as never, next)).toBe(next);
    expect(reuseUnchanged({ out: line(2) }, null as never)).toBeNull();
    expect(reuseUnchanged({ out: line(2) }, "abc" as never)).toBe("abc");
  });

  it("a hole stays a hole — not judged, not materialized", () => {
    const previous = { out: line(3) };
    const next = { out: line(3) };
    delete next.out[1];
    const kept = reuseUnchanged(previous, next);
    expect(1 in kept.out).toBe(false);
    expect(kept.out[0]).toBe(previous.out[0]);
  });
});

/**
 * What "the same point" means is narrow on purpose: plain objects with
 * the same own enumerable string keys and the same values. That is the
 * whole of what the comparison reads — a point is a plain record, and a
 * difference it does not read (a non-enumerable property, a symbol key)
 * is outside the contract, so two such objects *are* reused as one. The
 * cases below are the shapes the comparison must not mistake for the same.
 */
describe("reuseUnchanged — what it may not reuse", () => {
  class Tracked {
    readonly #value: number;
    constructor(
      public x: number,
      value: number,
    ) {
      this.#value = value;
    }
    get y(): number {
      return this.#value;
    }
  }

  // Any object with an x — the shapes under test are deliberately not one type.
  const pair = <A extends BaseDataPoint, B extends BaseDataPoint>(before: A, after: B) => {
    const previous: BaseDataPoint[] = [before];
    const next: BaseDataPoint[] = [after];
    return reuseUnchanged({ out: previous }, { out: next }).out[0];
  };

  it("a point that gained a key is new", () => {
    const after = { x: 0, y: 5, color: "red" };
    expect(pair({ x: 0, y: 5 }, after)).toBe(after);
  });

  it("a point that lost a key is new — even one that was set to undefined", () => {
    const after = { x: 0, y: 5 };
    expect(pair({ x: 0, y: 5, color: undefined }, after)).toBe(after);
  });

  it("a class instance is never reused — its state may live outside its own keys", () => {
    const after = new Tracked(0, 2);
    expect(pair(new Tracked(0, 1), after)).toBe(after);
    expect(pair(new Tracked(0, 2), after)).toBe(after);
  });

  it("NaN never matches — a point holding one stays new", () => {
    const after = { x: 0, y: Number.NaN };
    expect(pair({ x: 0, y: Number.NaN }, after)).toBe(after);
  });

  it("0 and -0 are different points — a formatter can tell them apart", () => {
    const after = { x: 0, y: -0 };
    expect(pair({ x: 0, y: 0 }, after)).toBe(after);
  });

  it("a non-object entry is not judged — it stays for the consumer's validator to name", () => {
    const previous = { out: [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }] };
    const next = { out: [{ x: 0, y: 1 }, null as never, { x: 2, y: 3 }] };
    const kept = reuseUnchanged(previous, next);
    expect(kept.out[1]).toBeNull();
    expect(kept.out[0]).toBe(previous.out[0]);
    expect(kept.out[2]).toBe(previous.out[2]);
  });
});

function stage(withLane: boolean) {
  const deps = testBrowserDeps();
  const { plot } = mountPlot<OHLC>({ deps, config: { ...defaultConfig, showGrid: false } });
  const price = plot.mainPane.addSeries({ series: candleSeries(), data: candles(10) });
  let runs = 0;
  const calc = (source: DataView<OHLC>) => {
    runs += 1;
    return {
      close: source.map((c) => ({ x: c.x, y: c.close })),
      band: source.map((c) => ({ x: c.x, upper: c.high, lower: c.low })),
    };
  };
  const node = withLane
    ? computation({
        inputs: [price],
        calc,
        calcLast: (previous, [input]) => reuseUnchanged(previous, calc(input)),
      })
    : computation({ inputs: [price], calc });
  const drawn = plot.addPane().addSeries({ series: lineSeries(), input: node.out.close });
  plot.render();
  return { plot, price, node, drawn, runs: () => runs };
}

describe("a node declaring the lane", () => {
  it("recomputes wholesale on a tick, yet keeps every earlier output object on every branch", () => {
    const { plot, price, node, runs } = stage(true);
    const closeBefore = [...node.out.close.read()];
    const bandBefore = [...node.out.band.read()];

    price.updateLast({ x: 10, open: 1, high: 2, low: 0.5, close: 1.5 });
    plot.render();

    expect(runs()).toBe(2);
    const closeAfter = node.out.close.read();
    const bandAfter = node.out.band.read();
    expect(closeAfter).toHaveLength(11);
    for (let i = 0; i < 10; i++) {
      expect(closeAfter[i], `close[${i}]`).toBe(closeBefore[i]);
      expect(bandAfter[i], `band[${i}]`).toBe(bandBefore[i]);
    }
    expect(closeAfter[10]).toEqual({ x: 10, y: 1.5 });
  });

  it("a changed value is a new object — identity never lies about equality", () => {
    const { plot, price, node } = stage(true);
    const before = [...node.out.close.read()];
    price.updateLast({ x: 9, open: 1, high: 2, low: 0.5, close: 999 });
    plot.render();
    const after = node.out.close.read();
    for (let i = 0; i < 9; i++) expect(after[i]).toBe(before[i]);
    expect(after[9]).not.toBe(before[9]);
    expect(after[9]).toEqual({ x: 9, y: 999 });
  });
});

describe("a node without the lane", () => {
  it("keeps every new object — reuse is a call the author makes, not a guess the node takes", () => {
    const { plot, price, node } = stage(false);
    const before = [...node.out.close.read()];
    price.updateLast({ x: 10, open: 1, high: 2, low: 0.5, close: 1.5 });
    plot.render();
    const after = node.out.close.read();
    expect(after).toHaveLength(11);
    for (let i = 0; i < 10; i++) expect(after[i], `close[${i}]`).not.toBe(before[i]);
    expect(after[3]).toEqual(before[3]);
  });
});
