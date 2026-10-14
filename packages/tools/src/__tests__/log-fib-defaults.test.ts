/**
 * Without defaults, `levelSpacing` can be set through `add` and `update`
 * and by nothing a hand does: a Fibonacci drawn with the pointer is born
 * with its type, id and anchors, and nothing else. So the tool takes what a
 * hand-drawn drawing of each kind is born with.
 */
import type { LineDataPoint } from "@finchart/core";
import { ContractError, createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import type { DrawingToolsOptions } from "../tools";
import { drawingTools } from "../tools";
import { drawingChart, type Spot } from "./drawing-chart.fixture";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

/** A spread: it goes below zero, which a log axis never shows and a linear one does. */
const spread: LineDataPoint[] = [
  { x: 0, y: -50 },
  { x: 5, y: 30 },
  { x: 10, y: -20 },
];

function mounted(defaults: DrawingToolsOptions["defaults"], series: LineDataPoint[] = data) {
  const chart = drawingChart({ series: { series: lineSeries(), data: series }, tools: { defaults } });
  /** Arms `kind`, drags from the first anchor to the second, then moves to and clicks each one after. */
  const place = (kind: Drawing["type"], first: Spot, second: Spot, ...rest: Spot[]) => {
    chart.tools.begin(kind);
    chart.drag(first, second);
    for (const spot of rest) {
      chart.hover(spot);
      chart.click(spot);
    }
    return chart.tools.list().at(-1);
  };
  return { ...chart, place };
}

/** A value the type forbids, the way an untyped caller would hand it over. */
const untyped = (value: unknown): DrawingToolsOptions["defaults"] => JSON.parse(JSON.stringify(value));

describe("what a hand-drawn Fibonacci is born with", () => {
  it("is the kind's defaults — spacing and levels", () => {
    const { place } = mounted({
      fib: { levelSpacing: "log", levels: [0, 0.5, 1] },
      fibExtension: { levelSpacing: "log" },
    });
    expect(place("fib", { x: 2, price: 105 }, { x: 8, price: 115 })).toMatchObject({
      type: "fib", levelSpacing: "log", levels: [0, 0.5, 1],
    });
    const extension = place("fibExtension", { x: 1, price: 102 }, { x: 4, price: 114 }, { x: 8, price: 108 });
    expect(extension).toMatchObject({ type: "fibExtension", levelSpacing: "log" });
    expect(extension).not.toHaveProperty("levels");
  });

  it("is nothing extra without them, and nothing for a kind that has none", () => {
    const plain = mounted(undefined);
    expect(plain.place("fib", { x: 2, price: 105 }, { x: 8, price: 115 })).not.toHaveProperty("levelSpacing");
    const { place } = mounted({ fib: { levelSpacing: "log" } });
    expect(place("trend", { x: 2, price: 105 }, { x: 8, price: 115 })).not.toHaveProperty("levelSpacing");
  });

  it("does not touch what `add` is told — the caller said what it meant", () => {
    const { tools } = mounted({ fib: { levelSpacing: "log" } });
    const handle = tools.add({ type: "fib", a: { x: 2, price: 105 }, b: { x: 8, price: 115 } });
    expect(handle.read()).not.toHaveProperty("levelSpacing");
    handle.update({ levelSpacing: "log" });
    handle.update({ levelSpacing: undefined });
    expect(handle.read()).not.toHaveProperty("levelSpacing");
  });

  // Anchors below zero leave log spacing only the anchors' own levels to draw,
  // until the prices are positive. The default still holds there: a drawing that
  // silently came out price-linear is what this must not do.
  it("still applies where the anchors' prices are not positive", () => {
    const { place } = mounted({ fib: { levelSpacing: "log" } }, spread);
    expect(place("fib", { x: 2, price: -40 }, { x: 8, price: -10 })).toMatchObject({
      levelSpacing: "log", a: { price: expect.closeTo(-40, 6) },
    });
  });
});

describe("the defaults option itself", () => {
  it("is checked where the other options are — before anything is installed", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 }, series: { series: lineSeries(), data } });
    for (const broken of [
      { fib: { levelSpacing: "LOG" } },
      { fib: { levels: [] } },
      { fib: { levels: [0, Number.NaN] } },
      { fibExtension: { levelSpacing: 1 } },
      { fib: "log" },
      "log",
    ]) {
      expect(() => drawingTools({ plot: model.plot, defaults: untyped(broken) })).toThrow(ContractError);
    }
  });

  /**
   * What is kept has to be the very copy that was checked. Checking the
   * caller's object and copying it afterwards reads it twice: a getter can
   * answer differently, and a sparse array's hole is skipped by the check and
   * becomes `undefined` in the copy — either way the failure would surface as a
   * throw when someone finishes drawing, not here.
   */
  it("judges the copy it keeps — a second read or a sparse array cannot slip past", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 }, series: { series: lineSeries(), data } });
    let reads = 0;
    const shifty = {
      get levels() {
        reads += 1;
        return reads === 1 ? [0, 1] : [Number.NaN];
      },
    };
    const built = () => drawingTools({ plot: model.plot, defaults: { fib: shifty } });
    // Either outcome of a single read is sound; what may not happen is a checked [0, 1] and a kept [NaN].
    expect(built).not.toThrow();
    expect(reads).toBe(1);

    expect(() => drawingTools({ plot: model.plot, defaults: { fib: { levels: new Array<number>(1) } } })).toThrow(ContractError);
    const throwing = {
      get levels(): number[] {
        throw new Error("the consumer's store");
      },
    };
    expect(() => drawingTools({ plot: model.plot, defaults: { fib: throwing } })).toThrow(ContractError);
  });

  /** The container is read inside the same fence — and a value that cannot even be described still gets the contract's error. */
  it("answers in the contract's vocabulary whatever the option is made of", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 }, series: { series: lineSeries(), data } });
    const throwing = {
      get fib(): never {
        throw new Error("the consumer's store");
      },
    };
    expect(() => drawingTools({ plot: model.plot, defaults: throwing })).toThrow(ContractError);

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    // What a getter throws is the consumer's too — it may not even be inspectable.
    const throwsProxy = {
      get fib(): never {
        throw proxy;
      },
    };
    expect(() => drawingTools({ plot: model.plot, defaults: throwsProxy })).toThrow(ContractError);
    expect(() => drawingTools({ plot: model.plot, defaults: { fib: proxy } })).toThrow(ContractError);
    expect(() => drawingTools({ plot: model.plot, defaults: proxy })).toThrow(ContractError);
  });

  /** Both kinds come from one reading of the option — not one reading each, which could be two different objects. */
  it("reads the option once for both kinds", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 }, series: { series: lineSeries(), data } });
    let reads = 0;
    const options = {
      plot: model.plot,
      get defaults(): DrawingToolsOptions["defaults"] {
        reads += 1;
        return reads === 1 ? { fib: { levelSpacing: "log" }, fibExtension: { levelSpacing: "log" } } : {};
      },
    };
    drawingTools(options);
    expect(reads).toBe(1);
  });

  it("keeps the first read — the drawing a hand finishes carries it", () => {
    let reads = 0;
    const { place } = mounted({
      fib: {
        get levels() {
          reads += 1;
          return reads === 1 ? [0, 0.5, 1] : [Number.NaN];
        },
      },
    });
    expect(place("fib", { x: 2, price: 105 }, { x: 8, price: 115 })).toMatchObject({ levels: [0, 0.5, 1] });
  });

  it("is owned — changing the caller's object afterwards changes no later drawing", () => {
    const levels = [0, 0.5, 1];
    const defaults: DrawingToolsOptions["defaults"] = { fib: { levelSpacing: "log", levels } };
    const { place } = mounted(defaults);
    levels.push(9);
    delete defaults.fib?.levelSpacing;
    expect(place("fib", { x: 2, price: 105 }, { x: 8, price: 115 })).toMatchObject({ levelSpacing: "log", levels: [0, 0.5, 1] });
  });

  it("hands each drawing its own copy of the levels", () => {
    const { tools, place } = mounted({ fib: { levels: [0, 0.5, 1] } });
    place("fib", { x: 2, price: 105 }, { x: 8, price: 115 });
    place("fib", { x: 3, price: 106 }, { x: 7, price: 112 });
    tools.handles()[0].update({ levels: [0, 1] });
    expect(tools.list().map((drawing) => "levels" in drawing && drawing.levels)).toEqual([[0, 1], [0, 0.5, 1]]);
  });
});
