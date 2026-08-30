import { resolveStyle, type TextStyle } from "../render";
import {
  AXIS_LABEL_OFFSET,
  AXIS_LABEL_SPEC,
  BADGE_PADDING,
  labelFont,
  type AxisLabelsFactory,
} from "./labels";

/**
 * Draws tick labels on canvas instead of DOM. The default is still DOM
 * (`createDomAxisLabels`) — text selection, zoom, and screen readers come
 * free with it. This path is for places where the whole picture has to
 * live on a single surface (screenshots, server-side / offscreen render).
 *
 * Label placement follows the same convention as the DOM path — if the two
 * paths drew at different spots, the chart would appear to shift when you
 * switch wiring.
 */
export const createCanvasAxisLabels: AxisLabelsFactory = ({ target }) => ({
  render({ x, y, badges, area, axes, readStyle }) {
    const font = labelFont(readStyle);
    const yRight = axes.y !== null && axes.y.left >= area.right;
    const yEdge = yRight
      ? area.right + AXIS_LABEL_OFFSET
      : area.left - AXIS_LABEL_OFFSET;
    const yAlign = yRight ? ("left" as const) : ("right" as const);
    const style: TextStyle = {
      font,
      color: resolveStyle(AXIS_LABEL_SPEC, readStyle).color,
    };

    for (const tick of x) {
      target.drawText({
        text: tick.label,
        at: { x: tick.position, y: area.bottom + AXIS_LABEL_OFFSET },
        align: "center",
        baseline: "top",
        style,
      });
    }

    for (const tick of y) {
      target.drawText({
        text: tick.label,
        at: { x: yEdge, y: tick.position },
        align: yAlign,
        baseline: "middle",
        style,
      });
    }

    // Badges come after ticks — command order is stacking order, so the value box covers the tick.
    for (const badge of badges) {
      const horizontal = badge.axis === "x";
      target.drawText({
        text: badge.label,
        at: horizontal
          ? { x: badge.position, y: area.bottom + AXIS_LABEL_OFFSET }
          : { x: yEdge, y: badge.position },
        align: horizontal ? "center" : yAlign,
        baseline: horizontal ? "top" : "middle",
        style: { font, color: badge.color },
        box: { fill: badge.back, padding: BADGE_PADDING },
      });
    }
  },

  clear() {
    // The renderer clears the command list at the start of each frame — nothing to clear here.
  },

  destroy() {
    // Nothing was created.
  },
});
