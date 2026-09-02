import { describe, expect, it } from "vitest";
import { ContractError } from "@finchart/core";
import {
  FIB_LEVELS,
  fibLevels,
  parseDrawings,
  serializeDrawings,
  type Drawing,
  type FibRetracement,
} from "../drawings";
import { gripAt } from "../hit";
import { drawOne } from "../render";
import type { DrawingSpace } from "../space";

/**
 * Commit 2 of the schema-v2 day: per-drawing `style` (the same
 * `Partial<LineStyle>` leaves the toolbox override uses) and the fib
 * `levels` field, with one interpreter shared by hit and render.
 */

const fib = (levels?: number[]): FibRetracement => ({
  type: "fib",
  id: "f1",
  a: { x: 0, price: 0 },
  b: { x: 100, price: 100 },
  ...(levels ? { levels } : {}),
});

describe("per-drawing style round trip", () => {
  it("keeps all three leaves through save and load", () => {
    const styled: Drawing[] = [
      {
        type: "horizontal",
        id: "h1",
        price: 100,
        style: { color: "#f00", width: 3, dashArray: "4,4" },
      },
    ];
    expect(parseDrawings(serializeDrawings(styled))).toEqual(styled);
  });

  it("normalizes an empty style to absent — {} and nothing save identically", () => {
    const back = parseDrawings(
      '{"version":2,"drawings":[{"type":"horizontal","id":"h1","price":1,"style":{}}]}',
    );
    expect(back).toEqual([{ type: "horizontal", id: "h1", price: 1 }]);
  });

  it("strips undefined leaves so a later spread can't erase the toolbox value", () => {
    const back = parseDrawings(
      serializeDrawings([
        {
          type: "horizontal",
          id: "h1",
          price: 1,
          style: { color: "#0f0", width: undefined },
        },
      ]),
    );
    expect(back).toEqual([
      { type: "horizontal", id: "h1", price: 1, style: { color: "#0f0" } },
    ]);
  });

  it.each([
    ["zero width", { width: 0 }],
    ["negative width", { width: -1 }],
    ["NaN width", { width: Number.NaN }],
    ["empty color", { color: "" }],
    ["non-string color", { color: 7 }],
    ["oversized color", { color: "x".repeat(65) }],
    ["non-string dash", { dashArray: [4, 4] }],
    ["oversized dash", { dashArray: "4,".repeat(40) }],
  ])("rejects %s at the door and at the parser alike", (_label, style) => {
    const drawing = { type: "horizontal", id: "h1", price: 1, style };
    expect(() => serializeDrawings([drawing as never])).toThrow(ContractError);
    expect(
      parseDrawings(JSON.stringify({ version: 2, drawings: [drawing] })),
    ).toBeNull();
  });
});

describe("fib levels", () => {
  it("round-trips sorted and deduped, never clamped", () => {
    const back = parseDrawings(
      serializeDrawings([fib([1, 0.5, 0.5, -0.236, 1.618])]),
    );
    expect(back).toEqual([fib([-0.236, 0.5, 1, 1.618])]);
  });

  it.each([
    ["an empty list", []],
    ["a non-finite level", [0.5, Number.NaN]],
    ["a non-array", "0.5"],
  ])("rejects %s", (_label, levels) => {
    const drawing = { ...fib(), levels };
    expect(() => serializeDrawings([drawing as never])).toThrow(ContractError);
    expect(
      parseDrawings(JSON.stringify({ version: 2, drawings: [drawing] })),
    ).toBeNull();
  });

  it("interprets absent as the conventional seven", () => {
    expect(fibLevels(fib())).toEqual(FIB_LEVELS);
    expect(fibLevels(fib([0.9]))).toEqual([0.9]);
  });
});

/**
 * Hit and render read the same interpreter — the property `fibLevelPrice`
 * already pins for the price formula, extended to the level list. A
 * custom-level retracement must be grabbable exactly on its own lines.
 */
describe("one interpreter for hit and render", () => {
  const space: DrawingSpace = {
    area: { left: 0, right: 100, top: 0, bottom: 100 },
    xAt: (pixel) => pixel,
    pixelAtX: (x) => x,
    valueAt: (pixel) => pixel,
    pixelAtValue: (price) => price,
  };

  it("renders exactly the drawing's own levels", () => {
    const lines: number[] = [];
    const target = {
      drawLine: (points: { y: number }[]) => {
        lines.push(points[0].y);
      },
      drawShape: () => undefined,
      drawText: () => undefined,
      drawCustom: () => undefined,
    };
    drawOne(
      target as never,
      space,
      { readStyle: () => "", formatValue: String, barIndexAt: (x) => x },
      fib([0, 1]),
      { width: 1, color: "#000" },
      false,
    );
    // Two levels → two level lines (plus nothing else for a fib).
    expect(lines).toHaveLength(2);
  });

  it("grabs on a custom level line and not on a dropped default", () => {
    const custom = fib([0.9]);
    // level 0.9 → price 90 in this identity space (a=0 → level 0 at b? —
    // the formula reads from b toward a, so assert through the hit
    // itself rather than re-deriving the price here).
    const onCustom = gripAt([custom], space, { x: 50, y: 10 });
    const onDroppedDefault = gripAt([custom], space, { x: 50, y: 50 });
    expect(onCustom).not.toBeNull();
    expect(onDroppedDefault).toBeNull();
  });
});
