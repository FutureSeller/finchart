import { describe, expect, it } from "vitest";
import { computation } from "../computation";
import { validateSeriesData, validateSeriesPoint } from "../validate";
import { SimpleDataManager } from "../data-manager";
import { LttbDecimation, SimpleDecimation } from "../decimation";
import { OhlcAggregation } from "../aggregation";
import { DataError } from "../../primitives";

it("propagates an upstream corrected prefix through the declared lookback", () => {
  let values = [2, 3, 4, 5, 6].map(x => ({ x, y: x }));
  const calc = (data: readonly Readonly<{ x: number; y: number }>[]) => ({
    line: data.map((p, i) => ({ x: p.x, y: i === 0 ? null : data[i - 1].y + p.y })),
  });
  const node = computation({ inputs: [{ read: () => values }], calc, headLookback: 1 });
  const before = node.out.line.read();
  values = [{ x: 1, y: 1 }, { x: 2, y: 20 }, { x: 3, y: 30 }, ...values.slice(2)];
  const after = node.out.line.read();
  expect(after).toEqual(calc(values).line);
  expect(after[4]).toBe(before[3]);
  values = [...values, { x: 7, y: 7 }];
  expect(node.out.line.read()).toEqual(calc(values).line);
});

describe("custom accessor finite-or-gap fallback", () => {
  const coordinates = { getX: (p: { x: number; v: number | null }) => p.x, getY: (p: { x: number; v: number | null }) => p.v };
  it.each([NaN, Infinity, -Infinity])("rejects %s in both diagnostics and ingestion", v => {
    const data = [{ x: 0, v: 1 }, { x: 1, v }, { x: 2, v: 2 }];
    expect(validateSeriesData(data, coordinates)).toEqual([expect.objectContaining({ code: "non-finite-value", index: 1 })]);
    expect(validateSeriesPoint(data[1], coordinates)?.[0].code).toBe("non-finite-value");
    const manager = new SimpleDataManager({ coordinates, decimation: new SimpleDecimation(coordinates) });
    manager.setData([{ x: 0, v: 1 }]);
    expect(() => manager.append(data.slice(1))).toThrow(DataError);
    expect(manager.read()).toEqual([{ x: 0, v: 1 }]);
    expect(() => manager.setData(data)).toThrow(DataError);
  });
  it("retains null gaps", () => {
    expect(validateSeriesData([{ x: 0, v: null }], coordinates)).toBeNull();
  });
});

it("LTTB retains the same shape under finite large and small coordinate scalings", () => {
  const values = [46, 14, 50, 33, 66, 21, 49, 25, 7, 36, 86, 17, 9, 16, 8, 44, 82, 96, 85, 31];
  const decimator = new LttbDecimation<{ x: number; y: number; id: number }>();
  for (const [sx, sy] of [[1, 1], [1e306, 1e300], [1e-300, 1e-300]]) {
    const data = values.map((y, id) => ({ x: id * sx, y: y * sy, id }));
    const snapshot = data.map(p => ({ ...p }));
    expect(decimator.decimate(data, { start: 0, end: data.length }, 5).map(p => p.id)).toEqual([0, 1, 10, 14, 19]);
    expect(data).toEqual(snapshot);
  }
});

it("OHLC aggregation refuses overflowing volume without altering its input", () => {
  const data = [0, 1].map(x => Object.freeze({ x, open: 1, high: 2, low: 0, close: 1, volume: Number.MAX_VALUE }));
  expect(() => new OhlcAggregation().decimate(data, { start: 0, end: 2 }, 1)).toThrow(DataError);
  expect(data.map(p => p.volume)).toEqual([Number.MAX_VALUE, Number.MAX_VALUE]);
  const finite = data.map(p => ({ ...p, volume: Number.MAX_VALUE / 4 }));
  expect(new OhlcAggregation().decimate(finite, { start: 0, end: 2 }, 1)[0].volume).toBe(Number.MAX_VALUE / 2);
});

it("LTTB preserves small price differences around a large common offset", () => {
  const offsets = [96, 134, 76, 130, 64, 94, 172, 42, 16, 70, 124, 2, 160, 190, 172, 58, 32, 190, 132, 18];
  const decimator = new LttbDecimation<{ x: number; y: number }>();
  // Exact integer-area oracle, including each bucket's rational centroid.
  for (const offset of [0, 1e16]) {
    const data = offsets.map((y, x) => ({ x, y: y + offset }));
    expect(decimator.decimate(data, { start: 0, end: data.length }, 5).map(p => p.x)).toEqual([0, 6, 11, 13, 19]);
  }
});
