import { ContractError } from "@finchart/core";
import type { StyleReader, DrawTarget, LineStyle } from "@finchart/core";
import { labelFont } from "@finchart/core";
import type { Drawing } from "./drawings";
import { FIB_LEVELS, fibLevelPrice } from "./drawings";
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

export function drawOne(
  target: DrawTarget,
  space: DrawingSpace,
  readStyle: StyleReader,
  drawing: Drawing,
  style: LineStyle,
  isSelected: boolean,
): void {
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

    case "fib": {
      const a = toPixel(space, drawing.a);
      const b = toPixel(space, drawing.b);
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      const font = labelFont(readStyle);

      for (const level of FIB_LEVELS) {
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
