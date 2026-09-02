import { ContractError } from "@finchart/core";
import type { Point } from "@finchart/core";
import type { Anchor, Drawing } from "./drawings";
import {
  channelParallel,
  drawingAnchors,
  fibLevelPrice,
  fibLevels,
  pitchforkLines,
} from "./drawings";
import { distanceToPoint, distanceToSegment, extendThrough } from "./geometry";
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
 * The domain offset at the moment of grabbing. Keeping this fixed for the
 * whole drag makes the grabbed spot stick to the cursor — unlike
 * accumulating a pixel delta, it stays accurate on a log axis too.
 */
export interface DragState {
  grip: Grip;
  /** Per anchor (or price): the domain value minus the cursor's domain value. */
  offsets: { x: number; price: number }[];
  /**
   * A snapshot taken at the moment of grabbing — the material a cancel
   * restores. `moveGrip` mutates the original object in place, so
   * without this, Esc would have nothing to restore to.
   */
  original: Drawing;
  /** Whether it actually moved after being grabbed. Esc on a drag that never moved does nothing. */
  moved: boolean;
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

/** The nearest of a list of pixel points within the handle radius, as a grip part — or null. */
function handleAt(
  point: Point,
  handles: readonly [Point, "a" | "b" | "c"][],
): "a" | "b" | "c" | null {
  for (const [pixel, part] of handles) {
    if (distanceToPoint(point, pixel) <= HANDLE_TOLERANCE) return part;
  }
  return null;
}

/**
 * The overshoot endpoints of a ray / extended line — far enough past the
 * pane that the clipped drawing reaches its edge. The renderer draws
 * these same two points and the pane clips the spill, so the line you
 * see and the line you can grab come from one function (the
 * `fibLevelPrice` rule for derived geometry).
 */
export function infiniteEndpoints(
  kind: "ray" | "extended",
  a: Point,
  b: Point,
  space: DrawingSpace,
): [Point, Point] {
  const { area } = space;
  const overshoot = area.right - area.left + (area.bottom - area.top);
  const end = extendThrough(a, b, overshoot);
  const start =
    kind === "extended" ? extendThrough(b, a, overshoot) : { x: a.x, y: a.y };
  return [start, end];
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
        if (distanceToPoint(point, a) <= HANDLE_TOLERANCE) {
          return { drawing, part: "a" };
        }
        if (distanceToPoint(point, b) <= HANDLE_TOLERANCE) {
          return { drawing, part: "b" };
        }
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

  return fibLevels(drawing).some((level) => {
    const price = fibLevelPrice(drawing, level);
    return Math.abs(point.y - space.pixelAtValue(price)) <= LINE_TOLERANCE;
  });
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
 * Takes the cursor **as a domain position** — not pixels. That's so
 * snapping can decorate the cursor: the caller (tools) passes either a
 * free cursor or a snapped one in the same shape. This function doesn't
 * know about snapping.
 */
export function moveGrip(
  drag: DragState,
  cursor: { x: number; price: number },
): void {
  const { grip, offsets } = drag;

  if (grip.drawing.type === "horizontal") {
    grip.drawing.price = cursor.price + offsets[0].price;
    return;
  }
  if (grip.drawing.type === "vertical") {
    grip.drawing.x = cursor.x + offsets[0].x;
    return;
  }

  anchorsOf(grip).forEach((anchor, index) => {
    anchor.x = cursor.x + offsets[index].x;
    anchor.price = cursor.price + offsets[index].price;
  });
}
