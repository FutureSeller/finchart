import { describe, expect, it } from "vitest";
import { DataError } from "../../primitives";
import { M4Decimation, OHLCAccessor, SimpleDataManager, defaultCoordinates } from "..";
import type { CoordinateAccessor, LineDataPoint } from "../types";
import { validateSeriesData, validateSeriesPoint } from "../validate";
import { SimpleDecimation } from "../decimation";

/**
 * The quality contract of this API: `null` means exactly "setData will not
 * throw a DataError". If the validator and the manager ever grow separate
 * rule sets, this equivalence is where the drift turns red.
 */
function agreesWithSetData<T extends { x: number }>(
  data: T[],
  coordinates: CoordinateAccessor<T>,
): void {
  const issues = validateSeriesData(data, coordinates);
  const manager = new SimpleDataManager<T>({
    coordinates,
    decimation: new M4Decimation(coordinates),
  });

  let threw: unknown = null;
  try {
    manager.setData(data);
  } catch (error) {
    threw = error;
  }

  if (issues === null) {
    expect(threw).toBeNull();
  } else {
    expect(threw).toBeInstanceOf(DataError);
  }
}

const line = defaultCoordinates<LineDataPoint>();

describe("equivalence with setData", () => {
  const fixtures: Array<[string, LineDataPoint[]]> = [
    ["clean data", [{ x: 0, y: 1 }, { x: 1, y: 2 }]],
    ["empty array", []],
    ["a single point", [{ x: 0, y: 1 }]],
    ["gaps are legal", [{ x: 0, y: 1 }, { x: 1, y: null }, { x: 2, y: 3 }]],
    ["equal x in a row is legal", [{ x: 1, y: 1 }, { x: 1, y: 2 }]],
    ["unsorted x", [{ x: 5, y: 1 }, { x: 3, y: 2 }]],
    ["NaN x", [{ x: Number.NaN, y: 1 }]],
    ["Infinity x", [{ x: 0, y: 1 }, { x: Number.POSITIVE_INFINITY, y: 2 }]],
    ["NaN y", [{ x: 0, y: Number.NaN }]],
    ["a null element", [{ x: 0, y: 1 }, null as never]],
    [
      "a wrongly mapped field ({x, value})",
      [{ x: 0, value: 1 } as never],
    ],
  ];

  it.each(fixtures)("should agree on %s", (_label, data) => {
    agreesWithSetData(data, line);
  });

  it("should agree on OHLC data with a NaN field", () => {
    const ohlc = new OHLCAccessor();
    agreesWithSetData(
      [{ x: 0, open: 1, high: Number.NaN, low: 0, close: 1 }],
      ohlc,
    );
  });
});

describe("issues", () => {
  it("should return null for clean data", () => {
    expect(
      validateSeriesData([
        { x: 0, y: 1 },
        { x: 1, y: null },
        { x: 2, y: 3 },
      ]),
    ).toBeNull();
  });

  it("should accept repeated x in a row on line data (no uniqueX)", () => {
    expect(
      validateSeriesData([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ]),
    ).toBeNull();
  });

  it("should name the code and the index", () => {
    const issues = validateSeriesData([
      { x: 0, y: 1 },
      { x: Number.NaN, y: 2 },
    ]);

    expect(issues).toEqual([
      expect.objectContaining({ code: "non-finite-x", index: 1 }),
    ]);
  });

  it("should collect every violation, ascending by index", () => {
    const issues = validateSeriesData([
      { x: 5, y: 1 },
      { x: 3, y: 2 },
      { x: 4, y: Number.NaN },
    ]);

    expect(issues?.map((issue) => [issue.code, issue.index])).toEqual([
      ["unsorted-x", 1],
      ["non-finite-value", 2],
    ]);
  });

  it("should skip the checks that cannot read a broken point", () => {
    const issues = validateSeriesData([
      { x: 0, y: 1 },
      "not a point" as never,
      { x: 2, y: 3 },
    ]);

    // One issue for the broken shape — no phantom non-finite-x/unsorted-x
    // from trying to read x off a string.
    expect(issues?.map((issue) => [issue.code, issue.index])).toEqual([
      ["not-an-object", 1],
    ]);
  });

  it("should report a payload that is not an array instead of throwing", () => {
    const issues = validateSeriesData(null as never);

    expect(issues).toEqual([
      expect.objectContaining({ code: "not-an-array", index: -1 }),
    ]);
  });

  it("should guide a wrongly mapped field through unreadable-y", () => {
    const issues = validateSeriesData([
      { x: 0, value: 1 } as never,
    ]);

    expect(issues?.[0]?.code).toBe("unreadable-y");
    expect(issues?.[0]?.message).toContain("coordinates accessor");
  });

  /**
   * A point without a value in the middle is whitespace, but a mis-mapped
   * field leaves every point without one — the last point is read too, so
   * the mistake shows even when the first point happens to carry a value.
   */
  it("should flag a last point the accessor reads no value from", () => {
    interface Reading {
      x: number;
      value?: number;
    }
    const byValue: CoordinateAccessor<Reading> = {
      getX: (point) => point.x,
      getY: (point) => point.value,
    };

    const issues = validateSeriesData<Reading>([{ x: 0, value: 1 }, { x: 1, value: 2 }, { x: 2 }], byValue);

    expect(issues?.map((issue) => [issue.code, issue.index])).toEqual([["unreadable-y", 2]]);
  });

  it("should check OHLC fields through the given accessor", () => {
    const issues = validateSeriesData(
      [{ x: 0, open: 1, high: Number.NaN, low: 0, close: 1 }],
      new OHLCAccessor(),
    );

    expect(issues?.map((issue) => [issue.code, issue.index])).toEqual([
      ["non-finite-value", 0],
    ]);
  });

  it("should carry a human message on every issue", () => {
    const issues = validateSeriesData([{ x: Number.NaN, y: 1 }]);

    expect(issues?.[0]?.message).toMatch(/finite/);
  });
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
