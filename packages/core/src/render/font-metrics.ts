import type { TextMetricsLike } from "./types";

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
