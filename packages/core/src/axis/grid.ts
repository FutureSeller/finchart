import type { PlotArea } from "../primitives";
import type { DrawTarget, LineStyle } from "../render";

/**
 * The minimum drawing capability a grid needs — just drawing lines.
 *
 * Pulled out of `DrawTarget` down to only what's needed. It requires
 * neither shapes nor text, so anything that can draw a grid only needs to
 * be able to draw a line.
 */
export type GridTarget = Pick<DrawTarget, "drawLine">;

export interface GridOptions {
  /** x coordinates to draw vertical lines at (x-axis tick positions) */
  verticals: number[];
  /** y coordinates to draw horizontal lines at (y-axis tick positions) */
  horizontals: number[];
  area: PlotArea;
  style: LineStyle;
}

/**
 * Draws grid lines at already-computed tick positions.
 *
 * The caller (`Plot`) computes ticks exactly once, so the grid and the
 * labels share the same values — computing them separately would let them
 * drift apart eventually.
 */
export function drawGrid(target: GridTarget, options: GridOptions): void {
  const { verticals, horizontals, area, style } = options;

  for (const x of verticals) {
    target.drawLine(
      [
        { x, y: area.top },
        { x, y: area.bottom },
      ],
      style,
    );
  }

  for (const y of horizontals) {
    target.drawLine(
      [
        { x: area.left, y },
        { x: area.right, y },
      ],
      style,
    );
  }
}
