import { describe, expect, it } from "vitest";
import { DataError } from "../../primitives";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel } from "../../plot/model";
import { LineDataAccessor, OHLCAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import { SimpleDecimation } from "../decimation";
import type { LineDataPoint, OHLC } from "../types";
import { validateSeriesData, validateSeriesPoint } from "../validate";

/**
 * Seam-aware validation: the pre-check doors take the x the consumer
 * already holds (`lastX` — the tail, `firstX` — the head) and answer the
 * same question the incremental doors ask on the way in. The seed walks
 * the chunk with the existing tail as "the previous point", so the
 * offending index is a real index in the chunk.
 */

const line = new LineDataAccessor();

describe("validateSeriesData with a seam", () => {
  it("a chunk that starts before the tail is reported at index 0, naming the tail", () => {
    const issues = validateSeriesData([{ x: 4, y: 1 }, { x: 6, y: 1 }], line, { lastX: 5 });
    expect(issues).toHaveLength(1);
    expect(issues?.[0]).toMatchObject({ code: "unsorted-x", index: 0 });
    expect(issues?.[0].message).toContain("existing tail x=5");
  });

  it("a chunk that continues at or after the tail passes (repeated x is legal without uniqueX)", () => {
    expect(validateSeriesData([{ x: 5, y: 1 }, { x: 6, y: 1 }], line, { lastX: 5 })).toBeNull();
    expect(validateSeriesData([{ x: 6, y: 1 }], line, { lastX: 5 })).toBeNull();
  });

  it("a wholly overlapping ascending chunk is one issue — the seed walks on, like append", () => {
    const issues = validateSeriesData(
      [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
      line,
      { lastX: 5 },
    );
    expect(issues?.map((issue) => issue.index)).toEqual([0]);
  });

  it("a chunk that ends after the head is reported at its last index, naming the head", () => {
    const issues = validateSeriesData([{ x: 8, y: 1 }, { x: 11, y: 1 }], line, { firstX: 10 });
    expect(issues).toHaveLength(1);
    expect(issues?.[0]).toMatchObject({ code: "unsorted-x", index: 1 });
    expect(issues?.[0].message).toContain("existing head x=10");
    expect(validateSeriesData([{ x: 8, y: 1 }, { x: 10, y: 1 }], line, { firstX: 10 })).toBeNull();
  });

  it("a broken x skips the seam comparison instead of manufacturing a second issue", () => {
    const issues = validateSeriesData([{ x: Number.NaN, y: 1 }], line, { lastX: 5 });
    expect(issues?.map((issue) => issue.code)).toEqual(["non-finite-x"]);
  });

  it("without a seam nothing changes", () => {
    expect(validateSeriesData([{ x: 1, y: 1 }, { x: 0, y: 1 }], line)?.[0].index).toBe(1);
  });
});

describe("validateSeriesPoint", () => {
  it("answers the tick door: same x replaces, an earlier x is the past", () => {
    expect(validateSeriesPoint({ x: 5, y: 1 }, line, { lastX: 5 })).toBeNull();
    expect(validateSeriesPoint({ x: 6, y: 1 }, line, { lastX: 5 })).toBeNull();
    const issues = validateSeriesPoint({ x: 4, y: 1 }, line, { lastX: 5 });
    expect(issues?.[0]).toMatchObject({ code: "unsorted-x", index: 0 });
    expect(issues?.[0].message).toContain("setData");
  });

  it("runs the same per-point rules as the array door", () => {
    expect(validateSeriesPoint(null as never)?.[0].code).toBe("not-an-object");
    expect(validateSeriesPoint({ x: Number.NaN, y: 1 }, line, { lastX: 1 })?.map((i) => i.code)).toEqual([
      "non-finite-x",
    ]);
    expect(validateSeriesPoint({ x: 1, value: 2 } as never)?.[0].code).toBe("unreadable-y");
    expect(
      validateSeriesPoint({ x: 1, open: 1, high: 1, low: 1, close: "1" } as never, new OHLCAccessor())?.[0]
        .code,
    ).toBe("non-finite-value");
  });

  it("defaults to {x, y} like validateSeriesData", () => {
    expect(validateSeriesPoint({ x: 1, y: 2 })).toBeNull();
  });
});

/**
 * The equivalence that makes the pre-check doors worth having: "validator
 * said null" ⟺ "the ingestion door does not throw". Identity registrations
 * only — a derived series re-checks its own output under its own accessor.
 */
describe("seam equivalence", () => {
  const chunks: { label: string; chunk: LineDataPoint[] }[] = [
    { label: "continues", chunk: [{ x: 6, y: 1 }, { x: 7, y: 1 }] },
    { label: "touches the tail", chunk: [{ x: 5, y: 1 }] },
    { label: "starts before the tail", chunk: [{ x: 4, y: 1 }, { x: 9, y: 1 }] },
    { label: "unsorted inside", chunk: [{ x: 6, y: 1 }, { x: 5.5, y: 1 }] },
    { label: "nan x", chunk: [{ x: Number.NaN, y: 1 }] },
    { label: "bad shape", chunk: [null as never] },
    { label: "gap", chunk: [{ x: 6, y: null }] },
  ];

  function manager() {
    const m = new SimpleDataManager<LineDataPoint>({
      decimation: new SimpleDecimation(),
      coordinates: line,
    });
    m.setData([{ x: 1, y: 1 }, { x: 5, y: 1 }]);
    return m;
  }

  const throwsDataError = (run: () => void): boolean => {
    try {
      run();
      return false;
    } catch (error) {
      if (error instanceof DataError) return true;
      throw error;
    }
  };

  it.each(chunks)("append ⟺ validateSeriesData(chunk, acc, { lastX }) — $label", ({ chunk }) => {
    const said = validateSeriesData(chunk, line, { lastX: 5 }) === null;
    const threw = throwsDataError(() => manager().append(chunk));
    expect(said).toBe(!threw);
  });

  const heads: { label: string; chunk: LineDataPoint[] }[] = [
    { label: "ends before the head", chunk: [{ x: -2, y: 1 }, { x: 0, y: 1 }] },
    { label: "touches the head", chunk: [{ x: 1, y: 1 }] },
    { label: "ends after the head", chunk: [{ x: 0, y: 1 }, { x: 2, y: 1 }] },
    { label: "nan x", chunk: [{ x: Number.NaN, y: 1 }] },
  ];

  it.each(heads)("prepend ⟺ validateSeriesData(chunk, acc, { firstX }) — $label", ({ chunk }) => {
    const said = validateSeriesData(chunk, line, { firstX: 1 }) === null;
    const threw = throwsDataError(() => manager().prepend(chunk));
    expect(said).toBe(!threw);
  });

  const ticks: { label: string; point: unknown }[] = [
    { label: "same bar", point: { x: 5, y: 2 } },
    { label: "new bar", point: { x: 6, y: 2 } },
    { label: "the past", point: { x: 4, y: 2 } },
    { label: "nan x", point: { x: Number.NaN, y: 2 } },
    { label: "no value", point: { x: 5, value: 2 } },
    { label: "not an object", point: 7 },
  ];

  it.each(ticks)("updateLast ⟺ validateSeriesPoint(p, acc, { lastX }) — $label", ({ point }) => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
    });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: [{ x: 1, y: 1 }, { x: 5, y: 1 }] satisfies LineDataPoint[],
    });
    const said = validateSeriesPoint(point as never, line, { lastX: 5 }) === null;
    const threw = throwsDataError(() => handle.updateLast(point as never));
    expect(said).toBe(!threw);
  });

  it("holds for OHLC through the accessor too", () => {
    const acc = new OHLCAccessor();
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
    });
    const bars: OHLC[] = [
      { x: 1, open: 1, high: 2, low: 0.5, close: 1.5 },
      { x: 5, open: 1.5, high: 2.5, low: 1, close: 2 },
    ];
    const handle = model.plot.mainPane.addSeries({ series: candleSeries(), data: bars });
    for (const point of [
      { x: 5, open: 1, high: 2, low: 1, close: 1.5 },
      { x: 5, open: 1, high: 2, low: 1, close: Number.NaN },
      { x: 3, open: 1, high: 2, low: 1, close: 1.5 },
    ]) {
      const said = validateSeriesPoint(point, acc, { lastX: 5 }) === null;
      const threw = throwsDataError(() => handle.updateLast(point));
      expect(said).toBe(!threw);
    }
  });
});
