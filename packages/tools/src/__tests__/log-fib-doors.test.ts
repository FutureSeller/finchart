/**
 * `levelSpacing` through the doors a consumer actually uses. The normalizer
 * runs **before** the predicate in `add` and `update`, so a test of the
 * predicate alone would pass while the door quietly dropped a typo — and with
 * it the `"log"` that was already there.
 */
import type { LineDataPoint } from "@finchart/core";
import { ContractError, createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { DrawingInput } from "../drawings";
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
    config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
  });
  return model.plot.mainPane.use(drawingTools({ plot: model.plot }));
}

const fib: DrawingInput = { type: "fib", a: { x: 1, price: 100 }, b: { x: 8, price: 120 } };
const extension: DrawingInput = {
  type: "fibExtension",
  a: { x: 1, price: 100 },
  b: { x: 4, price: 120 },
  c: { x: 8, price: 110 },
};

/** A value the type forbids, the way an untyped caller would hand it over. */
const untyped = (patch: Record<string, unknown>): Record<string, never> => JSON.parse(JSON.stringify(patch));

describe("levelSpacing through add", () => {
  it('takes "log" on both Fibonacci kinds', () => {
    const tools = mounted();
    expect(tools.add({ ...fib, levelSpacing: "log" }).read()).toMatchObject({ levelSpacing: "log" });
    expect(tools.add({ ...extension, levelSpacing: "log" }).read()).toMatchObject({ levelSpacing: "log" });
  });

  it("takes it with a price that is not positive — those levels are simply not drawn", () => {
    const tools = mounted();
    const handle = tools.add({ ...fib, a: { x: 1, price: -5 }, levelSpacing: "log" });
    expect(handle.read()).toMatchObject({ levelSpacing: "log", a: { price: -5 } });
  });

  it("throws on anything else, and adds nothing", () => {
    const tools = mounted();
    for (const value of ["linear", "LOG", 1, null]) {
      expect(() => tools.add({ ...fib, ...untyped({ levelSpacing: value }) })).toThrow(ContractError);
    }
    expect(tools.list()).toEqual([]);
  });

  it("drops it from a kind that has no levels — a foreign field, like any other", () => {
    const tools = mounted();
    const handle = tools.add({ type: "trend", a: { x: 1, price: 100 }, b: { x: 8, price: 120 }, ...untyped({ levelSpacing: "log" }) });
    expect(handle.read()).not.toHaveProperty("levelSpacing");
  });

  it("does not share the caller's object", () => {
    const tools = mounted();
    const levels = [0, 0.5, 1];
    const handle = tools.add({ ...fib, levelSpacing: "log", levels });
    levels.push(2);
    expect(handle.read()).toMatchObject({ levels: [0, 0.5, 1], levelSpacing: "log" });
  });
});

describe("levelSpacing through update", () => {
  it("switches on, and back off with undefined", () => {
    const tools = mounted();
    const handle = tools.add(fib);
    handle.update({ levelSpacing: "log" });
    expect(handle.read()).toMatchObject({ levelSpacing: "log" });
    handle.update({ levelSpacing: undefined });
    expect(handle.read()).not.toHaveProperty("levelSpacing");
  });

  it("throws on a typo and leaves the spacing that was there", () => {
    const tools = mounted();
    const handle = tools.add({ ...fib, levelSpacing: "log" });
    expect(() => handle.update(untyped({ levelSpacing: "LOG" }))).toThrow(ContractError);
    expect(handle.read()).toMatchObject({ levelSpacing: "log" });
  });

  it("throws when the kind has no such field — it is not dropped", () => {
    const tools = mounted();
    const handle = tools.add({ type: "trend", a: { x: 1, price: 100 }, b: { x: 8, price: 120 } });
    expect(() => handle.update(untyped({ levelSpacing: "log" }))).toThrow(ContractError);
  });
});

describe("levelSpacing through undo and redo", () => {
  it("is switched off by undo and back on by redo — for both kinds", () => {
    for (const input of [fib, extension]) {
      const tools = mounted();
      const handle = tools.add(input);
      handle.update({ levelSpacing: "log" });

      tools.undo();
      expect(handle.read()).not.toHaveProperty("levelSpacing");
      tools.redo();
      expect(handle.read()).toMatchObject({ levelSpacing: "log" });

      handle.update({ levelSpacing: undefined });
      tools.undo();
      expect(handle.read()).toMatchObject({ levelSpacing: "log" });
    }
  });
});
