import type { DataView, OHLC } from "@finchart/core";
import { candleSeries, createPlotModel, DataError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { heikinAshi, heikinAshiLast } from "../heikin-ashi";

function candle(
  x: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume?: number,
): OHLC {
  return { x, open, high, low, close, volume };
}

describe("heikinAshi", () => {
  it("should seed the first bar's open from the raw open/close average", () => {
    const [first] = heikinAshi([candle(0, 10, 12, 8, 11)]);
    // open = (10+11)/2 = 10.5, close = (10+12+8+11)/4 = 10.25
    expect(first.open).toBeCloseTo(10.5);
    expect(first.close).toBeCloseTo(10.25);
  });

  it("should carry the previous HA open/close into the next open (stateful)", () => {
    const out = heikinAshi([
      candle(0, 10, 12, 8, 11), // HA: open 10.5, close 10.25
      candle(1, 11, 14, 10, 13), // next open = (10.5+10.25)/2 = 10.375
    ]);

    expect(out[1].open).toBeCloseTo(10.375);
    // close = (11+14+10+13)/4 = 12
    expect(out[1].close).toBeCloseTo(12);
  });

  it("should widen high/low to cover both the raw range and the HA body", () => {
    // HA open/close land inside the raw range here — high/low stay raw.
    const [bar] = heikinAshi([candle(0, 10, 20, 5, 12)]);
    expect(bar.high).toBe(20);
    expect(bar.low).toBe(5);
  });

  it("should widen the range to an HA body that gaps outside the raw candle", () => {
    // Bar 1 gaps far above bar 0: its HA open is the midpoint of bar 0's HA body,
    // well below its raw low — so the HA low must be that open, not the raw low.
    const out = heikinAshi([candle(0, 10, 12, 8, 11), candle(1, 50, 52, 49, 51)]);
    // bar 0: HA open 10.5, HA close 10.25 → bar 1 HA open = 10.375
    expect(out[1].open).toBeCloseTo(10.375);
    expect(out[1].low).toBeCloseTo(10.375);
    expect(out[1].high).toBe(52);
    // and a gap down: HA open above the raw high → HA high is the open.
    const down = heikinAshi([candle(0, 50, 52, 48, 51), candle(1, 10, 12, 8, 11)]);
    // bar 0: HA open 50.5, HA close 50.25 → bar 1 HA open = 50.375, above the raw high of 12
    expect(down[1].open).toBeCloseTo(50.375);
    expect(down[1].high).toBeCloseTo(50.375);
    expect(down[1].low).toBe(8);
  });

  it("should inherit x and volume unchanged", () => {
    const out = heikinAshi([candle(5, 10, 12, 8, 11, 999)]);
    expect(out[0].x).toBe(5);
    expect(out[0].volume).toBe(999);
  });

  it("should not require a lookahead — output length matches input", () => {
    const source = Array.from({ length: 10 }, (_, i) =>
      candle(i, 100 + i, 105 + i, 95 + i, 102 + i),
    );
    expect(heikinAshi(source)).toHaveLength(10);
  });

  it("should handle an empty source", () => {
    expect(heikinAshi([])).toEqual([]);
  });
});

/** A tape whose bars are not all alike — so a wrong seed or a wrong slice shows. */
function tape(from: number, count: number): OHLC[] {
  return Array.from({ length: count }, (_, i) => {
    const x = from + i;
    const close = 100 + Math.sin(x / 3) * 10 + (x % 4);
    return candle(x, close - 1.5, close + 2, close - 2.5, close, 10 + (x % 7));
  });
}

describe("heikinAshiLast — the tail of heikinAshi, for deriveLast", () => {
  it("should return exactly the changed tail: count for an append, one for a replace", () => {
    const source = tape(0, 40);
    const previous = heikinAshi(source.slice(0, 35));
    expect(heikinAshiLast(previous, source, { kind: "append", count: 5 })).toHaveLength(5);
    const replaced = source.slice(0, 35);
    replaced[34] = candle(34, 1, 2, 0, 1.5);
    expect(heikinAshiLast(previous, replaced, { kind: "replace", count: 1 })).toHaveLength(1);
  });

  it("should agree with the full derivation, appended from the last HA bar", () => {
    const source = tape(0, 40);
    const previous = heikinAshi(source.slice(0, 35));
    const tail = heikinAshiLast(previous, source, { kind: "append", count: 5 });
    expect([...previous, ...tail]).toEqual(heikinAshi(source));
  });

  it("should agree with the full derivation, replaced from the HA bar before the last", () => {
    const source = tape(0, 40);
    const previous = heikinAshi(source);
    const replaced = [...source];
    replaced[39] = candle(39, 50, 60, 40, 55);
    const [last] = heikinAshiLast(previous, replaced, { kind: "replace", count: 1 });
    expect([...previous.slice(0, 39), last]).toEqual(heikinAshi(replaced));
  });

  it("should fall back to the first-bar seed when the replace reaches index 0", () => {
    const only = [candle(0, 10, 12, 8, 11)];
    const previous = heikinAshi(only);
    const replaced = [candle(0, 20, 24, 16, 22)];
    expect(heikinAshiLast(previous, replaced, { kind: "replace", count: 1 })).toEqual(heikinAshi(replaced));
  });

  it("should take the tail door on a tick when registered as deriveLast — no full re-derive, prefix kept", () => {
    const source = tape(0, 60);
    const counts = { full: 0 };
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: candleSeries(), data: source },
    });
    const handle = model.plot.mainPane.addSeries({
      series: candleSeries(),
      data: source,
      derive: (view: DataView<OHLC>) => {
        counts.full += 1;
        return heikinAshi(view);
      },
      deriveLast: heikinAshiLast,
    });
    model.plot.render();
    const before = handle.read();
    counts.full = 0;

    handle.append(tape(60, 3));
    handle.updateLast(candle(62, 90, 95, 85, 92));
    model.plot.render();

    expect(counts.full).toBe(0);
    const after = handle.read();
    const expected = heikinAshi([...source, ...tape(60, 2), candle(62, 90, 95, 85, 92)]);
    expect(after).toEqual(expected);
    // The prefix is the manager's — the same objects as before the tick.
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
  });

  it("should be refused by the door when it returns the wrong length — the contract is the count", () => {
    const source = tape(0, 10);
    const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series: candleSeries(), data: source } });
    const handle = model.plot.mainPane.addSeries({
      series: candleSeries(),
      data: source,
      derive: (view: DataView<OHLC>) => heikinAshi(view),
      deriveLast: (previous, view, change) => heikinAshiLast(previous, view, { ...change, count: change.count + 1 }),
    });
    expect(() => handle.append(tape(10, 1))).toThrow(DataError);
  });
});
