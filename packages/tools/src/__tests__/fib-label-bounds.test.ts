/**
 * Fibonacci level labels sit just left of the levels, right-aligned. Near
 * the pane's left edge that pushes them out of the pane, where they are cut
 * off. The tool can't measure text, so each label carries the pane's
 * horizontal range and the renderer keeps it inside — the anchor and
 * alignment stay what they were.
 */
import type { DrawTarget, Point, TextParams } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import { drawOne } from "../render";
import type { DrawingSpace } from "../space";

const space: DrawingSpace = {
  area: { left: 40, right: 400, top: 0, bottom: 300 },
  xAt: (pixel) => pixel,
  pixelAtX: (x) => x,
  valueAt: (pixel) => pixel,
  pixelAtValue: (price) => price,
};

function labels(drawing: Drawing): TextParams[] {
  const texts: TextParams[] = [];
  const target: DrawTarget = {
    drawLine: (_points: Point[]) => undefined,
    drawShape: () => undefined,
    drawText: (params) => void texts.push(params),
  };
  drawOne(target, space, { readStyle: () => "", formatValue: String, barIndexAt: (x) => x }, drawing, { width: 1, color: "#000" }, false);
  return texts;
}

const fib = (left: number): Drawing => ({ type: "fib", id: "f", a: { x: left, price: 100 }, b: { x: left + 200, price: 200 } });
const extension = (left: number): Drawing => ({
  type: "fibExtension",
  id: "e",
  a: { x: left, price: 100 },
  b: { x: left + 100, price: 200 },
  c: { x: left + 200, price: 150 },
});

describe("Fibonacci level labels stay inside the pane", () => {
  it("carry the pane's horizontal range, for both Fibonacci tools", () => {
    for (const drawing of [fib(45), extension(45)]) {
      const texts = labels(drawing);
      expect(texts.length).toBeGreaterThan(0);
      for (const text of texts) expect({ type: drawing.type, within: text.within }).toEqual({ type: drawing.type, within: { left: 40, right: 400 } });
    }
  });

  it("keep their anchor and alignment — only the renderer moves what would spill", () => {
    for (const drawing of [fib(200), extension(200)]) {
      for (const text of labels(drawing)) {
        expect(text.at.x).toBe(196);
        expect(text.align).toBe("right");
      }
    }
  });

  it("leave a drawing that is wholly off the pane alone — no label is pulled in without its levels", () => {
    // The pane spans x 40..400. Far right, and far left.
    for (const drawing of [fib(500), extension(500), fib(-400), extension(-400)]) {
      for (const text of labels(drawing)) {
        expect({ type: drawing.type, at: text.at.x, within: text.within }).toEqual({ type: drawing.type, at: text.at.x, within: undefined });
      }
    }
  });

  it("still bound a drawing that only reaches into the pane", () => {
    // Starts left of the pane, ends inside it.
    for (const drawing of [fib(-100), extension(-150)]) {
      for (const text of labels(drawing)) expect(text.within).toEqual({ left: 40, right: 400 });
    }
  });
});
