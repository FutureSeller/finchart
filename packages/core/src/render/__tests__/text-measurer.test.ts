import { describe, expect, it } from "vitest";
import { fakeCanvasContext } from "../../__tests__/dom-fakes";
import { CanvasRenderer } from "../canvas-renderer";
import { createCanvasTextMeasurer } from "../text-measurer";
import type { DrawSurface } from "../types";

function measurer() {
  const context = fakeCanvasContext();
  const surface: DrawSurface = { width: 400, height: 300, context };
  return { measurer: createCanvasTextMeasurer(surface), context, surface };
}

describe("createCanvasTextMeasurer", () => {
  it("should set the font before measuring", () => {
    const { measurer: m, context } = measurer();

    m.measure("104,500", "11px Inter, sans-serif");

    const fontSet = context.calls.findIndex(
      (call) => call.method === "set:font",
    );
    const measured = context.calls.findIndex(
      (call) => call.method === "measureText",
    );
    expect(fontSet).toBeGreaterThanOrEqual(0);
    expect(fontSet).toBeLessThan(measured);
    expect(context.calls[fontSet].args).toEqual(["11px Inter, sans-serif"]);
  });

  it("should return the context's measured width", () => {
    const { measurer: m } = measurer();

    // The fake context returns 7px per character.
    expect(m.measure("12345", "11px sans-serif").width).toBe(35);
  });

  it("should fall back to the font px when metrics lack a bounding box", () => {
    const { measurer: m } = measurer();

    // The default fake deliberately omits fontBoundingBox* — the minimal-surface path.
    expect(m.measure("42", "600 13px Inter").height).toBe(13);
  });

  it("should use font bounding box metrics when the surface provides them", () => {
    const context = fakeCanvasContext();
    context.measureText = () =>
      ({
        width: 20,
        fontBoundingBoxAscent: 10,
        fontBoundingBoxDescent: 3,
      }) as TextMetrics;
    const m = createCanvasTextMeasurer({ width: 400, height: 300, context });

    expect(m.measure("42", "11px sans-serif").height).toBe(13);
  });

  it("should fall back to the font px when the bounding box has no height", () => {
    const context = fakeCanvasContext();
    // A zero-height box would collapse the label box and the axis rows built from it.
    context.measureText = () => ({
      width: 20,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
    });
    const m = createCanvasTextMeasurer({ width: 400, height: 300, context });

    expect(m.measure("42", "11px sans-serif").height).toBe(11);
  });

  it("should fall back to a constant for non-px fonts", () => {
    const { measurer: m } = measurer();

    expect(m.measure("42", "1em serif").height).toBe(12);
  });

  /**
   * Measuring and drawing must agree ("measure in exactly one
   * place"). If the renderer's box size disagrees with the measurer's
   * answer, the axis width won't fit the label.
   */
  it("should agree with the box the renderer draws", () => {
    const { measurer: m, context, surface } = measurer();
    const font = "11px sans-serif";
    const size = m.measure("104,500", font);

    const renderer = new CanvasRenderer(surface);
    renderer.drawText({
      text: "104,500",
      at: { x: 100, y: 50 },
      align: "left",
      baseline: "top",
      style: { font, color: "#fff" },
      box: { fill: "#000", padding: 0 },
    });
    renderer.commit();

    const box = context.calls.find((call) => call.method === "fillRect");
    expect(box?.args?.[2]).toBe(size.width);
    expect(box?.args?.[3]).toBe(size.height);
  });
});
