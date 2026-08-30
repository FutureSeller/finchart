import { FALLBACK_FONT, FontVerdicts, applyFont } from "./canvas-renderer";
import { RenderError } from "../primitives";
import type { DrawSurface, TextMetricsLike } from "./types";

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

/**
 * The vertical size a single line of text takes up. `fontBoundingBox*` is
 * used because it doesn't wobble from glyph to glyph — measuring with
 * `actualBoundingBox*` gives "42" and "42.5" different box heights, and
 * the axis value box would jitter as the cursor moves.
 *
 * Falls back to the font string's px when it's absent. A surface that only
 * satisfies the minimal `Canvas2DContext` can return width alone — that's
 * a valid implementation too.
 */
export function textHeight(metrics: TextMetricsLike, font: string): number {
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } =
    metrics;

  // Must be positive — checking only finiteness would let a negative
  // through, pushing anchorTop the wrong way and making fillRect a no-op.
  // This value also feeds the y-axis width and row spacing.
  const height = Number(ascent) + Number(descent);
  if (
    typeof ascent === "number" &&
    typeof descent === "number" &&
    Number.isFinite(height) &&
    height > 0
  ) {
    return height;
  }
  return fontPixelSize(font);
}

/**
 * `"600 12px Inter, sans-serif"` → 12
 *
 * Reads token by token — running a regex over the raw string anywhere
 * could pick up a number inside the family name (`"1em 'Foo 20px Mono'"` →
 * 20, a spot where failing to read it is the right answer since the size
 * is in `em`). Style, variant, weight, and stretch can all come before the
 * size, and weight among them is a unitless number (`600`) — the first
 * token with a unit is the size, so it stops there.
 */
function fontPixelSize(font: string): number {
  for (const token of font.trim().split(/\s+/)) {
    const size = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]+)(?:\/\S+)?$/i.exec(token);
    // No unit means it's a weight (`600`) — not the size yet.
    if (!size) continue;
    const px = size[2].toLowerCase() === "px" ? Number(size[1]) : Number.NaN;
    return Number.isFinite(px) && px > 0 ? px : FALLBACK_FONT_PX;
  }
  return FALLBACK_FONT_PX;
}

/**
 * Where things land once a font unit other than px shows up (em, rem, a
 * keyword). It doesn't have to match the renderer's `FALLBACK_FONT_SIZE`
 * (11px) — that one is the size standing in for a rejected font, while
 * this one is the guess for when an accepted font's size couldn't be read
 * as px.
 */
const FALLBACK_FONT_PX = 12;
