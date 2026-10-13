import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingChart, record } from "./drawing-chart.fixture";

describe("drawingTools selection", () => {
  it("should select what was grabbed and expose a copy", () => {
    const { tools, onLine, click } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    expect(tools.selection()).toBeNull();
    click(onLine(110));

    const picked = tools.selection();
    expect(picked).toMatchObject({ type: "horizontal", price: 110 });
    // It's a copy -- mutating it outside has no effect on the stage.
    (picked as { price: number }).price = 50;
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 110 });
  });

  it("should deselect on a press in empty space without eating it", () => {
    const { tools, onLine, press, click } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });
    click(onLine(110));

    const empty = onLine(110, 40);
    // A press in empty space is not consumed -- pan must still be free
    // to start.
    expect(press(empty).down).toBe(false);
    expect(tools.selection()).toBeNull();
  });

  it("should delete the selected drawing with Delete", () => {
    const { tools, onLine, click, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });
    const changes = record(tools.changes);

    click(onLine(110));
    expect(key("Delete")).toBe(true);

    expect(tools.list()).toHaveLength(0);
    expect(tools.selection()).toBeNull();
    expect(changes.map(({ reason }) => reason)).toEqual(["remove"]);
  });

  it("should treat Backspace like Delete", () => {
    const { tools, onLine, click, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    click(onLine(110));
    expect(key("Backspace")).toBe(true);

    expect(tools.list()).toHaveLength(0);
  });

  it("should decline Delete when nothing is selected", () => {
    const { tools, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    expect(key("Delete")).toBe(false);
    expect(tools.list()).toHaveLength(1);
  });

  it("should release the selection with Escape", () => {
    const { tools, onLine, click, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });
    click(onLine(110));

    expect(key("Escape")).toBe(true);
    expect(tools.selection()).toBeNull();
    // Declines when there's nothing to release -- so a consumer below
    // can use it.
    expect(key("Escape")).toBe(false);
  });

  /**
   * Cancel is undo -- the docs sell the contract as "cancel," but simply
   * resetting the state back to idle would leave the value that had
   * already slid in place (no undo).
   */
  it("should undo the drag on Escape, not commit it", () => {
    const { tools, onLine, press, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    press(onLine(110)).moveTo(onLine(110, 40));
    // It has already moved by this point -- cancel has something to undo.
    expect(tools.list()[0]).not.toMatchObject({ type: "horizontal", price: 110 });

    expect(key("Escape")).toBe(true);
    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 110 }]);
  });

  it("should tell the consumer that the drag was undone", () => {
    const { tools, onLine, press, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    const seen = record(tools.changes);

    press(onLine(110)).moveTo(onLine(110, 40));
    // The drag itself already reported "move", so only the count after
    // Escape shows whether the undo was announced too.
    const beforeEscape = seen.length;
    key("Escape");

    // A consumer only finds out by reading `list()` again, so this must
    // still fire once more after the undo -- otherwise the save side
    // (a debounced autosave) is left holding the stale value.
    expect(seen.slice(beforeEscape).map(({ reason }) => reason)).toEqual(["move"]);
  });

  /** A drag that never moved has nothing to undo -- no notification either. */
  it("should stay quiet when the drag never moved", () => {
    const { tools, onLine, press, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    const seen = record(tools.changes);

    press(onLine(110));
    key("Escape");

    expect(seen).toEqual([]);
  });

  /**
   * A cancel is not a release -- this is the spot where tablet palm
   * rejection, an OS gesture, or a scroll takeover reclaims the pointer.
   * Folding this into `pointerup` handling would commit a half-dragged
   * shape even though the user never lifted a finger.
   */
  it("should undo the drag when the system cancels the pointer", () => {
    const { tools, route, onLine, press } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    const moved = onLine(110, 40);
    press(onLine(110)).moveTo(moved);
    route({
      type: "pointercancel",
      point: { x: moved.px, y: moved.py },
      pointerId: 1,
    });

    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 110 }]);
  });

  /** A release still commits -- only a cancel undoes it. */
  it("should still commit the drag on pointerup", () => {
    const { tools, onLine, drag } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    drag(onLine(110), onLine(110, 40));

    expect(tools.list()[0]).not.toMatchObject({ type: "horizontal", price: 110 });
  });

  it("should end a drag with Escape but keep the selection", () => {
    const { tools, onLine, press, key } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });

    const gesture = press(onLine(110));
    expect(key("Escape")).toBe(true);
    // The drag is over -- subsequent movement cannot move the drawing.
    gesture.moveTo(onLine(110, 40));
    gesture.release();

    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 110 }]);
    expect(tools.selection()).not.toBeNull();
  });

  it("should drop the selection when the list is replaced", () => {
    const { tools, onLine, click } = drawingChart();
    tools.add({ type: "horizontal", price: 110 });
    click(onLine(110));
    const payload = tools.serialize();

    tools.load(payload);
    expect(tools.selection()).toBeNull();

    click(onLine(110));
    expect(tools.selection()).not.toBeNull();
    tools.clear();
    expect(tools.selection()).toBeNull();
  });
});

describe("drawingTools select and keyboard traversal", () => {
  it("should open selection to programs through the handle", () => {
    const { tools } = drawingChart();
    const low = tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 115 });

    tools.select(low);
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 105 });

    tools.select(null);
    expect(tools.selection()).toBeNull();
  });

  it("should refuse to select a removed drawing", () => {
    const { tools } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 105 });
    handle.remove();

    expect(() => tools.select(handle)).toThrow(ContractError);
  });

  it("should reach Delete with the keyboard alone", () => {
    const { tools, key } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 115 });

    // ] grabs the first drawing initially, and the next one on repeat
    // presses. [ goes the other way.
    expect(key("]")).toBe(true);
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 105 });
    key("]");
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 115 });
    // Wraps around at the end.
    key("]");
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 105 });
    key("[");
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 115 });

    // Completes the pointer-free editing flow -- grab by traversal,
    // delete with Delete.
    key("Delete");
    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 105 }]);
  });

  it("should start [ from the last drawing when nothing is selected", () => {
    const { tools, key } = drawingChart();
    tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 110 });
    tools.add({ type: "horizontal", price: 115 });

    expect(key("[")).toBe(true);
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 115 });
  });

  it("should keep the selection when a different drawing is removed", () => {
    const { tools } = drawingChart();
    const kept = tools.add({ type: "horizontal", price: 105 }, { select: true });
    const other = tools.add({ type: "horizontal", price: 115 });

    other.remove();
    expect(tools.selection()).toEqual(kept.read());
  });

  it("should not eat the bracket keys when there is nothing to select", () => {
    const { tools, key } = drawingChart();
    expect(key("]")).toBe(false);
    expect(tools.selection()).toBeNull();
  });
});
