import type { LineDataPoint } from "@finchart/core";
import { ContractError, createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";

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

  const route = (event: Parameters<typeof model.plot.routeInput>[0]) =>
    model.plot.routeInput(event);

  /** A point on the horizontal line -- screen center x, y at that price. */
  const onLine = (price: number) => ({
    x: (pane.area.left + pane.area.right) / 2,
    y: pane.yScale.scale(price),
  });

  /** Press and release -- leaves only a selection. */
  const pick = (point: { x: number; y: number }) => {
    route({ type: "pointerdown", point, pointerId: 1 });
    route({ type: "pointerup", point, pointerId: 1 });
  };

  return { model, tools, pane, route, onLine, pick };
}

describe("drawingTools selection", () => {
  it("should select what was grabbed and expose a copy", () => {
    const { tools, onLine, pick } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    expect(tools.selection()).toBeNull();
    pick(onLine(110));

    const picked = tools.selection();
    expect(picked).toEqual({ type: "horizontal", price: 110 });
    // It's a copy -- mutating it outside has no effect on the stage.
    (picked as { price: number }).price = 50;
    expect(tools.selection()).toEqual({ type: "horizontal", price: 110 });
  });

  it("should deselect on a press in empty space without eating it", () => {
    const { tools, route, onLine, pick, pane } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    pick(onLine(110));

    const empty = {
      x: (pane.area.left + pane.area.right) / 2,
      y: pane.yScale.scale(110) + 40,
    };
    // A press in empty space is not consumed -- pan must still be free
    // to start.
    expect(route({ type: "pointerdown", point: empty, pointerId: 1 })).toBe(
      false,
    );
    expect(tools.selection()).toBeNull();
  });

  it("should delete the selected drawing with Delete", () => {
    const { tools, onLine, pick, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    const reasons: string[] = [];
    tools.changes.subscribe(({ reason }) => reasons.push(reason));

    pick(onLine(110));
    expect(route({ type: "keydown", key: "Delete" })).toBe(true);

    expect(tools.list()).toHaveLength(0);
    expect(tools.selection()).toBeNull();
    expect(reasons).toEqual(["remove"]);
  });

  it("should treat Backspace like Delete", () => {
    const { tools, onLine, pick, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    pick(onLine(110));
    expect(route({ type: "keydown", key: "Backspace" })).toBe(true);

    expect(tools.list()).toHaveLength(0);
  });

  it("should decline Delete when nothing is selected", () => {
    const { tools, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    expect(route({ type: "keydown", key: "Delete" })).toBe(false);
    expect(tools.list()).toHaveLength(1);
  });

  it("should release the selection with Escape", () => {
    const { tools, onLine, pick, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    pick(onLine(110));

    expect(route({ type: "keydown", key: "Escape" })).toBe(true);
    expect(tools.selection()).toBeNull();
    // Declines when there's nothing to release -- so a consumer below
    // can use it.
    expect(route({ type: "keydown", key: "Escape" })).toBe(false);
  });

  /**
   * Cancel is undo -- the docs sell the contract as "cancel," but simply
   * resetting the state back to idle would leave the value that had
   * already slid in place (no undo).
   */
  it("should undo the drag on Escape, not commit it", () => {
    const { tools, onLine, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const grab = onLine(110);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 40 },
      pointerId: 1,
    });
    // It has already moved by this point -- cancel has something to undo.
    expect(tools.list()[0]).not.toEqual({ type: "horizontal", price: 110 });

    expect(route({ type: "keydown", key: "Escape" })).toBe(true);
    expect(tools.list()).toEqual([{ type: "horizontal", price: 110 }]);
  });

  it("should tell the consumer that the drag was undone", () => {
    const { tools, onLine, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const seen: string[] = [];
    tools.changes.subscribe(({ reason }) => seen.push(reason));

    const grab = onLine(110);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 40 },
      pointerId: 1,
    });
    route({ type: "keydown", key: "Escape" });

    // A consumer only finds out by reading `list()` again, so this must
    // still fire once more after the undo -- otherwise the save side
    // (a debounced autosave) is left holding the stale value.
    expect(seen[seen.length - 1]).toBe("move");
  });

  /** A drag that never moved has nothing to undo -- no notification either. */
  it("should stay quiet when the drag never moved", () => {
    const { tools, onLine, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const seen: string[] = [];
    tools.changes.subscribe(({ reason }) => seen.push(reason));

    route({ type: "pointerdown", point: onLine(110), pointerId: 1 });
    route({ type: "keydown", key: "Escape" });

    expect(seen).toEqual([]);
  });

  /**
   * A cancel is not a release -- this is the spot where tablet palm
   * rejection, an OS gesture, or a scroll takeover reclaims the pointer.
   * Folding this into `pointerup` handling would commit a half-dragged
   * shape even though the user never lifted a finger.
   */
  it("should undo the drag when the system cancels the pointer", () => {
    const { tools, onLine, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const grab = onLine(110);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 40 },
      pointerId: 1,
    });
    route({
      type: "pointercancel",
      point: { x: grab.x, y: grab.y + 40 },
      pointerId: 1,
    });

    expect(tools.list()).toEqual([{ type: "horizontal", price: 110 }]);
  });

  /** A release still commits -- only a cancel undoes it. */
  it("should still commit the drag on pointerup", () => {
    const { tools, onLine, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const grab = onLine(110);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 40 },
      pointerId: 1,
    });
    route({
      type: "pointerup",
      point: { x: grab.x, y: grab.y + 40 },
      pointerId: 1,
    });

    expect(tools.list()[0]).not.toEqual({ type: "horizontal", price: 110 });
  });

  it("should end a drag with Escape but keep the selection", () => {
    const { tools, onLine, route } = mounted();
    tools.add({ type: "horizontal", price: 110 });

    const grab = onLine(110);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    expect(route({ type: "keydown", key: "Escape" })).toBe(true);
    // The drag is over -- subsequent movement cannot move the drawing.
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 40 },
      pointerId: 1,
    });
    route({ type: "pointerup", point: { x: grab.x, y: grab.y + 40 }, pointerId: 1 });

    expect(tools.list()).toEqual([{ type: "horizontal", price: 110 }]);
    expect(tools.selection()).not.toBeNull();
  });

  it("should drop the selection when the list is replaced", () => {
    const { tools, onLine, pick } = mounted();
    tools.add({ type: "horizontal", price: 110 });
    pick(onLine(110));
    const payload = tools.serialize();

    tools.load(payload);
    expect(tools.selection()).toBeNull();

    pick(onLine(110));
    expect(tools.selection()).not.toBeNull();
    tools.clear();
    expect(tools.selection()).toBeNull();
  });
});

describe("drawingTools select and keyboard traversal", () => {
  it("should open selection to programs through the handle", () => {
    const { tools } = mounted();
    const low = tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 115 });

    tools.select(low);
    expect(tools.selection()).toEqual({ type: "horizontal", price: 105 });

    tools.select(null);
    expect(tools.selection()).toBeNull();
  });

  it("should refuse to select a removed drawing", () => {
    const { tools } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    handle.remove();

    expect(() => tools.select(handle)).toThrow(ContractError);
  });

  it("should reach Delete with the keyboard alone", () => {
    const { tools, route } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 115 });

    // ] grabs the first drawing initially, and the next one on repeat
    // presses. [ goes the other way.
    expect(route({ type: "keydown", key: "]" })).toBe(true);
    expect(tools.selection()).toEqual({ type: "horizontal", price: 105 });
    route({ type: "keydown", key: "]" });
    expect(tools.selection()).toEqual({ type: "horizontal", price: 115 });
    // Wraps around at the end.
    route({ type: "keydown", key: "]" });
    expect(tools.selection()).toEqual({ type: "horizontal", price: 105 });
    route({ type: "keydown", key: "[" });
    expect(tools.selection()).toEqual({ type: "horizontal", price: 115 });

    // Completes the pointer-free editing flow -- grab by traversal,
    // delete with Delete.
    route({ type: "keydown", key: "Delete" });
    expect(tools.list()).toEqual([{ type: "horizontal", price: 105 }]);
  });

  it("should not eat the bracket keys when there is nothing to select", () => {
    const { tools, route } = mounted();
    expect(route({ type: "keydown", key: "]" })).toBe(false);
    expect(tools.selection()).toBeNull();
  });
});
