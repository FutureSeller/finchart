/**
 * deriveLast's tail-increment door. Three things to guarantee: with the
 * door present, a full re-derive never runs; going through the door still
 * matches what a full re-derive would produce; and breaking the length
 * contract stops with the door named as the culprit.
 */
import { describe, expect, it } from "vitest";
import type { DataView, LineDataPoint, OHLC } from "../../data";
import { DataError } from "../../primitives";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel } from "../model";

const candles: OHLC[] = Array.from({ length: 30 }, (_, i) => ({
  x: i,
  open: 100 + i,
  high: 104 + i,
  low: 98 + i,
  close: 102 + (i % 5),
}));

/** Double the last close — the simplest derivation, where the tail is 1:1 with the source tail. */
const doubled = (source: DataView<OHLC>): LineDataPoint[] =>
  source.map((c) => ({ x: c.x, y: c.close * 2 }));

function mounted(withDoor: boolean, counts: { full: number; tail: number }) {
  const model = createPlotModel({
    size: { width: 400, height: 300 },
    series: { series: candleSeries(), data: candles },
    config: { showGrid: false },
  });

  const handle = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data: candles,
    derive: (source: DataView<OHLC>) => {
      counts.full += 1;
      return doubled(source);
    },
    deriveLast: withDoor
      ? (_previous, source, change) => {
          counts.tail += 1;
          const from = source.length - (change.kind === "replace" ? 1 : change.count);
          return doubled(source.slice(from));
        }
      : undefined,
  });
  model.plot.render();
  return { model, handle };
}

describe("deriveLast — tail-increment door", () => {
  it("runs zero full re-derives on a replace tick", () => {
    const counts = { full: 0, tail: 0 };
    const { model, handle } = mounted(true, counts);
    counts.full = 0;

    handle.updateLast({ ...candles[29], close: 999 });
    model.plot.render();

    expect(counts.full).toBe(0);
    expect(counts.tail).toBe(1);
  });

  it("matches a full re-derive even through the door", () => {
    const withDoor = { full: 0, tail: 0 };
    const without = { full: 0, tail: 0 };
    const a = mounted(true, withDoor);
    const b = mounted(false, without);

    const ticks: OHLC[] = [
      { ...candles[29], close: 150 },
      { ...candles[29], close: 90 },
      { ...candles[29], x: 30, close: 110 }, // new bar
      { ...candles[29], x: 30, close: 120 }, // a tick on that bar
    ];
    for (const tick of ticks) {
      a.handle.updateLast(tick);
      b.handle.updateLast(tick);
    }
    a.model.plot.render();
    b.model.plot.render();

    expect(a.handle.read()).toEqual(b.handle.read());
    expect(without.full).toBeGreaterThan(withDoor.full);
  });

  it("routes an append batch through the door too, with the same result", () => {
    const withDoor = { full: 0, tail: 0 };
    const without = { full: 0, tail: 0 };
    const a = mounted(true, withDoor);
    const b = mounted(false, without);
    withDoor.full = 0;

    const chunk: OHLC[] = [30, 31, 32].map((x) => ({ ...candles[0], x, close: 200 + x }));
    a.handle.append(chunk);
    b.handle.append(chunk);

    expect(a.handle.read()).toEqual(b.handle.read());
    expect(withDoor.full).toBe(0);
    expect(withDoor.tail).toBe(1);
  });

  /** Length is the contract — the worst outcome is a silently mismatched tail getting drawn. */
  it("stops with DataError on a length violation, leaving nothing behind", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: candleSeries(), data: candles },
      config: { showGrid: false },
    });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: candles,
      derive: doubled,
      // Contract violation — a replace must be exactly 1. The point is that
      // **both are valid points**: an empty array is already caught by the
      // manager's shape check regardless, but a valid excess point gets
      // **silently dropped** without a length check — that's the mutation
      // this leaked through.
      deriveLast: () => [
        { x: 29, y: 1 },
        { x: 29, y: 2 },
      ],
    });
    model.plot.render();
    const before = handle.read();

    expect(() => handle.updateLast({ ...candles[29], close: 999 })).toThrow(
      DataError,
    );
    // A rejection leaves nothing behind.
    expect(handle.read()).toEqual(before);
  });

  /** A tail produced by the door still has to pass through the manager's own door (finiteness). */
  it("rejects a bad value from the door too, leaving nothing behind", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: candleSeries(), data: candles },
      config: { showGrid: false },
    });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: candles,
      derive: doubled,
      deriveLast: (_previous, source) => [
        { x: source[source.length - 1].x, y: Number.NaN },
      ],
    });
    model.plot.render();
    const before = handle.read();

    expect(() => handle.updateLast({ ...candles[29], close: 999 })).toThrow(
      DataError,
    );
    expect(handle.read()).toEqual(before);
  });
});

describe("a derivation written as methods", () => {
  it("is called on the registration, so `this` works in derive and deriveLast", () => {
    const model = createPlotModel({ size: { width: 400, height: 300 }, config: { showGrid: false } });
    const registration = {
      series: lineSeries(),
      data: candles,
      factor: 2,
      derive(source: DataView<OHLC>): LineDataPoint[] {
        return source.map((c) => ({ x: c.x, y: c.close * this.factor }));
      },
      deriveLast(_previous: DataView<LineDataPoint>, source: DataView<OHLC>): LineDataPoint[] {
        const last = source[source.length - 1];
        return [{ x: last.x, y: last.close * this.factor }];
      },
    };

    const handle = model.plot.mainPane.addSeries(registration);
    handle.updateLast({ ...candles[29], close: 500 });

    expect(handle.read().at(-1)).toEqual({ x: 29, y: 1000 });
  });
});
