
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

export type DividerFactory = (
  /** `ChartLayers.overlay`, passed through as-is — the core doesn't know its type. `null` when headless. */
  overlay: unknown,
  onDrag: DividerDragHandler,
) => DividerRenderer;

