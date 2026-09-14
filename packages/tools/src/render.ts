import { ContractError } from "@finchart/core";
import type {
  StyleReader,
  StyleSpec,
  DrawTarget,
  LineStyle,
} from "@finchart/core";
import { labelFont, resolveStyle, styleSpec } from "@finchart/core";
import type { Drawing } from "./drawings";
import {
  channelParallel,
  fibExtensionLevels,
  fibExtensionPrice,
  fibLevelPrice,
  fibLevels,
  pitchforkLines,
  priceMeasureDelta,
} from "./drawings";
import {
  ellipseOutline,
  fibExtensionSpan,
  infiniteEndpoints,
  rectangleOutline,
} from "./hit";
import type { DrawingSpace } from "./space";
import { toPixel } from "./space";

/*
 * Doesn't redeclare the Fibonacci label font here — `--chart-label-font-family`
 * is owned by core's `AXIS_LABEL_SPEC`. Declaring a separate fallback here
 * would give the same token two default values, so in an app with a
 * custom font, the axis labels would follow the page font while the
 * Fibonacci labels alone stayed on the browser default. Only reads core's
 * `labelFontFamily`.
 */

/**
 * The endpoint handle's radius (px). Only shown on a selected drawing —
 * showing it always would clutter the screen as drawings pile up. The
 * grabbable range itself is independent of the handle's visible radius
 * (`HANDLE_TOLERANCE`).
 */
const HANDLE_RADIUS = 4;

/**
 * The text on a measure's label box. The box itself is the drawing's
 * color (the crosshair badge precedent — a box that covers things wears
 * the strong color, the text the light one), so only the text needs a
 * token of its own.
 */
export const DRAWING_LABEL_SPEC = /* @__PURE__ */ styleSpec({
  color: { css: "--chart-drawing-label", fallback: "#f8fafc" },
}) satisfies StyleSpec<{ color: string }>;

/** Padding (px) around a measure label's text, inside its box. */
const LABEL_PADDING = 3;

/**
 * What rendering needs beyond the coordinate space: the theme reader,
 * the pane's value formatter (a price measure's delta wears the axis's
 * own digits), and the pane's bar index at an x (a bar measure counts
 * bars, and only the data knows where the bars are — the x mapping's
 * domain is time under a continuous mapping, so it can't).
 */
export interface DrawingRenderContext {
  readStyle: StyleReader;
  /** The pane's value formatter — the same one its axis labels use. */
  formatValue: (value: number) => string;
  /** The index of the bar nearest `x` in the pane's data — `null` when there is no bar at all. */
  barIndexAt: (x: number) => number | null;
}

/** A signed number in the pane's format — `+`/`-` in front of the magnitude. */
function signed(value: number, format: (value: number) => string): string {
  return `${value < 0 ? "-" : "+"}${format(Math.abs(value))}`;
}

/** The delta and, when the base isn't zero, the percent move. */
function priceMeasureLabel(
  drawing: Extract<Drawing, { type: "priceMeasure" }>,
  format: (value: number) => string,
): string {
  const delta = priceMeasureDelta(drawing);
  const text = signed(delta, format);
  if (drawing.a.price === 0) return text;
  const percent = (delta / drawing.a.price) * 100;
  return `${text} (${percent < 0 ? "-" : "+"}${Math.abs(percent).toFixed(2)}%)`;
}

/**
 * Whole bars between the anchors — the nearest bar at each end, so a
 * gap between bars counts as what it is. `null` without data: a count
 * that can't be taken isn't drawn (a label reading "0 bars" over an
 * empty pane would be the quietly-wrong side).
 */
function barMeasureLabel(
  drawing: Extract<Drawing, { type: "barMeasure" }>,
  barIndexAt: (x: number) => number | null,
): string | null {
  const from = barIndexAt(drawing.a.x);
  const to = barIndexAt(drawing.b.x);
  if (from === null || to === null) return null;
  const bars = Math.abs(to - from);
  return `${bars} ${bars === 1 ? "bar" : "bars"}`;
}

/** Endpoint handles — the selected drawing's grab points. */
function drawHandles(
  target: DrawTarget,
  points: readonly { x: number; y: number }[],
  fill: string,
): void {
  for (const point of points) {
    target.drawShape({
      shape: "circle",
      cx: point.x,
      cy: point.y,
      r: HANDLE_RADIUS,
      fill,
    });
  }
}

/** Arrowhead barb: length (px) and sweep angle off the shaft. */
const ARROW_BARB_LENGTH = 9;
const ARROW_BARB_ANGLE = Math.PI / 7;

/** One barb endpoint — swept back from the tip `b` along the shaft from `a`. */
function barbPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  angle: number,
): { x: number; y: number } {
  // Unit vector back along the shaft, rotated around the tip.
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const span = Math.hypot(dx, dy);
  if (span === 0) return { x: b.x, y: b.y };
  const ux = dx / span;
  const uy = dy / span;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: b.x + (ux * cos - uy * sin) * ARROW_BARB_LENGTH,
    y: b.y + (ux * sin + uy * cos) * ARROW_BARB_LENGTH,
  };
}

/**
 * Keeps a Fibonacci level label inside the pane — but only while the
 * drawing's levels (`left`..`right`) reach into it. A drawing panned wholly
 * off the pane keeps its labels off with it; pulling them in would leave
 * percentages with no levels beside them.
 */
function labelBounds(
  space: DrawingSpace,
  left: number,
  right: number,
): { within?: { left: number; right: number } } {
  const { area } = space;
  return right >= area.left && left <= area.right ? { within: { left: area.left, right: area.right } } : {};
}

export function drawOne(
  target: DrawTarget,
  space: DrawingSpace,
  context: DrawingRenderContext,
  drawing: Drawing,
  style: LineStyle,
  isSelected: boolean,
): void {
  const { readStyle } = context;
  switch (drawing.type) {
    case "horizontal": {
      // Anything spilling outside the pane gets clipped by core —
      // "whoever hands out the area does the clipping" (`plot.ts`). Same
      // world as series and other drawings.
      const y = space.pixelAtValue(drawing.price);

      target.drawLine(
        [
          { x: space.area.left, y },
          { x: space.area.right, y },
        ],
        style,
      );
      if (isSelected) {
        // A horizontal line has no endpoints — its selection marker is
        // a single handle at the middle of the screen.
        target.drawShape({
          shape: "circle",
          cx: (space.area.left + space.area.right) / 2,
          cy: y,
          r: HANDLE_RADIUS,
          fill: style.color,
        });
      }
      return;
    }

    case "vertical": {
      const x = space.pixelAtX(drawing.x);

      target.drawLine(
        [
          { x, y: space.area.top },
          { x, y: space.area.bottom },
        ],
        style,
      );
      if (isSelected) {
        // The dual of the horizontal line — one handle at mid-height.
        target.drawShape({
          shape: "circle",
          cx: x,
          cy: (space.area.top + space.area.bottom) / 2,
          r: HANDLE_RADIUS,
          fill: style.color,
        });
      }
      return;
    }

    case "ray":
    case "extended": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);

      // The same overshoot endpoints hit-testing checks — the pane clips
      // the spill (whoever hands out the area does the clipping).
      target.drawLine(infiniteEndpoints(drawing.type, a, b, space), style);
      if (isSelected) {
        for (const point of [a, b]) {
          target.drawShape({
            shape: "circle",
            cx: point.x,
            cy: point.y,
            r: HANDLE_RADIUS,
            fill: style.color,
          });
        }
      }
      return;
    }

    case "arrow": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);

      target.drawLine([a, b], style);
      // The arrowhead: two barbs swept back from the tip. Presentation
      // only — the hit target stays the segment.
      for (const angle of [ARROW_BARB_ANGLE, -ARROW_BARB_ANGLE]) {
        target.drawLine([b, barbPoint(a, b, angle)], style);
      }
      if (isSelected) {
        for (const point of [a, b]) {
          target.drawShape({
            shape: "circle",
            cx: point.x,
            cy: point.y,
            r: HANDLE_RADIUS,
            fill: style.color,
          });
        }
      }
      return;
    }

    case "trend": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);

      target.drawLine([a, b], style);
      if (isSelected) {
        // Endpoint handles — show it's selected and can be grabbed and moved.
        target.drawShape({
          shape: "circle",
          cx: a.x,
          cy: a.y,
          r: HANDLE_RADIUS,
          fill: style.color,
        });
        target.drawShape({
          shape: "circle",
          cx: b.x,
          cy: b.y,
          r: HANDLE_RADIUS,
          fill: style.color,
        });
      }
      return;
    }

    case "rectangle":
    case "ellipse": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);

      // The same outline hit-testing walks, closed back to its start.
      const outline =
        drawing.type === "rectangle"
          ? rectangleOutline(a, b)
          : ellipseOutline(a, b);
      target.drawLine([...outline, outline[0]], style);
      if (isSelected) {
        // The anchors are the box's opposite corners — same handles as a
        // trend line, so the grab vocabulary doesn't change per kind.
        for (const point of [a, b]) {
          target.drawShape({
            shape: "circle",
            cx: point.x,
            cy: point.y,
            r: HANDLE_RADIUS,
            fill: style.color,
          });
        }
      }
      return;
    }

    case "priceMeasure":
    case "barMeasure": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);

      target.drawLine([a, b], style);
      // The label sits on the segment's midpoint in a box of the
      // drawing's color. Sizing is the receiver's job (`TextParams.box`)
      // — the tool never measures text.
      const text =
        drawing.type === "priceMeasure"
          ? priceMeasureLabel(drawing, context.formatValue)
          : barMeasureLabel(drawing, context.barIndexAt);
      if (text !== null) {
        const label = resolveStyle(DRAWING_LABEL_SPEC, readStyle);
        target.drawText({
          text,
          at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          align: "center",
          baseline: "middle",
          style: { font: labelFont(readStyle), color: label.color },
          box: { fill: style.color, padding: LABEL_PADDING },
        });
      }
      if (isSelected) {
        for (const point of [a, b]) {
          target.drawShape({
            shape: "circle",
            cx: point.x,
            cy: point.y,
            r: HANDLE_RADIUS,
            fill: style.color,
          });
        }
      }
      return;
    }

    case "parallelChannel": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);
      const c = toPixel(space, drawing.c);

      target.drawLine([a, b], style);
      // The parallel comes from the same price-space formula
      // hit-testing reads.
      const [p, q] = channelParallel(drawing).map((anchor) => toPixel(space, anchor));
      target.drawLine([p, q], style);
      if (isSelected) drawHandles(target, [a, b, c], style.color);
      return;
    }

    case "pitchfork": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);
      const c = toPixel(space, drawing.c);

      for (const [from, through] of pitchforkLines(drawing)) {
        target.drawLine(
          infiniteEndpoints("ray", toPixel(space, from), toPixel(space, through), space),
          style,
        );
      }
      target.drawLine([b, c], style);
      if (isSelected) drawHandles(target, [a, b, c], style.color);
      return;
    }

    case "fibExtension": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);
      const c = toPixel(space, drawing.c);
      const [left, right] = fibExtensionSpan(a, b, c);
      const font = labelFont(readStyle);

      // The swing legs first, so the levels read as projected from them.
      target.drawLine([a, b, c], style);
      for (const level of fibExtensionLevels(drawing)) {
        const y = space.pixelAtValue(fibExtensionPrice(drawing, level));
        target.drawLine(
          [
            { x: left, y },
            { x: right, y },
          ],
          style,
        );
        target.drawText({
          text: `${(level * 100).toFixed(1)}%`,
          at: { x: left - 4, y },
          align: "right",
          baseline: "middle",
          style: { font, color: style.color },
          // Near the pane's edge the label would spill out and be cut off.
          ...labelBounds(space, left, right),
        });
      }
      if (isSelected) drawHandles(target, [a, b, c], style.color);
      return;
    }

    case "fib": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const font = labelFont(readStyle);

      for (const level of fibLevels(drawing)) {
        const price = fibLevelPrice(drawing, level);
        const y = space.pixelAtValue(price);

        target.drawLine(
          [
            { x: left, y },
            { x: right, y },
          ],
          style,
        );
        target.drawText({
          text: `${(level * 100).toFixed(1)}%`,
          at: { x: left - 4, y },
          align: "right",
          baseline: "middle",
          style: { font, color: style.color },
          // Near the pane's edge the label would spill out and be cut off.
          ...labelBounds(space, left, right),
        });
      }

      if (isSelected) {
        // Endpoint handles — grabbed with the same vocabulary as a trend line.
        for (const end of [a, b]) {
          target.drawShape({
            shape: "circle",
            cx: end.x,
            cy: end.y,
            r: HANDLE_RADIUS,
            fill: style.color,
          });
        }
      }
      return;
    }
  }

  // A fourth kind breaks the compile here.
  const unreachable: never = drawing;
  throw new ContractError(`unknown drawing: ${JSON.stringify(unreachable)}`);
}
