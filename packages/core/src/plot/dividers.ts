
/** Where a divider sits. `index` is the ordinal of the pane just above it. */
export interface DividerBoundary {
  index: number;
  /** y coordinate of the divider's center */
  y: number;
  left: number;
  right: number;
}

export interface DividerRenderer {
  render(boundaries: readonly DividerBoundary[]): void;
  clear(): void;
  destroy(): void;
}

/** Dragged the boundary between pane `index` and the pane below it by `dy`. */
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
  const grow = Math.max(0, lower.height - lower.minHeight); // room to shrink the lower pane
  const shrink = Math.min(0, upper.minHeight - upper.height); // room to shrink the upper pane
  return Math.min(Math.max(dy, shrink), grow);
}

export type DividerFactory = (
  /** `ChartLayers.overlay`, passed through as-is — the core doesn't know its type. `null` when headless. */
  overlay: unknown,
  onDrag: DividerDragHandler,
) => DividerRenderer;

