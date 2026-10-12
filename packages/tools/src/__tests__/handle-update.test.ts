import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingChart, record } from "./drawing-chart.fixture";

describe("handle.update", () => {
  it("patches in place — every other door keeps working afterwards", () => {
    const { tools } = drawingChart();
    const changes = record(tools.changes);
    const handle = tools.add({ type: "horizontal", price: 100 });

    handle.update({ price: 120 });

    expect(handle.read()).toMatchObject({ type: "horizontal", price: 120 });
    expect(changes.map(({ reason }) => reason)).toEqual(["add", "update"]);
    // Identity survived: the same handle still selects and removes.
    tools.select(handle);
    expect(tools.selection()).toMatchObject({ price: 120 });
    handle.remove();
    expect(tools.list()).toEqual([]);
  });

  it("keeps the id — update never re-identifies a drawing", () => {
    const { tools } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 100 });
    const before = handle.read().id;
    handle.update({ price: 120 });
    expect(handle.read().id).toBe(before);
  });

  it("style: undefined is the way back to the theme", () => {
    const { tools } = drawingChart();
    const handle = tools.add({
      type: "horizontal",
      price: 100,
      style: { color: "#f00" },
    });
    handle.update({ style: undefined });
    expect(handle.read().style).toBeUndefined();
  });

  it("patches a trend anchor in place — the other anchor untouched, identity kept", () => {
    const { tools } = drawingChart();
    const handle = tools.add({
      type: "trend",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
    });

    handle.update({ a: { x: 2, price: 105 } });

    expect(handle.read()).toMatchObject({
      a: { x: 2, price: 105 },
      b: { x: 10, price: 120 },
    });
    // The anchor was mutated in place, not swapped — the same handle
    // still drives selection (identity is the plugin's backbone).
    tools.select(handle);
    expect(tools.selection()).toMatchObject({ a: { x: 2, price: 105 } });
  });

  it("levels: undefined reverts a fib to the conventional seven", () => {
    const { tools } = drawingChart();
    const handle = tools.add({
      type: "fib",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
      levels: [0.5],
    });
    handle.update({ levels: undefined });
    expect(handle.read().type).toBe("fib");
    expect(handle.read()).not.toHaveProperty("levels");
  });

  it("patches fib levels through the normalizer", () => {
    const { tools } = drawingChart();
    const handle = tools.add({
      type: "fib",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
    });
    handle.update({ levels: [1, 0.5, 0.5] });
    expect(handle.read()).toMatchObject({ levels: [0.5, 1] });
  });

  it("refuses a field the kind doesn't own", () => {
    const { tools } = drawingChart();
    const handle = tools.add({
      type: "trend",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
    });
    expect(() => handle.update({ levels: [0.5] } as never)).toThrow(
      ContractError,
    );
  });

  it("refuses to patch type or id", () => {
    const { tools } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 100 });
    expect(() => handle.update({ type: "trend" } as never)).toThrow(
      ContractError,
    );
    expect(() => handle.update({ id: "other" } as never)).toThrow(
      ContractError,
    );
  });

  it("an empty patch does nothing and announces nothing", () => {
    const { tools } = drawingChart();
    const changes = record(tools.changes);
    const handle = tools.add({ type: "horizontal", price: 100 });
    handle.update({});
    expect(changes.map(({ reason }) => reason)).toEqual(["add"]);
  });

  it("an unfit patch throws and leaves the drawing untouched", () => {
    const { tools } = drawingChart();
    const changes = record(tools.changes);
    const handle = tools.add({ type: "horizontal", price: 100 });
    expect(() => handle.update({ price: Number.NaN })).toThrow(ContractError);
    expect(handle.read()).toMatchObject({ price: 100 });
    expect(changes.map(({ reason }) => reason)).toEqual(["add"]);
  });

  it("throws on a removed drawing's handle", () => {
    const { tools } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 100 });
    handle.remove();
    expect(() => handle.update({ price: 120 })).toThrow(ContractError);
  });

  /**
   * An outside change ends an in-flight gesture — the removeOne rule.
   * Committed, not restored: the next pointermove must not overwrite the
   * patch, and Esc must not resurrect the pre-patch position.
   */
  it("commits a mid-drag gesture, then applies — and the drag is over", () => {
    const { tools, press, key, onLine } = drawingChart();
    const handle = tools.add({ type: "horizontal", price: 110 });

    const gesture = press(onLine(110));
    expect(gesture.down).toBe(true);
    gesture.moveTo(onLine(115));

    handle.update({ price: 130 });
    expect(handle.read()).toMatchObject({ price: 130 });

    // The gesture ended: further movement no longer drags the line...
    gesture.moveTo(onLine(100));
    expect(handle.read()).toMatchObject({ price: 130 });
    // ...and Esc can't restore the pre-patch position either.
    key("Escape");
    expect(handle.read()).toMatchObject({ price: 130 });
  });
});
