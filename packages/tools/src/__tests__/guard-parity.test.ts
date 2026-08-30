/**
 * Two spots where a rule was wired into sibling doors only. "Another
 * toolbox's contested area is its own business" is wired into
 * pointerdown and contextmenu, but might not be wired into dblclick, and
 * "cut any in-progress gesture before swapping out the list" is honored
 * by `clear` and `load`, but `removeOne` might not honor it.
 */
import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools, type DrawingsChange } from "../tools";

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
  const middleOf = (area: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }) => ({
    x: (area.left + area.right) / 2,
    y: (area.top + area.bottom) / 2,
  });
  const selectLine = (price: number) => {
    const at = {
      x: middleOf(model.plot.mainPane.area).x,
      y: model.plot.mainPane.yScale.scale(price),
    };
    route({ type: "pointerdown", point: at, pointerId: 1 });
    route({ type: "pointerup", point: at, pointerId: 1 });
    return at;
  };

  return { model, main, other, route, middleOf, selectLine };
}

describe("another toolbox's contested area is its own business on dblclick too", () => {
  it("a miss-dblclick on another toolbox's pane does not clear my selection", () => {
    const { model, main, route, middleOf, selectLine } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    selectLine(110);
    expect(main.selection()).not.toBeNull();

    // Double-click an empty spot in the pane below (the area another
    // toolbox contests) -- headless synthesis can only send a dblclick,
    // so this pins the path down directly.
    route({ type: "dblclick", point: middleOf(model.plot.panes[1].area) });

    expect(main.selection()).not.toBeNull();
  });

  it("control: a dblclick on the axis/margin still clears selection as before", () => {
    const { main, route, selectLine } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    selectLine(110);

    route({ type: "dblclick", point: { x: 799, y: 5 } });

    expect(main.selection()).toBeNull();
  });
});

describe("delete also cuts an in-progress gesture (same rule as clear and load)", () => {
  it("movement after Delete during a drag does not keep pushing the shape that fell out of the list", () => {
    const { model, main, route, middleOf } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    const at = {
      x: middleOf(model.plot.mainPane.area).x,
      y: model.plot.mainPane.yScale.scale(110),
    };

    // Grab and start dragging -- normal so far.
    route({ type: "pointerdown", point: at, pointerId: 1 });
    route({ type: "pointermove", point: { x: at.x, y: at.y + 8 }, pointerId: 1 });

    // Another hand presses Delete. It disappears from the list.
    route({ type: "keydown", key: "Delete" });
    expect(main.list()).toHaveLength(0);

    const after: DrawingsChange["reason"][] = [];
    main.changes.subscribe(({ reason }) => after.push(reason));

    // The hand holding it hasn't let go yet -- any "move" firing here
    // would belong to a shape no longer in the list. Delete has to cut
    // the in-progress gesture too, or this fires.
    route({ type: "pointermove", point: { x: at.x, y: at.y + 40 }, pointerId: 1 });
    route({ type: "pointerup", point: { x: at.x, y: at.y + 40 }, pointerId: 1 });

    expect(after).toEqual([]);
  });

  it("control: without the delete, the same movement really does fire 'move'", () => {
    const { model, main, route, middleOf } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    const at = {
      x: middleOf(model.plot.mainPane.area).x,
      y: model.plot.mainPane.yScale.scale(110),
    };

    route({ type: "pointerdown", point: at, pointerId: 1 });
    route({ type: "pointermove", point: { x: at.x, y: at.y + 8 }, pointerId: 1 });

    const after: DrawingsChange["reason"][] = [];
    main.changes.subscribe(({ reason }) => after.push(reason));
    route({ type: "pointermove", point: { x: at.x, y: at.y + 40 }, pointerId: 1 });
    route({ type: "pointerup", point: { x: at.x, y: at.y + 40 }, pointerId: 1 });

    expect(after).toEqual(["move"]);
  });
});
