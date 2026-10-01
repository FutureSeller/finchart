/**
 * A Fibonacci drawing can space its levels in log price. On a log axis the
 * price-linear levels bunch toward one end — measured while dogfooding: the
 * 50% line of a 160,000 → 380,000 retracement sat 29px of 276 off the visual
 * middle. Log spacing is plain value arithmetic, `b·(a/b)^level`, so the
 * drawing carries it (`levelSpacing: "log"`) and no scale is asked anything:
 * the same stored drawing draws its lines at the same prices on any axis.
 *
 * The expected numbers here are **independent oracles** — computed at 60
 * digits outside this code base — never the implementation called again.
 */
import type { DrawTarget, Point, TextParams } from "@finchart/core";
import { createPlotModel, lineSeries, LogScale } from "@finchart/core";
import { describe, expect, it } from "vitest";
import {
  type Drawing,
  type FibExtension,
  type FibRetracement,
  fibExtensionPrice,
  fibLevelPrice,
  hasDrawingShape,
  parseDrawings,
  serializeDrawings,
} from "../drawings";
import { gripAt } from "../hit";
import { drawOne } from "../render";
import type { DrawingSpace } from "../space";
import { drawingTools } from "../tools";

const close = (actual: number, expected: number) => expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-12);

const retracement = (a: number, b: number, extra: Partial<FibRetracement> = {}): FibRetracement => ({
  type: "fib",
  id: "f",
  a: { x: 100, price: a },
  b: { x: 300, price: b },
  levelSpacing: "log",
  ...extra,
});

const extension = (a: number, b: number, c: number, extra: Partial<FibExtension> = {}): FibExtension => ({
  type: "fibExtension",
  id: "e",
  a: { x: 100, price: a },
  b: { x: 200, price: b },
  c: { x: 300, price: c },
  levelSpacing: "log",
  ...extra,
});

describe("log-spaced retracement levels", () => {
  it("are the geometric interpolation between the anchors", () => {
    const fib = retracement(160_000, 380_000);
    close(fibLevelPrice(fib, 0.5), 246_576.56011875905);
    close(fibLevelPrice(fib, 0.236), 309_832.50886179676);
    close(fibLevelPrice(fib, 0.786), 192_536.02264721337);
  });

  it("are never clamped — a negative level and one past 1 extrapolate", () => {
    const fib = retracement(160_000, 380_000);
    close(fibLevelPrice(fib, -0.5), 585_619.3302820527);
    close(fibLevelPrice(fib, 1.618), 93_747.53759639373);
  });

  it("put level 0 exactly on b and level 1 exactly on a", () => {
    const fib = retracement(160_000.1, 379_999.7);
    expect(fibLevelPrice(fib, 0)).toBe(379_999.7);
    expect(fibLevelPrice(fib, 1)).toBe(160_000.1);
  });

  it("stay price-linear without the field — what every saved drawing already is", () => {
    const fib = retracement(160_000, 380_000, { levelSpacing: undefined });
    expect(fibLevelPrice(fib, 0.5)).toBe(270_000);
  });

  it("survive a ratio no double can hold", () => {
    close(fibLevelPrice(retracement(1e300, 1e-300), 0.5), 1);
    close(fibLevelPrice(retracement(1e-300, 1e300), 0.5), 1);
    expect(fibLevelPrice(retracement(1e300, 1e-300), 1)).toBe(1e300);
  });

  // The two logarithms of these neighbours are the same double. A formula that
  // subtracts them returns an endpoint here; the right answer is e² away.
  it("do not lose two prices that differ in the sixteenth digit", () => {
    close(fibLevelPrice(retracement(10_000_000_000_000_002, 10_000_000_000_000_000), 1e16), 7.389056098930648e16);
  });

  /**
   * Oracles from 90-digit arithmetic on the exact doubles. A large level
   * multiplies whatever the logarithm of the swing got wrong, so the swing's
   * logarithm has to be good to the last digits at any magnitude — subtracting
   * two logarithms near 690 is not (it was 5e-11 off on the first of these).
   */
  it("hold their precision for a huge level at a huge magnitude, on both sides of where the arithmetic switches", () => {
    close(fibLevelPrice(retracement(5e299, 1e300), 1000), 0.09332636185032189);
    close(fibLevelPrice(retracement(1.5e300, 1e300), -1000), 8.104774656527567e123);
    close(fibLevelPrice(retracement(1.5000000000000004e300, 1e300), -1000), 8.10477465652596e123);
    close(fibLevelPrice(retracement(1.4999999999999998e300, 1e300), -1000), 8.104774656529174e123);
    close(fibLevelPrice(retracement(3e-300, 1e-300), 500), 3.636029179587094e-62);
    close(fibExtensionPrice(extension(3, 7, 1e-300), 700), 3.834861699943728e-43);
  });

  it("give the one price there is when the swing is flat", () => {
    expect(fibLevelPrice(retracement(250, 250), 0.618)).toBe(250);
  });
});

describe("log-spaced extension levels", () => {
  it("scale c by the a→b ratio raised to the level", () => {
    const fib = extension(100, 400, 50);
    close(fibExtensionPrice(fib, 0.5), 100);
    close(fibExtensionPrice(fib, 1), 200);
    close(fibExtensionPrice(fib, 2), 800);
    close(fibExtensionPrice(fib, -1), 12.5);
  });

  it("project a down-swing downward", () => {
    close(fibExtensionPrice(extension(400, 100, 50), 0.5), 25);
  });

  it("put level 0 exactly on c", () => {
    expect(fibExtensionPrice(extension(100.3, 399.9, 50.7), 0)).toBe(50.7);
  });

  it("stay price-linear without the field", () => {
    expect(fibExtensionPrice(extension(100, 400, 50, { levelSpacing: undefined }), 1)).toBe(350);
  });
});

describe("a level log spacing cannot define", () => {
  it("is NaN when a required price is not positive — but the anchors' own levels stand", () => {
    for (const fib of [retracement(0, 100), retracement(-5, 100), retracement(100, 0), retracement(100, -5)]) {
      expect(fibLevelPrice(fib, 0)).toBe(fib.b.price);
      expect(fibLevelPrice(fib, 1)).toBe(fib.a.price);
      expect(fibLevelPrice(fib, 0.5)).toBeNaN();
      expect(fibLevelPrice(fib, 1.618)).toBeNaN();
    }
  });

  it("leaves an extension only level 0 — level 1 is c·b/a, a log level like the rest", () => {
    for (const fib of [extension(0, 100, 50), extension(-2, -4, 3), extension(100, -5, 50), extension(100, 400, 0), extension(2, 2, 0)]) {
      expect(fibExtensionPrice(fib, 0)).toBe(fib.c.price);
      expect(fibExtensionPrice(fib, 1)).toBeNaN();
      expect(fibExtensionPrice(fib, 0.5)).toBeNaN();
    }
  });

  it("is NaN when the result leaves the doubles — past the largest, or down to zero", () => {
    expect(fibLevelPrice(retracement(1e300, 1e-300), 2)).toBeNaN();
    expect(fibLevelPrice(retracement(1e300, 1e-300), -1)).toBeNaN();
    expect(fibExtensionPrice(extension(1, 2, 1), 1025)).toBeNaN();
    // Exactly 2^1024 — one past the largest double, not the largest double.
    expect(fibExtensionPrice(extension(1, 2, 1), 1024)).toBeNaN();
    close(fibExtensionPrice(extension(1, 2, 1), 1023.5), 1.2711610061536464e308);
    // Exactly the smallest double, and the first power of two that rounds to zero.
    expect(fibExtensionPrice(extension(2, 1, 1), 1074)).toBe(Number.MIN_VALUE);
    expect(fibExtensionPrice(extension(2, 1, 1), 1075)).toBeNaN();
    expect(fibExtensionPrice(extension(2, 1, 1), 1080)).toBeNaN();
  });
});

/** A pane 0..600px tall showing 100..10,000, log or linear. Throws when asked to place a price that is not finite. */
function pane(kind: "log" | "linear"): DrawingSpace & { asked: number[] } {
  const asked: number[] = [];
  const [low, high] = [100, 10_000];
  const place = (price: number) =>
    kind === "log"
      ? 600 - (600 * Math.log(price / low)) / Math.log(high / low)
      : 600 - (600 * (price - low)) / (high - low);
  return {
    asked,
    area: { left: 0, right: 400, top: 0, bottom: 600 },
    xAt: (pixel) => pixel,
    pixelAtX: (x) => x,
    valueAt: (pixel) => pixel,
    pixelAtValue: (price) => {
      if (!Number.isFinite(price)) throw new Error(`projection asked to place ${price}`);
      asked.push(price);
      return place(price);
    },
  };
}

function emitted(drawing: Drawing, space: DrawingSpace) {
  const lines: Point[][] = [];
  const texts: TextParams[] = [];
  const target: DrawTarget = {
    drawLine: (points) => void lines.push(points),
    drawShape: () => undefined,
    drawText: (params) => void texts.push(params),
  };
  drawOne(target, space, { readStyle: () => "", formatValue: String, barIndexAt: (x) => x }, drawing, { width: 1, color: "#000" }, false);
  return { lines, texts };
}

const levelYs = (lines: Point[][]) => lines.filter((line) => line.length === 2 && line[0].y === line[1].y).map((line) => line[0].y);

describe("drawing log-spaced levels", () => {
  it("spaces them evenly on a log axis — the measured defect", () => {
    const { lines } = emitted(retracement(1_000, 4_000, { levels: [0, 0.5, 1] }), pane("log"));
    const ys = levelYs(lines);
    expect(ys).toHaveLength(3);
    expect(ys[1] - ys[0]).toBeCloseTo(ys[2] - ys[1], 9);
    expect(ys[1] - ys[0]).not.toBeCloseTo(0, 3);
  });

  it("draws the same prices on a linear axis — the axis is not asked", () => {
    const log = pane("log");
    const linear = pane("linear");
    emitted(retracement(1_000, 4_000, { levels: [0, 0.5, 1] }), log);
    emitted(retracement(1_000, 4_000, { levels: [0, 0.5, 1] }), linear);
    expect(linear.asked).toEqual(log.asked);
    // …and the 50% level among them is the geometric middle, 2,000 — not 2,500.
    expect(linear.asked.some((price) => Math.abs(price / 2_000 - 1) < 1e-12)).toBe(true);
    expect(linear.asked).not.toContain(2_500);
  });

  it("leaves a price-linear drawing as it was — even on a linear axis, bunched on a log one", () => {
    const fib = retracement(1_000, 4_000, { levels: [0, 0.5, 1], levelSpacing: undefined });
    const onLinear = levelYs(emitted(fib, pane("linear")).lines);
    expect(onLinear[1] - onLinear[0]).toBeCloseTo(onLinear[2] - onLinear[1], 9);
    const onLog = levelYs(emitted(fib, pane("log")).lines);
    expect(Math.abs(onLog[1] - onLog[0] - (onLog[2] - onLog[1]))).toBeGreaterThan(50);
  });

  it("emits nothing for a level it cannot define, before asking the projection", () => {
    // b is not positive: only levels 0 and 1 — the anchors — are defined.
    const space = pane("linear");
    const { lines, texts } = emitted(retracement(1_000, -50, { levels: [0, 0.5, 0.786, 1] }), space);
    expect(levelYs(lines)).toHaveLength(2);
    expect(texts.map((text) => text.text)).toEqual(["0.0%", "100.0%"]);
    expect(space.asked.every(Number.isFinite)).toBe(true);
  });

  it("keeps an extension's swing legs and its defined level when the rest are not", () => {
    const { lines, texts } = emitted(extension(1_000, 4_000, -50, { levels: [0, 1, 2] }), pane("linear"));
    expect(texts.map((text) => text.text)).toEqual(["0.0%"]);
    expect(levelYs(lines)).toHaveLength(1);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("grabbing log-spaced levels", () => {
  it("hits the log level, and misses where the price-linear one would have been", () => {
    const space = pane("linear");
    const fib = retracement(1_000, 4_000, { levels: [0.5] });
    const at = (price: number): Point => ({ x: 200, y: 600 - (600 * (price - 100)) / 9_900 });
    expect(gripAt([fib], space, at(2_000))).toMatchObject({ part: "whole" });
    expect(gripAt([fib], space, at(2_500))).toBeNull();
  });

  it("does the same for an extension, away from its swing legs", () => {
    const space = pane("linear");
    const fib = extension(1_000, 2_000, 1_500, { levels: [2] });
    // x 250 is inside the drawing's span; the b→c leg passes there at 1,750, far from both.
    const at = (price: number): Point => ({ x: 250, y: 600 - (600 * (price - 100)) / 9_900 });
    expect(gripAt([fib], space, at(6_000))).toMatchObject({ part: "whole" });
    expect(gripAt([fib], space, at(3_500))).toBeNull();
  });

  it("misses an undefined level at the finite place a linear one would occupy", () => {
    const space = pane("linear");
    const fib = retracement(1_000, -50, { levels: [0.5] });
    expect(gripAt([fib], space, { x: 200, y: 600 - (600 * (475 - 100)) / 9_900 })).toBeNull();
  });
});

describe("the stored field", () => {
  it('is absent or exactly "log"', () => {
    const { id: _, ...input } = retracement(100, 200);
    expect(hasDrawingShape(input)).toBe(true);
    for (const value of ["linear", "LOG", 1, null, true]) {
      expect(hasDrawingShape({ ...input, levelSpacing: value })).toBe(false);
    }
  });

  it("survives the save round trip without a format bump", () => {
    const saved = serializeDrawings([retracement(100, 200), extension(100, 200, 150)]);
    expect(JSON.parse(saved).version).toBe(2);
    const loaded = parseDrawings(saved);
    expect(loaded?.map((drawing) => "levelSpacing" in drawing && drawing.levelSpacing)).toEqual(["log", "log"]);
    expect(serializeDrawings(loaded ?? [])).toBe(saved);
  });

  it("is refused by serialization when it holds a value nobody knows", () => {
    // Through JSON, the way a value the type forbids actually arrives.
    const broken: Drawing = JSON.parse(JSON.stringify({ ...retracement(100, 200), levelSpacing: "sqrt" }));
    expect(() => serializeDrawings([broken])).toThrow();
  });

  // An unknown field NAME has always been dropped quietly. An unknown VALUE of a
  // known field used to fail the predicate — and one fib took every saved
  // drawing with it. It is read the way an unknown field is: dropped.
  it("does not kill the ledger when a future build wrote a spacing this one does not know", () => {
    const trend = { type: "trend", id: "t", a: { x: 0, price: 1 }, b: { x: 1, price: 2 } };
    const fib = { type: "fib", id: "f", a: { x: 0, price: 100 }, b: { x: 1, price: 200 }, levelSpacing: "sqrt" };
    const loaded = parseDrawings(JSON.stringify({ version: 2, drawings: [trend, fib] }));
    expect(loaded).toHaveLength(2);
    expect(loaded?.[1]).toMatchObject({ type: "fib", a: { x: 0, price: 100 }, b: { x: 1, price: 200 } });
    expect(loaded?.[1]).not.toHaveProperty("levelSpacing");
  });
});

/**
 * The measurement that opened this, end to end on the core's own `LogScale`:
 * a 160,000 → 380,000 retracement whose 50% line sat a tenth of its height off
 * the visual middle.
 */
describe("on the core's log axis", () => {
  const swing = (levelSpacing: "log" | undefined) => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: lineSeries(),
        data: [
          { x: 0, y: 150_000 },
          { x: 5, y: 400_000 },
          { x: 10, y: 250_000 },
        ],
      },
      config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
    });
    model.plot.mainPane.setYScale(new LogScale());
    const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
    tools.add({ type: "fib", a: { x: 2, price: 160_000 }, b: { x: 8, price: 380_000 }, levels: [0, 0.5, 1], levelSpacing });
    model.plot.render();
    const { yScale } = model.plot.mainPane;
    const ends = [yScale.scale(380_000), yScale.scale(160_000)];
    const levels = model
      .commands()
      .flatMap((command) => (command.type === "drawLine" && command.points.length === 2 ? [command.points] : []))
      .filter(([from, to]) => from.y === to.y && from.y >= ends[0] - 1e-6 && from.y <= ends[1] + 1e-6)
      .map(([from]) => from.y)
      .sort((left, right) => left - right);
    return { levels, height: ends[1] - ends[0] };
  };

  it("price-linear levels sit a tenth of the swing off the middle — what was measured", () => {
    const { levels, height } = swing(undefined);
    expect(levels).toHaveLength(3);
    const off = Math.abs(levels[1] - (levels[0] + levels[2]) / 2) / height;
    expect(off).toBeGreaterThan(0.09);
    expect(off).toBeLessThan(0.12);
  });

  it("log-spaced levels sit on it", () => {
    const { levels, height } = swing("log");
    expect(levels).toHaveLength(3);
    expect(Math.abs(levels[1] - (levels[0] + levels[2]) / 2) / height).toBeLessThan(1e-9);
  });
});
