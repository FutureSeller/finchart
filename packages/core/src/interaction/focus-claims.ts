/**
 * The keyboard-focus contest — the door that separates *"the cursor went to
 * **someone contesting the keyboard**"* from *"it went to no one."*
 *
 * Asking *"is there anyone with an area"* would let a claimant with no
 * interest in the keyboard — a legend, a watermark — kill the toolbox's
 * Delete key. So registering is itself the declaration *"I contest the
 * keyboard too."*
 */
import {
  ContractError,
  describe,
  forEachStill,
  requirePoint,
  type PlotArea,
  type Point,
} from "../primitives";
import type { FocusClaim } from "./types";

interface FocusEntry {
  readonly areaOf: () => PlotArea | null;
}

export interface FocusClaims {
  /** Registers a contestant. Asked fresh every time since the area changes on resize. */
  claim(areaOf: () => PlotArea | null): FocusClaim;
}

/**
 * Reads someone else's `areaOf` **safely**.
 *
 * Three things are absorbed here:
 *
 * - **It throws**: a defect in someone else's extension would blow up
 *   right where this calls `contestedAt`, killing the entire drawing-tools
 *   keyboard path. Treated as unable to contest.
 * - **Wrong shape**: `claimFocusArea` only checks that its argument is a
 *   function, so nothing else looks at the return value. Unread here, it
 *   would raise the raw `TypeError` the five coordinate doors refuse to,
 *   **in a neighbor's hands.**
 * - **Degenerate area**: a zero-width vertical line (`x == left == right`)
 *   contests its entire x — it's the only line where `x >= left && x <=
 *   right` is true. (`EMPTY_AREA` does not let (0,0) through:
 *   `containsFocus`'s bottom edge is exclusive.) Core `PaneStack.at` in
 *   `panes.ts` carries the same guard (and `PaneStack.atY`, for height),
 *   as do `gripAt` in tools `hit.ts` and `usableArea` in tools `tools.ts`.
 */
function focusAreaOf(entry: FocusEntry): PlotArea | null {
  let area: unknown;
  try {
    area = entry.areaOf();
  } catch {
    return null;
  }
  if (typeof area !== "object" || area === null) return null;
  const left = Reflect.get(area, "left");
  const right = Reflect.get(area, "right");
  const top = Reflect.get(area, "top");
  const bottom = Reflect.get(area, "bottom");
  if (
    typeof left !== "number" ||
    typeof right !== "number" ||
    typeof top !== "number" ||
    typeof bottom !== "number" ||
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !Number.isFinite(top) ||
    !Number.isFinite(bottom)
  ) {
    return null;
  }
  // A degenerate area contests nothing.
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom };
}

/**
 * **The bottom edge doesn't count** — panes sit flush against each other
 * vertically, so including both ends would make the 1px boundary line
 * **belong to both panes**, with the winner decided by registration order
 * (measured: `main {8,302}`, `ind {302,596}`, both claiming `y=302`). A
 * verdict that claims to be exclusive can't have a
 * point that isn't.
 *
 * `contains`, the plot-interior rule used by pane lookup, is left alone —
 * there, including both ends is correct: `geometry.ts` counts a point on
 * the boundary as inside.
 */
function containsFocus(area: PlotArea, point: Point): boolean {
  return (
    point.x >= area.left &&
    point.x <= area.right &&
    point.y >= area.top &&
    point.y < area.bottom
  );
}

export function focusClaims(): FocusClaims {
  const entries: FocusEntry[] = [];

  return {
    claim(areaOf) {
      if (typeof areaOf !== "function") {
        throw new ContractError(
          `claimFocusArea(areaOf) must be a function — asked fresh every time since the area changes on resize, got ${describe(areaOf)}`,
        );
      }

      const claim: FocusEntry = { areaOf };
      entries.push(claim);

      return {
        contestedAt: (point) => {
          const at = requirePoint(point, "contestedAt(point)");
          /**
           * **Doesn't use `some`'s short-circuit.** Short-circuiting would
           * mean an earlier claimant returning true skips calling a later
           * `areaOf`, so **whether it throws would depend on registration
           * order.** Everyone is asked so the verdict never depends on order.
           */
          let contested = false;
          // `areaOf` is someone else's code and may release a claim →
          // `forEachStill`, so the claimant after it is still asked.
          forEachStill(entries, (other) => {
            if (other === claim) return;
            const area = focusAreaOf(other);
            if (area !== null && containsFocus(area, at)) contested = true;
          });
          return contested;
        },
        release: () => {
          const index = entries.indexOf(claim);
          if (index !== -1) entries.splice(index, 1);
        },
      };
    },
  };
}
