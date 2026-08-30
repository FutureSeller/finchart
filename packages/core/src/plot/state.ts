import type { Range } from "../data";
import type { Pane } from "./pane";
/**
 * State slice for one pane → `ChartState.panes`
 *
 * `valueDomain` is **present only when `autoScale` is off** — when it's on,
 * the value domain is a derived value, not state, so there's nothing to
 * carry.
 */
export interface PaneState {
  /** Ratio for sharing the remaining vertical space. Changes when the divider is dragged. */
  flex: number;
  /** Whether the value axis tracks the visible range. */
  autoScale: boolean;
  /** A manually set value range. Only present when `autoScale` is off. */
  valueDomain?: Range;
  /** Value-axis inversion. Only carried when it's not the default. */
  invert?: boolean;
}
/**
 * The chart's entire **view state**, as one value.
 *
 * This is the "view state" — not the data, not the series configuration,
 * not the style. It's what the user built through pan, zoom, and dragging,
 * and expects to come back after a refresh: what's in view (x), how the
 * panes are split (flex), and how the value axes are set.
 *
 * **No crosshair.** Cursor position isn't state, it's an echo of input — it
 * lives in pixels and belongs in neither URL storage nor undo. Syncing two
 * charts is already possible via the `crosshair` event (which gives you
 * data x) and `crosshairLine.follow()`.
 *
 * Serialization is a helper's job, not this type's — the version field
 * belongs to the serialization format.
 */
export interface ChartState {
  /**
   * The x range in view, **in data x** (indices never leak out). `null` if
   * it's never been fit to data — the scale's default `[0,1]` isn't state
   * the user made.
   */
  xDomain: Range | null;
  /** Stacking order from the top. Identity is the index — same order as `Plot.panes`. */
  panes: PaneState[];
}
/** Reads a pane's public fields into a state slice. Used when Plot builds a snapshot. */
export function paneStateOf(pane: Pane): PaneState {
  const slice: PaneState = { flex: pane.flex, autoScale: pane.autoScale };
  // Inversion is only carried when it's not the default — keeps serialized output from silently growing.
  if (pane.invert) slice.invert = true;
  if (!pane.autoScale) {
    const [min, max] = pane.yScale.getDomain();
    slice.valueDomain = { min, max };
  }
  return slice;
}
