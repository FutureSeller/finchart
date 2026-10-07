import { space } from "./drawing-stage.fixture";
import type { DrawTarget, LineDataPoint } from "@finchart/core";
import { ContractError, createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import { drawOne } from "../render";
import { drawingTools } from "../tools";
import type { DrawingPane, DrawingStage } from '../tools';

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

export function mounted() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: lineSeries(), data },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  return { model, tools };
}

const lines = (model: ReturnType<typeof mounted>["model"]) =>
  model.commands().filter((c) => c.type === "drawLine");

describe("drawingTools drawing", () => {
  it("should draw a horizontal line across the pane at its price", () => {
    const { model, tools } = mounted();
    const before = lines(model).length;

    tools.add({ type: "horizontal", price: 110 });

    const drawn = lines(model);
    expect(drawn).toHaveLength(before + 1);
    const line = drawn.at(-1)!;
    if (line.type !== "drawLine") return;
    // It's a horizontal line -- both ends share the same y, spanning
    // from the pane's left edge to its right edge.
    expect(line.points[0].y).toBe(line.points[1].y);
    expect(line.points[1].x).toBeGreaterThan(line.points[0].x);
  });

  it("should emit an off-range horizontal line and leave clipping to the core", () => {
    const { model, tools } = mounted();
    const before = lines(model).length;

    tools.add({ type: "horizontal", price: 10_000 });

    // The tool doesn't clip -- "whoever allocated the area does the
    // clipping" (the plot's clip). This used to hand-clip only
    // horizontal lines, which split the rule away from trend and fib.
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
    const { model, tools } = mounted();
    const pane = model.plot.mainPane;

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
    const a = { x: model.plot.pixelAtX(0), y: pane.yScale.scale(100) };
    model.plot.routeInput({ type: "pointerdown", point: a, pointerId: 1 });
    model.plot.routeInput({ type: "pointerup", point: a, pointerId: 1 });

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
    const { model, tools } = mounted();
    const before = lines(model).length;

    const handle = tools.add({ type: "horizontal", price: 110 });
    handle.remove();
    handle.remove(); // safe to call twice.

    expect(lines(model)).toHaveLength(before);
  });

  it("should round-trip its drawings through serialize/load", () => {
    const { tools } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    tools.add({
      type: "trend",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
    });

    const payload = tools.serialize();
    const { tools: restored } = mounted();

    expect(restored.load(payload)).toBe(true);
    expect(restored.list()).toEqual(tools.list());
  });

  it("should keep its list when a payload cannot be read", () => {
    const { tools } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    expect(tools.load("garbage")).toBe(false);
    expect(tools.list()).toHaveLength(1);
  });

  it("should not let a caller's object mutate the stage", () => {
    const { model, tools } = mounted();
    const drawing = { type: "horizontal", price: 110 } as const;

    tools.add(drawing);
    const line = lines(model).at(-1)!;

    // Mutating the outside object has no effect on the stage -- add copied it.
    (drawing as { price: number }).price = 50;
    model.plot.render();

    expect(lines(model).at(-1)).toEqual(line);
  });

  it("should erase everything on dispose", () => {
    const { model, tools } = mounted();
    const before = lines(model).length;
    tools.add({ type: "horizontal", price: 110 });

    tools.dispose();

    expect(lines(model)).toHaveLength(before);
  });
});

/** `add` rejects the same things the parser (`parseDrawings`) rejects. */
describe("add's numeric contract", () => {
  it("should throw on a non-finite coordinate instead of storing it", () => {
    const { tools } = mounted();

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

  /** A rejection **leaves nothing behind** -- no half-added drawing. */
  it("should not leave a partial drawing behind", () => {
    const { tools } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    expect(() => tools.add({ type: "horizontal", price: NaN })).toThrow();

    expect(tools.list()).toHaveLength(1);
  });

  /** The stored copy can read itself back -- `load` must not reject what `add` accepted. */
  it("should keep serialize/load a closed loop after many adds", () => {
    const { tools } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    tools.add({ type: "trend", a: { x: 0, price: 100 }, b: { x: 10, price: 120 } });

    expect(tools.load(tools.serialize())).toBe(true);
    expect(tools.list()).toHaveLength(2);
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
    const { tools } = mounted();
    for (const drawing of two) tools.add(drawing);

    const handles = tools.handles();
    expect(handles).toHaveLength(2);
    expect(handles.map((handle) => handle.read())).toEqual(tools.list());
  });

  it("should hand out handles for drawings that came from load", () => {
    const source = mounted();
    for (const drawing of two) source.tools.add(drawing);
    const payload = source.tools.serialize();

    // A fresh session -- add was never called.
    const { tools } = mounted();
    expect(tools.load(payload)).toBe(true);
    expect(tools.handles()).toHaveLength(2);
  });

  it("should let a restored handle drive select and remove", () => {
    const source = mounted();
    for (const drawing of two) source.tools.add(drawing);
    const payload = source.tools.serialize();

    const { tools } = mounted();
    tools.load(payload);

    const [first, second] = tools.handles();
    tools.select(second);
    expect(tools.selection()).toMatchObject(two[1]);

    first.remove();
    expect(tools.list()).toMatchObject([two[1]]);
  });

  /** The contract is what it points at, not object identity -- this must work even though every call produces a fresh object. */
  it("should work even though each call makes fresh handle objects", () => {
    const { tools } = mounted();
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
    expect(mounted().tools.handles()).toEqual([]);
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
    const harness = mounted();
    harness.tools.add({ type: "horizontal", price: 110 });
    const pane = harness.model.plot.mainPane;
    return {
      ...harness,
      x: (pane.area.left + pane.area.right) / 2,
      y: pane.yScale.scale(110),
    };
  }

  const dbl = (model: ReturnType<typeof mounted>["model"], point: { x: number; y: number }) =>
    model.plot.routeInput({ type: "dblclick", point });

  it("should eat the double click that lands on a drawing", () => {
    const { model, x, y } = withLine();
    expect(dbl(model, { x, y: y + 3 })).toBe(true);
  });

  it("should select what it was double clicked on", () => {
    const { model, tools, x, y } = withLine();
    expect(tools.selection()).toBeNull();

    dbl(model, { x, y: y + 3 });

    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 110 });
  });

  /** Empty space is **let through** -- the fit-all reset still belongs to the shell. */
  it("should let an empty-space double click through", () => {
    const { model, x, y } = withLine();
    expect(dbl(model, { x, y: y + 200 })).toBe(false);
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
