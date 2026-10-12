/**
 * **The extension notifies.** There used to be no channel for this, so
 * the only place an example could save a drawing was a button click --
 * the result of a drag would vanish on refresh.
 */
import { describe, expect, it, vi } from "vitest";
import { lineSeries } from "@finchart/core";
import { drawingChart, record } from "./drawing-chart.fixture";

const mount = () =>
  drawingChart({
    series: {
      series: lineSeries(),
      data: [
        { x: 0, y: 10 },
        { x: 100, y: 20 },
      ],
    },
  });

describe("drawingTools.changes", () => {
  it("should say why the list changed", () => {
    const { tools } = mount();
    const changes = record(tools.changes);

    const handle = tools.add({ type: "horizontal", price: 15 });
    handle.remove();
    tools.add({ type: "horizontal", price: 12 });
    tools.clear();

    expect(changes.map(({ reason }) => reason)).toEqual(["add", "remove", "add", "clear"]);
  });

  it("should report a load", () => {
    const { tools } = mount();
    const payload = (() => {
      tools.add({ type: "horizontal", price: 15 });
      return tools.serialize();
    })();
    tools.clear();

    const changes = record(tools.changes);

    expect(tools.load(payload)).toBe(true);
    expect(changes.map(({ reason }) => reason)).toEqual(["load"]);
  });

  it("should not report a load that was refused", () => {
    const { tools } = mount();
    const listener = vi.fn();
    tools.changes.subscribe(listener);

    expect(tools.load("not json")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("should report a drag as move", () => {
    const { plot, pane, tools, drag } = mount();

    const price = pane.valueAt((pane.area.top + pane.area.bottom) / 2);
    tools.add({ type: "horizontal", price });
    plot.render();
    const changes = record(tools.changes);

    const y = pane.pixelAtValue(price);

    drag({ px: 300, py: y }, { px: 300, py: y + 20 });

    // This is why this channel exists -- a drag never goes through any
    // explicit call.
    expect(changes.map(({ reason }) => reason)).toEqual(["move"]);
  });
});

describe("drawingTools.applyOptions", () => {
  it("should restyle without losing the drawings", () => {
    const { model, plot, tools } = mount();
    tools.add({ type: "horizontal", price: 15 });

    tools.applyOptions({ style: { color: "#00ff00", width: 3 } });
    plot.render();

    // If it had been rebuilt from scratch, the list would be empty.
    expect(tools.list()).toHaveLength(1);
    const drawn = model
      .commands()
      .filter((command) => command.type === "drawLine");
    expect(drawn.some((command) => command.style.color === "#00ff00")).toBe(
      true,
    );
  });

  /** `{ style: undefined }` resets to the default — different from leaving the key out. */
  it("should keep a style override when the key is left out and drop it when given as undefined", () => {
    const { model, tools } = mount();
    tools.add({ type: "horizontal", price: 15 });
    const colors = () =>
      model
        .commands()
        .flatMap((command) => (command.type === "drawLine" ? [command.style.color] : []));
    const defaults = colors();

    tools.applyOptions({ style: { color: "#00ff00" } });
    tools.applyOptions({});
    expect(colors()).toContain("#00ff00");

    tools.applyOptions({ style: undefined });
    expect(colors()).toEqual(defaults);
  });
});

describe("a disposed toolbox", () => {
  it("should refuse to be used after dispose", () => {
    const { tools } = mount();
    tools.dispose();

    expect(tools.disposed).toBe(true);
    // Silent success would let a list grow that never gets drawn anywhere.
    expect(() => tools.add({ type: "horizontal", price: 1 })).toThrow();
    expect(() => tools.clear()).toThrow();
    expect(() => tools.cancel()).toThrow();
    // Reads are not blocked -- saving the last state is a normal path.
    expect(() => tools.serialize()).not.toThrow();
  });
});

/**
 * Does the door that swaps out the list also cut an in-progress gesture?
 * If `clear` and `load` only empty `selected` and leave `state` behind,
 * a half-drawn shape survives common flows like a "clear all" button or
 * switching symbols.
 */
describe("replacing the list cuts an in-progress gesture", () => {
  it("should cancel an in-flight placement on clear", () => {
    const { tools, click } = mount();
    tools.begin("trend");
    expect(tools.mode()).toBe("trend");

    tools.clear();

    expect(tools.mode()).toBe(null);
    // The next click must not draw a line on the canvas that was just cleared.
    click({ px: 120, py: 120 });
    expect(tools.list()).toHaveLength(0);
  });

  it("should cancel an in-flight placement on load", () => {
    const { tools } = mount();
    const payload = tools.serialize();
    tools.begin("horizontal");

    expect(tools.load(payload)).toBe(true);
    expect(tools.mode()).toBe(null);
  });

  it("should keep the list when load fails, and not cancel either", () => {
    const { tools } = mount();
    tools.begin("trend");

    expect(tools.load("unreadable string")).toBe(false);
    // If it can't be read, nothing gets cut -- the same spot that
    // protects the existing list.
    expect(tools.mode()).toBe("trend");
  });

  it("should refuse handle.remove() on a disposed toolbox", () => {
    const { tools } = mount();
    const handle = tools.add({ type: "horizontal", price: 105 });
    tools.dispose();

    // select throws while remove quietly succeeded -- two doors on the
    // same handle.
    expect(() => tools.select(handle)).toThrow();
    expect(() => handle.remove()).toThrow();
    // Reads remain open (this is the path for saving the last state on
    // unmount).
    expect(handle.read()).toMatchObject({ type: "horizontal", price: 105 });
  });
});

/**
 * The guard is part of the recipe -- if the subscription example fed
 * saves back without the guard, `load` and `clear` notifications would
 * immediately re-write the source or normalized copy just read,
 * overwriting the edit.
 */
describe("the echo guard in the save recipe", () => {
  it("load and clear notifications do not call save, but edits do", () => {
    const { tools } = mount();
    const saves: string[] = [];
    tools.changes.subscribe(({ reason }) => {
      if (reason === "load" || reason === "clear") return;
      saves.push(tools.serialize());
    });

    tools.add({ type: "horizontal", price: 105 });
    const stored = tools.serialize();
    expect(saves).toHaveLength(1); // add -- a user edit

    tools.clear();
    tools.load(stored);
    expect(saves).toHaveLength(1); // two echoes -- no save

    tools.add({ type: "horizontal", price: 110 });
    expect(saves).toHaveLength(2);
  });
});
