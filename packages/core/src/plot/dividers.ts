import { MIN_PANE_HEIGHT } from "./frame";
import type { PaneApi } from "./pane";

/** Where a divider sits. `index` is the ordinal of the pane just above it. */
export interface DividerBoundary {
  index: number;
  /** y coordinate of the divider's center */
  y: number;
  left: number;
  right: number;
  /**
   * The upper pane's height (px) and the heights a drag can take it to —
   * what a focusable separator reports as `aria-valuenow`/`min`/`max`, and
   * the limits a Home/End key moves to. `min === max === now` when the pair
   * can't move either way.
   */
  value: { now: number; min: number; max: number };
  /**
   * The panes above and below it. When a later frame puts a different pair
   * at the same `index` (a pane removed or inserted mid-drag), a drag that
   * grabbed the old pair should end rather than move the new one.
   */
  panes: readonly [upper: PaneApi, lower: PaneApi];
}

export interface DividerRenderer {
  render(boundaries: readonly DividerBoundary[]): void;
  clear(): void;
  destroy(): void;
}

/**
 * Dragged the boundary between pane `index` and the pane below it by `dy`.
 * `-Infinity` and `Infinity` move it as far as it can go — up and down.
 */
export type DividerDragHandler = (index: number, dy: number) => void;

/** What the clamp needs to know about one of the two panes beside a divider. */
export interface DividerSide {
  /** Current height in px. */
  height: number;
  minHeight: number;
}

/**
 * How far a divider dragged by `dy` may actually move, clamped between both
 * neighbors' `minHeight`. Positive grows the upper pane. `0` when nothing
 * can move.
 *
 * **Both limits are wrapped at 0** — the same clause the x viewport uses
 * at pan boundaries, for the same reason: *"if already past the boundary,
 * only block the direction that makes it worse."* Before wrapping, a
 * limit's sign could flip. If the container is shorter than the sum of
 * minHeights, `distributeHeights` shrinks proportionally all the way to
 * the floor, so both panes ending up smaller than their own minimum is
 * produced by **ordinary input.**
 *
 * Measured: with two panes of minHeight 40 sitting at 32px each, the lower
 * limit was `-(32-40) = +8`, the upper limit `min(dy, -8) = -8` → `max(8,
 * -8) = 8`, **regardless of dy.** Drag up by 1px and the boundary moved 8px
 * down, shrinking the lower pane to 24px — the opposite of the gesture, and
 * it violated the very minimum it was meant to protect even further.
 */
export function clampDividerDrag(
  dy: number,
  upper: DividerSide,
  lower: DividerSide,
): number {
  const { shrink, grow } = room(upper, lower);
  return Math.min(Math.max(dy, shrink), grow);
}

/**
 * The upper pane's height and the heights `clampDividerDrag` lets a drag
 * reach — the same limits, from the same arithmetic, so a separator never
 * reports a height the drag can't produce.
 */
export function dividerRange(
  upper: DividerSide,
  lower: DividerSide,
): DividerBoundary["value"] {
  const { shrink, grow } = room(upper, lower);
  return {
    now: upper.height,
    min: upper.height + shrink,
    max: upper.height + grow,
  };
}

/**
 * How far the boundary may move up (`shrink`, ≤ 0) and down (`grow`, ≥ 0).
 * A pane's floor is its `minHeight`, but never under the pixel the layout
 * lays under every pane — a limit below that would be a height no frame
 * draws.
 */
function room(upper: DividerSide, lower: DividerSide): { shrink: number; grow: number } {
  const floor = (side: DividerSide) => Math.max(MIN_PANE_HEIGHT, side.minHeight);
  return {
    grow: Math.max(0, lower.height - floor(lower)), // room to shrink the lower pane
    shrink: Math.min(0, floor(upper) - upper.height), // room to shrink the upper pane
  };
}

export type DividerFactory = (
  /** `ChartLayers.overlay`, passed through as-is — the core doesn't know its type. `null` when headless. */
  overlay: unknown,
  onDrag: DividerDragHandler,
) => DividerRenderer;

