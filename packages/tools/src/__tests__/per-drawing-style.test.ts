import { describe, expect, it } from "vitest";
import type { DrawTarget } from "@finchart/core";
import { ContractError, createPlotModel, lineSeries } from "@finchart/core";
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
import { drawingTools } from "../tools";

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
 * The drawing's own style is the last layer: on top of the toolbox's
 * style, leaf by leaf. Drawn through a real pane, since the layering
 * happens where the toolbox draws, not in `drawOne`.
 */
describe("a drawing's own style over the toolbox's", () => {
  it("wins on the leaves it sets and inherits the rest", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: lineSeries(),
        data: [
          { x: 0, y: 10 },
          { x: 10, y: 20 },
        ],
      },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    const tools = model.plot.mainPane.use(
      drawingTools({ plot: model.plot, style: { color: "#00ff00", width: 3 } }),
    );
    tools.add({ type: "horizontal", price: 12 });
    tools.add({ type: "horizontal", price: 18, style: { color: "#ff0000" } });

    const styles = model
      .commands()
      .flatMap((command) =>
        command.type === "drawLine" && command.points[0].y === command.points[1].y
          ? [{ y: command.points[0].y, color: command.style.color, width: command.style.width }]
          : [],
      );
    const at = (price: number) => model.plot.mainPane.yScale.scale(price);
    expect(styles).toContainEqual({ y: at(12), color: "#00ff00", width: 3 });
    expect(styles).toContainEqual({ y: at(18), color: "#ff0000", width: 3 });
    model.plot.destroy();
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
    const target: DrawTarget = {
      drawLine: (points) => {
        lines.push(points[0].y);
      },
      drawShape: () => undefined,
      drawText: () => undefined,
      drawCustom: () => undefined,
    };
    drawOne(
      target,
      space,
      { readStyle: () => "", formatValue: String, barIndexAt: (x) => x },
      fib([0.25, 1]),
      { width: 1, color: "#000" },
      false,
    );
    // Lopsided levels so a mirrored or reversed formula shows: in this
    // identity space a level sits at b + (a − b)·level, so 0.25 → 75 and
    // 1 → 0 (and nothing else for a fib).
    expect(lines).toEqual([75, 0]);
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
