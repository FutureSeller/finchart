import { createPlotModel, lineSeries, manualScheduler } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";

function mounted() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: {
      series: lineSeries(),
      data: [
        { x: 0, y: 100 },
        { x: 10, y: 110 },
      ],
    },
  });
  const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  const pane = model.plot.mainPane;
  model.plot.render();
  const route = (event: Parameters<typeof model.plot.routeInput>[0]) =>
    model.plot.routeInput(event);
  const onLine = (price: number) => ({
    x: (pane.area.left + pane.area.right) / 2,
    y: pane.yScale.scale(price),
  });
  const at = (x: number, price: number) => ({
    x: pane.area.left + (x / 10) * (pane.area.right - pane.area.left),
    y: pane.yScale.scale(price),
  });
  return { model, tools, route, onLine, at };
}

describe("drawingTools history", () => {
  it("replaces a large saved document without an argument-limit failure or stale history", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      deps: { createScheduler: manualScheduler() },
    });
    const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
    tools.add({ type: "horizontal", price: 10 }, { select: true });
    const drawings = Array.from({ length: 200_000 }, (_, i) => ({
      type: "horizontal", id: `saved-${i}`, price: i,
    }));
    try {
      expect(tools.load(JSON.stringify({ version: 2, drawings }))).toBe(true);
      const restored = tools.list();
      expect(restored).toHaveLength(drawings.length);
      expect(restored[0]).toEqual(drawings[0]);
      expect(restored.at(-1)).toEqual(drawings.at(-1));
      expect(tools.selection()).toBeNull();
      expect(tools.canUndo()).toBe(false);
      expect(tools.canRedo()).toBe(false);
      tools.clear();
      const next = tools.add({ type: "horizontal", price: -1 });
      expect(tools.undo()).toBe(true);
      expect(tools.redo()).toBe(true);
      expect(tools.list()).toEqual([next.read()]);
    } finally {
      model.plot.destroy();
    }
  });

  it("undoes and redoes a selected add without losing its handle", () => {
    const { tools } = mounted();
    const handle = tools.add(
      { type: "horizontal", price: 105 },
      { select: true },
    );

    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(false);
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
    expect(tools.selection()).toBeNull();

    expect(tools.redo()).toBe(true);
    expect(tools.list()).toEqual([handle.read()]);
    expect(tools.selection()).toEqual(handle.read());
  });

  it("restores a selected removal at the same stacking index", () => {
    const { tools } = mounted();
    const low = tools.add({ type: "horizontal", price: 101 });
    const middle = tools.add({ type: "horizontal", price: 105 });
    const high = tools.add({ type: "horizontal", price: 109 });
    tools.select(middle);

    middle.remove();
    expect(tools.selection()).toBeNull();
    expect(tools.list()).toEqual([low.read(), high.read()]);

    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([low.read(), middle.read(), high.read()]);
    expect(tools.selection()).toEqual(middle.read());

    expect(tools.redo()).toBe(true);
    expect(tools.list()).toEqual([low.read(), high.read()]);
    expect(tools.selection()).toBeNull();
  });

  it("replays an update onto the same drawing object", () => {
    const { tools } = mounted();
    const handle = tools.add({
      type: "fib",
      a: { x: 1, price: 101 },
      b: { x: 9, price: 109 },
      style: { color: "#f00" },
      levels: [0.5],
    });
    handle.update({
      b: { x: 8, price: 108 },
      style: undefined,
      levels: [1, 0.5],
    });
    const updated = handle.read();

    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({
      b: { x: 9, price: 109 },
      style: { color: "#f00" },
      levels: [0.5],
    });

    expect(tools.redo()).toBe(true);
    expect(handle.read()).toEqual(updated);
    tools.select(handle);
    expect(tools.selection()).toEqual(updated);
  });

  it("records one drag command when the pointer is released", () => {
    const { tools, route, onLine } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const history: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    tools.historyChanges.subscribe((change) => history.push(change));

    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });
    expect(history).toEqual([]);
    const moved = handle.read();

    route({
      type: "pointerup",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });
    expect(history).toEqual([{ canUndo: true, canRedo: false }]);

    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.redo()).toBe(true);
    expect(handle.read()).toEqual(moved);
  });

  it("does not record a pointer move that leaves the geometry unchanged", () => {
    const { tools, route, onLine } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    const history: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    tools.historyChanges.subscribe((change) => history.push(change));

    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({ type: "pointermove", point: grab, pointerId: 1 });
    route({ type: "pointerup", point: grab, pointerId: 1 });

    expect(history).toEqual([]);
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
  });

  it("cancels an unreleased drag without putting it in history", () => {
    const { tools, route, onLine } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });

    tools.cancel();
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
  });

  it("undoes a draft anchor before touching the command stack", () => {
    const { tools, route, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.begin("pitchfork");
    const first = at(2, 102);
    route({ type: "pointerdown", point: first, pointerId: 1 });
    route({ type: "pointerup", point: first, pointerId: 1 });

    expect(tools.undo()).toBe(true);
    expect(tools.mode()).toBe("pitchfork");
    expect(tools.list()).toHaveLength(1);
    expect(tools.canUndo()).toBe(true);

    // Armed has no in-flight gesture, so the next call reaches history.
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
    expect(tools.mode()).toBe("pitchfork");
  });

  it("reports and announces undo availability for an in-flight draft", () => {
    const { tools, route, at } = mounted();
    const history: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    tools.historyChanges.subscribe((change) => history.push(change));
    tools.begin("trend");
    const first = at(2, 102);

    route({ type: "pointerdown", point: first, pointerId: 1 });
    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(false);

    expect(tools.undo()).toBe(true);
    expect(tools.canUndo()).toBe(false);
    expect(history).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: false },
    ]);
  });

  it("hides redo while drafting and restores it when the draft is rewound", () => {
    const { tools, route, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.undo();
    const history: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    tools.historyChanges.subscribe((change) => history.push(change));
    tools.begin("trend");

    route({ type: "pointerdown", point: at(2, 102), pointerId: 1 });
    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(false);
    expect(tools.redo()).toBe(false);

    expect(tools.undo()).toBe(true);
    expect(tools.canUndo()).toBe(false);
    expect(tools.canRedo()).toBe(true);
    expect(tools.redo()).toBe(true);
    expect(history).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
      { canUndo: true, canRedo: false },
    ]);
  });

  it("reports drag cancellation as undoable while temporarily hiding redo", () => {
    const { tools, route, onLine } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.load(tools.serialize());
    tools.add({ type: "horizontal", price: 109 });
    tools.undo();
    const history: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    tools.historyChanges.subscribe((change) => history.push(change));
    const grab = onLine(105);

    route({ type: "pointerdown", point: grab, pointerId: 1 });
    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(false);
    expect(tools.redo()).toBe(false);

    expect(tools.undo()).toBe(true);
    expect(tools.canUndo()).toBe(false);
    expect(tools.canRedo()).toBe(true);
    expect(history).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
    ]);
  });

  it("treats clear and a successful load as history boundaries", () => {
    const { tools } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.clear();
    expect(tools.canUndo()).toBe(false);
    expect(tools.canRedo()).toBe(false);
    expect(tools.undo()).toBe(false);

    const kept = tools.add({ type: "horizontal", price: 109 });
    expect(tools.load("not drawings")).toBe(false);
    expect(tools.canUndo()).toBe(true);
    expect(tools.list()).toEqual([kept.read()]);

    expect(tools.load(tools.serialize())).toBe(true);
    expect(tools.canUndo()).toBe(false);
    expect(tools.canRedo()).toBe(false);
  });

  it("finishes stack movement before notifying a re-entrant subscriber", () => {
    const { tools } = mounted();
    tools.add({ type: "horizontal", price: 101 });
    tools.add({ type: "horizontal", price: 105 });
    const vias: string[] = [];
    tools.changes.subscribe(({ via }) => {
      vias.push(via);
      if (via === "undo") tools.add({ type: "horizontal", price: 109 });
    });

    expect(tools.undo()).toBe(true);
    expect(tools.list().map((drawing) => drawing.type === "horizontal" && drawing.price)).toEqual([
      101,
      109,
    ]);
    expect(tools.canRedo()).toBe(false);
    expect(tools.redo()).toBe(false);
    expect(vias).toEqual(["undo", "direct"]);
  });

  it("keeps at most one hundred committed commands", () => {
    const { tools } = mounted();
    for (let price = 1; price <= 101; price++) {
      tools.add({ type: "horizontal", price });
    }

    for (let count = 0; count < 100; count++) expect(tools.undo()).toBe(true);
    expect(tools.undo()).toBe(false);
    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 1 }]);
  });

  it("keeps history reads open after disposal but closes writes", () => {
    const { tools } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.dispose();

    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(false);
    expect(() => tools.undo()).toThrow();
    expect(() => tools.redo()).toThrow();
  });

  it("quietly restores an unreleased drag during disposal", () => {
    const { tools, route, onLine } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });

    tools.dispose();
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.canUndo()).toBe(true);
  });

  it("commits a drag before an external update as two ordered commands", () => {
    const { tools, route, onLine } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });
    const dragged = handle.read();

    handle.update({ price: 109 });
    expect(handle.read()).toMatchObject({ price: 109 });
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toEqual(dragged);
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
  });

  it("restores a drag quietly before clear crosses the history boundary", () => {
    const { tools, route, onLine } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });
    const reasons: string[] = [];
    tools.changes.subscribe(({ reason }) => reasons.push(reason));

    tools.clear();
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(reasons).toEqual(["clear"]);
    expect(tools.canUndo()).toBe(false);
  });

  it("does not replay redo through an in-flight draft", () => {
    const { tools, route, at } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.undo();
    tools.begin("trend");
    route({ type: "pointerdown", point: at(2, 102), pointerId: 1 });

    expect(tools.redo()).toBe(false);
    expect(tools.list()).toEqual([]);
    expect(tools.mode()).toBe("trend");
    expect(tools.canRedo()).toBe(false);
  });

  it("commits a drag before arming a new drawing tool", () => {
    const { tools, route, onLine } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });

    tools.begin("trend");
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.mode()).toBe("trend");
  });

  it("commits a drag before removing its drawing", () => {
    const { tools, route, onLine } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });
    const dragged = handle.read();

    handle.remove();
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toEqual(dragged);
    expect(tools.selection()).toEqual(dragged);
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
  });

  it("does not expose a half-finished drag-and-remove to history subscribers", () => {
    const { tools, route, onLine } = mounted();
    const low = tools.add({ type: "horizontal", price: 101 });
    const target = tools.add({ type: "horizontal", price: 105 });
    const grab = onLine(105);
    route({ type: "pointerdown", point: grab, pointerId: 1 });
    route({
      type: "pointermove",
      point: { x: grab.x, y: grab.y + 30 },
      pointerId: 1,
    });
    let nested = false;
    tools.historyChanges.subscribe(() => {
      if (nested) return;
      nested = true;
      low.remove();
    });

    target.remove();
    expect(tools.list()).toEqual([]);
  });

  it("a clear from inside the deselect notification lands after the removal, in order", () => {
    const { tools } = mounted();
    const handle = tools.add(
      { type: "horizontal", price: 105 },
      { select: true },
    );
    let crossedBoundary = false;
    tools.selectionChanges.subscribe(({ selection }) => {
      if (selection !== null || crossedBoundary) return;
      crossedBoundary = true;
      tools.clear();
    });
    const reasons: string[] = [];
    tools.changes.subscribe(({ reason }) => reasons.push(reason));

    handle.remove();

    // The subscriber's clear applied at once, but its notification lines
    // up behind the removal it interrupted — a mirror replays the same order.
    expect(tools.list()).toEqual([]);
    expect(reasons).toEqual(["remove", "clear"]);
    expect(tools.canUndo()).toBe(false);
    expect(tools.undo()).toBe(false);
  });

  it("a clear from inside the select notification lands after the add, in order", () => {
    const { tools } = mounted();
    let crossedBoundary = false;
    tools.selectionChanges.subscribe(({ selection }) => {
      if (selection === null || crossedBoundary) return;
      crossedBoundary = true;
      tools.clear();
    });
    const reasons: string[] = [];
    tools.changes.subscribe(({ reason }) => reasons.push(reason));

    tools.add({ type: "horizontal", price: 105 }, { select: true });

    expect(tools.list()).toEqual([]);
    expect(tools.selection()).toBeNull();
    expect(reasons).toEqual(["add", "clear"]);
    expect(tools.canUndo()).toBe(false);
    expect(tools.undo()).toBe(false);
  });

  it("a clear from inside the mode notification lands after the placement, in order", () => {
    const { tools, route, at } = mounted();
    let crossedBoundary = false;
    tools.modeChanges.subscribe(({ mode }) => {
      if (mode !== null || crossedBoundary) return;
      crossedBoundary = true;
      tools.clear();
    });
    tools.begin("horizontal");
    const point = at(5, 105);
    const reasons: string[] = [];
    tools.changes.subscribe(({ reason }) => reasons.push(reason));

    route({ type: "pointerdown", point, pointerId: 1 });
    route({ type: "pointerup", point, pointerId: 1 });

    expect(tools.list()).toEqual([]);
    expect(tools.selection()).toBeNull();
    expect(reasons).toEqual(["add", "clear"]);
    expect(tools.canUndo()).toBe(false);
    expect(tools.undo()).toBe(false);
  });

  it("an undo from inside the deselect notification replays after the removal it interrupted", () => {
    const { tools } = mounted();
    const handle = tools.add({ type: "horizontal", price: 105 }, { select: true });
    let nested = false;
    tools.selectionChanges.subscribe(({ selection }) => {
      if (selection !== null || nested) return;
      nested = true;
      tools.undo();
    });
    const seen: string[] = [];
    tools.changes.subscribe(({ reason, via }) => seen.push(`${reason}:${via}`));

    handle.remove();

    // The nested undo restored the drawing (same object, selection back),
    // and a mirror sees exactly what happened: removed, then put back.
    expect(tools.list()).toHaveLength(1);
    expect(handle.read()).toMatchObject({ type: "horizontal", price: 105 });
    expect(tools.selection()).toMatchObject({ price: 105 });
    expect(seen).toEqual(["remove:direct", "add:undo"]);
    // The original add is still undoable; the removal moved to redo.
    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(true);
  });

  it("passes an undo through the existing save echo guard", () => {
    const { tools } = mounted();
    const saved: string[] = [];
    tools.changes.subscribe(({ reason }) => {
      if (reason === "load" || reason === "clear") return;
      if (reason !== "move") saved.push(tools.serialize());
    });

    tools.add({ type: "horizontal", price: 105 });
    tools.undo();
    expect(saved).toHaveLength(2);
    expect(saved[1]).toBe(JSON.stringify({ version: 2, drawings: [] }));
  });
});
