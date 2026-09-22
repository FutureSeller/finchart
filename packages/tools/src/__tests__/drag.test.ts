import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";
import { moveGrip } from '../hit';
import { parseDrawings, toOwnedDrawing } from '../drawings';
import type { Drawing } from '../drawings';

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

  /**
   * Domain coordinates to pixels — how a test aims at a drawing.
   *
   * **x is deliberately unused.** Every drawing in this suite is a horizontal
   * line, so aiming needs only the price and the middle of the pane will do
   * horizontally. It used to take the argument and multiply it away with
   * `+ 0 * x`, which is what `oxc(erasing-op)` bit as "always evaluates to
   * zero". What isn't used is now written as unused.
   */
  const pixelOf = (_x: number, price: number) => ({
    x: (pane.area.left + pane.area.right) / 2,
    y: pane.yScale.scale(price),
  });

  const route = (
    type: "pointerdown" | "pointermove" | "pointerup",
    point: { x: number; y: number },
  ) => model.plot.routeInput({ type, point, pointerId: 1 });

  return { model, tools, pane, pixelOf, route };
}

describe("drawingTools drag", () => {
  it("should eat the drag so pan cannot move — and follow the cursor", () => {
    const { model, tools, pane, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    const xDomainBefore = model.plot.getState().xDomain;

    const grabX = (pane.area.left + pane.area.right) / 2;
    const grabY = pane.yScale.scale(110);
    // 3px onto the line -- inside the 4px tolerance.
    expect(route("pointerdown", { x: grabX, y: grabY + 3 })).toBe(true);
    expect(route("pointermove", { x: grabX, y: grabY + 43 })).toBe(true);
    expect(route("pointerup", { x: grabX, y: grabY + 43 })).toBe(true);

    // The grabbed point sticks to the cursor -- a 40px change in price.
    const moved = tools.list()[0];
    if (moved.type !== "horizontal") throw new Error("unexpected");
    const expected = pane.yScale.invert(grabY + 40);
    expect(moved.price).toBeCloseTo(expected, 8);

    // Consumed, so pan never gets to run -- the x domain is unchanged
    // (the invariant this locks in).
    expect(model.plot.getState().xDomain).toEqual(xDomainBefore);
  });

  it("should decline a press away from every drawing", () => {
    const { pane, tools, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const missY = pane.yScale.scale(110) + 20;
    expect(
      route("pointerdown", {
        x: (pane.area.left + pane.area.right) / 2,
        y: missY,
      }),
    ).toBe(false);
  });

  it("should move only the grabbed endpoint of a trend line", () => {
    const { model, tools, pane, route } = mounted();
    const handle = tools.add({
      type: "trend",
      a: { x: 2, price: 105 },
      b: { x: 8, price: 115 },
    });
    model.plot.render();

    // Data x -> pixels. The mapping is continuous, so the domain is the
    // raw data x range as-is (0-10).
    const frameX = (x: number) => {
      const { left, right } = pane.area;
      return left + (x / 10) * (right - left);
    };
    const grab = { x: frameX(2), y: pane.yScale.scale(105) };

    expect(route("pointerdown", grab)).toBe(true);
    route("pointermove", { x: grab.x, y: grab.y - 30 });
    route("pointerup", { x: grab.x, y: grab.y - 30 });

    const after = handle.read();
    if (after.type !== "trend") throw new Error("unexpected");
    // Only a moved -- the price went up (30px upward), and b is unchanged.
    expect(after.a.price).toBeGreaterThan(105);
    expect(after.b).toEqual({ x: 8, price: 115 });
  });

  it("should move the whole trend line when grabbed by its body", () => {
    const { model, tools, pane, route } = mounted();
    const handle = tools.add({
      type: "trend",
      a: { x: 2, price: 105 },
      b: { x: 8, price: 115 },
    });
    model.plot.render();

    const frameX = (x: number) => {
      const { left, right } = pane.area;
      return left + (x / 10) * (right - left);
    };
    // The midpoint of the segment -- outside the endpoint tolerance.
    const mid = {
      x: frameX(5),
      y: pane.yScale.scale(110),
    };

    expect(route("pointerdown", mid)).toBe(true);
    route("pointermove", { x: mid.x, y: mid.y - 20 });
    route("pointerup", { x: mid.x, y: mid.y - 20 });

    const after = handle.read();
    if (after.type !== "trend") throw new Error("unexpected");
    // Moved as a whole -- the price gap between the two anchors is preserved.
    expect(after.b.price - after.a.price).toBeCloseTo(10, 8);
    expect(after.a.price).toBeGreaterThan(105);
    // x didn't move (dragged vertically only).
    expect(after.a.x).toBeCloseTo(2, 8);
  });

  it("should grab the drawing on top when two overlap", () => {
    const { model, tools, pane, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    const top = tools.add({ type: "horizontal", price: 110 });
    model.plot.render();

    const grab = {
      x: (pane.area.left + pane.area.right) / 2,
      y: pane.yScale.scale(110),
    };
    route("pointerdown", grab);
    route("pointermove", { x: grab.x, y: grab.y + 30 });
    route("pointerup", { x: grab.x, y: grab.y + 30 });

    // The one added later (on top) moved, and the first one stayed put.
    const [bottomAfter, topAfter] = tools.list();
    if (bottomAfter.type !== "horizontal" || topAfter.type !== "horizontal") {
      throw new Error("unexpected");
    }
    expect(bottomAfter.price).toBe(110);
    expect(topAfter.price).not.toBe(110);
    expect(top.read()).toEqual(topAfter);
  });

  it("should ignore input before anything has been drawn", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 } });
    const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
    tools.add({ type: "horizontal", price: 110 });

    // Nothing was ever drawn since there's no data -- there's nothing on
    // screen to grab either.
    expect(
      model.plot.routeInput({
        type: "pointerdown",
        point: { x: 100, y: 100 },
        pointerId: 1,
      }),
    ).toBe(false);
  });
});

describe("fibonacci", () => {
  it("should draw seven levels with ratio labels", () => {
    const { model, tools } = mounted();

    tools.add({
      type: "fib",
      a: { x: 1, price: 118 },
      b: { x: 9, price: 102 },
    });

    const texts = model
      .commands()
      .filter((c) => c.type === "drawText")
      .map((c) => (c.type === "drawText" ? c.params.text : ""));
    for (const label of ["0.0%", "23.6%", "50.0%", "100.0%"]) {
      expect(texts).toContain(label);
    }
  });

  it("should move as one body when a level line is grabbed", () => {
    const { model, tools, pane, route } = mounted();
    const handle = tools.add({
      type: "fib",
      a: { x: 1, price: 118 },
      b: { x: 9, price: 102 },
    });
    model.plot.render();

    const frameX = (x: number) => {
      const { left, right } = pane.area;
      return left + (x / 10) * (right - left);
    };
    // The middle of the 50% level -- outside the endpoint tolerance, on
    // the level line.
    const grab = { x: frameX(5), y: pane.yScale.scale(110) };

    expect(route("pointerdown", grab)).toBe(true);
    route("pointermove", { x: grab.x, y: grab.y + 15 });
    route("pointerup", { x: grab.x, y: grab.y + 15 });

    const after = handle.read();
    if (after.type !== "fib") throw new Error("unexpected");
    // a and b moved down together -- the range width (price gap) is preserved.
    expect(after.a.price - after.b.price).toBeCloseTo(16, 8);
    expect(after.a.price).toBeLessThan(118);
  });
});

it('rejects a complete additive drag candidate before writing any anchor', () => {
  const drawing: Drawing = { type: 'trend', id: 't', a: { x: 1, price: 1e308 }, b: { x: 2, price: 10 } };
  const original = toOwnedDrawing(drawing);
  moveGrip({ grip: { drawing, part: 'whole' }, offsets: [{ x: 1, price: 1e308 }, { x: 2, price: 10 }], original }, { x: 50, price: 1e308 });
  expect(drawing).toEqual(original);
});

it('keeps saving and history valid after an out-of-range finite pixel drag', () => {
  const model = createPlotModel({ size: { width: 800, height: 600 }, series: { series: lineSeries(), data: [{ x: 0, y: 1e307 }, { x: 10, y: 2e307 }] } });
  const api = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  const handle = api.add({ type: 'horizontal', price: 1.5e307 });
  const before = handle.read();
  model.plot.routeInput({ type: 'pointerdown', point: { x: 400, y: model.plot.mainPane.pixelAtValue(1.5e307) }, pointerId: 1 });
  model.plot.routeInput({ type: 'pointermove', point: { x: 400, y: -10000 }, pointerId: 1 });
  model.plot.routeInput({ type: 'pointerup', point: { x: 400, y: -10000 }, pointerId: 1 });
  expect(handle.read()).toEqual(before);
  expect(parseDrawings(api.serialize())).toEqual([before]);
  api.undo(); // Only the add was committed.
  expect(api.list()).toEqual([]);
  model.plot.destroy();
});
