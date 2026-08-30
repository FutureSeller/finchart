import { ContractError } from "@finchart/core";
import type { Point } from "@finchart/core";
import type { Anchor, Drawing } from "./drawings";
import { FIB_LEVELS, fibLevelPrice } from "./drawings";
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
  | { drawing: Extract<Drawing, { a: Anchor }>; part: "a" | "b" };

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
  if (snapshot.type === "horizontal") return;

  target.a.x = snapshot.a.x;
  target.a.price = snapshot.a.price;
  target.b.x = snapshot.b.x;
  target.b.price = snapshot.b.price;
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

      case "trend":
      case "fib": {
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
        if (
          drawing.type === "trend" &&
          distanceToSegment(point, a, b) <= LINE_TOLERANCE
        ) {
          return { drawing, part: "whole" };
        }
        // A Fibonacci's body is its level lines — grabbing any level
        // counts as grabbing the whole thing.
        if (drawing.type === "fib" && hitsFibLevel(drawing, space, point)) {
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

  return FIB_LEVELS.some((level) => {
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
  if (grip.part === "whole") return [grip.drawing.a, grip.drawing.b];
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

  anchorsOf(grip).forEach((anchor, index) => {
    anchor.x = cursor.x + offsets[index].x;
    anchor.price = cursor.price + offsets[index].price;
  });
}
