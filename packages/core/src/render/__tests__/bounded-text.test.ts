/**
 * `TextParams.within` — keep text (and its box) inside a horizontal range.
 * The caller can't measure text, so it states the range; the renderer that
 * draws measures and slides the text in. When the text is wider than the
 * range, its left edge sits on the range's left and it overflows right.
 */
import { describe, expect, it } from "vitest";
import { drawnTexts, fakeCanvasContext, filledRects } from "../../__tests__/dom-fakes";
import { CanvasRenderer } from "../canvas-renderer";
import { recordingRenderer } from "../recording-renderer";
import type { TextParams, TextStyle } from "../types";

/** The fake measures 7px per character. */
const CHAR = 7;
const STYLE: TextStyle = { font: "600 12px Inter, sans-serif", color: "#111" };

function draw(params: TextParams) {
  const context = fakeCanvasContext();
  const renderer = new CanvasRenderer({ width: 400, height: 300, context });
  renderer.drawText(params);
  renderer.commit();
  const [text] = drawnTexts(context);
  const width = params.text.length * CHAR;
  const left = text.align === "right" ? text.x - width : text.align === "center" ? text.x - width / 2 : text.x;
  return { text, left, right: left + width, rect: filledRects(context)[0] };
}

const aligns: TextParams["align"][] = ["left", "center", "right"];

describe("TextParams.within", () => {
  it("slides text that would cross the left edge back inside, for every alignment", () => {
    for (const align of aligns) {
      // "38.2%" is 35px wide, anchored at x = 10.
      const { left, right } = draw({ text: "38.2%", at: { x: 10, y: 20 }, align, baseline: "middle", style: STYLE, within: { left: 20, right: 300 } });
      expect({ align, left }).toEqual({ align, left: 20 });
      expect(right).toBeLessThanOrEqual(300);
    }
  });

  it("slides text that would cross the right edge back inside, for every alignment", () => {
    for (const align of aligns) {
      const { left, right } = draw({ text: "161.8%", at: { x: 320, y: 20 }, align, baseline: "middle", style: STYLE, within: { left: 0, right: 300 } });
      expect({ align, right }).toEqual({ align, right: 300 });
      expect(left).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves text that already fits exactly where its anchor put it", () => {
    for (const align of aligns) {
      const bounded = draw({ text: "50%", at: { x: 150, y: 20 }, align, baseline: "middle", style: STYLE, within: { left: 0, right: 300 } });
      const free = draw({ text: "50%", at: { x: 150, y: 20 }, align, baseline: "middle", style: STYLE });
      expect(bounded.text.x).toBe(free.text.x);
    }
  });

  it("moves a box and its text together, padding included in what must fit", () => {
    const padding = 4;
    const { text, rect, left } = draw({
      text: "0.0%",
      at: { x: 22, y: 20 },
      align: "right",
      baseline: "middle",
      style: STYLE,
      box: { fill: "#000", padding },
      within: { left: 10, right: 300 },
    });
    // The box's left edge is on the range's left; the text sits padding inside it.
    expect(rect.x).toBe(10);
    expect(left).toBe(10 + padding);
    expect(rect.x + rect.width).toBe(left + text.text.length * CHAR + padding);
  });

  it("keeps a padded box inside for every alignment at either edge", () => {
    const padding = 4;
    for (const align of aligns) {
      const edges: Array<["left" | "right", number]> = [["left", 12], ["right", 298]];
      for (const [edge, x] of edges) {
        const { rect } = draw({ text: "61.8%", at: { x, y: 20 }, align, baseline: "middle", style: STYLE, box: { fill: "#000", padding }, within: { left: 10, right: 300 } });
        const where = { align, edge };
        expect({ ...where, left: rect.x >= 10 }).toEqual({ ...where, left: true });
        expect({ ...where, right: rect.x + rect.width <= 300 }).toEqual({ ...where, right: true });
        // Crossing the edge it was placed at puts the box right on that edge.
        const onEdge = edge === "left" ? rect.x : rect.x + rect.width;
        const crossed = edge === "left" ? (align === "left" ? 12 - padding < 10 : true) : (align === "right" ? 298 + padding > 300 : true);
        if (crossed) expect({ ...where, onEdge }).toEqual({ ...where, onEdge: edge === "left" ? 10 : 300 });
      }
    }
  });

  it("pins an oversized padded box to the left edge, whatever its alignment", () => {
    for (const align of aligns) {
      const { rect } = draw({ text: "a label much wider than the range", at: { x: 50, y: 20 }, align, baseline: "middle", style: STYLE, box: { fill: "#000", padding: 6 }, within: { left: 20, right: 80 } });
      expect({ align, left: rect.x }).toEqual({ align, left: 20 });
    }
  });

  it("measures the text once when it is both bounded and boxed", () => {
    const context = fakeCanvasContext();
    const renderer = new CanvasRenderer({ width: 400, height: 300, context });
    renderer.drawText({ text: "x", at: { x: 1, y: 2 }, align: "right", baseline: "top", style: STYLE, box: { fill: "#000", padding: 2 }, within: { left: 0, right: 10 } });
    renderer.commit();
    expect(context.calls.filter((call) => call.method === "measureText")).toHaveLength(1);
  });

  it("pins the left edge when the text is wider than the range, letting it overflow right", () => {
    const { left, right } = draw({ text: "a very long level label", at: { x: 5, y: 20 }, align: "right", baseline: "middle", style: STYLE, within: { left: 20, right: 60 } });
    expect(left).toBe(20);
    expect(right).toBeGreaterThan(60);
  });

  it("is carried as-is by the recording renderer, which measures nothing", () => {
    const recorder = recordingRenderer();
    const target = recorder.factory({ width: 400, height: 300, context: fakeCanvasContext() });
    const params: TextParams = { text: "x", at: { x: 1, y: 2 }, align: "right", baseline: "top", style: STYLE, within: { left: 0, right: 10 } };
    target.drawText(params);
    target.commit();
    const [command] = recorder.commands().filter((c) => c.type === "drawText");
    expect(command).toEqual({ type: "drawText", params });
  });
});
