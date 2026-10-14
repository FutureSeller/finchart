/**
 * Two spots where a rule is wired into sibling doors only. "Another
 * toolbox's contested area is its own business" is wired into
 * pointerdown and contextmenu, but might not be wired into dblclick, and
 * "cut any in-progress gesture before swapping out the list" is honored
 * by `clear` and `load`, but `removeOne` might not honor it.
 */
import type { LineDataPoint } from "@finchart/core";
import { lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";
import { drawingChart, record } from "./drawing-chart.fixture";

const data: LineDataPoint[] = Array.from({ length: 20 }, (_, i) => ({
  x: i,
  y: 100 + i,
}));

function twoToolboxes() {
  const chart = drawingChart({ series: { series: lineSeries(), data } });
  const { model } = chart;
  const lower = model.plot.addPane({ flex: 1 });
  lower.addSeries({ series: lineSeries(), data });
  const other = lower.use(drawingTools({ plot: model.plot }));
  model.plot.render();

  const middleOf = (area: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }) => ({
    x: (area.left + area.right) / 2,
    y: (area.top + area.bottom) / 2,
  });
  const selectLine = (price: number) => chart.click(chart.onLine(price));

  return { ...chart, main: chart.tools, other, middleOf, selectLine };
}

describe("another toolbox's contested area is its own business on dblclick too", () => {
  it("a miss-dblclick on another toolbox's pane does not clear my selection", () => {
    const { model, main, dblclick, middleOf, selectLine } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    selectLine(110);
    expect(main.selection()).not.toBeNull();

    // Double-click an empty spot in the pane below (the area another
    // toolbox contests) -- headless synthesis can only send a dblclick,
    // so this pins the path down directly.
    const below = middleOf(model.plot.panes[1].area);
    dblclick({ px: below.x, py: below.y });

    expect(main.selection()).not.toBeNull();
  });

  it("control: a dblclick on the axis/margin still clears selection as before", () => {
    const { main, dblclick, selectLine } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });
    selectLine(110);

    dblclick({ px: 799, py: 5 });

    expect(main.selection()).toBeNull();
  });
});

describe("delete also cuts an in-progress gesture (same rule as clear and load)", () => {
  it("movement after Delete during a drag does not keep pushing the shape that fell out of the list", () => {
    const { main, press, key, onLine } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });

    // Grab and start dragging -- normal so far.
    const gesture = press(onLine(110));
    gesture.moveTo(onLine(110, 8));

    // Another hand presses Delete. It disappears from the list.
    key("Delete");
    expect(main.list()).toHaveLength(0);

    const after = record(main.changes);

    // The hand holding it hasn't let go yet -- any "move" firing here
    // would belong to a shape no longer in the list. Delete has to cut
    // the in-progress gesture too, or this fires.
    gesture.moveTo(onLine(110, 40));
    gesture.release();

    expect(after.map(({ reason }) => reason)).toEqual([]);
  });

  it("control: without the delete, the same movement really does fire 'move'", () => {
    const { main, press, onLine } = twoToolboxes();
    main.add({ type: "horizontal", price: 110 });

    const gesture = press(onLine(110));
    gesture.moveTo(onLine(110, 8));

    const after = record(main.changes);
    gesture.moveTo(onLine(110, 40));
    gesture.release();

    expect(after.map(({ reason }) => reason)).toEqual(["move"]);
  });
});
