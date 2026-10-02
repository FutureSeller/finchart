/**
 * What the chart announces. The channel itself is generic and lives with
 * the other lifecycle primitives (`eventChannel`); what's here is the
 * vocabulary — one name per event and the payload each one carries.
 */
import type { Point } from "../primitives";
import type { Range } from "../data";
import type { PaneApi } from "./pane";

/**
 * Where on the chart the cursor is pointing.
 *
 * x is shared by every pane, but the value differs per pane, so you need to
 * know which pane the cursor is over before a tooltip can show the right
 * number.
 */
export interface CrosshairPayload {
  /** Screen coordinates. */
  position: Point;
  /**
   * The **data x** under the cursor. Same regardless of pane.
   *
   * Even in bar-index coordinates this is x, not an index — what a
   * subscriber (a tooltip) should show is time, not a bar number. Between
   * bars this is a linear interpolation between the neighboring bars' x.
   */
  x: number;
  /** The pane the cursor is over. null if it's over padding or a pane gap. */
  pane: PaneApi | null;
  /** That pane's value. null if pane is null. */
  value: number | null;
}

/**
 * The visible x range changed.
 *
 * The y domain isn't reported — that follows the series, it isn't something
 * the user moved.
 */
export interface XDomainChangePayload {
  /**
   * The range currently visible, **in data x**. Not an index even in
   * bar-index coordinates — it has to share units with `dataRange` so a
   * subscriber can measure "how close to the end."
   */
  startX: number;
  endX: number;
  /**
   * The x range of the data held. The reference for measuring closeness to
   * the end. null if there's no data.
   */
  dataRange: Range | null;
}

export interface PlotEvents {
  /**
   * The pane layout or a pane's value-axis mode changed. **No payload**:
   * read `plot.panes` and the panes themselves.
   *
   * - Layout: a pane added, removed or reordered, maximized or given back
   *   (`maximizePane`), a pane's `flex` (a divider drag rewrites every
   *   pane's) or `minHeight`.
   * - Mode: `autoScale`, `invert`, the scale (`setYScale` with a different
   *   instance), or a value range set by hand (`setValueDomain`, an axis drag).
   *
   * Doesn't ring for the x window (that's `xDomainChange`), data,
   * `valuePadding` or `axis` (how a pane draws, not where it sits or how its
   * axis follows), a fit to the data (`fitValueDomain`, a manual range that
   * `setData` or a scale swap refits — the swap itself rings once), an
   * automatic value axis following the view, or a value restated as it is.
   *
   * **Synchronous.** A divider drag (once per pointermove), `fitDomains()`
   * and a maximize ring at most once for the whole change; separate
   * `pane.applyOptions` calls ring once each.
   */
  panesChange: Record<string, never>;
  /**
   * A frame finished drawing. **No payload.**
   *
   * It used to carry `{ dataPoints }`, but that value was **the source's
   * visible point count**, so it didn't count what derived series drew —
   * stacking on four indicators gave the same number. Fixing it would mean
   * the drawing path counts, and the only place that wants the count is
   * benchmarks — **and a benchmark can count more accurately by wrapping the
   * renderer** (the commands actually issued). The core has no reason to
   * count every frame.
   */
  render: Record<string, never>;
  /**
   * The cursor over the chart — and **`null` once, when it leaves**. A
   * tooltip, a legend or a synced sibling holding the last value after the
   * pointer left would show a value that is no longer under anything; on a
   * live chart that reads as the current price. `null` is the cursor being
   * nowhere, which is different from a payload with `pane: null` — that
   * one is the cursor over a margin or a gap, still at a position.
   */
  crosshair: CrosshairPayload | null;
  /** Click set — the payload is the same shape as crosshair. */
  click: CrosshairPayload;
  dblclick: CrosshairPayload;
  contextmenu: CrosshairPayload;
  xDomainChange: XDomainChangePayload;
}
