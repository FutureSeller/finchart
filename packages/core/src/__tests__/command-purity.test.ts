/**
 * Draw commands stay pure data. Because a command is plain data, it can be
 * replayed against another surface, sent to a worker, or asserted on
 * directly — the moment convenience sneaks in a single function or DOM
 * reference, all three of those uses break at once.
 */
import { describe, expect, it } from "vitest";
import type { OHLC } from "../data";
import { crosshair } from "../extensions";
import { testBrowserDeps } from "./dom-fakes";
import { defaultConfig, mountPlot } from "../plot/__tests__/helpers";
import { CanvasRenderer } from "../render";
import type { DrawCommand } from "../render";
import { candleSeries } from "../series";
import { fakeCanvasContext } from "./dom-fakes";

/** A single spot that isn't pure. */
interface Impurity {
  path: string;
  what: string;
}

const PLAIN_PROTOTYPES: unknown[] = [Object.prototype, Array.prototype, null];

/**
 * Walks a value and collects the spots that aren't pure data. Just checking
 * whether `structuredClone` throws isn't enough — a class instance passes
 * through silently and only loses its prototype, which then shows up later
 * as `undefined is not a function`. That's why this also checks the
 * prototype.
 */
function impurities(value: unknown, path = "command"): Impurity[] {
  if (value === null) return [];

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "undefined":
    case "bigint":
      return [];
    case "function":
      return [{ path, what: "function" }];
    case "symbol":
      return [{ path, what: "symbol" }];
  }

  const prototype = Object.getPrototypeOf(value);
  if (!PLAIN_PROTOTYPES.includes(prototype)) {
    const name = (value as object).constructor?.name ?? "unknown thing";
    return [{ path, what: `${name} instance` }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => impurities(item, `${path}[${index}]`));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, item]) => impurities(item, `${path}.${key}`),
  );
}

/** A command list where grid, candles, crosshair, and text all land in one frame. */
function renderEverything(): DrawCommand[] {
  const context = fakeCanvasContext();
  const renderer = new CanvasRenderer({ width: 800, height: 600, context });

  const data: OHLC[] = Array.from({ length: 40 }, (_, i) => ({
    x: i,
    open: 100 + i,
    high: 106 + i,
    low: 95 + i,
    close: 102 + i,
  }));

  const { plot, handle } = mountPlot({ deps: { ...testBrowserDeps(), createRenderer: () => renderer }, series: candleSeries(), config: defaultConfig });

  plot.use(crosshair());
  handle.setData(data);

  // Mix text into the same frame too — this is where a drawText that pollutes
  // the command list would get caught.
  plot.addDecoration({
    draw: (target) =>
      target.drawText({
        text: "102.5",
        at: { x: 10, y: 20 },
        align: "right",
        baseline: "middle",
        style: { font: "12px sans-serif", color: "#111" },
        box: { fill: "#000", padding: 3 },
      }),
  });

  plot.crosshair({ x: 400, y: 300 });
  plot.render();

  const commands = renderer.getCommands();
  plot.destroy();
  return commands;
}

describe("draw commands are pure data", () => {
  const commands = renderEverything();

  it("should actually have drawn something", () => {
    // If the command list is empty, the assertions below all pass for free.
    expect(commands.length).toBeGreaterThan(10);
    expect(new Set(commands.map((c) => c.type))).toEqual(
      new Set(["clip", "drawLine", "drawShape", "drawText"]),
    );
  });

  it("should hold no functions, DOM references, or class instances", () => {
    const found = commands.flatMap((command, index) =>
      impurities(command, `commands[${index}]`),
    );

    expect(
      found.map(({ path, what }) => `${path} is a ${what}`),
    ).toEqual([]);
  });

  it("should survive structuredClone unchanged", () => {
    // This is where the path for sending commands to a worker/OffscreenCanvas hinges.
    expect(() => structuredClone(commands)).not.toThrow();
    expect(structuredClone(commands)).toEqual(commands);
  });
});

describe("impurities", () => {
  // Guards against the rule test silently ending up catching nothing.
  it.each([
    { name: "function", value: { onClick: () => {} }, what: "function" },
    { name: "symbol", value: { id: Symbol("x") }, what: "symbol" },
    { name: "class instance", value: { at: new (class Foo {})() }, what: "Foo instance" },
    { name: "nested function", value: { style: { fn: () => {} } }, what: "function" },
    { name: "inside an array", value: { points: [{ x: 1 }, { y: () => {} }] }, what: "function" },
  ])("should catch $name", ({ value, what }) => {
    const found = impurities(value);

    expect(found).toHaveLength(1);
    expect(found[0].what).toBe(what);
  });

  it("should let plain data through", () => {
    expect(
      impurities({
        type: "drawLine",
        points: [{ x: 1, y: 2 }],
        style: { width: 1, color: "#fff", dashArray: undefined },
        nested: { deep: [1, "two", true, null] },
      }),
    ).toEqual([]);
  });
});
