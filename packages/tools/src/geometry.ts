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
  const dx = coord(b, "x") - coord(a, "x");
  const dy = coord(b, "y") - coord(a, "y");
  const lengthSquared = dx * dx + dy * dy;

  const px = coord(point, "x");
  const py = coord(point, "y");
  const ax = coord(a, "x");
  const ay = coord(a, "y");

  // A zero-length segment is a point.
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

  // Clamps the foot of the perpendicular to inside the segment — outside
  // it, the nearest endpoint is the shortest.
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
  );

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
