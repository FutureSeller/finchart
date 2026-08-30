/**
 * Text layout is the renderer's job, not the caller's
 *
 * What's checked here is "does the caller get to stay ignorant of size?"
 * Given just an anchor and alignment, the box has to wrap the text, and
 * that whole calculation has to happen inside here.
 */
import { describe, expect, it } from "vitest";
import {
  drawnTexts,
  fakeCanvasContext,
  filledRects,
} from "../../__tests__/dom-fakes";
import { CanvasRenderer } from "../canvas-renderer";
import type { Canvas2DContext, DrawSurface, TextStyle } from "../types";

/** The fake measures 7px per character. "abcd" comes to 28px. */
const CHAR = 7;
const STYLE: TextStyle = { font: "600 12px Inter, sans-serif", color: "#111" };

function renderer(width = 400, height = 300) {
  const context = fakeCanvasContext();
  const surface: DrawSurface = { width, height, context };
  return { renderer: new CanvasRenderer(surface), context };
}

describe("CanvasRenderer.drawText", () => {
  it("should not touch the context until commit", () => {
    const { renderer: r, context } = renderer();

    r.drawText({
      text: "hi",
      at: { x: 10, y: 20 },
      align: "left",
      baseline: "top",
      style: STYLE,
    });

    expect(context.calls).toHaveLength(0);
  });

  it("should hand the resolved font straight through", () => {
    const { renderer: r, context } = renderer();

    r.drawText({
      text: "42.50",
      at: { x: 10, y: 20 },
      align: "left",
      baseline: "top",
      style: STYLE,
    });
    r.commit();

    // The renderer doesn't choose or augment the font — it passes the string through unchanged.
    expect(drawnTexts(context)).toEqual([
      {
        text: "42.50",
        x: 10,
        y: 20,
        font: "600 12px Inter, sans-serif",
        color: "#111",
        align: "left",
        baseline: "top",
      },
    ]);
  });

  it("should measure with the font already applied", () => {
    const { renderer: r, context } = renderer();

    r.drawText({
      text: "abc",
      at: { x: 0, y: 0 },
      align: "left",
      baseline: "top",
      style: STYLE,
      box: { fill: "#eee", padding: 0 },
    });
    r.commit();

    // If the font assignment doesn't happen before measureText, the width comes out based on the default font.
    const methods = context.calls.map((call) => call.method);
    expect(methods.indexOf("set:font")).toBeLessThan(
      methods.indexOf("measureText"),
    );
  });

  it("should size the box from the measured text", () => {
    const { renderer: r, context } = renderer();

    r.drawText({
      text: "abcd", // 4 * 7 = 28px
      at: { x: 100, y: 50 },
      align: "left",
      baseline: "top",
      style: STYLE,
      box: { fill: "#222", padding: 3 },
    });
    r.commit();

    expect(filledRects(context)).toEqual([
      {
        x: 100 - 3,
        y: 50 - 3,
        width: 4 * CHAR + 6,
        // With no metrics available, it falls back to the font's 12px.
        height: 12 + 6,
        fill: "#222",
      },
    ]);
  });

  it("should put the box behind the text", () => {
    const { renderer: r, context } = renderer();

    r.drawText({
      text: "x",
      at: { x: 0, y: 0 },
      align: "left",
      baseline: "top",
      style: STYLE,
      box: { fill: "#222", padding: 2 },
    });
    r.commit();

    const methods = context.calls.map((call) => call.method);
    expect(methods.indexOf("fillRect")).toBeLessThan(
      methods.indexOf("fillText"),
    );
  });

  it("should not draw a box when none was asked for", () => {
    const { renderer: r, context } = renderer();

    r.drawText({
      text: "x",
      at: { x: 0, y: 0 },
      align: "left",
      baseline: "top",
      style: STYLE,
    });
    r.commit();

    expect(filledRects(context)).toEqual([]);
  });

  describe("box placement follows the anchor", () => {
    /** "ab" = 14px wide, 12px tall, padding 0. The anchor is (100, 50). */
    const cases: Array<{
      align: "left" | "center" | "right";
      baseline: "top" | "middle" | "bottom";
      x: number;
      y: number;
    }> = [
      { align: "left", baseline: "top", x: 100, y: 50 },
      { align: "center", baseline: "top", x: 100 - 7, y: 50 },
      { align: "right", baseline: "top", x: 100 - 14, y: 50 },
      { align: "left", baseline: "middle", x: 100, y: 50 - 6 },
      { align: "left", baseline: "bottom", x: 100, y: 50 - 12 },
    ];

    it.each(cases)("$align / $baseline", ({ align, baseline, x, y }) => {
      const { renderer: r, context } = renderer();

      r.drawText({
        text: "ab",
        at: { x: 100, y: 50 },
        align,
        baseline,
        style: STYLE,
        box: { fill: "#000", padding: 0 },
      });
      r.commit();

      expect(filledRects(context)[0]).toMatchObject({ x, y });
    });
  });

  it("should prefer real font metrics over parsing the font string", () => {
    // A surface that provides metrics. The box height should come out as 14px, not 12px (the font size).
    const base = fakeCanvasContext();
    const context = {
      ...base,
      measureText: (text: string) =>
        ({
          width: text.length * CHAR,
          fontBoundingBoxAscent: 11,
          fontBoundingBoxDescent: 3,
        }) as TextMetrics,
    } as unknown as Canvas2DContext;

    const r = new CanvasRenderer({ width: 400, height: 300, context });
    r.drawText({
      text: "ab",
      at: { x: 0, y: 0 },
      align: "left",
      baseline: "top",
      style: STYLE,
      box: { fill: "#000", padding: 0 },
    });
    r.commit();

    expect(filledRects(base)[0]).toMatchObject({ height: 14 });
  });

  it("should keep commands cloneable", () => {
    const { renderer: r } = renderer();

    r.drawText({
      text: "hi",
      at: { x: 1, y: 2 },
      align: "center",
      baseline: "middle",
      style: STYLE,
      box: { fill: "#000", padding: 2 },
    });

    // Commands must be pure data to be sendable to a worker or assertable in a test.
    expect(() => structuredClone(r.getCommands())).not.toThrow();
    expect(structuredClone(r.getCommands())).toEqual(r.getCommands());
  });
});
