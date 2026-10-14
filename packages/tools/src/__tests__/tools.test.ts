import { space } from "./drawing-stage.fixture";
import type { DrawTarget } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import { drawOne } from "../render";
import { drawingTools } from "../tools";
import type { DrawingPane, DrawingStage } from '../tools';
import { drawingChart } from "./drawing-chart.fixture";

const lines = (model: ReturnType<typeof drawingChart>["model"]) =>
  model.commands().filter((c) => c.type === "drawLine");

describe("drawingTools drawing", () => {
  it("should emit an off-range horizontal line and leave clipping to the core", () => {
    const { model, tools } = drawingChart();
    const before = lines(model).length;

    tools.add({ type: "horizontal", price: 10_000 });

    // The tool doesn't clip -- "whoever allocated the area does the
    // clipping" (the plot's clip). Hand-clipping only horizontal
    // lines would split the rule away from trend and fib.
    const commands = model.commands();
    const drawn = lines(model);
    expect(drawn).toHaveLength(before + 1);

    // That line is drawn inside the pane area's clip -- leaking is the
    // core's job to prevent.
    const index = commands.indexOf(drawn.at(-1)!);
    const lastClip = commands
      .slice(0, index)
      .findLast((command) => command.type === "clip");
    expect(lastClip?.type === "clip" ? lastClip.area : null).not.toBeNull();
  });

  it("should show grab handles only while the trend line is selected", () => {
    const { model, tools, click } = drawingChart();

    tools.add({
      type: "trend",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
    });

    const handles = () =>
      model
        .commands()
        .filter(
          (c) =>
            c.type === "drawShape" &&
            c.shape.shape === "circle" &&
            c.shape.r === 4,
        );

    // No handles before selection -- showing them all the time clutters
    // the screen.
    expect(handles()).toHaveLength(0);

    // Grab endpoint a to select it — half a bar inside the left edge.
    click({ x: 0, price: 100 });

    expect(handles()).toHaveLength(2);
  });

  /**
   * Where each handle sits, per kind — on the anchors it moves, or at the
   * middle of the pane for a line with no endpoints. Drawn in the identity
   * space so a handle's centre reads as its anchor.
   */
  it.each<[string, Drawing, { x: number; y: number }[]]>([
    ["horizontal", { type: "horizontal", id: "d", price: 30 }, [{ x: 50, y: 30 }]],
    ["vertical", { type: "vertical", id: "d", x: 30 }, [{ x: 30, y: 50 }]],
    [
      "trend",
      { type: "trend", id: "d", a: { x: 10, price: 20 }, b: { x: 70, price: 80 } },
      [{ x: 10, y: 20 }, { x: 70, y: 80 }],
    ],
    [
      "fib",
      { type: "fib", id: "d", a: { x: 10, price: 20 }, b: { x: 70, price: 80 } },
      [{ x: 10, y: 20 }, { x: 70, y: 80 }],
    ],
    [
      "parallelChannel",
      {
        type: "parallelChannel",
        id: "d",
        a: { x: 10, price: 20 },
        b: { x: 50, price: 40 },
        c: { x: 30, price: 70 },
      },
      [{ x: 10, y: 20 }, { x: 50, y: 40 }, { x: 30, y: 70 }],
    ],
    [
      "fibExtension",
      {
        type: "fibExtension",
        id: "d",
        a: { x: 10, price: 20 },
        b: { x: 50, price: 40 },
        c: { x: 70, price: 30 },
      },
      [{ x: 10, y: 20 }, { x: 50, y: 40 }, { x: 70, y: 30 }],
    ],
  ])("should centre a selected %s's handles on its grab points", (_kind, drawing, expected) => {
    const centres: { x: number; y: number }[] = [];
    const target: DrawTarget = {
      drawLine: () => undefined,
      drawShape: (shape) => {
        if (shape.shape === "circle") centres.push({ x: shape.cx, y: shape.cy });
      },
      drawText: () => undefined,
      drawCustom: () => undefined,
    };
    const context = { readStyle: () => "", formatValue: String, barIndexAt: () => null };
    drawOne(target, space, context, drawing, { width: 1, color: "#000" }, true);
    expect(centres).toEqual(expected);
  });

  /** The line segments `drawOne` emits for `drawing`, in the identity space. */
  const segmentsOf = (drawing: Drawing): { x: number; y: number }[][] => {
    const segments: { x: number; y: number }[][] = [];
    const target: DrawTarget = {
      drawLine: (points) => {
        segments.push(points.map(({ x, y }) => ({ x, y })));
      },
      drawShape: () => undefined,
      drawText: () => undefined,
      drawCustom: () => undefined,
    };
    const context = { readStyle: () => "", formatValue: String, barIndexAt: () => null };
    drawOne(target, space, context, drawing, { width: 1, color: "#000" }, false);
    return segments;
  };

  it("should run a horizontal line from the pane's left edge to its right edge", () => {
    expect(segmentsOf({ type: "horizontal", id: "d", price: 30 })).toEqual([
      [{ x: 0, y: 30 }, { x: 100, y: 30 }],
    ]);
  });

  /** b to the left of a — the levels still cover the whole swing, whichever anchor came first. */
  it("should span a fib's levels between its anchors when b lies left of a", () => {
    const segments = segmentsOf({
      type: "fib",
      id: "d",
      a: { x: 70, price: 80 },
      b: { x: 10, price: 20 },
      levels: [0, 1],
    });
    expect(segments).toEqual([
      [{ x: 10, y: 20 }, { x: 70, y: 20 }],
      [{ x: 10, y: 80 }, { x: 70, y: 80 }],
    ]);
  });

  it("should take a drawing back through its handle", () => {
    const { model, tools } = drawingChart();
    const before = lines(model).length;

    const handle = tools.add({ type: "horizontal", price: 110 });
    handle.remove();
    handle.remove(); // safe to call twice.

    expect(lines(model)).toHaveLength(before);
  });

  it("should round-trip its drawings through serialize/load", () => {
    const { tools } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });
    tools.add({
      type: "trend",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
    });

    const payload = tools.serialize();
    const { tools: restored } = drawingChart();

    expect(restored.load(payload)).toBe(true);
    expect(restored.list()).toEqual(tools.list());
  });

  it("should not let a caller's object mutate the stage", () => {
    const { model, plot, tools } = drawingChart();
    const drawing = { type: "horizontal", price: 110 } as const;

    tools.add(drawing);
    const line = lines(model).at(-1)!;

    // Mutating the outside object has no effect on the stage -- add copied it.
    (drawing as { price: number }).price = 50;
    plot.render();

    expect(lines(model).at(-1)).toEqual(line);
  });

  it("should erase everything on dispose", () => {
    const { model, tools } = drawingChart();
    const before = lines(model).length;
    tools.add({ type: "horizontal", price: 110 });

    tools.dispose();

    expect(lines(model)).toHaveLength(before);
  });
});

/** `add` rejects the same things the parser (`parseDrawings`) rejects. */
describe("add's numeric contract", () => {
  it("should throw on a non-finite coordinate instead of storing it", () => {
    const { tools } = drawingChart();

    expect(() => tools.add({ type: "horizontal", price: NaN })).toThrow(
      ContractError,
    );
    expect(() =>
      tools.add({
        type: "trend",
        a: { x: 1, price: JSON.parse('{"v":1e999}').v },
        b: { x: 2, price: 3 },
      }),
    ).toThrow(ContractError);
  });
});

/**
 * The round trip doesn't lose the handle. If only `add` issued handles,
 * a drawing restored via `load` after a refresh could be neither
 * targeted with `select` nor removed individually -- only `clear()`
 * would be left. `handles()` issues a handle for every entry in the
 * list.
 */
describe("handles() -- a restored drawing can be targeted too", () => {
  const two = [
    { type: "horizontal" as const, price: 110 },
    { type: "trend" as const, a: { x: 0, price: 100 }, b: { x: 10, price: 120 } },
  ];

  it("should hand out handles in list() order", () => {
    const { tools } = drawingChart();
    for (const drawing of two) tools.add(drawing);

    const handles = tools.handles();
    expect(handles).toHaveLength(2);
    expect(handles.map((handle) => handle.read())).toEqual(tools.list());
  });

  it("should hand out handles for drawings that came from load", () => {
    const source = drawingChart();
    for (const drawing of two) source.tools.add(drawing);
    const payload = source.tools.serialize();

    // A fresh session -- add was never called.
    const { tools } = drawingChart();
    expect(tools.load(payload)).toBe(true);
    expect(tools.handles()).toHaveLength(2);
  });

  it("should let a restored handle drive select and remove", () => {
    const source = drawingChart();
    for (const drawing of two) source.tools.add(drawing);
    const payload = source.tools.serialize();

    const { tools } = drawingChart();
    tools.load(payload);

    const [first, second] = tools.handles();
    tools.select(second);
    expect(tools.selection()).toMatchObject(two[1]);

    first.remove();
    expect(tools.list()).toMatchObject([two[1]]);
  });

  /** The contract is what it points at, not object identity -- this must work even though every call produces a fresh object. */
  it("should work even though each call makes fresh handle objects", () => {
    const { tools } = drawingChart();
    tools.add(two[0]);

    const [a] = tools.handles();
    const [b] = tools.handles();
    expect(a).not.toBe(b);

    tools.select(b);
    expect(tools.selection()).toMatchObject(two[0]);
    a.remove();
    expect(tools.list()).toEqual([]);
  });

  it("should be empty before anything is drawn", () => {
    expect(drawingChart().tools.handles()).toEqual([]);
  });
});

/**
 * A double-click on a shape does not reset the viewport -- without
 * blocking it, the shell's `doubleClickReset` would call `fitDomains()`,
 * and double-clicking a line you just drew would wipe out the
 * zoomed-in range you'd set up.
 */
describe("double-click on a shape", () => {
  function withLine() {
    const harness = drawingChart();
    harness.tools.add({ type: "horizontal", price: 110 });
    return harness;
  }

  it("should eat the double click that lands on a drawing", () => {
    const { dblclick, onLine } = withLine();
    expect(dblclick(onLine(110, 3))).toBe(true);
  });

  it("should select what it was double clicked on", () => {
    const { dblclick, tools, onLine } = withLine();
    expect(tools.selection()).toBeNull();

    dblclick(onLine(110, 3));

    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 110 });
  });

  /** Empty space is **let through** -- the fit-all reset still belongs to the shell. */
  it("should let an empty-space double click through", () => {
    const { dblclick, onLine } = withLine();
    expect(dblclick(onLine(110, 200))).toBe(false);
  });
});

it('rolls back focus and decoration acquisitions if input installation fails', () => {
  let focus = 0, decorations = 0;
  const plot: DrawingStage = {
    ...space, requestRender() {}, crosshair() {}, claimCursor: () => () => {},
    claimFocusArea() { focus++; return { contestedAt: () => false, release() { focus--; } }; },
    addInputConsumer() { throw new Error('registration failed'); },
  };
  const pane: DrawingPane = { ...space, xRange: () => null, probe: () => [], addDecoration() { decorations++; return () => { decorations--; }; } };
  expect(() => drawingTools({ plot })(pane)).toThrow('registration failed');
  expect({ focus, decorations }).toEqual({ focus: 0, decorations: 0 });
});
