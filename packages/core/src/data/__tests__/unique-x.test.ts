import { describe, expect, it } from "vitest";
import { DataError } from "../../primitives";
import { LineDataAccessor, OHLCAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import { SimpleDecimation } from "../decimation";
import type { CoordinateAccessor, LineDataPoint, OHLC } from "../types";
import { validateSeriesData, validateSeriesPoint } from "../validate";

/**
 * One bar per x — an accessor's declaration (`uniqueX`), the way `gapless`
 * already declares "never a gap". A repeated x is legal for line data
 * (two points at one moment) and stays so; for bars it is the reconnect
 * gap-fill that drew the same candle twice, reported as `duplicate-x` —
 * a different fix (dedupe) than `unsorted-x` (sort).
 */

const ohlc = new OHLCAccessor();
const line = new LineDataAccessor();

const bar = (x: number): OHLC => ({ x, open: 1, high: 2, low: 0.5, close: 1.5 });

function bars(...xs: number[]): OHLC[] {
  return xs.map(bar);
}

function candles(verifyAdoptions?: boolean) {
  const m = new SimpleDataManager<OHLC>({
    decimation: new SimpleDecimation(),
    coordinates: ohlc,
    ...(verifyAdoptions === undefined ? {} : { verifyAdoptions }),
  });
  m.setData(bars(1, 2, 3));
  return m;
}

describe("the accessor declares it", () => {
  it("OHLC declares one bar per x; line data does not", () => {
    expect(ohlc.uniqueX).toBe(true);
    const asAccessor: CoordinateAccessor<LineDataPoint> = line;
    expect(asAccessor.uniqueX).toBeUndefined();
  });
});

describe("validateSeriesData", () => {
  it("reports a repeated x on bars as duplicate-x at the later index", () => {
    const issues = validateSeriesData(bars(1, 2, 2, 3), ohlc);
    expect(issues).toHaveLength(1);
    expect(issues?.[0]).toMatchObject({ code: "duplicate-x", index: 2 });
    expect(issues?.[0].message).toContain("one point per x");
  });

  it("keeps a repeated x legal for line data", () => {
    const points: LineDataPoint[] = [{ x: 1, y: 1 }, { x: 1, y: 2 }];
    expect(validateSeriesData(points, line)).toBeNull();
    expect(validateSeriesData(points)).toBeNull();
  });

  it("a chunk that starts on the tail is duplicate-x at index 0 for bars, fine for lines", () => {
    const issues = validateSeriesData(bars(3, 4), ohlc, { lastX: 3 });
    expect(issues?.[0]).toMatchObject({ code: "duplicate-x", index: 0 });
    expect(issues?.[0].message).toContain("existing tail x=3");
    expect(validateSeriesData([{ x: 3, y: 1 }, { x: 4, y: 1 }], line, { lastX: 3 })).toBeNull();
  });

  it("a chunk that ends on the head is duplicate-x at its last index for bars", () => {
    const issues = validateSeriesData(bars(0, 1), ohlc, { firstX: 1 });
    expect(issues?.[0]).toMatchObject({ code: "duplicate-x", index: 1 });
    expect(issues?.[0].message).toContain("existing head x=1");
  });
});

describe("validateSeriesPoint", () => {
  it("the same x is the bar being replaced — never a duplicate", () => {
    expect(validateSeriesPoint(bar(3), ohlc, { lastX: 3 })).toBeNull();
    expect(validateSeriesPoint(bar(2), ohlc, { lastX: 3 })?.[0].code).toBe("unsorted-x");
  });
});

describe("ingestion agrees — every seam, both adoption modes", () => {
  it("setData rejects a repeated x on bars", () => {
    expect(() => candles().setData(bars(1, 1))).toThrow(/one point per x/);
  });

  it("append and prepend reject a chunk touching the seam on bars, accept it on lines", () => {
    expect(() => candles().append(bars(3, 4))).toThrow(DataError);
    expect(() => candles().prepend(bars(0, 1))).toThrow(DataError);
    const m = new SimpleDataManager<LineDataPoint>({
      decimation: new SimpleDecimation(),
      coordinates: line,
    });
    m.setData([{ x: 1, y: 1 }, { x: 3, y: 1 }]);
    expect(() => m.append([{ x: 3, y: 2 }])).not.toThrow();
    expect(() => m.prepend([{ x: 1, y: 0 }])).not.toThrow();
  });

  it.each([false, true])("adoptHeadRetainingTail rejects an equal-x seam (verifyAdoptions=%s)", (verify) => {
    const m = candles(verify);
    expect(() => m.adoptHeadRetainingTail(bars(0, 2), 1)).toThrow(DataError);
    expect(() => candles(verify).adoptHeadRetainingTail(bars(0, 1), 1)).not.toThrow();
  });

  it("replaceLast replaces the last bar, but can't land on the one before it", () => {
    const m = candles();
    expect(() => m.replaceLast(bar(3))).not.toThrow();
    expect(() => m.replaceLast(bar(2))).toThrow(/one point per x/);
  });

  it.each([
    ["repeated inside", bars(4, 4)],
    ["touches the tail", bars(3, 4)],
    ["continues", bars(4, 5)],
  ])("validateSeriesData(chunk, ohlc, { lastX }) ⟺ append — %s", (_label, chunk) => {
    const said = validateSeriesData(chunk, ohlc, { lastX: 3 }) === null;
    let threw = false;
    try {
      candles().append(chunk);
    } catch (error) {
      if (!(error instanceof DataError)) throw error;
      threw = true;
    }
    expect(said).toBe(!threw);
  });
});
