/**
 * Predicate separation. The disease that shows up when a single
 * `insideArea` handles all three roles: (1) at boundary y, drawing
 * leaks through while hit-testing still catches it (half-open vs.
 * closed) (2) a miss on another toolbox's pane clears my selection,
 * making `selection()` depend on registration order (3) mid-gesture, a
 * second pointer hands off ownership, and Delete dies at the end of the
 * drag.
 */
import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";

const data: LineDataPoint[] = Array.from({ length: 20 }, (_, i) => ({
  x: i,
  y: 100 + i,
}));

function twoToolboxes() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: lineSeries(), data },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const lower = model.plot.addPane({ flex: 1 });
  lower.addSeries({ series: lineSeries(), data });
  const main = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  const other = lower.use(drawingTools({ plot: model.plot }));
  model.plot.render();

  const route = (event: Parameters<typeof model.plot.routeInput>[0]) =>
    model.plot.routeInput(event);
  const middleOf = (area: { left: number; right: number; top: number; bottom: number }) => ({
    x: (area.left + area.right) / 2,
    y: (area.top + area.bottom) / 2,
  });

  return { model, main, other, route, middleOf };
}

describe("(1) drawing is inside the pane (closed) -- it doesn't leak into pan at boundary y", () => {
  it("an armed pointerdown at the bottom edge y starts drawing", () => {
    const { model, main, route } = (() => {
      const t = twoToolboxes();
      return t;
    })();
    const area = model.plot.mainPane.area;

    main.begin("trend");
    const consumed = route({
      type: "pointerdown",
      point: { x: (area.left + area.right) / 2, y: area.bottom },
      pointerId: 1,
    });

    // Same rule as hit-testing (closed) -- the old half-open version
    // returned false here and leaked into pan.
    expect(consumed).toBe(true);
  });
});

describe("(2) another toolbox's contested area is its own business -- selection is not tied to registration order", () => {
  it("a miss-down on another toolbox's pane does not clear my selection", () => {
    const { model, main, route, middleOf } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    const line = {
      x: middleOf(model.plot.mainPane.area).x,
      y: model.plot.mainPane.yScale.scale(110),
    };
    route({ type: "pointerdown", point: line, pointerId: 1 });
    route({ type: "pointerup", point: line, pointerId: 1 });
    expect(main.selection()).not.toBeNull();

    // Press an empty spot in the pane below (the area another toolbox contests).
    const below = middleOf(model.plot.panes[1].area);
    route({ type: "pointerdown", point: below, pointerId: 1 });
    route({ type: "pointerup", point: below, pointerId: 1 });

    expect(main.selection()).not.toBeNull();
  });

  it("a pointerdown on the axis/margin (an area nobody contests) still clears selection as before", () => {
    const { model, main, route } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    const line = {
      x: (model.plot.mainPane.area.left + model.plot.mainPane.area.right) / 2,
      y: model.plot.mainPane.yScale.scale(110),
    };
    route({ type: "pointerdown", point: line, pointerId: 1 });
    route({ type: "pointerup", point: line, pointerId: 1 });
    expect(main.selection()).not.toBeNull();

    // Outside the plot (right margin) -- nobody contests this.
    route({ type: "pointerdown", point: { x: 799, y: 5 }, pointerId: 1 });
    route({ type: "pointerup", point: { x: 799, y: 5 }, pointerId: 1 });

    expect(main.selection()).toBeNull();
  });
});

describe("(3) ownership is not re-decided mid-gesture", () => {
  it("Delete still works even if a second pointer touches another pane mid-drag", () => {
    const { model, main, route, middleOf } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    const line = {
      x: middleOf(model.plot.mainPane.area).x,
      y: model.plot.mainPane.yScale.scale(110),
    };

    // Start the drag -- while still holding it, a second finger touches
    // the pane below.
    route({ type: "pointerdown", point: line, pointerId: 1 });
    route({
      type: "pointerdown",
      point: middleOf(model.plot.panes[1].area),
      pointerId: 2,
    });
    route({
      type: "pointermove",
      point: { x: line.x, y: line.y + 10 },
      pointerId: 1,
    });
    route({
      type: "pointerup",
      point: { x: line.x, y: line.y + 10 },
      pointerId: 1,
    });

    expect(main.selection()).not.toBeNull();
    route({ type: "keydown", key: "Delete" });
    expect(main.list()).toHaveLength(0);
  });
});
