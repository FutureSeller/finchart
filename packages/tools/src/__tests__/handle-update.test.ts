import type { LineDataPoint } from "@finchart/core";
import { ContractError, createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { DrawingsChange } from "../tools";
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
  const reasons: DrawingsChange["reason"][] = [];
  tools.changes.subscribe((change) => reasons.push(change.reason));
  const route = (
    type: "pointerdown" | "pointermove" | "pointerup",
    point: { x: number; y: number },
  ) => model.plot.routeInput({ type, point, pointerId: 1 });
  return { model, tools, pane, reasons, route };
}

describe("handle.update", () => {
  it("patches in place — every other door keeps working afterwards", () => {
    const { tools, reasons } = mounted();
    const handle = tools.add({ type: "horizontal", price: 100 });

    handle.update({ price: 120 });

    expect(handle.read()).toMatchObject({ type: "horizontal", price: 120 });
    expect(reasons).toEqual(["add", "update"]);
    // Identity survived: the same handle still selects and removes.
    tools.select(handle);
    expect(tools.selection()).toMatchObject({ price: 120 });
    handle.remove();
    expect(tools.list()).toEqual([]);
  });

  it("keeps the id — update never re-identifies a drawing", () => {
    const { tools } = mounted();
    const handle = tools.add({ type: "horizontal", price: 100 });
    const before = handle.read().id;
    handle.update({ price: 120 });
    expect(handle.read().id).toBe(before);
  });

  it("style: undefined is the way back to the theme", () => {
    const { tools } = mounted();
    const handle = tools.add({
      type: "horizontal",
      price: 100,
      style: { color: "#f00" },
    });
    handle.update({ style: undefined });
    expect(handle.read().style).toBeUndefined();
  });

  it("patches a trend anchor in place — the other anchor untouched, identity kept", () => {
    const { tools } = mounted();
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
    const { tools } = mounted();
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
    const { tools } = mounted();
    const handle = tools.add({
      type: "fib",
      a: { x: 0, price: 100 },
      b: { x: 10, price: 120 },
    });
    handle.update({ levels: [1, 0.5, 0.5] });
    expect(handle.read()).toMatchObject({ levels: [0.5, 1] });
  });

  it("refuses a field the kind doesn't own", () => {
    const { tools } = mounted();
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
    const { tools } = mounted();
    const handle = tools.add({ type: "horizontal", price: 100 });
    expect(() => handle.update({ type: "trend" } as never)).toThrow(
      ContractError,
    );
    expect(() => handle.update({ id: "other" } as never)).toThrow(
      ContractError,
    );
  });

  it("an empty patch does nothing and announces nothing", () => {
    const { tools, reasons } = mounted();
    const handle = tools.add({ type: "horizontal", price: 100 });
    handle.update({});
    expect(reasons).toEqual(["add"]);
  });

  it("an unfit patch throws and leaves the drawing untouched", () => {
    const { tools, reasons } = mounted();
    const handle = tools.add({ type: "horizontal", price: 100 });
    expect(() => handle.update({ price: Number.NaN })).toThrow(ContractError);
    expect(handle.read()).toMatchObject({ price: 100 });
    expect(reasons).toEqual(["add"]);
  });

  it("throws on a removed drawing's handle", () => {
    const { tools } = mounted();
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
    const { model, tools, pane, route } = mounted();
    const handle = tools.add({ type: "horizontal", price: 110 });

    const grabX = (pane.area.left + pane.area.right) / 2;
    const yOf = (price: number) => pane.yScale.scale(price);
    expect(route("pointerdown", { x: grabX, y: yOf(110) })).toBe(true);
    route("pointermove", { x: grabX, y: yOf(115) });

    handle.update({ price: 130 });
    expect(handle.read()).toMatchObject({ price: 130 });

    // The gesture ended: further movement no longer drags the line...
    route("pointermove", { x: grabX, y: yOf(100) });
    expect(handle.read()).toMatchObject({ price: 130 });
    // ...and Esc can't restore the pre-patch position either.
    model.plot.routeInput({ type: "keydown", key: "Escape" });
    expect(handle.read()).toMatchObject({ price: 130 });
  });
});
