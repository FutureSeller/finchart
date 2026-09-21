import type { Point } from "@finchart/core";

/**
 * The geometry behind hit-testing — pure functions in pixel space. Input
 * routing is the consumer's job, so hit-testing is the tool's own
 * geometry. Both are public exports — third parties use them to build
 * their own hit-testing.
 *
 * Demotes to `NaN` instead of throwing — this keeps pure geometry's
 * no-throw contract while collapsing "there's no point" and "the point's
 * coordinates are non-finite" into the same meaning (a false hit), so a
 * consumer never has to handle the two branches separately.
 */
function coord(point: unknown, axis: "x" | "y"): number {
  if (typeof point !== "object" || point === null) return Number.NaN;
  const value = Reflect.get(point, axis);
  return typeof value === "number" ? value : Number.NaN;
}

/** The shortest distance from a point to a segment. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const px = coord(point, "x"), py = coord(point, "y");
  const ax = coord(a, "x"), ay = coord(a, "y");
  const bx = coord(b, "x"), by = coord(b, "y");
  if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return Number.NaN;
  // Subtract first when possible: nearby coordinates retain their exact
  // difference even on a far-panned chart. Only overflowing differences
  // require scaling the coordinates themselves.
  let dx = bx - ax, dy = by - ay;
  let qx = px - ax, qy = py - ay;
  let scale = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(qx), Math.abs(qy));
  if (scale === 0) return 0;
  if (Number.isFinite(scale)) {
    dx /= scale;
    dy /= scale;
    qx /= scale;
    qy /= scale;
  } else {
    scale = Math.max(Math.abs(px), Math.abs(py), Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by));
    dx = bx / scale - ax / scale;
    dy = by / scale - ay / scale;
    qx = px / scale - ax / scale;
    qy = py / scale - ay / scale;
  }
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (qx * dx + qy * dy) / lengthSquared));
  if (t === 0) return Math.hypot(px - ax, py - ay);
  if (t === 1) return Math.hypot(px - bx, py - by);
  return Math.hypot(qx - t * dx, qy - t * dy) * scale;
}

export function distanceToPoint(point: Point, target: Point): number {
  return Math.hypot(
    coord(point, "x") - coord(target, "x"),
    coord(point, "y") - coord(target, "y"),
  );
}

/**
 * The point `length` pixels past `through`, on the line from `from`
 * through `through`. Rays and extended lines render and hit-test with
 * the same overshoot endpoints (one derived-geometry source — the
 * `fibLevelPrice` rule), and the pane clips whatever spills. A
 * zero-length direction answers `through` itself — a degenerate ray is
 * a point, not a throw.
 */
export function extendThrough(from: Point, through: Point, length: number): Point {
  const dx = through.x - from.x;
  const dy = through.y - from.y;
  const span = Math.hypot(dx, dy);
  if (span === 0 || !Number.isFinite(span)) {
    return { x: through.x, y: through.y };
  }
  const scale = length / span;
  return { x: through.x + dx * scale, y: through.y + dy * scale };
}
