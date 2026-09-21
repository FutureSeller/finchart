import { FALLBACK_FONT, FontVerdicts, applyFont } from "./canvas-renderer";
import { RenderError } from "../primitives";
import { textHeight } from "./font-metrics";
import type { DrawSurface } from "./types";

export interface TextSize {
  width: number;
  height: number;
}

/**
 * How to measure text before drawing it. `drawText` leaves layout to the
 * renderer, so the caller doesn't know the size — that's fine most of the
 * time, but anywhere the measured result decides layout (the y-axis width
 * following its longest label) has to measure before drawing. It doesn't
 * take a color — font is all measuring needs.
 */
export interface TextMeasurer {
  measure(text: string, font: string): TextSize;
}

export type TextMeasurerFactory = (surface: DrawSurface) => TextMeasurer;

/**
 * The default implementation. Measures with the very context the renderer
 * replays onto — if measuring and drawing used different engines, the
 * axis width and the glyphs would drift apart and clip the label. Any
 * wiring that swaps the renderer for a different surface is responsible
 * for swapping the measurer along with it.
 */
export const createCanvasTextMeasurer: TextMeasurerFactory = (surface) => {
  const { context } = surface;
  if (!context) {
    throw new RenderError(
      "The canvas measurer needs a 2D context — a surface without one (headless) should omit the measurer or supply its own",
    );
  }

  /** The measurer holds its own too — separate from the renderer's, but both are correct. */
  const verdicts = new FontVerdicts();

  return {
    measure(text, font) {
      // Must set the font before measuring — measureText uses whatever
      // font is currently set. An invalid font goes through the same
      // demotion as the renderer and measures with the stale font, and
      // that value becomes the axis's width and height.
      const applied = applyFont(context, font, FALLBACK_FONT, verdicts);
      const metrics = context.measureText(text);
      // Measure with the font that was actually set (applied) — passing
      // the requested string would, on a surface without
      // fontBoundingBox*, produce a height in the px of a font that was
      // never actually set.
      return { width: metrics.width, height: textHeight(metrics, applied) };
    },
  };
};

export { textHeight } from "./font-metrics";
