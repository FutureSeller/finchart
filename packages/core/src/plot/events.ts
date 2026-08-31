/**
 * What the chart announces. The channel itself is generic and lives with
 * the other lifecycle primitives (`eventChannel`); what's here is the
 * vocabulary — one name per event and the payload each one carries.
 */
import type { Point } from "../primitives";
import type { Range } from "../data";
import type { PaneApi } from "./pane";
import type { ChartState } from "./state";

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
   * A piece of view state (`ChartState`) changed. The payload is the whole
   * new snapshot — rather than growing one event per piece, it's collected
   * into one. Whatever's mirroring it (URL persistence, undo, chart sync)
   * wants the whole thing anyway.
   *
   * **Synchronous** — state changes synchronously. During a drag
   * it fires on every pointermove, so if persisting is expensive, the
   * listener should debounce it.
   *
   * Doesn't fire on data changes (append/prepend) — data isn't state.
   */
  stateChange: ChartState;
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
  crosshair: CrosshairPayload;
  /** Click set — the payload is the same shape as crosshair. */
  click: CrosshairPayload;
  dblclick: CrosshairPayload;
  contextmenu: CrosshairPayload;
  xDomainChange: XDomainChangePayload;
}
