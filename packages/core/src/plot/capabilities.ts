/**
 * The **capabilities** the chart lends to extensions. Split apart so each
 * can be required on its own — bundling them as `Plugin<Plot>` would let a
 * single crosshair demand the entire chart, and any change to any method
 * on `Plot` would then put every extension in the blast radius.
 *
 * **Function parameters are contravariant, so a plugin that demands less
 * accepts a host that offers more.** A `Plugin<RenderRequester>` drops
 * right into `plot.use`.
 *
 * ```ts
 * export function crosshair(): Plugin<DecorationHost & RenderRequester & PlotEventSource>
 * plot.use(crosshair());   // Plot satisfies all three, so this just works
 * ```
 *
 * **There's no monolithic type ("the one door an extension sees").**
 * Combining the split pieces with `&` as needed is what states a
 * requirement honestly. **Everything here has an actual consumer** —
 * a capability nobody uses isn't sold.
 */

import type { BaseDataPoint, Range } from "../data";
import type { InputConsumer, InputConsumerOptions } from "../interaction";
import type { PlotArea } from "../primitives";
import type { Scale } from "../scale";
import type { Series } from "../series";
import type {
  DecorationOptions,
  PaneDecoration,
  PlotDecoration,
} from "./decoration";
import type { FocusClaim } from "../interaction";
import type { Plugin, PluginApi } from "../primitives";
import type { SeriesRegistration } from "../registration";
import type { PaneApi } from "./pane";
import type { PaneOptions } from "./pane-options";
import type { SeriesHandle } from "./series-handle";
import type { SeriesSample } from "./series-list";
import type { PlotEvents } from "./events";

// The claim type lives with the input stack; it stays reachable from here
// because `FocusAreaHost` is the door that hands one out.
export type { FocusClaim };

/**
 * Can ask for a redraw.
 *
 * The channel through which an extension holding its own state (a
 * crosshair following the cursor, a drawing being dragged) refreshes the
 * screen. **When it actually draws is still up to the scheduler.**
 *
 * Consumers: `crosshair`, `@finchart/tools`
 */
export interface RenderRequester {
  requestRender(): void;
}

/**
 * Can mount a decoration on the whole chart. This is where anything that
 * doesn't use the value axis goes.
 *
 * If y is needed, get a pane through `PaneHost` and use
 * `pane.addDecoration` instead — Plot owns x, Pane owns y.
 *
 * Consumers: `crosshair`
 */
export interface DecorationHost {
  addDecoration(
    decoration: PlotDecoration,
    options?: DecorationOptions,
  ): () => void;
}

/**
 * Can listen to the chart's events.
 *
 * Not named `EventSource` because that's a global DOM type — colliding
 * with it would make auto-import grab the wrong thing for a consumer with
 * `lib.dom` enabled.
 *
 * Consumers: `crosshair`, `legend`, `tooltip`, `syncX`
 */
export interface PlotEventSource {
  on<E extends keyof PlotEvents>(
    event: E,
    handler: (payload: PlotEvents[E]) => void,
  ): () => void;
}

/**
 * Can get, create, and remove panes.
 *
 * Indicators are the flagship consumer here — MACD has a different price
 * range and digit count, so it needs its own pane, and has to clean up
 * what it created when removed.
 *
 * Consumers: `legend`, `@finchart/indicators`, `@finchart/tools`
 */
export interface PaneHost {
  /** The default pane holding series. Always present. */
  readonly mainPane: PaneApi;
  /** Stacking order from the top. */
  readonly panes: readonly PaneApi[];
  addPane(options?: PaneOptions & { yScale?: Scale }): PaneApi;
  removePane(pane: PaneApi): void;
  /** The pane that fills the chart, or `null` → `Plot.maximizePane`. */
  readonly maximizedPane: PaneApi | null;
  /** Lets one pane fill the chart without touching any flex; `null` gives the split back. */
  maximizePane(pane: PaneApi | null): void;
}

/**
 * Can see input **before** pan/zoom/crosshair does.
 *
 * Consumers: `@finchart/tools`
 */
export interface InputHost {
  addInputConsumer(
    consumer: InputConsumer,
    options?: InputConsumerOptions,
  ): () => void;
}

/**
 * Can claim the cursor shape — the latest claim wins, and the unsubscribe
 * function reverts it. Callable even on a headless chart (there's just no
 * screen for it to show on; it doesn't throw).
 *
 * Consumers: `@finchart/tools`, the built-in axis drag
 */
export interface CursorHost {
  claimCursor(cursor: string): () => void;
}

/**
 * Can mount onto the overlay. **The core doesn't know what the overlay
 * is** — it just hands back whatever the layers supplied
 * (`ChartLayers.overlay`). `null` on a headless chart.
 *
 * An extension that requires the overlay narrows it at the door
 * (`requireOverlayElement`) — otherwise it throws as a wiring error. This
 * isn't a place to silently do nothing.
 *
 * Consumers: `legend`, `tooltip`
 */
export interface OverlayHost {
  readonly overlay: unknown;
}

/**
 * Gives the axis's own "how to render a value as text". x is here because
 * it belongs to the chart; y belongs to the pane, hence `ValueFormatSource`
 * instead.
 *
 * Consumers: `tooltip` (default x formatting in the header)
 */
export interface FormatSource {
  formatX(value: number): string;
}

/**
 * y formatting as resolved by the pane — this pane's `axis.format`, or the
 * chart-wide default (`config.axis.y.format`) if there is none, or two
 * decimal places failing that. The **default** for the crosshair's y
 * badge, legend, tooltip, and priceLine label all reads this — the axis
 * owns formatting, and a decoration's own option remains an override.
 *
 * Consumers: `crosshairLine`, `tooltip`, `legend`, `priceLine`
 */
export interface ValueFormatSource {
  formatValue(value: number): string;
}

/**
 * Can set the x range in view, **in data x**.
 *
 * Pairs with `PlotEventSource` — listen via `xDomainChange`, set via this.
 * With just those two, syncing two charts doesn't need all of `Plot`.
 *
 * Consumers: `syncX`
 */
export interface ViewportControl {
  setVisibleRange(fromX: number, toX: number): void;
}

/**
 * Converts between screen x and **data x**.
 *
 * Hit testing was the first thing a third party needed, and there was no
 * door for it here. What `@finchart/tools` did instead was **stash the
 * draw context into a variable** — no hit test was possible before the
 * first render, and the stashed context went stale on the next frame.
 *
 * `XMapping` isn't handed over as-is because it has `rebuild` on it —
 * rebuilding the index is the chart's job, not an extension's. Only the
 * two read directions are exposed here.
 *
 * It's not an accident that only x is here — **Plot owns x, Pane owns
 * value.** The value-side counterpart is `ValueCoordinates`.
 *
 * Consumers: `@finchart/tools`
 */
export interface XCoordinates {
  /** The data x under screen x (px). Between bars, this is a linear interpolation between the neighbors. */
  xAt(pixel: number): number;
  /** The screen x (px) where a data x lands. */
  pixelAtX(x: number): number;
}

/**
 * **Keyboard ownership contest** — registered by extensions that route
 * keys based on whose area the cursor is over.
 *
 * In wiring that mounts one extension per pane, an extension that only
 * knows its own area can't tell "the cursor left" apart from "the cursor
 * went to someone else". The right question isn't "do I have an area" but
 * "is there someone else **contesting the keyboard**" — an extension that
 * has an area but doesn't contest keys, like axis drag, legend, or
 * tooltip, doesn't count.
 *
 * `panes` isn't handed over as-is because `PaneApi` has `setYScale` and
 * `addSeries` on it — asking who your neighbor is and pushing your
 * neighbor around are different privileges. It doesn't expose the chart's
 * layout either: only a contestant knows about other contestants.
 *
 * Consumers: `@finchart/tools`
 */
export interface FocusAreaHost {
  /**
   * Registers as a keyboard contestant. `areaOf` is **called every time**
   * — a pane's position changes on resize or maximize, and a cached value
   * would go stale by the next frame. **`null` is first-class vocabulary**
   * — "not contesting right now" (disarmed, hidden, collapsed).
   */
  claimFocusArea(areaOf: () => PlotArea | null): FocusClaim;
}

/**
 * Converts between this pane's screen y and its **value**. The
 * value-side counterpart to `XCoordinates`.
 *
 * `yScale` isn't handed over as-is because `Scale` has `setDomain` and
 * `setRange` on it — if an extension could push the value axis around,
 * this wouldn't be a coordinate converter anymore.
 *
 * Consumers: `@finchart/tools`
 */
export interface ValueCoordinates {
  /** The space allotted to this pane. The basis for a hit test's "is this inside" question. */
  readonly area: PlotArea;
  /** The value at screen y (px). */
  valueAt(pixel: number): number;
  /** The screen y (px) where a value lands. */
  pixelAtValue(value: number): number;
}

/**
 * Can mount a series on this pane.
 *
 * Indicators are the flagship consumer — a moving average never creates a
 * pane, mounts a decoration, or captures input. **Ask for only this, and
 * you get only this.**
 *
 * Consumers: `@finchart/indicators`
 */
export interface SeriesHost {
  addSeries<TSource extends BaseDataPoint, TPoint extends BaseDataPoint = TSource>(
    registration: SeriesRegistration<TSource, TPoint> | Series<TSource>,
  ): SeriesHandle<TSource, TPoint>;
}

/**
 * Can mount a decoration on this pane. This is where anything that uses
 * the value axis goes.
 *
 * `DecorationHost` is the chart-wide counterpart — the two aren't merged
 * into one because of context: a pane decoration is guaranteed a
 * `yScale`, and a plot decoration is not.
 *
 * Consumers: `@finchart/tools`
 */
export interface PaneDecorationHost {
  addDecoration(
    decoration: PaneDecoration,
    options?: DecorationOptions,
  ): () => void;
}

/**
 * Asks what each series is drawing under the cursor.
 *
 * The channel tooltip and legend use to get values, and it's
 * **read-only** — asking for only this gets you neither the ability to
 * remove a series nor to push the value axis around.
 *
 * Consumers: `legend`, `tooltip`
 */
export interface DataProbe {
  probe(x: number): SeriesSample[];
  /** The x range of the points being drawn. `null` if empty — legend's "last value" uses this. */
  xRange(): Range | null;
}

/**
 * Can install an extension. **Each host lends itself.** Both `Plot` and
 * `Pane` implement it — an extension mounted on a pane needs to be tied to
 * that pane's own lifecycle.
 */
export interface PluginHost<Self> {
  use<Api extends PluginApi>(plugin: Plugin<Self, Api>): Api;
}
