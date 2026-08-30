import type { Point, ValueCoordinates, XCoordinates } from "@finchart/core";
import type { Anchor } from "./drawings";

/**
 * The coordinate system that drawing and hit-testing share. **The chart
 * owns x, the pane owns value** — so the tool's whole world is
 * the two combined.
 */
export type DrawingSpace = XCoordinates & ValueCoordinates;

/** The cursor's domain position. The reference coordinate system for dragging. */
export function domainAt(
  space: DrawingSpace,
  point: Point,
): { x: number; price: number } {
  return {
    x: space.xAt(point.x),
    price: space.valueAt(point.y),
  };
}

export function toPixel(space: DrawingSpace, anchor: Anchor): Point {
  return {
    x: space.pixelAtX(anchor.x),
    y: space.pixelAtValue(anchor.price),
  };
}
