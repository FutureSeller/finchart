/**
 * Snapping — a decorator on `domainAt`. The state machine doesn't know
 * about it: at the seam where a pointer becomes a domain position, it
 * pulls toward a candidate, and off / outside the radius / no data all
 * collapse back to the raw value. Planting a branch in every state would
 * spread ad-hoc fixes, so it lives in this one place instead.
 *
 * Candidates are the three values the bar at the cursor's x carries —
 * value (close), min (low), max (high). min/max come from the accessor's
 * value span — not the drawing's value span (`Series.valueExtent`).
 *
 * This module isn't a public export — its return shape may still change.
 */
import type { Point, SeriesSample } from "@finchart/core";
import type { DrawingSpace } from "./space";
import { domainAt } from "./space";

export interface SnapContext {
  /** Whether it's on right now — a runtime toggle, so this asks rather than holds a value. */
  enabled(): boolean;
  /** The snap radius (px). Outside it, a candidate means free-hand drawing. */
  radius: number;
  /** The pane's probe — the bar at the cursor's x and its values. */
  probe(x: number): SeriesSample[];
}

/**
 * Axis policy — a horizontal line snaps only y (it has no x), a vertical
 * line only x (it has no price); a trend line or Fibonacci snaps per
 * point. `null` means behavior outside snapping (moving the whole
 * thing). Without an "x" mode, a vertical line under "xy" would only
 * stick to a bar when the cursor also happened to sit near that bar's
 * values — the Euclidean gate would eat the x snap.
 */
export type SnapAxes = "x" | "y" | "xy";

/**
 * "The bar at this x" — the first registration with a value there. One
 * rule for everyone who asks the pane about a bar (snapping, a bar
 * measure's count), so the bar you snap to is the bar you count.
 */
export function barSampleAt(samples: readonly SeriesSample[]): SeriesSample | null {
  return (
    samples.find((candidate) => candidate.value !== null || candidate.min !== null) ??
    null
  );
}

/** Cursor pixel → snapped domain. The shape used by drawing and drafting. */
export function snappedDomainAt(
  snap: SnapContext,
  space: DrawingSpace,
  point: Point,
  axes: SnapAxes,
): { x: number; price: number } {
  return snapDomainPos(snap, space, domainAt(space, point), axes);
}

/**
 * Domain position → snapped domain position. The shape used by anchor
 * dragging — you snap "where the anchor would land" (the grabbed
 * position plus offset) so it's the **anchor**, not the fingertip, that
 * sticks to the value.
 */
export function snapDomainPos(
  snap: SnapContext,
  space: DrawingSpace,
  pos: { x: number; price: number },
  axes: SnapAxes,
): { x: number; price: number } {
  if (!snap.enabled()) return pos;

  const sample = barSampleAt(snap.probe(pos.x));
  if (!sample) return pos;

  if (axes === "x") {
    // Only the bar's x sticks — the price stays free (a vertical line
    // has no price of its own).
    const dx = Math.abs(space.pixelAtX(sample.x) - space.pixelAtX(pos.x));
    return dx <= snap.radius ? { x: sample.x, price: pos.price } : pos;
  }

  const candidates: number[] = [];
  for (const value of [sample.value, sample.min, sample.max]) {
    if (value !== null && !candidates.includes(value)) candidates.push(value);
  }
  if (candidates.length === 0) return pos;

  const pixelY = space.pixelAtValue(pos.price);
  let best = candidates[0];
  let bestDy = Math.abs(space.pixelAtValue(best) - pixelY);
  for (const value of candidates) {
    const dy = Math.abs(space.pixelAtValue(value) - pixelY);
    if (dy < bestDy) {
      best = value;
      bestDy = dy;
    }
  }

  if (axes === "y") {
    return bestDy <= snap.radius ? { x: pos.x, price: best } : pos;
  }

  // Point-wise snapping — judged by on-screen Euclidean distance. The
  // bar's x snaps along with it.
  const dx = Math.abs(space.pixelAtX(sample.x) - space.pixelAtX(pos.x));
  return Math.hypot(dx, bestDy) <= snap.radius
    ? { x: sample.x, price: best }
    : pos;
}
