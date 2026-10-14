export interface Point {
  x: number;
  y: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The actual plot area after subtracting padding. Screen coordinates (px). */
export interface PlotArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function plotAreaOf(
  size: { width: number; height: number },
  padding: Padding,
): PlotArea {
  return {
    left: padding.left,
    right: size.width - padding.right,
    top: padding.top,
    bottom: size.height - padding.bottom,
  };
}

/**
 * Is the point inside the area? On the boundary counts as inside: the
 * plot-interior rule, used by pane lookup (`PaneStack.at`), axis drag's slice
 * test and the crosshair magnet. Keyboard ownership and drawing grabs (core
 * `containsFocus`, tools `ownsPoint` and `gripAt`) use a half-open bottom
 * edge instead, so the 1px line between stacked panes belongs to one pane
 * only.
 */
export function contains(area: PlotArea, point: Point): boolean {
  return (
    point.x >= area.left &&
    point.x <= area.right &&
    point.y >= area.top &&
    point.y <= area.bottom
  );
}
