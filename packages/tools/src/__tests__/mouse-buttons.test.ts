import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";

type Area = { left: number; right: number; top: number; bottom: number };

/**
 * The button axis. If a pointerdown is accepted without a `button`
 * field, right-clicking on a line (the habitual gesture for opening a
 * properties/delete menu) turns any hand tremor while the button is
 * held into a real drag, shifting the price line and potentially saving
 * it -- with no undo.
 */

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

function mounted() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: lineSeries(), data },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  const pane = model.plot.mainPane;
  model.plot.render();

  const at = (x: number, price: number) => ({
    x: pane.area.left + (x / 10) * (pane.area.right - pane.area.left),
    y: pane.yScale.scale(price),
  });

  return { model, tools, pane, at };
}

describe("the secondary button does not grab a drawing", () => {
  it("should not drag a drawing with the secondary button", () => {
    const { model, tools, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    const before = tools.list();

    // Right-click on the line -- and the hand wobbles while it's held down.
    const on = at(5, 105);
    model.plot.routeInput({
      type: "pointerdown",
      point: on,
      pointerId: 1,
      button: 2,
    });
    model.plot.routeInput({
      type: "pointermove",
      point: { x: on.x, y: on.y + 14 },
      pointerId: 1,
    });
    model.plot.routeInput({
      type: "pointerup",
      point: { x: on.x, y: on.y + 14 },
      pointerId: 1,
    });

    expect(tools.list()).toEqual(before);
  });

  it("should still drag with the primary button", () => {
    const { model, tools, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });

    const on = at(5, 105);
    model.plot.routeInput({
      type: "pointerdown",
      point: on,
      pointerId: 1,
      button: 0,
    });
    model.plot.routeInput({
      type: "pointermove",
      point: { x: on.x, y: on.y + 14 },
      pointerId: 1,
    });
    model.plot.routeInput({
      type: "pointerup",
      point: { x: on.x, y: on.y + 14 },
      pointerId: 1,
    });

    expect(tools.list()[0]).not.toEqual({ type: "horizontal", price: 105 });
  });

  /** Synthetic input that omits `button` must mean the same thing as today. */
  it("should treat a missing button as primary", () => {
    const { model, tools, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });

    const on = at(5, 105);
    model.plot.routeInput({ type: "pointerdown", point: on, pointerId: 1 });
    model.plot.routeInput({
      type: "pointermove",
      point: { x: on.x, y: on.y + 14 },
      pointerId: 1,
    });

    expect(tools.list()[0]).not.toEqual({ type: "horizontal", price: 105 });
  });

  /** If `"right"` came through, `!== 0` would be true for everything, and selection would break entirely. */
  it("should reject a non-numeric button at the door", () => {
    const { model, at } = mounted();
    expect(() =>
      model.plot.routeInput({
        type: "pointerdown",
        point: at(5, 105),
        pointerId: 1,
        button: "right",
      } as never),
    ).toThrow(/button/);
  });
});

describe("a right click selects but doesn't consume", () => {
  it("should select the drawing under a right click", () => {
    const { model, tools, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });

    expect(tools.selection()).toBeNull();
    model.plot.routeInput({ type: "contextmenu", point: at(5, 105) });

    expect(tools.selection()).toEqual({ type: "horizontal", price: 105 });
  });

  /**
   * A right click on empty space clears the selection -- selecting only
   * on a hit and leaving it untouched on a miss would let the app's
   * delete menu end up pointing at a drawing that isn't under the
   * cursor.
   */
  it("should clear the selection when the right click misses", () => {
    const { model, tools, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    model.plot.routeInput({ type: "contextmenu", point: at(5, 105) });
    expect(tools.selection()).not.toBeNull();

    model.plot.routeInput({ type: "contextmenu", point: at(5, 118) });

    expect(tools.selection()).toBeNull();
  });

  /**
   * All three buttons (left click, right click, double click) must give
   * the same answer at the same point -- wiring the axis/margin gate
   * into only one of them would create a spot where the published
   * `.d.ts`'s recipe ("the drawing under the cursor, or null") turns
   * out to be a lie.
   */
  it.each([
    ["empty space in the same pane", (p: Area) => ({ x: (p.left + p.right) / 2, y: p.top + 10 })],
    ["the price axis", (p: Area) => ({ x: p.right + 5, y: (p.top + p.bottom) / 2 })],
    ["the time axis", (p: Area) => ({ x: (p.left + p.right) / 2, y: p.bottom + 5 })],
    ["the left margin", (p: Area) => ({ x: Math.max(p.left - 3, 0), y: (p.top + p.bottom) / 2 })],
  ])("all three buttons agree at %s", (_label, at) => {
    const answers = (["left", "right", "double"] as const).map((button) => {
      const { model, tools, pane } = mounted();
      const handle = tools.add({ type: "horizontal", price: 105 });
      tools.select(handle);
      const point = at(pane.area);

      if (button === "left") {
        model.plot.routeInput({ type: "pointerdown", point, pointerId: 1 });
        model.plot.routeInput({ type: "pointerup", point, pointerId: 1 });
      } else if (button === "right") {
        model.plot.routeInput({ type: "contextmenu", point });
      } else {
        model.plot.routeInput({ type: "dblclick", point });
      }
      return tools.selection();
    });

    // The absolute assertion comes first -- a relative comparison (all
    // three equal to each other) alone would pass even if all three were
    // wrong. The right answer for a miss isn't "equal to each other,"
    // it's null itself.
    expect(answers[0]).toBeNull();
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  /** Control -- on the line, all three buttons point at that line. */
  it("all three buttons agree on the line", () => {
    const answers = (["left", "right", "double"] as const).map((button) => {
      const { model, tools, at } = mounted();
      tools.add({ type: "horizontal", price: 105 });
      const point = at(5, 105);

      if (button === "left") {
        model.plot.routeInput({ type: "pointerdown", point, pointerId: 1 });
        model.plot.routeInput({ type: "pointerup", point, pointerId: 1 });
      } else if (button === "right") {
        model.plot.routeInput({ type: "contextmenu", point });
      } else {
        model.plot.routeInput({ type: "dblclick", point });
      }
      return tools.selection();
    });

    expect(answers).toEqual([
      { type: "horizontal", price: 105 },
      { type: "horizontal", price: 105 },
      { type: "horizontal", price: 105 },
    ]);
  });

  /** The double click follows the same rule -- headless synthesis can only send a dblclick. */
  it("should clear the selection when a double click misses", () => {
    const { model, tools, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    model.plot.routeInput({ type: "dblclick", point: at(5, 105) });
    expect(tools.selection()).not.toBeNull();

    model.plot.routeInput({ type: "dblclick", point: at(5, 118) });

    expect(tools.selection()).toBeNull();
  });

  /** If this consumed the event, `plot.contextMenu(point)` wouldn't fire, and the app couldn't open its own menu. */
  it("should let the app open its own menu", () => {
    const { model, tools, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });

    const eaten = model.plot.routeInput({
      type: "contextmenu",
      point: at(5, 105),
    });

    expect(eaten).toBe(false);
    expect(tools.selection()).not.toBeNull();
  });
});
