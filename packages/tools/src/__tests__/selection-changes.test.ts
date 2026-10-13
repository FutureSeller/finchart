/**
 * Notifies whenever the selection changes. Selection changes through
 * six different paths, so an app hand-assembling `modeChanges + changes
 * + plot.on("click")` gets it wrong -- `]`, `[`, and Escape live inside
 * the plugin, and an app has no way to hook them.
 *
 * The notification carries the handle. `selection()` returns a copy, so
 * the only way an app can recover the handle is by value comparison --
 * but if two shapes share the same value, hit-testing and value
 * comparison can point at different ones, and a line the user never
 * touched could get deleted.
 */
import type { LineDataPoint } from "@finchart/core";
import { ContractError, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { DrawingHandle, DrawingToolsApi } from "../tools";
import { drawingChart, record } from "./drawing-chart.fixture";

const data: LineDataPoint[] = Array.from({ length: 20 }, (_, i) => ({
  x: i,
  y: 100 + i,
}));
const series = () => ({ series: lineSeries(), data });

describe("selection notifications -- all six paths", () => {
  it("notifies on a pointer hit", () => {
    const { tools, onLine, click } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    tools.add({ type: "horizontal", price: 110 });

    click(onLine(110));

    expect(seen).toHaveLength(1);
    expect(seen[0].selection).toMatchObject({ type: "horizontal", price: 110 });
  });

  it("notifies on a double-click -- this is the reason this door exists", () => {
    const { tools, onLine, dblclick } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    tools.add({ type: "horizontal", price: 110 });

    dblclick(onLine(110));

    expect(seen).toHaveLength(1);
    expect(seen[0].selection).not.toBeNull();
  });

  it("notifies on a right-click", () => {
    const { tools, route, onLine } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    tools.add({ type: "horizontal", price: 110 });

    const { px, py } = onLine(110);
    route({ type: "contextmenu", point: { x: px, y: py } });

    expect(seen).toHaveLength(1);
  });

  it("notifies on keyboard traversal -- the spot an app couldn't hook", () => {
    const { tools, key } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    tools.add({ type: "horizontal", price: 110 });
    tools.add({ type: "horizontal", price: 105 });

    key("]");
    key("]");

    expect(seen.map((c) => c.selection)).toMatchObject([
      { type: "horizontal", price: 110 },
      { type: "horizontal", price: 105 },
    ]);
  });

  it("notifies on select() and on deselect", () => {
    const { tools } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    const handle = tools.add({ type: "horizontal", price: 110 });

    tools.select(handle);
    tools.select(null);

    expect(seen.map((c) => c.selection === null)).toEqual([false, true]);
  });

  const deselectPaths: Array<[string, (tools: DrawingToolsApi, handle: DrawingHandle) => void]> = [
    ["remove", (_tools, handle) => handle.remove()],
    ["clear", (tools) => tools.clear()],
    ["load", (tools) => expect(tools.load(tools.serialize())).toBe(true)],
  ];
  it.each(deselectPaths)("notifies deselect on %s", (_path, act) => {
    const { tools } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    const handle = tools.add({ type: "horizontal", price: 110 });
    tools.select(handle);
    seen.length = 0;

    act(tools, handle);

    expect(seen).toHaveLength(1);
    expect(seen[0].selection).toBeNull();
  });

  it("stays quiet when re-picking the same thing", () => {
    const { tools, onLine, click } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    tools.add({ type: "horizontal", price: 110 });

    click(onLine(110));
    click(onLine(110));

    expect(seen).toHaveLength(1);
  });

  it("disposal is quiet -- a toolbox being torn down must not fire a final notification", () => {
    const { tools } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    const handle = tools.add({ type: "horizontal", price: 110 });
    tools.select(handle);
    seen.length = 0;

    tools.dispose();

    expect(seen).toEqual([]);
  });
});

describe("the notification carries identity", () => {
  it("with two equal values, the handle for **the one the cursor actually pointed at** comes through", () => {
    const { tools, onLine, click } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    // Two with the same value -- value comparison alone cannot tell them apart.
    tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 105 });
    const handles = tools.handles();

    // The one drawn on top (the later one) gets grabbed -- `gripAt`'s contract.
    click(onLine(105));
    const picked = seen[0].handle;
    expect(picked).not.toBeNull();

    picked?.remove();

    // Confirm by identity that the one removed was **the later one**: the
    // earlier one can still be selected, and the later one cannot.
    // Under value comparison, the earlier one would have been removed
    // instead.
    expect(tools.list()).toHaveLength(1);
    expect(() => tools.select(handles[0])).not.toThrow();
    expect(() => tools.select(handles[1])).toThrow(ContractError);
  });

  it("on deselect, the handle is null too", () => {
    const { tools } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);
    const handle = tools.add({ type: "horizontal", price: 110 });
    tools.select(handle);
    tools.select(null);

    expect(seen[1].handle).toBeNull();
  });
});

describe("add(drawing, { select })", () => {
  it("defaults to not selecting -- a programmatic add is not user intent", () => {
    const { tools } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);

    tools.add({ type: "horizontal", price: 110 });

    expect(seen).toEqual([]);
    expect(tools.selection()).toBeNull();
  });

  it("with select: true, it ends up in the same state as something drawn by hand", () => {
    const { tools } = drawingChart({ series: series() });
    const seen = record(tools.selectionChanges);

    tools.add({ type: "horizontal", price: 110 }, { select: true });

    expect(seen).toHaveLength(1);
    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 110 });
  });

  it("not stealing an in-progress edit's selection is why this is the default", () => {
    const { tools, onLine, click } = drawingChart({ series: series() });
    tools.add({ type: "horizontal", price: 110 });
    click(onLine(110));

    // As if a server push just arrived -- the user is mid-edit on 110.
    tools.add({ type: "horizontal", price: 90 });

    expect(tools.selection()).toMatchObject({ type: "horizontal", price: 110 });
  });

  it("the options are a door too -- rejects anything that isn't the right shape", () => {
    const { tools } = drawingChart({ series: series() });

    expect(() =>
      tools.add({ type: "horizontal", price: 110 }, { select: "yes" } as never),
    ).toThrow(ContractError);
    expect(() =>
      tools.add({ type: "horizontal", price: 110 }, "yes" as never),
    ).toThrow(ContractError);
  });
});
