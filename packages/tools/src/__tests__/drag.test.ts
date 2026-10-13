import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";
import { moveGrip } from '../hit';
import { parseDrawings, toOwnedDrawing } from '../drawings';
import type { Drawing } from '../drawings';
import { drawingChart } from "./drawing-chart.fixture";
import { mountDrawingStage } from "./drawing-stage.fixture";

describe("drawingTools drag", () => {
  it("should eat the drag so pan cannot move — and follow the cursor", () => {
    const { plot, tools, pane, press, onLine } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });
    const xDomainBefore = plot.getVisibleRange();

    const grabY = pane.yScale.scale(110);
    // 3px onto the line -- inside the 4px tolerance.
    const gesture = press(onLine(110, 3));
    expect(gesture.down).toBe(true);
    expect(gesture.moveTo(onLine(110, 43))).toBe(true);
    expect(gesture.release()).toBe(true);

    // The grabbed point sticks to the cursor -- a 40px change in price.
    const moved = tools.list()[0];
    if (moved.type !== "horizontal") throw new Error("unexpected");
    const expected = pane.yScale.invert(grabY + 40);
    expect(moved.price).toBeCloseTo(expected, 8);

    // Consumed, so pan never gets to run -- the x domain is unchanged
    // (the invariant this locks in).
    expect(plot.getVisibleRange()).toEqual(xDomainBefore);
  });

  it("should claim a drag's release on a stage that has no pointer capture", () => {
    // A custom stage hands every event to the consumer and trusts its
    // answer; the chart's own router would claim the release regardless.
    const { api, route } = mountDrawingStage();
    api.add({ type: "horizontal", price: 50 });

    expect(route("pointerdown", 50, 50)).toBe(true);
    expect(route("pointermove", 50, 60)).toBe(true);
    expect(route("pointerup", 50, 60)).toBe(true);
    expect(api.list()).toMatchObject([{ price: 60 }]);
    // A release that moved nothing is still the drag's to claim.
    expect(route("pointerdown", 50, 60)).toBe(true);
    expect(route("pointerup", 50, 60)).toBe(true);
    api.dispose();
  });

  it("should decline a press away from every drawing", () => {
    const { tools, press, onLine } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    expect(press(onLine(110, 20)).down).toBe(false);
  });

  it("should move only the grabbed endpoint of a trend line", () => {
    const { plot, tools, at, drag } = drawingChart();
    const handle = tools.add({
      type: "trend",
      a: { x: 2, price: 105 },
      b: { x: 8, price: 115 },
    });
    plot.render();

    // Data x -> pixels, through the chart — the fit pads the data range
    // (0-10) by half a bar at each end.
    const grab = at(2, 105);

    expect(drag({ x: 2, price: 105 }, { px: grab.x, py: grab.y - 30 })).toBe(true);

    const after = handle.read();
    if (after.type !== "trend") throw new Error("unexpected");
    // Only a moved -- the price went up (30px upward), and b is unchanged.
    expect(after.a.price).toBeGreaterThan(105);
    expect(after.b).toEqual({ x: 8, price: 115 });
  });

  it("should move the whole trend line when grabbed by its body", () => {
    const { plot, tools, pane, drag } = drawingChart();
    const handle = tools.add({
      type: "trend",
      a: { x: 2, price: 105 },
      b: { x: 8, price: 115 },
    });
    plot.render();

    const frameX = (x: number) => {
      const { left, right } = pane.area;
      return left + (x / 10) * (right - left);
    };
    // The midpoint of the segment -- outside the endpoint tolerance.
    const mid = {
      x: frameX(5),
      y: pane.yScale.scale(110),
    };

    expect(drag({ px: mid.x, py: mid.y }, { px: mid.x, py: mid.y - 20 })).toBe(true);

    const after = handle.read();
    if (after.type !== "trend") throw new Error("unexpected");
    // Moved as a whole -- the price gap between the two anchors is preserved.
    expect(after.b.price - after.a.price).toBeCloseTo(10, 8);
    expect(after.a.price).toBeGreaterThan(105);
    // x didn't move (dragged vertically only).
    expect(after.a.x).toBeCloseTo(2, 8);
  });

  it("should grab the drawing on top when two overlap", () => {
    const { plot, tools, drag, onLine } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });
    const top = tools.add({ type: "horizontal", price: 110 });
    plot.render();

    drag(onLine(110), onLine(110, 30));

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
    const { model, tools } = drawingChart();

    tools.add({
      type: "fib",
      a: { x: 1, price: 118 },
      b: { x: 9, price: 102 },
    });

    const texts = model
      .commands()
      .filter((c) => c.type === "drawText")
      .map((c) => (c.type === "drawText" ? c.params.text : ""));
    expect(texts.filter((text) => text.endsWith("%"))).toEqual([
      "0.0%",
      "23.6%",
      "38.2%",
      "50.0%",
      "61.8%",
      "78.6%",
      "100.0%",
    ]);
  });

  it("should move as one body when a level line is grabbed", () => {
    const { plot, tools, pane, drag } = drawingChart();
    const handle = tools.add({
      type: "fib",
      a: { x: 1, price: 118 },
      b: { x: 9, price: 102 },
    });
    plot.render();

    const frameX = (x: number) => {
      const { left, right } = pane.area;
      return left + (x / 10) * (right - left);
    };
    // The middle of the 50% level -- outside the endpoint tolerance, on
    // the level line.
    const grab = { x: frameX(5), y: pane.yScale.scale(110) };

    expect(drag({ px: grab.x, py: grab.y }, { px: grab.x, py: grab.y + 15 })).toBe(true);

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
  const { pane, tools: api, drag } = drawingChart({ series: { series: lineSeries(), data: [{ x: 0, y: 1e307 }, { x: 10, y: 2e307 }] } });
  const handle = api.add({ type: 'horizontal', price: 1.5e307 });
  const before = handle.read();
  drag({ px: 400, py: pane.pixelAtValue(1.5e307) }, { px: 400, py: -10000 });
  expect(handle.read()).toEqual(before);
  expect(parseDrawings(api.serialize())).toEqual([before]);
  api.undo(); // Only the add was committed.
  expect(api.list()).toEqual([]);
});
