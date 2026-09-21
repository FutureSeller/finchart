/**
 * Dragging a log-spaced Fibonacci drawing by its body.
 *
 * A body drag fixes the offset between each anchor and the cursor at the
 * moment of grabbing, so the grabbed spot stays under the cursor. Offsets that
 * are price *differences* keep a price-linear level there — and lose a
 * log-spaced one: with a at 100 and b at 400, grab the 50% level at 200 and
 * move to 300, and adding 100 to both anchors puts that level at 316. Log
 * drawings move by a common *factor* instead: 150 and 600, and the level is at
 * 300. Still only the anchors' prices and the cursor's — no scale is asked.
 */
import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing, FibExtension, FibRetracement } from "../drawings";
import { fibLevelPrice, serializeDrawings, toOwnedDrawing } from "../drawings";
import type { DragState } from "../hit";
import { gripOffsets, logGrab, moveGrip } from "../hit";
import type { DrawingSpace } from "../space";
import { drawingTools } from "../tools";

const close = (actual: number, expected: number) => expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-12);

/** Pixels are domain values here — the arithmetic under test never asks for more. */
const space: DrawingSpace = {
  area: { left: 0, right: 1_000, top: 0, bottom: 1_000 },
  xAt: (pixel) => pixel,
  pixelAtX: (x) => x,
  valueAt: (pixel) => pixel,
  pixelAtValue: (price) => price,
};

const retracement = (a: number, b: number, extra: Partial<FibRetracement> = {}): FibRetracement => ({
  type: "fib",
  id: "f",
  a: { x: 100, price: a },
  b: { x: 300, price: b },
  levelSpacing: "log",
  ...extra,
});

/** Grabs the whole drawing with the cursor at `price` (x 200), the way tools.ts builds the state. */
function grab(drawing: Drawing, price: number, x = 200): DragState {
  const grip: DragState["grip"] = { drawing, part: "whole" };
  const point = { x, y: price };
  return {
    grip,
    offsets: gripOffsets(grip, space, point),
    grabbed: logGrab(grip, space, point),
    original: toOwnedDrawing(drawing),
    moved: false,
  };
}

describe("a log drawing moves by a factor", () => {
  it("keeps the grabbed level under the cursor", () => {
    const fib = retracement(100, 400);
    moveGrip(grab(fib, 200), { x: 200, price: 300 });
    close(fib.a.price, 150);
    close(fib.b.price, 600);
    close(fibLevelPrice(fib, 0.5), 300);
  });

  it("moves x by a difference, as ever", () => {
    const fib = retracement(100, 400);
    moveGrip(grab(fib, 200), { x: 260, price: 300 });
    expect([fib.a.x, fib.b.x]).toEqual([160, 360]);
  });

  it("does the same for an extension", () => {
    const fib: FibExtension = {
      type: "fibExtension",
      id: "e",
      a: { x: 100, price: 100 },
      b: { x: 200, price: 400 },
      c: { x: 300, price: 50 },
      levelSpacing: "log",
    };
    moveGrip(grab(fib, 100), { x: 200, price: 300 });
    close(fib.a.price, 300);
    close(fib.b.price, 1_200);
    close(fib.c.price, 150);
  });

  it("puts the anchors back bit for bit when the cursor is back where it grabbed", () => {
    const fib = retracement(100.3, 399.7);
    const drag = grab(fib, 217.9);
    moveGrip(drag, { x: 431, price: 288.1 });
    moveGrip(drag, { x: 200, price: 217.9 });
    expect(toOwnedDrawing(fib)).toEqual(drag.original);
  });

  /**
   * Each axis comes back on its own. Two anchors one double apart carry a level
   * of 1e16 at 7.39e16; sending each price through a logarithm and back erased
   * that one double, so dragging the drawing **sideways** dropped the level to
   * the anchors' price — an 86% jump from a move that changed no price.
   */
  it("changes no price when the cursor only moved sideways", () => {
    const fib = retracement(10_000_000_000_000_002, 10_000_000_000_000_000, { levels: [1e16] });
    moveGrip(grab(fib, 7.38905609893065e16), { x: 201, price: 7.38905609893065e16 });
    expect([fib.a.price, fib.b.price]).toEqual([10_000_000_000_000_002, 10_000_000_000_000_000]);
    expect([fib.a.x, fib.b.x]).toEqual([101, 301]);
  });

  /**
   * One factor for every anchor — not a logarithm and an exponential per
   * anchor, whose separate roundings move two close prices by different
   * amounts. Doubling is exact, so here the anchors must double to the bit.
   */
  it("moves every anchor by the same factor, so close anchors stay apart", () => {
    const fib = retracement(10_000_000_000_000_002, 10_000_000_000_000_000);
    moveGrip(grab(fib, 1e16), { x: 200, price: 2e16 });
    expect([fib.a.price, fib.b.price]).toEqual([20_000_000_000_000_004, 20_000_000_000_000_000]);
  });

  /** `0.7 + (0.1 − 0.7)` is 0.09999999999999998 — a difference does not bring x back by itself. */
  it("puts x back bit for bit too, when only the price moved", () => {
    const fib = retracement(100, 400, { a: { x: 0.1, price: 100 }, b: { x: 0.9, price: 400 } });
    const drag = grab(fib, 200, 0.7);
    moveGrip(drag, { x: 0.5, price: 300 });
    moveGrip(drag, { x: 0.7, price: 300 });
    expect([fib.a.x, fib.b.x]).toEqual([0.1, 0.9]);
    close(fib.a.price, 150);
  });

  /**
   * 1.4 over 1.5 is a factor of 1.87 and a halving. Multiplying by 1.87 first
   * would overflow on the way to a price that fits.
   */
  it("reaches a price next to the largest double without overflowing on the way", () => {
    const fib = retracement(1.7e308, 1e308);
    moveGrip(grab(fib, 1.5), { x: 200, price: 1.4 });
    close(fib.a.price, 1.5866666666666665e308);
    close(fib.b.price, 9.333333333333332e307);
  });

  /**
   * The smallest doubles have one or two bits to round. Multiplying them by the
   * factor *before* lifting them rounds 2m·0.75 and 3m·0.75 to the same double;
   * and a power of two built in one or two pieces is `Infinity` on the way to a
   * product that fits.
   */
  it("moves the smallest doubles up without merging them or giving up", () => {
    const tiny = Number.MIN_VALUE;
    const near = retracement(2 * tiny, 3 * tiny);
    moveGrip(grab(near, 2 * tiny), { x: 200, price: 3 });
    expect([near.a.price, near.b.price]).toEqual([3, 4.5]);

    const far = retracement(tiny, 2 * tiny);
    moveGrip(grab(far, tiny), { x: 200, price: 2 ** 1000 });
    expect([far.a.price, far.b.price]).toEqual([2 ** 1000, 2 ** 1001]);
  });

  it("survives anchors whose ratio no double can hold", () => {
    const fib = retracement(1e300, 1e-300);
    const drag = grab(fib, 1);
    moveGrip(drag, { x: 200, price: 10 });
    close(fib.a.price, 1e301);
    close(fib.b.price, 1e-299);
  });

  // The factor itself can leave the doubles while every moved price stays in
  // them: grabbed at 1e-300 and carried to 1e300 the factor is 1e600, and the
  // anchors land on 2e300 and 1e300. A factor formed as a ratio refuses this.
  it("survives a cursor whose own ratio no double can hold", () => {
    const fib = retracement(2e-300, 1e-300);
    moveGrip(grab(fib, 1e-300), { x: 200, price: 1e300 });
    close(fib.a.price, 2e300);
    close(fib.b.price, 1e300);
  });
});

describe("a move that log price cannot express is not applied", () => {
  it("holds when the cursor's price is not positive, and follows again when it is", () => {
    const fib = retracement(100, 400);
    const drag = grab(fib, 200);
    moveGrip(drag, { x: 250, price: 300 });
    const held = toOwnedDrawing(fib);
    for (const price of [0, -40, Number.NaN]) {
      moveGrip(drag, { x: 900, price });
      expect(toOwnedDrawing(fib)).toEqual(held);
    }
    moveGrip(drag, { x: 200, price: 100 });
    close(fib.a.price, 50);
  });

  /**
   * Doubles are twice as far apart above 2 as below it, so two anchors one
   * double apart at 1.2 have no two doubles to land on at 2.04 — and a swing
   * that closes takes every level with it (this one from 12.98 to 2.04). The
   * same drawing a little further, where they fit again, follows.
   */
  it("holds when two anchors would land on one double, and follows where they would not", () => {
    const fib = retracement(1.2000000000000002, 1.2, { levels: [1e16] });
    const drag = grab(fib, 7.634620747146576);
    moveGrip(drag, { x: 200, price: 12.978855270149179 });
    expect([fib.a.price, fib.b.price]).toEqual([1.2000000000000002, 1.2]);
    moveGrip(drag, { x: 200, price: 7.634620747146576 / 2 });
    expect([fib.a.price, fib.b.price]).toEqual([0.6000000000000001, 0.6]);
  });

  // a′ would be Infinity. Unchecked, the commit copies it into history and the
  // next save throws — stored geometry, not a picture, is what would break.
  it("holds when a moved anchor would leave the doubles — and writes no anchor at all", () => {
    const fib = retracement(1e300, 1e-300);
    const drag = grab(fib, 1);
    moveGrip(drag, { x: 777, price: 1e10 });
    expect(toOwnedDrawing(fib)).toEqual(drag.original);
    expect(() => serializeDrawings([fib])).not.toThrow();
    // …and the other way: b′ = 1e-330 is zero in doubles, and zero is not a log price.
    moveGrip(drag, { x: 777, price: 1e-30 });
    expect(toOwnedDrawing(fib)).toEqual(drag.original);
    moveGrip(drag, { x: 200, price: 10 });
    close(fib.a.price, 1e301);
  });
  /**
   * The arithmetic is good to a few units in the last place, so a product
   * within that of the largest double can come out infinite. Which side such a
   * move falls on is not promised; that it is whole is — all of it, or none.
   */
  it("applies a move that lands on the very edge of the doubles whole, or not at all", () => {
    const fib = retracement(7, 3.5);
    moveGrip(grab(fib, 7), { x: 200, price: Number.MAX_VALUE });
    const moved = fib.a.price !== 7;
    expect([fib.a.price, fib.b.price, fib.a.x]).toEqual(
      moved ? [Number.MAX_VALUE, Number.MAX_VALUE / 2, 100] : [7, 3.5, 100],
    );
  });
});

describe("the drag that stays a difference", () => {
  it("is every price-linear drawing", () => {
    const fib = retracement(100, 400, { levelSpacing: undefined });
    const drag = grab(fib, 250);
    expect(drag.grabbed).toBeUndefined();
    moveGrip(drag, { x: 200, price: 350 });
    expect([fib.a.price, fib.b.price]).toEqual([200, 500]);
  });

  it("is a log drawing holding a price that is not positive", () => {
    const drag = grab(retracement(-50, 400), 200);
    expect(drag.grabbed).toBeUndefined();
  });

  it("is a log drawing grabbed where the cursor's price is not positive — the hit tolerance reaches there", () => {
    expect(grab(retracement(2, 400), 0).grabbed).toBeUndefined();
    expect(grab(retracement(2, 400), -1).grabbed).toBeUndefined();
  });

  it("is an endpoint of a log drawing — that anchor simply follows the cursor", () => {
    const fib = retracement(100, 400);
    const grip: DragState["grip"] = { drawing: fib, part: "a" };
    expect(logGrab(grip, space, { x: 100, y: 100 })).toBeUndefined();
  });
});

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
  const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  const pane = model.plot.mainPane;
  const at = (price: number) => ({ x: (pane.area.left + pane.area.right) / 2, y: pane.yScale.scale(price) });
  const route = (type: "pointerdown" | "pointermove" | "pointerup", price: number) =>
    model.plot.routeInput({ type, point: at(price), pointerId: 1 });
  const anchors = () => {
    const drawing = tools.list()[0];
    if (drawing.type !== "fib") throw new Error("unexpected kind");
    return drawing;
  };
  return { tools, route, anchors };
}

describe("a routed body drag of a log fib", () => {
  const middle = Math.sqrt(101 * 119);

  it("leaves the grabbed level at the cursor's price", () => {
    const { tools, route, anchors } = mounted();
    tools.add({ type: "fib", a: { x: 1, price: 101 }, b: { x: 9, price: 119 }, levels: [0.5], levelSpacing: "log" });
    expect(route("pointerdown", middle)).toBe(true);
    route("pointermove", 112);
    route("pointerup", 112);
    expect(fibLevelPrice(anchors(), 0.5)).toBeCloseTo(112, 8);
    // A difference would have kept the swing at 18; a factor scales it.
    expect(anchors().b.price - anchors().a.price).not.toBeCloseTo(18, 3);
  });

  it("records nothing when every move was refused", () => {
    const { tools, route, anchors } = mounted();
    tools.add({ type: "fib", a: { x: 1, price: 101 }, b: { x: 9, price: 119 }, levels: [0.5], levelSpacing: "log" });
    route("pointerdown", middle);
    route("pointermove", -30);
    route("pointerup", -30);
    expect(anchors()).toMatchObject({ a: { x: 1, price: 101 }, b: { x: 9, price: 119 } });
    // History, asked directly: the one thing there is to undo is the add.
    // (`changes` says "move" on every pointer move of a drag, moved or not.)
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
  });

  it("records nothing when the cursor comes back to where it grabbed after a refused move", () => {
    const { tools, route, anchors } = mounted();
    tools.add({ type: "fib", a: { x: 1, price: 101 }, b: { x: 9, price: 119 }, levels: [0.5], levelSpacing: "log" });
    route("pointerdown", middle);
    route("pointermove", 112);
    route("pointermove", -30);
    route("pointermove", middle);
    route("pointerup", middle);
    expect(anchors()).toMatchObject({ a: { x: 1, price: 101 }, b: { x: 9, price: 119 } });
    // History, asked directly: the one thing there is to undo is the add.
    // (`changes` says "move" on every pointer move of a drag, moved or not.)
    expect(tools.undo()).toBe(true);
    expect(tools.list()).toEqual([]);
  });

  it("keeps the last accepted place when it ends on a refused move — one step to undo, one to redo", () => {
    const { tools, route, anchors } = mounted();
    tools.add({ type: "fib", a: { x: 1, price: 101 }, b: { x: 9, price: 119 }, levels: [0.5], levelSpacing: "log" });
    route("pointerdown", middle);
    route("pointermove", 112);
    route("pointermove", -30);
    route("pointerup", -30);
    expect(fibLevelPrice(anchors(), 0.5)).toBeCloseTo(112, 8);
    const moved = toOwnedDrawing(anchors());
    tools.undo();
    expect(anchors()).toMatchObject({ a: { price: 101 }, b: { price: 119 } });
    tools.redo();
    expect(toOwnedDrawing(anchors())).toEqual(moved);
    // One step, not one per pointer move: two undos empty the ledger.
    tools.undo();
    tools.undo();
    expect(tools.list()).toEqual([]);
  });
});
