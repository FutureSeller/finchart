import { createPlotModel, manualScheduler } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";
import { drawingChart, record } from "./drawing-chart.fixture";

describe("drawingTools history", () => {
  it.skipIf(process.env.FINCHART_SKIP_STRESS === "1")("replaces a large saved document without an argument-limit failure or stale history", { timeout: 30_000 }, () => {
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
    const { tools } = drawingChart();
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

  it("redoes an unselected add without moving the selection", () => {
    const { tools } = drawingChart();
    const picked = tools.add({ type: "horizontal", price: 101 }, { select: true });
    tools.add({ type: "horizontal", price: 105 });

    expect(tools.undo()).toBe(true);
    expect(tools.redo()).toBe(true);
    expect(tools.list()).toHaveLength(2);
    expect(tools.selection()).toEqual(picked.read());
  });

  it("restores a selected removal at the same stacking index", () => {
    const { tools } = drawingChart();
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
    const { tools } = drawingChart();
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
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    const history = record(tools.historyChanges);

    const gesture = press(onLine(105));
    gesture.moveTo(onLine(105, 30));
    expect(history).toEqual([]);
    const moved = handle.read();

    gesture.release();
    expect(history).toEqual([{ canUndo: true, canRedo: false }]);

    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.redo()).toBe(true);
    expect(handle.read()).toEqual(moved);
  });

  it("does not record a pointer move that leaves the geometry unchanged", () => {
    const { tools, drag, onLine } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    const history = record(tools.historyChanges);

    const grab = onLine(105);
    drag(grab, grab);

    expect(history).toEqual([]);
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
  });

  it("cancels an unreleased drag without putting it in history", () => {
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));

    tools.cancel();
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
  });

  it("undoes a draft anchor before touching the command stack", () => {
    const { tools, click } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    tools.begin("pitchfork");
    click({ x: 2, price: 102 });

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
    const { tools, press } = drawingChart();
    const history = record(tools.historyChanges);
    tools.begin("trend");

    press({ x: 2, price: 102 });
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
    const { tools, press } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    tools.undo();
    const history = record(tools.historyChanges);
    tools.begin("trend");

    press({ x: 2, price: 102 });
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
    const { tools, press, onLine } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    tools.load(tools.serialize());
    tools.add({ type: "horizontal", price: 109 });
    tools.undo();
    const history = record(tools.historyChanges);

    press(onLine(105));
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
    const { tools } = drawingChart();
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
    const { tools } = drawingChart();
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
    const { tools } = drawingChart();
    for (let price = 1; price <= 101; price++) {
      tools.add({ type: "horizontal", price });
    }

    for (let count = 0; count < 100; count++) expect(tools.undo()).toBe(true);
    expect(tools.undo()).toBe(false);
    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 1 }]);
  });

  it("keeps history reads open after disposal but closes writes", () => {
    const { tools } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    tools.dispose();

    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(false);
    expect(() => tools.undo()).toThrow();
    expect(() => tools.redo()).toThrow();
  });

  it("quietly restores an unreleased drag during disposal", () => {
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));

    tools.dispose();
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.canUndo()).toBe(true);
  });

  it("commits a drag before an external update as two ordered commands", () => {
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));
    const dragged = handle.read();

    handle.update({ price: 109 });
    expect(handle.read()).toMatchObject({ price: 109 });
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toEqual(dragged);
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
  });

  it("restores a drag quietly before clear crosses the history boundary", () => {
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));
    const changes = record(tools.changes);

    tools.clear();
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(changes.map(({ reason }) => reason)).toEqual(["clear"]);
    expect(tools.canUndo()).toBe(false);
  });

  it("does not replay redo through an in-flight draft", () => {
    const { tools, press } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    tools.undo();
    tools.begin("trend");
    press({ x: 2, price: 102 });

    expect(tools.redo()).toBe(false);
    expect(tools.list()).toEqual([]);
    expect(tools.mode()).toBe("trend");
    expect(tools.canRedo()).toBe(false);
  });

  it("commits a drag before arming a new drawing tool", () => {
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));

    tools.begin("trend");
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
    expect(tools.mode()).toBe("trend");
  });

  it("keeps the dragged position when a new tool is armed mid-drag", () => {
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));
    const dragged = handle.read();

    tools.begin("trend");
    expect(handle.read()).toEqual(dragged);
    expect(dragged).not.toMatchObject({ price: 105 });
  });

  it("commits a drag before removing its drawing", () => {
    const { tools, press, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));
    const dragged = handle.read();

    handle.remove();
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toEqual(dragged);
    expect(tools.selection()).toEqual(dragged);
    expect(tools.undo()).toBe(true);
    expect(handle.read()).toMatchObject({ price: 105 });
  });

  it("does not expose a half-finished drag-and-remove to history subscribers", () => {
    const { tools, press, onLine } = drawingChart();
    const low = tools.add({ type: "horizontal", price: 101 });
    const target = tools.add({ type: "horizontal", price: 105 });
    press(onLine(105)).moveTo(onLine(105, 30));
    const lowDrawing = low.read();
    const seen: unknown[][] = [];
    let nested = false;
    tools.historyChanges.subscribe(() => {
      seen.push(tools.list());
      if (nested) return;
      nested = true;
      low.remove();
    });

    target.remove();
    // One notification per removal, and the first already sees the target
    // gone: the drag's commit and the removal land as one step, never the
    // commit on its own.
    expect(seen).toEqual([[lowDrawing], []]);
    expect(tools.list()).toEqual([]);
  });

  it("a clear from inside the deselect notification lands after the removal, in order", () => {
    const { tools } = drawingChart();
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
    const changes = record(tools.changes);

    handle.remove();

    // The subscriber's clear applied at once, but its notification lines
    // up behind the removal it interrupted — a mirror replays the same order.
    expect(tools.list()).toEqual([]);
    expect(changes.map(({ reason }) => reason)).toEqual(["remove", "clear"]);
    expect(tools.canUndo()).toBe(false);
    expect(tools.undo()).toBe(false);
  });

  it("a clear from inside the select notification lands after the add, in order", () => {
    const { tools } = drawingChart();
    let crossedBoundary = false;
    tools.selectionChanges.subscribe(({ selection }) => {
      if (selection === null || crossedBoundary) return;
      crossedBoundary = true;
      tools.clear();
    });
    const changes = record(tools.changes);

    tools.add({ type: "horizontal", price: 105 }, { select: true });

    expect(tools.list()).toEqual([]);
    expect(tools.selection()).toBeNull();
    expect(changes.map(({ reason }) => reason)).toEqual(["add", "clear"]);
    expect(tools.canUndo()).toBe(false);
    expect(tools.undo()).toBe(false);
  });

  it("a clear from inside the mode notification lands after the placement, in order", () => {
    const { tools, click } = drawingChart();
    let crossedBoundary = false;
    tools.modeChanges.subscribe(({ mode }) => {
      if (mode !== null || crossedBoundary) return;
      crossedBoundary = true;
      tools.clear();
    });
    tools.begin("horizontal");
    const changes = record(tools.changes);

    click({ x: 5, price: 105 });

    expect(tools.list()).toEqual([]);
    expect(tools.selection()).toBeNull();
    expect(changes.map(({ reason }) => reason)).toEqual(["add", "clear"]);
    expect(tools.canUndo()).toBe(false);
    expect(tools.undo()).toBe(false);
  });

  it("an undo from inside the deselect notification replays after the removal it interrupted", () => {
    const { tools } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 }, { select: true });
    let nested = false;
    tools.selectionChanges.subscribe(({ selection }) => {
      if (selection !== null || nested) return;
      nested = true;
      tools.undo();
    });
    const changes = record(tools.changes);

    handle.remove();

    // The nested undo restored the drawing (same object, selection back),
    // and a mirror sees exactly what happened: removed, then put back.
    expect(tools.list()).toHaveLength(1);
    expect(handle.read()).toMatchObject({ type: "horizontal", price: 105 });
    expect(tools.selection()).toMatchObject({ price: 105 });
    expect(changes.map(({ reason, via }) => `${reason}:${via}`)).toEqual(["remove:direct", "add:undo"]);
    // The original add is still undoable; the removal moved to redo.
    expect(tools.canUndo()).toBe(true);
    expect(tools.canRedo()).toBe(true);
  });

  it("passes an undo through the existing save echo guard", () => {
    const { tools } = drawingChart();
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
