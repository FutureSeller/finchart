import { styleSpec } from "../render/style-spec";
import type { PlotArea } from "../primitives";
import type { DrawTarget, StyleReader, StyleSpec } from "../render";
import type { Tick } from "./types";

/**
 * A single label mounted on the axis — this belongs to decorations, not to
 * ticks. Crosshair value boxes and price line labels arrive in this shape.
 *
 * Why decorations only describe a badge instead of drawing it themselves:
 * when ticks live in the DOM, a box drawn on canvas can't cover that tick.
 * A badge exists precisely to cover a tick, so whoever draws the tick has
 * to draw the badge too — which makes it an input to the label renderer.
 * The color being a resolved value follows the same logic — the decoration
 * that builds the descriptor resolves CSS variables, the renderer doesn't
 * choose them.
 */
export interface AxisBadge {
  axis: "x" | "y";
  /** Same space as Tick.position (absolute px) — screen x for the x axis, screen y for the y axis. */
  position: number;
  label: string;
  /** Background color. Always having a background is what distinguishes it from a tick. */
  back: string;
  color: string;
}

/** Padding (px) around badge text. The DOM and canvas paths use the same value. */
export const BADGE_PADDING = 3;

export interface AxisLabelsInput {
  x: Tick[];
  y: Tick[];
  /** Axis labels described by decorations. They sit on top of ticks — later ones are on top. */
  badges: AxisBadge[];
  /** The area where data is drawn. Labels attach to this edge. */
  area: PlotArea;
  /**
   * The space layout allotted to the axis. `null` for an axis that mounts
   * no labels. The DOM path only needs an offset from the area's edge and
   * never reads this, but the canvas path needs to know this space to
   * paint and clip the background.
   */
  axes: { x: PlotArea | null; y: PlotArea | null };
  /**
   * This frame's style resolution — one per render, shared by everyone.
   * DOM labels don't read it since the browser resolves CSS variables for
   * them, but canvas labels draw on a surface that can't read variables,
   * so this is where the resolved value gets built.
   */
  readStyle: StyleReader;
}

/**
 * Whoever draws axis tick labels.
 *
 * Mounted in the DOM rather than on canvas — text selection, zoom, and
 * screen readers just work, and labels survive even though data redraws
 * every frame.
 */
export interface AxisLabelRenderer {
  render(input: AxisLabelsInput): void;
  clear(): void;
  destroy(): void;
}

/**
 * The places a label renderer can be mounted — each path uses something
 * different. DOM labels mount on the layer's overlay; canvas labels queue
 * commands on the `DrawTarget`.
 */
export interface AxisLabelsHost {
  /**
   * The layer's overlay, passed through as-is — core doesn't know what it
   * is. The DOM label gate narrows it, and a headless host (`null`) makes
   * it throw as a wiring error.
   */
  overlay: unknown;
  target: DrawTarget;
}

export type AxisLabelsFactory = (host: AxisLabelsHost) => AxisLabelRenderer;

/** Distance (px) a label sits from the data area's edge. Slice size counts this too. */
export const AXIS_LABEL_OFFSET = 6;

/**
 * The CSS variables an axis label owns. The DOM and canvas paths read the
 * same declarations — the two font variables are the exception, shared
 * with the legend, tooltip, and marker.
 */
export const AXIS_LABEL_SPEC = /* @__PURE__ */ styleSpec({
  fontSize: { css: "--chart-label-font-size", fallback: "11px" },
  fontFamily: { css: "--chart-label-font-family", fallback: "inherit" },
  color: { css: "--chart-label", fallback: "#64748b" },
}) satisfies StyleSpec<{ fontSize: string; fontFamily: string; color: string }>;

/** Fallback for the label color variable. The DOM and canvas paths use the same value. */
export const DEFAULT_LABEL_COLOR = AXIS_LABEL_SPEC.color.fallback;

/**
 * Resolves the font a DOM label actually uses into a CSS shorthand string
 * for measurement. Reads the same variable as the label style — reading a
 * different name would let the measured font and the drawn font diverge,
 * so the axis width couldn't fit the label.
 */
export function labelFont(readStyle: StyleReader): string {
  const size =
    readStyle(AXIS_LABEL_SPEC.fontSize.css) || AXIS_LABEL_SPEC.fontSize.fallback;
  return `${size} ${labelFontFamily(readStyle)}`;
}

/*
 * `labelFont` is public too — anything drawing text on canvas uses this,
 * not just the family. `labelFontFamily` is used inside it, and is
 * exported alongside it for a consumer that wants to assemble a font
 * string directly.
 */

/**
 * The family resolver everyone drawing text on canvas shares.
 *
 * `ctx.font` doesn't know `inherit` — using the spec's fallback
 * (`inherit`) as-is makes canvas throw the whole declaration out and draw
 * with the browser's default font instead. These three lines make
 * `inherit` real on canvas: variable → the container's computed
 * font-family → sans-serif.
 *
 * Axis labels, markers, and drawing labels all share this — if each held
 * its own literal sans-serif fallback, an app with a house font would end
 * up with axes following the page font while markers and Fibonacci labels
 * stayed stuck on the browser default.
 */
export function labelFontFamily(readStyle: StyleReader): string {
  return (
    readStyle(AXIS_LABEL_SPEC.fontFamily.css) ||
    readStyle("font-family") ||
    "sans-serif"
  );
}
