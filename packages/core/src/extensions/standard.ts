import type { LineStyle, StyleSpec } from "../render";
import { resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";
import {
  ContractError,
  requireDataArray,
  requireDataPoint,
  requireFinite,
  requireInterval,
  requireObject,
} from "../primitives";
import { labelFont } from "../axis";
import type { PaneDecoration, PlotDecoration } from "../plot/decoration";

/**
 * The standard decoration set — all small functions built on the existing
 * contract. `priceLine` and `markers` use the value axis, so they're pane
 * decorations; `watermark` and `span` belong to the chart itself, so
 * they're plot decorations.
 */

export interface PriceLineOptions {
  value: number;
  /** Line style. Defaults to a faint dotted line. */
  style?: Partial<LineStyle>;
  /** Label for the y-axis badge — a wholesale override. If omitted, `format` (or the axis's own wording if that's absent too) formats the value. */
  label?: string;
  /** Value format for the badge. Defaults to that pane's y wording (`formatY`). */
  format?: (value: number) => string;
  /** Turns off the badge. Defaults to on — a price line's whole reason to exist is the axis value. */
  badge?: boolean;
}

/**
 * The CSS variables the price line owns. Width and dash are leaves too —
 * every place reachable through `options.style` takes part in the same
 * three tiers (override > variable > default).
 */
export const PRICE_LINE_SPEC = /* @__PURE__ */ styleSpec({
  width: { css: "--chart-price-line-width", fallback: 1 },
  color: { css: "--chart-price-line", fallback: "#94a3b8" },
  dashArray: { css: "--chart-price-line-dash", fallback: "4,3" },
}) satisfies StyleSpec<LineStyle>;

/** Badge text color. A code constant, not a token, since it's not reachable through `options.style`. */
export const BADGE_TEXT_COLOR = "#ffffff";

/**
 * A horizontal price line — where a target price or stop-loss line
 * belongs. It's a decoration rather than a registered series because a
 * series would drag the value axis along with it.
 *
 * ```ts
 * pane.addDecoration(priceLine({ value: 205, label: "Target" }));
 * ```
 */
export function priceLine(options: PriceLineOptions): PaneDecoration {
  // Without this check, a string value would pass through and draw with garbage coordinates.
  requireObject(options, "priceLine(options)");
  requireFinite(options.value, "priceLine value");
  return {
    draw(target, { area, yScale, readStyle }) {
      const y = yScale.scale(options.value);
      if (y < area.top || y > area.bottom) return;

      target.drawLine(
        [
          { x: area.left, y },
          { x: area.right, y },
        ],
        resolveStyle(PRICE_LINE_SPEC, readStyle, options.style),
      );
    },

    axisBadges({ yScale, area, readStyle, formatY }) {
      if (options.badge === false) return [];
      const y = yScale.scale(options.value);
      if (y < area.top || y > area.bottom) return [];

      const { color } = resolveStyle(PRICE_LINE_SPEC, readStyle, options.style);
      return [
        {
          axis: "y",
          position: y,
          // label (wholesale override) > format > the axis's own wording.
          label:
            options.label ?? (options.format ?? formatY)(options.value),
          back: color,
          color: BADGE_TEXT_COLOR,
        },
      ];
    },
  };
}

export interface Marker {
  x: number;
  /** The marker's value position (that pane's value axis). */
  price: number;
  shape?: "circle" | "arrowUp" | "arrowDown";
  color?: string;
  /** Text attached above the shape (below it for `arrowDown`). */
  text?: string;
}

/**
 * The CSS variable the marker owns. Size isn't a leaf — there's no
 * override for it at all.
 *
 * The font isn't declared here — the two font variables belong to the axis
 * label (`AXIS_LABEL_SPEC`), and `labelFont` is what realizes that
 * declaration on canvas. The marker only reads it — a separate declaration
 * would give the same token two sets of defaults.
 */
export const MARKER_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  color: { css: "--chart-marker", fallback: "#f59e0b" },
}) satisfies StyleSpec<{ color: string }>;

const MARKER_SIZE = 5;

/**
 * Markers on top of a series — buy/sell points, events. Since it's a
 * decoration, it doesn't take part in value-axis fitting, so a marker
 * never drags the axis along.
 */
export function markers(items: readonly Marker[]): PaneDecoration {
  // Without this check, a wrong type would pass through as-is and draw garbage commands.
  requireDataArray(items, "markers(items)");
  items.forEach((marker, i) => {
    requireDataPoint(marker, i, "markers(items)");
    requireFinite(marker.x, `markers[${i}].x`);
    requireFinite(marker.price, `markers[${i}].price`);
  });
  return {
    draw(target, { area, x: mapping, yScale, readStyle }) {
      const base = resolveStyle(MARKER_STYLE_SPEC, readStyle);
      const fallback = base.color;
      // Both size and family go through the resolver — ctx.font doesn't
      // know `inherit`, and a literal size would stop --chart-label-font-size from being followed.
      const font = labelFont(readStyle);

      for (const marker of items) {
        const cx = mapping.toPixel(marker.x);
        const cy = yScale.scale(marker.price);
        if (cx < area.left || cx > area.right) continue;
        if (cy < area.top || cy > area.bottom) continue;

        const color = marker.color ?? fallback;
        const shape = marker.shape ?? "circle";

        if (shape === "circle") {
          target.drawShape({ shape: "circle", cx, cy, r: MARKER_SIZE, fill: color });
        } else {
          const up = shape === "arrowUp";
          const tip = up ? cy : cy;
          const base = up ? cy + MARKER_SIZE * 2 : cy - MARKER_SIZE * 2;
          target.drawShape({
            shape: "polygon",
            points: [
              { x: cx, y: tip },
              { x: cx - MARKER_SIZE, y: base },
              { x: cx + MARKER_SIZE, y: base },
            ],
            fill: color,
          });
        }

        if (marker.text) {
          const above = shape !== "arrowDown";
          target.drawText({
            text: marker.text,
            at: { x: cx, y: above ? cy - MARKER_SIZE * 2 - 2 : cy + MARKER_SIZE * 2 + 2 },
            align: "center",
            baseline: above ? "bottom" : "top",
            style: { font, color },
          });
        }
      }
    },
  };
}

export interface WatermarkOptions {
  text: string;
  /** Full CSS font shorthand. Defaults to "700 44px sans-serif". */
  font?: string;
  color?: string;
}

export const WATERMARK_SPEC = /* @__PURE__ */ styleSpec({
  color: { css: "--chart-watermark", fallback: "rgba(100, 116, 139, 0.14)" },
}) satisfies StyleSpec<{ color: string }>;

/** Faint text in the middle of the chart — where a symbol name belongs. */
export function watermark(options: WatermarkOptions): PlotDecoration {
  requireObject(options, "watermark(options)");
  // `text` is required. Without it, `undefined` would draw on canvas as the literal string "undefined".
  if (typeof options.text !== "string") {
    throw new ContractError(
      `watermark({ text }) must be a string, got ${typeof options.text}`,
    );
  }
  return {
    draw(target, { area, readStyle }) {
      target.drawText({
        text: options.text,
        at: {
          x: (area.left + area.right) / 2,
          y: (area.top + area.bottom) / 2,
        },
        align: "center",
        baseline: "middle",
        style: {
          // font isn't a leaf — no CSS variable, just a code constant with option > default.
          font: options.font ?? "700 44px sans-serif",
          color: resolveStyle(WATERMARK_SPEC, readStyle, {
            color: options.color,
          }).color,
        },
      });
    },
  };
}

export interface SpanOptions {
  /** Data x values — both ends of the interval. */
  from: number;
  to: number;
  fill?: string;
}

export const SPAN_SPEC = /* @__PURE__ */ styleSpec({
  fill: { css: "--chart-span", fallback: "rgba(59, 130, 246, 0.08)" },
}) satisfies StyleSpec<{ fill: string }>;

/**
 * An x-interval highlight — for a backtest position or an event window.
 * Since it's a plot decoration, it cuts vertically through every pane.
 */
export function span(options: SpanOptions): PlotDecoration {
  requireObject(options, "span(options)");
  requireInterval(options.from, options.to, "span");
  return {
    draw(target, { area, x: mapping, readStyle }) {
      const left = Math.max(mapping.toPixel(options.from), area.left);
      const right = Math.min(mapping.toPixel(options.to), area.right);
      if (right <= left) return;

      target.drawShape({
        shape: "rect",
        x: left,
        y: area.top,
        width: right - left,
        height: area.bottom - area.top,
        fill: resolveStyle(SPAN_SPEC, readStyle, { fill: options.fill }).fill,
      });
    },
  };
}
