import { ContractError } from "@finchart/core";
import type { Point } from "@finchart/core";
import type { Anchor, Drawing } from "./drawings";
import {
  channelParallel,
  drawingAnchors,
  fibExtensionLines,
  fibLevelLines,
  pitchforkLines,
  scaledByRatio,
} from "./drawings";
import { distanceToPoint, distanceToSegment } from "./geometry";
import type { DrawingSpace } from "./space";
import { domainAt, toPixel } from "./space";

/** The distance (px) at which a line counts as grabbed. */
const LINE_TOLERANCE = 4;
/** The distance (px) at which an endpoint counts as grabbed. More generous than the line — endpoints win. */
const HANDLE_TOLERANCE = 6;

/** What got grabbed — the whole thing, or which endpoint. */
export type Grip =
  | { drawing: Drawing; part: "whole" }
  | { drawing: Extract<Drawing, { a: Anchor }>; part: "a" | "b" }
  | { drawing: Extract<Drawing, { c: Anchor }>; part: "c" };

/**
 * What a drag fixes at the moment of grabbing. Every move is computed from
 * that and the cursor — never accumulated — which is what makes the grabbed
 * spot stick to the cursor, on a log axis too: domain offsets for a move by a
 * difference, and for a log-spaced drawing grabbed by its body the cursor it
 * was grabbed at and the original prices, for a move by a factor.
 */
export interface DragState {
  grip: Grip;
  /** Per anchor (or price): the domain value minus the cursor's domain value. */
  offsets: { x: number; price: number }[];
  /**
   * Where the cursor was when a **log-spaced** drawing was grabbed by its body
   * — present only then (see `logGrab`). Such a drag moves prices by a factor.
   */
  grabbed?: { x: number; price: number };
  /**
   * A snapshot taken at the moment of grabbing — the material a cancel
   * restores. `moveGrip` mutates the original object in place, so
   * without this, Esc would have nothing to restore to.
   */
  original: Drawing;
}

/**
 * Restores the snapshot taken at grab time onto the same object.
 * Preserving identity is the point — both the list and `selected` point
 * at that object, so swapping in a new one would break the selection.
 * Reads the same enumeration as `moveGrip` — two separate copies would
 * make it easy to update only one when a new drawing kind is added.
 */
export function restoreDrawing(target: Drawing, snapshot: Drawing): void {
  if (target.type === "horizontal") {
    if (snapshot.type !== "horizontal") return;
    target.price = snapshot.price;
    return;
  }
  if (target.type === "vertical") {
    if (snapshot.type !== "vertical") return;
    target.x = snapshot.x;
    return;
  }
  if (target.type !== snapshot.type) return;

  const sources = drawingAnchors(snapshot);
  drawingAnchors(target).forEach((anchor, index) => {
    anchor.x = sources[index].x;
    anchor.price = sources[index].price;
  });
}

/**
 * The nearest handle within the handle radius, as a grip part — or
 * null. **Nearest wins**, not first-listed: a line zoomed down to a few
 * pixels puts both ends under one radius, and "a always" would make b
 * ungrabbable at exactly the zoom where you'd want to fix it.
 */
function handleAt(
  point: Point,
  handles: readonly [Point, "a" | "b" | "c"][],
): "a" | "b" | "c" | null {
  let best: "a" | "b" | "c" | null = null;
  let bestDistance = HANDLE_TOLERANCE;
  for (const [pixel, part] of handles) {
    const distance = distanceToPoint(point, pixel);
    if (distance <= bestDistance) {
      best = part;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The viewport intersections of a ray / extended line. Off-screen anchors
 * can be arbitrarily far away, so extending by the pane dimensions alone
 * cannot reach its edge. Rendering and hit-testing share these endpoints (the
 * `fibLevelPrice` rule for derived geometry).
 */
export function infiniteEndpoints(
  kind: "ray" | "extended",
  a: Point,
  b: Point,
  space: DrawingSpace,
): [Point, Point] {
  const { area } = space;
  let dx = b.x - a.x, dy = b.y - a.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    dx = b.x / 2 - a.x / 2;
    dy = b.y / 2 - a.y / 2;
  }
  if ((dx === 0 && dy === 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return [a, b];
  // Work along the dominant axis: its slope is at most one. Construct
  // intersections on the boundary itself rather than adding a viewport-sized
  // offset to a huge ray distance (which can round both ends to one point).
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const along = (point: Point): number => horizontal ? point.x : point.y;
  const across = (point: Point): number => horizontal ? point.y : point.x;
  const direction = horizontal ? dx : dy;
  const slope = (horizontal ? dy : dx) / direction;
  const origin = Math.max(Math.abs(a.x), Math.abs(a.y)) < Math.max(Math.abs(b.x), Math.abs(b.y)) ? a : b;
  const intercept = across(origin) - along(origin) * slope;
  const low = horizontal ? area.left : area.top;
  const high = horizontal ? area.right : area.bottom;
  const bottom = horizontal ? area.top : area.left;
  const top = horizontal ? area.bottom : area.right;
  const points: Point[] = [];
  const add = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < low || x > high || y < bottom || y > top) return;
    if (kind === "ray" && (direction > 0 ? x < along(a) : x > along(a))) return;
    points.push(horizontal ? { x, y } : { x: y, y: x });
  };
  add(low, intercept + low * slope);
  add(high, intercept + high * slope);
  if (slope !== 0) {
    add((bottom - intercept) / slope, bottom);
    add((top - intercept) / slope, top);
  }
  if (kind === "ray") add(along(a), across(a));
  if (points.length === 0) return [a, b];
  points.sort((left, right) => direction > 0 ? along(left) - along(right) : along(right) - along(left));
  return [points[0], points[points.length - 1]];
}

/** The four corners of the box with `a` and `b` as opposite corners — clockwise from the top-left. */
export function rectangleOutline(a: Point, b: Point): Point[] {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/**
 * How many segments approximate an ellipse. At 48, a pane-sized ellipse
 * deviates from the true arc by well under a pixel — below the 4px line
 * tolerance, so the polyline you see and the one you grab agree.
 */
const ELLIPSE_SEGMENTS = 48;

/** Points along the ellipse inscribed in the `a`–`b` box. Rendering and hit-testing walk this same list. */
export function ellipseOutline(a: Point, b: Point): Point[] {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const points: Point[] = [];
  for (let index = 0; index < ELLIPSE_SEGMENTS; index++) {
    const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

/** The shortest distance from a point to a closed polyline's edges. */
function distanceToOutline(point: Point, outline: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < outline.length; index++) {
    const next = outline[(index + 1) % outline.length];
    best = Math.min(best, distanceToSegment(point, outline[index], next));
  }
  return best;
}

/** The x span an extension's level lines cover — all three anchors, so a level is visible wherever the swing is. */
export function fibExtensionSpan(a: Point, b: Point, c: Point): [number, number] {
  return [Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x)];
}

/** Whatever's drawn on top gets grabbed first — later in the list is higher (registration order is stacking order). */
export function gripAt(
  drawings: readonly Drawing[],
  space: DrawingSpace,
  point: Point,
): Grip | null {
  const { area } = space;
  /**
   * No area, nothing to grab. That's the state before the first frame —
   * the pane's area is empty until render allocates it, and until then
   * the boundary check below would let the single point (0,0) through.
   * If that one point actually got grabbed, a drag would start against a
   * coordinate system that doesn't exist.
   */
  if (area.right <= area.left || area.bottom <= area.top) return null;

  /**
   * The bottom edge isn't mine — panes butt up against each other
   * vertically, so if the 1px boundary line belonged to both sides,
   * click hit-testing and cursor-ownership checks would point at
   * different panes: selection would work on that pixel but Delete
   * wouldn't fire. Uses the same exclusive (`< bottom`) rule as
   * `insideArea` in `tools.ts`.
   *
   * Leaves hit-testing's `contains` (`geometry.ts`) alone — there,
   * including the boundary line is correct. This is a different spot,
   * dealing with exclusivity between panes.
   */
  if (
    point.x < area.left ||
    point.x > area.right ||
    point.y < area.top ||
    point.y >= area.bottom
  ) {
    return null;
  }

  for (let index = drawings.length - 1; index >= 0; index--) {
    const drawing = drawings[index];

    switch (drawing.type) {
      case "horizontal": {
        const y = space.pixelAtValue(drawing.price);
        if (Math.abs(point.y - y) <= LINE_TOLERANCE) {
          return { drawing, part: "whole" };
        }
        break;
      }

      case "vertical": {
        const x = space.pixelAtX(drawing.x);
        if (Math.abs(point.x - x) <= LINE_TOLERANCE) {
          return { drawing, part: "whole" };
        }
        break;
      }

      case "trend":
      case "ray":
      case "extended":
      case "arrow":
      case "fib":
      case "rectangle":
      case "ellipse":
      case "priceMeasure":
      case "barMeasure": {
        const a = toPixel(space, drawing.a);
        const b = toPixel(space, drawing.b);

        // Endpoints come first — if the segment check ran first, you
        // could never grab an endpoint.
        const part = handleAt(point, [[a, "a"], [b, "b"]]);
        if (part === "a" || part === "b") return { drawing, part };
        // A measure's label is presentation — the segment is the target.
        if (
          (drawing.type === "trend" ||
            drawing.type === "arrow" ||
            drawing.type === "priceMeasure" ||
            drawing.type === "barMeasure") &&
          distanceToSegment(point, a, b) <= LINE_TOLERANCE
        ) {
          return { drawing, part: "whole" };
        }
        // Area kinds grab on their boundary only — the interior stays
        // the chart's, so a click inside a box still pans.
        if (
          drawing.type === "rectangle" &&
          distanceToOutline(point, rectangleOutline(a, b)) <= LINE_TOLERANCE
        ) {
          return { drawing, part: "whole" };
        }
        if (
          drawing.type === "ellipse" &&
          distanceToOutline(point, ellipseOutline(a, b)) <= LINE_TOLERANCE
        ) {
          return { drawing, part: "whole" };
        }
        // A ray/extended line hit-tests the same overshoot endpoints the
        // renderer draws — one derived-geometry source, so the line you
        // see and the line you can grab can't drift.
        if (drawing.type === "ray" || drawing.type === "extended") {
          const [start, end] = infiniteEndpoints(drawing.type, a, b, space);
          if (distanceToSegment(point, start, end) <= LINE_TOLERANCE) {
            return { drawing, part: "whole" };
          }
        }
        // A Fibonacci's body is its level lines — grabbing any level
        // counts as grabbing the whole thing.
        if (drawing.type === "fib" && hitsFibLevel(drawing, space, point)) {
          return { drawing, part: "whole" };
        }
        break;
      }
      case "parallelChannel": {
        const a = toPixel(space, drawing.a);
        const b = toPixel(space, drawing.b);
        const c = toPixel(space, drawing.c);
        const part = handleAt(point, [[a, "a"], [b, "b"], [c, "c"]]);
        if (part === "c") return { drawing, part };
        if (part !== null) return { drawing, part };
        // Both lines grab; the band between them stays the chart's.
        const [p, q] = channelParallel(drawing).map((anchor) => toPixel(space, anchor));
        if (
          distanceToSegment(point, a, b) <= LINE_TOLERANCE ||
          distanceToSegment(point, p, q) <= LINE_TOLERANCE
        ) {
          return { drawing, part: "whole" };
        }
        break;
      }

      case "pitchfork": {
        const a = toPixel(space, drawing.a);
        const b = toPixel(space, drawing.b);
        const c = toPixel(space, drawing.c);
        const part = handleAt(point, [[a, "a"], [b, "b"], [c, "c"]]);
        if (part === "c") return { drawing, part };
        if (part !== null) return { drawing, part };
        // Three rays from the shared formula, plus the b–c bar.
        for (const [from, through] of pitchforkLines(drawing)) {
          const [start, end] = infiniteEndpoints(
            "ray",
            toPixel(space, from),
            toPixel(space, through),
            space,
          );
          if (distanceToSegment(point, start, end) <= LINE_TOLERANCE) {
            return { drawing, part: "whole" };
          }
        }
        if (distanceToSegment(point, b, c) <= LINE_TOLERANCE) {
          return { drawing, part: "whole" };
        }
        break;
      }

      case "fibExtension": {
        const a = toPixel(space, drawing.a);
        const b = toPixel(space, drawing.b);
        const c = toPixel(space, drawing.c);
        const part = handleAt(point, [[a, "a"], [b, "b"], [c, "c"]]);
        if (part === "c") return { drawing, part };
        if (part !== null) return { drawing, part };
        // The swing legs, then the level lines over the anchors' x span.
        if (
          distanceToSegment(point, a, b) <= LINE_TOLERANCE ||
          distanceToSegment(point, b, c) <= LINE_TOLERANCE
        ) {
          return { drawing, part: "whole" };
        }
        const [left, right] = fibExtensionSpan(a, b, c);
        if (point.x >= left - LINE_TOLERANCE && point.x <= right + LINE_TOLERANCE) {
          const onLevel = fibExtensionLines(drawing).some(
            ({ price }) => Math.abs(point.y - space.pixelAtValue(price)) <= LINE_TOLERANCE,
          );
          if (onLevel) return { drawing, part: "whole" };
        }
        break;
      }

      default: {
        // A fourth kind breaks the compile here — none of the known
        // three can reach this branch.
        const unreachable: never = drawing;
        throw new ContractError(`unknown drawing: ${JSON.stringify(unreachable)}`);
      }
    }
  }

  return null;
}

function hitsFibLevel(
  drawing: Extract<Drawing, { type: "fib" }>,
  space: DrawingSpace,
  point: Point,
): boolean {
  const a = toPixel(space, drawing.a);
  const b = toPixel(space, drawing.b);
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  if (point.x < left - LINE_TOLERANCE || point.x > right + LINE_TOLERANCE) {
    return false;
  }

  return fibLevelLines(drawing).some(
    ({ price }) => Math.abs(point.y - space.pixelAtValue(price)) <= LINE_TOLERANCE,
  );
}

/**
 * The anchors a grip will move — **live references** (except a
 * horizontal line, which has no anchor, so this holds a throwaway value
 * carrying its price). The point is that `gripOffsets` and `moveGrip`
 * read the same enumeration — two separate copies would turn matching
 * order in the offsets array into an implicit contract.
 */
function anchorsOf(grip: Grip): Anchor[] {
  if (grip.drawing.type === "horizontal") {
    // For a horizontal line, one price is the whole anchor — x is a
    // meaningless placeholder.
    return [{ x: 0, price: grip.drawing.price }];
  }
  if (grip.drawing.type === "vertical") {
    // The dual: one x is the whole anchor — price is the placeholder.
    return [{ x: grip.drawing.x, price: 0 }];
  }
  if (grip.part === "whole") return drawingAnchors(grip.drawing);
  if (grip.part === "c") return [grip.drawing.c];
  return [grip.drawing[grip.part]];
}

export function gripOffsets(
  grip: Grip,
  space: DrawingSpace,
  point: Point,
): DragState["offsets"] {
  const cursor = domainAt(space, point);
  return anchorsOf(grip).map((anchor) => ({
    x: anchor.x - cursor.x,
    price: anchor.price - cursor.price,
  }));
}

/**
 * A log-spaced drawing grabbed by its body moves by a **factor**, not a
 * difference: adding the same amount to both anchors keeps a price-linear
 * level under the cursor and loses a log-spaced one (a at 100, b at 400 — grab
 * the 50% level at 200, move to 300: +100 each puts that level at 316; ×1.5
 * each puts it at 300). This says whether the drag is that kind, once, at the
 * grab, and remembers where the cursor was.
 *
 * It is that kind only if everything a factor needs is there: the whole
 * drawing was grabbed, it is log-spaced, every anchor price is positive, and
 * so is the cursor's — the hit tolerance reaches a few pixels past a line, so
 * a press can land where the price is not. Anything else stays a difference.
 */
export function logGrab(grip: Grip, space: DrawingSpace, point: Point): DragState["grabbed"] {
  const { drawing } = grip;
  if (grip.part !== "whole" || (drawing.type !== "fib" && drawing.type !== "fibExtension")) return undefined;
  if (drawing.levelSpacing !== "log") return undefined;
  const cursor = domainAt(space, point);
  if (!(cursor.price > 0) || !drawingAnchors(drawing).every((anchor) => anchor.price > 0)) return undefined;
  return cursor;
}

/**
 * Takes the cursor **as a domain position** — not pixels. That's so
 * snapping can decorate the cursor: the caller (tools) passes either a
 * free cursor or a snapped one in the same shape. This function doesn't
 * know about snapping.
 */
export function moveGrip(
  drag: DragState,
  cursor: { x: number; price: number },
): void {
  const { grip, offsets, grabbed } = drag;

  if (grabbed) {
    const anchors = anchorsOf(grip);
    const origin = drawingAnchors(drag.original);
    // One factor for every anchor. With the cursor's price where it was grabbed
    // that factor is exactly 1, so the prices come back **to the bit** — also on
    // a sideways drag, which changes no price. A drift nobody can see would
    // still be recorded as a move to undo — or, between two anchors one double
    // apart, erase the swing.
    const prices = origin.map((from) => scaledByRatio(from.price, cursor.price, grabbed.price));
    // **The whole candidate first.** A cursor whose price is not positive, or a
    // price that would leave the doubles either way, is a move log price cannot
    // express: nothing is written — not one anchor of several, not x — and the
    // drawing waits where it last was. Written unchecked, an infinite anchor is
    // copied into history by the commit and the next save throws.
    if (!prices.every((price) => price > 0 && Number.isFinite(price))) return;
    // Nor can it express two anchors on one double: doubles thin out as prices
    // grow, and anchors a double apart may have only one to land on. A swing
    // that closes takes every level with it, so that move is refused as well.
    // (One factor keeps order, so counting distinct prices is the whole check.)
    if (new Set(prices).size < new Set(origin.map((from) => from.price)).size) return;
    const xs = anchors.map((_, index) => cursor.x === grabbed.x ? origin[index].x : cursor.x + offsets[index].x);
    if (!xs.every(Number.isFinite)) return;
    anchors.forEach((anchor, index) => {
      // x is a difference, and `g + (x − g)` is not always `x` — so back at the grab is said, not computed.
      anchor.x = xs[index];
      anchor.price = prices[index];
    });
    return;
  }

  if (grip.drawing.type === "horizontal") {
    const price = cursor.price + offsets[0].price;
    if (Number.isFinite(price)) grip.drawing.price = price;
    return;
  }
  if (grip.drawing.type === "vertical") {
    const x = cursor.x + offsets[0].x;
    if (Number.isFinite(x)) grip.drawing.x = x;
    return;
  }

  const candidates = offsets.map((offset) => ({ x: cursor.x + offset.x, price: cursor.price + offset.price }));
  if (!candidates.every((anchor) => Number.isFinite(anchor.x) && Number.isFinite(anchor.price))) return;
  anchorsOf(grip).forEach((anchor, index) => {
    anchor.x = candidates[index].x;
    anchor.price = candidates[index].price;
  });
}
