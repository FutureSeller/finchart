import type { AxisBadge, Tick } from "../axis";
import { autoTickStep } from "../axis";
import {
  ContractError,
  requireObject,
  requireDataArray,
  requireFinite,
  requireNonNegative,
  runAll,
  throwable,
  type PlotArea,
} from "../primitives";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataView,
  DataManagerFactory,
  Range,
  Source,
  Viewport,
} from "../data";
import type { StyleReader, DrawTarget } from "../render";
import type { ExpandHints, Scale, XMapping } from "../scale";
import type { Series } from "../series";
import type {
  DataProbe,
  PaneDecorationHost,
  PluginHost,
  SeriesHost,
  ValueCoordinates,
  ValueFormatSource,
} from "./capabilities";
import type {
  DecorationOptions,
  PaneDecoration,
  PaneDecorationContext,
} from "./decoration";
import {
  addDecoration,
  emptyDecorations,
  forEachAboveSeries,
  forEachBelowSeries,
} from "./decoration";
import { createEntry } from "./entry";
import type {
  Entry,
  SeriesId,
  SeriesRegistration,
  TypedEntry,
} from "./entry";
import { install } from "./plugin";
import type { Plugin, PluginApi } from "./plugin";
import { expandFor, unionOf } from "./range";
import type { ValueFormat } from "./format";
import { DEFAULT_Y_FORMAT } from "./format";
import type { YAxisOptions, AxisOptions } from "./types";

export interface PaneOptions {
  /**
   * Stable identity for persisted view state. Give dynamically assembled
   * panes a semantic key (`"rsi"`, `"volume"`); it is written to
   * `ChartState` and cannot be changed after the pane has claimed it.
   */
  stateKey?: string;
  /** Share of the leftover vertical space this pane takes. Default 1. */
  flex?: number;
  /** Never shrinks below this (px). Default 40. */
  minHeight?: number;
  /** Margin that keeps the value axis off the data. Default 0.1 */
  valuePadding?: number;
  /**
   * The value axis follows the **visible range**. Default true. This is the
   * default behavior for financial charts — zoom from a year of data into
   * the last week, and that week should fill the pane.
   * Turn it off to fit the whole source dataset instead, after which a
   * manually set value domain is no longer overwritten every frame.
   */
  autoScale?: boolean;
  /** This pane's value axis settings. Anything omitted follows the Plot's default. */
  axis?: AxisOptions;
  /**
   * Inverts the value axis — larger values go toward the bottom. The right
   * spot for values where "smaller is better," like the spread on a yield
   * curve. This is state (`PaneState.invert`).
   */
  invert?: boolean;
}

/**
 * The numeric contract for pane options. **`flex` becomes a denominator in
 * layout** (`flexTotal` in `layout.ts`) — feed it `Infinity` and the pane
 * height becomes `NaN`, which then leaks into the canvas size.
 *
 * **Both** the constructor and `applyOptions` pass through here — if the two
 * spots diverge, only one of them gets fixed. Zero is not blocked: `flex: 0`
 * is the idiom `paneMaximize` uses to collapse a pane.
 */
function checkPaneNumbers(options: PaneOptions): void {
  if (
    options.stateKey !== undefined &&
    (typeof options.stateKey !== "string" || options.stateKey.trim().length === 0)
  ) {
    throw new ContractError("pane stateKey must be a non-empty string");
  }
  if (options.flex !== undefined) requireNonNegative(options.flex, "pane flex");
  if (options.minHeight !== undefined) {
    requireNonNegative(options.minHeight, "pane minHeight");
  }
  if (options.valuePadding !== undefined) {
    requireNonNegative(options.valuePadding, "pane valuePadding");
  }
  // A nested spot is still a door — `PaneOptions.axis` takes a whole
  // `AxisOptions`, so `minTickSpacing` arrives here too. A `NaN` tick
  // spacing makes the ticks quietly vanish.
  if (options.axis?.minTickSpacing !== undefined) {
    requireFinite(options.axis.minTickSpacing, "pane axis minTickSpacing");
  }
}

/**
 * Tries to plant a domain without throwing — `false` on a contract violation.
 *
 * `setYScale` uses this to try moving the current window onto an axis it
 * **hasn't installed yet**. It swallows only `ContractError`, to separate
 * the normal branch (the current window falls outside the new axis's space)
 * from a genuine bug — everything else is rethrown as is.
 */
function trySetDomain(scale: Scale, min: number, max: number): boolean {
  try {
    scale.setDomain(min, max);
    return true;
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return false;
  }
}

/**
 * What a Pane needs from the outside to draw. yScale and area use its own.
 *
 * **There's no data here.** Each registration holds its own data and slices
 * it with its own manager, so all that needs to come from outside is "what
 * are we looking at."
 */
export interface PaneDrawContext {
  /** What each registration slices its own data against. */
  viewport: Viewport;
  /** Where a point's x lands on screen. Series and decorations see the same one. */
  x: XMapping;
  /** Built once per render and shared by every series. */
  readStyle: StyleReader;
  /** Ticks computed once. The y ticks belong to this pane. */
  ticks: { x: Tick[]; y: Tick[] };
  /** The x notation the chart resolved — flows into the decoration context. */
  formatX: ValueFormat;
}

const EMPTY_AREA: PlotArea = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Default pane options — **one set.** The constructor's `??`s read this, and
 * react (`<ChartPane>`) buys "removing a prop reverts to the default" off of
 * it — if the wrapper copied the numbers instead, only the wrapper would go
 * stale when these change.
 */
export const PANE_OPTION_DEFAULTS = {
  flex: 1,
  minHeight: 40,
  valuePadding: 0.1,
} as const;

/** What `Pane.probe` answers for one registration — raw material for tooltips and legends. */
export interface SeriesSample {
  series: SeriesId;
  /** Registration metadata. `null` if none. */
  name: string | null;
  color: string | null;
  /** The x of the point actually hit — not the queried x. Between bars, it's the neighboring bar's. */
  x: number;
  /** That point's value (by accessor — close, for a candle). `null` on a gap. */
  value: number | null;
  /**
   * That point's data value span (`CoordinateAccessor.getYRange`) — low and
   * high for a candle. `null` for series whose accessor omits it (line,
   * derived) — the point's value is `value` alone. These three are the
   * candidates for snapping.
   */
  min: number | null;
  max: number | null;
  /**
   * **Which index the chosen point sits at in the drawn point array.** The
   * consumer's key back to the source — the core seals off the point type
   * so it can't hand back OHLC, but it can hand back a position:
   * `bars[sample.index]`. Without this the consumer has to hand-roll a
   * binary search, and then the tooltip and the header can end up naming
   * different bars.
   */
  index: number;
}

/**
 * A handle onto one registration's data. `addSeries` returns it. On a chart
 * with several series, "who gets the new data" can't be answered by
 * `plot.setData`, so each registration gets its own handle.
 *
 * Rule: **a function if all it hands back is disposal, an object if there's
 * more.** That's why `addDecoration` and `plot.on` return a bare function.
 * `dispose` shares a name with `PluginApi` but doesn't inherit from it —
 * inheriting would imply a promise that doesn't exist, that the Plot cleans
 * it up on its own.
 */
export interface SeriesHandle<
  T extends BaseDataPoint,
  TPoint extends BaseDataPoint = T,
> extends Source<TPoint> {
  /**
   * The points this registration **draws**. Where an indicator's input lives.
   *
   * ```ts
   * const price = pane.addSeries({ series: candleSeries(), data: candles });
   * computation({ inputs: [price], calc: (candles) => ... });
   * ```
   *
   * If a derivation is attached, this is its result — what's on screen is
   * exactly the next computation's input.
   *
   * **The returned view is live and read-only.** The reason it isn't a
   * copy is that this door is an indicator pipeline's input — copying
   * 100,000 points somewhere that runs on every tick would eat the frame
   * budget on its own. If the receiver needs to sort or filter, it floats
   * one off with `[...handle.read()]`.
   */
  read(): DataView<TPoint>;

  /**
   * Replaces the whole dataset. **Refits both axes.**
   *
   * The array is copied; the points are not. **A point is handed over,
   * not lent** — from here on the chart reads `x` off the object you gave
   * it, so editing that object afterward changes the chart with nothing
   * scheduled and the sort order that slicing relies on possibly gone.
   * To change a point, pass a new one (`updateLast`, or `setData` again).
   * Copying every point on a door that takes 100,000 of them per call
   * would cost the frame budget on its own, so it's a contract instead.
   */
  setData(data: T[]): void;

  /**
   * Splices past data onto the front. Leaves the domain alone — dragging
   * left to load history shouldn't snap the screen back to the full range.
   */
  prepend(points: T[]): void;

  /** Splices the latest onto the back. Leaves the domain alone. */
  append(points: T[]): void;

  /**
   * A tick for the bar in progress. **Same x as the last point means
   * replace, greater means append.** Smaller throws `DataError` — fixing
   * the past is `setData`'s job. Doesn't touch the domain — pan/zoom and a
   * manual value range both stay put.
   */
  updateLast(point: T): void;

  /**
   * Swaps out **only the drawn representation** — the data, the derivation,
   * and whatever holds this handle (an indicator's source, live
   * `updateLast`) all stay put. This is the door for switching chart type,
   * like candle to area: `plot.setSeries` also discards the pane's other
   * series (a moving average, say), so it can't be used there.
   *
   * Refits the value axis — different series occupy different ranges (a
   * candle spans low to high, a close line only close).
   *
   * **A Series must be stateless** (the same rule as `SeriesSpec.series`) —
   * a representation that carries state loses it the moment it's swapped out.
   */
  swapSeries(next: Series<TPoint>): void;

  /**
   * The x range of the points this registration **draws**. `null` if empty.
   *
   * If it's a derivation, this is the derived result's range — a moving
   * average is shorter than the source by its period, since the leading
   * points are missing. What infinite scroll asks — "how far have we come"
   * — should be answered by what's drawn.
   */
  readonly xRange: Range | null;

  /**
   * Whether this handle is **still attached to the pane**. The five write
   * doors throw on a detached handle, so this is where to ask before that.
   *
   * ```ts
   * socket.on("tick", (t) => { if (handle.attached) handle.updateLast(t); });
   * ```
   *
   * Without it, the only option for code holding onto a late-arriving
   * callback is wrapping it in `try/catch` — a throwing contract only holds
   * up if you can ask first.
   *
   * **The line between asking and throwing sits in a different place.**
   * When the whole chart has come down (`Plot.removePane`, `destroy`), this
   * is also false, but the write doors **don't throw** — a late callback
   * firing mid-unmount is the normal path, and by then the pane is already
   * out of both the list and the layout, so whatever it wrote lands
   * nowhere. Read the two cases apart:
   *
   * | `attached` | write door | what happened |
   * |---|---|---|
   * | false | throws | the registration is gone — `dispose()` or a `syncSeries` eviction |
   * | false | silent | the chart came down — `removePane` or `destroy` |
   *
   * `read()`, `xRange`, and `dispose()` are safe even after detaching —
   * reading before asking doesn't blow up.
   */
  readonly attached: boolean;

  /** Detaches the registration. Safe to call twice. */
  dispose(): void;
}

/**
 * The change a pane announces. **It states what changed.** The three axes
 * are independent of each other, so they're spelled out as three fields —
 * merging them into one would mean rebuilding the whole x index even for a
 * single margin change (a full merge sort over every point, under a bar
 * index coordinate system).
 */
export interface PaneChange {
  /**
   * **The drawn points changed.** The x index needs rebuilding and the
   * value axis needs refitting. Changes to the list (addSeries, dispose)
   * belong here too — the union of drawn points changed.
   *
   * If false, only the picture needs redrawing: value axis swap,
   * decorations, and the state fields below.
   */
  data: boolean;
  /** The imperative `SeriesHandle.setData` replaced the source outright. Only meaningful when `data` is true. */
  refit: boolean;
  /**
   * **True:** the set of x values being drawn changed. Omitting it is read as
   * changed. Even among changes where `data` is true, most ticks only
   * change values — replacing the bar in progress puts a different value at
   * the same x, so the bar-index mapping has no reason to recount.
   *
   * **Omitting is the safe side** — when unsure, recount. The only place
   * that can say false is the one that knows the verdict
   * (`TypedEntry.updateLast`).
   */
  xValues?: boolean;
  /**
   * A state field (flex, autoScale — `PaneState`) changed.
   *
   * Kept separate from data changes because `stateChange` is a promise that
   * "state changed" — firing it on every append would waste effort for
   * anything holding a mirror of it.
   */
  state?: boolean;
}

/**
 * One series carried in a spec array.
 *
 * **The point type survives in only one place: `data`.** Each array element
 * can have a different derived-result type, so a single element type can't
 * express it — the same move `Entry` makes. `seriesSpec()` seals off that
 * type, leaving outside only the identity (`id`) and whatever an update
 * verdict needs.
 *
 * `TSource` sits **only in covariant position** (`data`), so a
 * `SeriesSpec<OHLC>` can be dropped straight into a `SeriesSpec` slot. This
 * is the property a pane relies on when it takes the list.
 */
export interface SeriesSpec<TSource extends BaseDataPoint = BaseDataPoint> {
  /** The identity an update matches against. An index would quietly get this wrong on a conditional insert. */
  readonly id: string;

  /**
   * What gets swapped in when the identity matches. The point type is erased.
   *
   * **A Series must be stateless** — swapping it loses any internal state.
   * Things that carry state (a crosshair, say) go through decorations, not series.
   */
  readonly series: SeriesId;

  /** The values that decide whether to rerun the derivation. `undefined` when there's no derivation. */
  readonly deriveKey?: readonly unknown[];

  /**
   * The data this series draws. **A changed reference counts as an update.**
   *
   * Passing the list again can't distinguish "replace" from "prepend past
   * data," so what arrives here is **always a replacement**. It doesn't
   * refit, though — in the declarative world, growing data means infinite
   * scroll, and the window shouldn't jump when that happens. Use the
   * imperative `SeriesHandle` when you need incremental updates and refitting.
   *
   * Same handoff as `SeriesHandle.setData`: the array is copied, the points
   * are kept as given — a point isn't edited after it's been passed in.
   */
  readonly data?: TSource[];

  /**
   * Input for a registration that draws someone else's output — the
   * declarative world's third mode. **The reference is the identity** —
   * changing it rebuilds the entry. It doesn't own data, so it can't
   * coexist with `data` or `deriveKey`.
   */
  readonly input?: Source<BaseDataPoint>;

  /** What a Pane uses to seal this into an Entry. The point type is concrete only inside this function. */
  readonly toEntry: (createDataManager: DataManagerFactory) => Entry;
}

/**
 * Turns one registration into a spec closed over TPoint.
 *
 * Two overloads, because: without a derivation, TPoint is just TSource, so
 * `series` alone suffices; with one, the three of series, derive, and
 * coordinates need to be tied together by TPoint. The call site infers that
 * relationship, so no `as` is needed.
 */
export function seriesSpec<TSource extends BaseDataPoint>(spec: {
  id: string;
  series: Series<TSource>;
  data?: TSource[];
  name?: string;
  color?: string;
  zIndex?: number;
}): SeriesSpec<TSource>;

export function seriesSpec<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
>(spec: {
  id: string;
  series: Series<TPoint>;
  data?: TSource[];
  name?: string;
  color?: string;
  zIndex?: number;
  derive: (source: DataView<TSource>) => TPoint[];
  /** Required whenever there's a derivation — without it, everything recomputes on every update. */
  deriveKey: readonly unknown[];
  coordinates?: CoordinateAccessor<TPoint>;
}): SeriesSpec<TSource>;

export function seriesSpec<TPoint extends BaseDataPoint>(spec: {
  id: string;
  series: Series<TPoint>;
  /** Draws points someone else made — a computed node's branch (`node.out.*`) arrives here. */
  input: Source<TPoint>;
  name?: string;
  color?: string;
  zIndex?: number;
  coordinates?: CoordinateAccessor<TPoint>;
}): SeriesSpec<never>;

/**
 * The implementation signature **takes the registration type as is.**
 *
 * Since the overloads already sorted out whether `deriveKey` is required,
 * there's no need to re-discriminate the branch here — pass the spec
 * straight to `createEntry` and each branch carries its own type along.
 * Having `id` and `deriveKey` tacked on doesn't stop it from passing as a
 * registration.
 */
export function seriesSpec<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
>(
  spec: { id: string; deriveKey?: readonly unknown[] } & SeriesRegistration<
    TSource,
    TPoint
  >,
): SeriesSpec<TSource> {
  return {
    id: spec.id,
    series: spec.series,
    data: spec.data,
    deriveKey: spec.deriveKey,
    input: spec.input,
    toEntry: (createDataManager) =>
      createEntry<TSource, TPoint>(spec, createDataManager, "seriesSpec"),
  };
}

/**
 * Whether the derivation needs to rerun.
 *
 * If both are missing, both are derivation-less registrations, so they're
 * equal. If only one is missing, the nature of the registration changed.
 */
function sameDeriveKey(
  a: readonly unknown[] | undefined,
  b: readonly unknown[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;

  return a.every((value, index) => Object.is(value, b[index]));
}

/**
 * Fits the Entry of a matching id onto the new spec — this is where the
 * derivation cache survives. Returns what actually changed: if nothing did,
 * there's neither a render nor a refit.
 */
function reuseEntry(
  prior: { spec: SeriesSpec; entry: Entry },
  spec: SeriesSpec,
): { swapped: boolean; fed: boolean } {
  const swapped = prior.spec.series !== spec.series;
  if (swapped) prior.entry.swapSeries(spec.series);

  /**
   * Data is pushed in **only when the reference changed.**
   *
   * `setData` does a full sort check and reruns the derivation, so calling
   * it on every render would turn data size into the cost of a React
   * update. Not refitting is what distinguishes this from the imperative
   * handle.
   */
  const fed = prior.spec.data !== spec.data;
  if (fed) prior.entry.feed(spec.data ?? []);

  return { swapped, fed };
}

/**
 * **The pane as seen from outside.** This is the name that's public
 * (`index.ts` exports it as `Pane`).
 *
 * Writing it by subtraction, like `Omit<Pane, …>`, would mean every new
 * method on the class gets published with no decision behind it, so this is
 * written by addition instead. `Pane implements PaneApi` lets the compiler
 * keep the two in sync.
 *
 * What's **not** here is wiring the chart uses every frame — planting the
 * vertical slot (`setValueRange`, `setArea`), drawing (`draw`), collecting
 * badges (`collectAxisBadges`), and handing x to the bar-index mapping
 * (`xValuesPerSeries`). Calling these from outside gets overwritten by the
 * next frame, or leaks a command outside a commit.
 *
 * What an extension should require is **not this whole type**, but the
 * pieces below — `SeriesHost`, `PaneDecorationHost`, `ValueCoordinates`,
 * `DataProbe` (→ `capabilities.ts`). An indicator only needs `SeriesHost`.
 */
export interface PaneApi
  extends SeriesHost,
    PaneDecorationHost,
    ValueCoordinates,
    DataProbe,
    ValueFormatSource,
    PluginHost<PaneApi> {
  /** Whether the value axis follows the visible range. */
  readonly autoScale: boolean;
  /** Share of the leftover vertical space this pane takes. Updates when a divider is dragged. */
  readonly flex: number;
  /** Never shrinks below this (px). */
  readonly minHeight: number;
  /** This pane's value axis settings. Change it with `applyOptions({ axis })`. */
  readonly axis: Readonly<AxisOptions>;
  /** Whether the value axis is inverted → `PaneOptions.invert` */
  readonly invert: boolean;
  /** Stable state identity, or null when this pane intentionally uses legacy index state. */
  readonly stateKey: string | null;
  /** The value axis. Can be swapped out — the log/linear toggle arrives via `setYScale`. */
  readonly yScale: Scale;

  /** Swaps out the value axis. Replants the current value range onto the new scale. */
  setYScale(next: Scale): void;
  /** Notifies you when a series or option changes. Returns an unsubscribe function. */
  subscribe(listener: (change: PaneChange) => void): () => void;
  /** Fits the series list to what the array says. **Owns the whole list.** */
  syncSeries(specs: readonly SeriesSpec[]): void;
  /** Discards everything mounted and leaves just one. */
  setSeries<TSource extends BaseDataPoint, TPoint extends BaseDataPoint = TSource>(
    registration: SeriesRegistration<TSource, TPoint> | Series<TSource>,
  ): SeriesHandle<TSource, TPoint>;
  clearSeries(): void;
  getSeries(): readonly SeriesId[];
  /** Changes only what's given. Omitting means "leave as is." */
  applyOptions(options: PaneOptions): void;
  /** The value range spanning every series in this pane. `null` if there's nothing to measure. */
  valueExtent(visible?: Viewport | null): Range | null;
  /** Sets the value range directly. **Turns off `autoScale`.** */
  setValueDomain(min: number, max: number): void;
  /** Fits this pane's value axis so every series in it is visible. */
  fitValueDomain(visible?: Viewport | null): void;
}

/**
 * A bundle of series sharing one value axis.
 *
 * Multiple series in the same pane are drawn overlapping — a moving average
 * over a price is the typical case. Give indicators with wildly different
 * value ranges their own pane instead.
 *
 * **There's no point-type parameter.** Once data has gone down into a
 * registration, all a pane knows is "what to draw, in what order" — which
 * is why BTC (OHLC) and ETH (line) can sit side by side in one pane, with
 * the type staying put where each was registered.
 *
 * The x-axis is owned by the Plot. Pan/zoom only ever touches x, so however
 * many panes there are, they move together automatically.
 */
export class Pane implements PaneApi {
  private entries: Entry[] = [];

  /**
   * Exactly one API owns the series list at a time. `syncSeries` reconciles
   * a complete declarative list, while handles are meaningful only for an
   * imperative list. Letting one silently replace the other detaches live
   * handles with no call at the point of failure.
   */
  private seriesOwner: "imperative" | "declarative" | null = null;

  /**
   * Extensions installed on this pane. **Cleaned up together when the pane
   * detaches.**
   *
   * Same rule as the chart's: stack in install order, tear down in reverse,
   * and let a dead one go at the next install → `Plot.use`
   */
  private readonly plugins: PluginApi[] = [];

  /**
   * What `syncSeries` last received. **The baseline the next update
   * compares against.**
   *
   * It has to compare against the previous spec, not the pane's current
   * state — dragging a divider overwrites `flex` from outside, and
   * comparing against current state would revert that every time.
   */
  private synced = new Map<string, { spec: SeriesSpec; entry: Entry }>();

  private valuePadding: number;

  /**
   * State fields. **Reading is open; writing goes through `applyOptions`
   * alone.**
   *
   * Back when these were assignable fields, there were two doors and one of
   * them was silent — `pane.flex = 2` went through with no notification and
   * no render. Even the Plot itself wrote through that silent door on
   * divider drag and patched in a state notification by hand, which means
   * the rule existed only as convention, not in code.
   */
  private autoScaleFlag: boolean;
  private flexWeight: number;
  private minHeightPx: number;
  private axisOptions: AxisOptions;
  private inverted: boolean;
  private stateKeyValue: string | null;

  /** The assigned vertical slice. The Plot sets this before every render. */
  private assignedArea: PlotArea = EMPTY_AREA;

  /**
   * **This is an array.** When it was a Set, subscribing the same function
   * twice quietly collapsed into one — `plot.on` is an array and counts it
   * as two (its own comment records why), and two doors on the same
   * contract have no reason to answer differently.
   */
  private readonly listeners: ((change: PaneChange) => void)[] = [];
  private readonly decorations = emptyDecorations<PaneDecoration>();

  /** Whether the value axis follows the visible range. */
  get autoScale(): boolean {
    return this.autoScaleFlag;
  }

  /** Share of the leftover vertical space this pane takes. Updates when a divider is dragged. */
  get flex(): number {
    return this.flexWeight;
  }

  /** Never shrinks below this (px). */
  get minHeight(): number {
    return this.minHeightPx;
  }

  /**
   * This pane's value axis settings. The Plot merges them with its own
   * defaults. Editing this from outside leaves the chart none the wiser —
   * change it with `applyOptions({ axis })` instead.
   *
   * **For that to be true, this has to be a copy.** `Readonly<T>` is only a
   * compiler-level promise — handing back the original would let it be
   * mutated at runtime, and since `yTicks` re-reads this object every
   * frame, an outside edit would quietly show up in the next render.
   */
  get axis(): Readonly<AxisOptions> {
    return { ...this.axisOptions };
  }

  /** Whether the value axis is inverted → PaneOptions.invert */
  get invert(): boolean {
    return this.inverted;
  }

  get stateKey(): string | null {
    return this.stateKeyValue;
  }

  /**
   * The value axis. **Can be swapped out** — the log/linear toggle arrives
   * via `setYScale`. The constructor's is just the initial wiring.
   */
  get yScale(): Scale {
    return this.scale;
  }

  /**
   * **Five surfaces use the same ruler — down to the tick spacing.** The
   * axis calls `format(value, step)`, but if a badge, tooltip, legend, or
   * priceLine only passes the value, a format function that picks digit
   * count from spacing would drift — the tick reading `0.00001235` while
   * the badge shows `0.00`.
   *
   * **This doesn't hold onto last frame's spacing.** That value goes stale
   * the moment a zoom, resize, or data change happens, and badges get asked
   * outside a frame too (crosshair events). Instead it calls the same
   * arithmetic the axis uses (`autoTickStep`) — there's no stale value to hold.
   */
  formatValue = (value: number): string => {
    const format = this.axisOptions.format ?? this.inheritedYAxis?.()?.format;
    if (!format) return DEFAULT_Y_FORMAT(value);

    const [min, max] = this.scale.getDomain();
    const [from, to] = this.scale.getRange();
    return format(
      value,
      autoTickStep({
        min,
        max,
        pixels: to - from,
        minTickSpacing:
          this.axisOptions.minTickSpacing ??
          this.inheritedYAxis?.()?.minTickSpacing,
        orientation: "vertical",
      }),
    );
  };

  constructor(
    private scale: Scale,
    /**
     * Builds a derived series's manager.
     *
     * Taken from outside so it decimates under the **same policy** as the
     * source — building it here directly would let the source use `LttbDecimation`
     * while a moving average gets decimated on a grid instead.
     */
    private readonly createDataManager: DataManagerFactory,
    options: PaneOptions = {},
    /**
     * Reads the chart's default y-axis options (notation, tick spacing) —
     * a function rather than a value because `applyOptions` can change the config.
     */
    private readonly inheritedYAxis?: () => YAxisOptions | undefined,
    /** Plot-owned uniqueness check for the persistent state identity. */
    private readonly assertStateKeyAvailable?: (key: string) => void,
  ) {
    checkPaneNumbers(options);
    this.valuePadding = options.valuePadding ?? PANE_OPTION_DEFAULTS.valuePadding;
    this.autoScaleFlag = options.autoScale ?? true;
    this.flexWeight = options.flex ?? PANE_OPTION_DEFAULTS.flex;
    this.minHeightPx = options.minHeight ?? PANE_OPTION_DEFAULTS.minHeight;
    this.axisOptions = options.axis ?? {};
    this.inverted = options.invert ?? false;
    this.stateKeyValue = options.stateKey ?? null;
    if (this.stateKeyValue !== null) this.assertStateKeyAvailable?.(this.stateKeyValue);
  }

  /**
   * Swaps out the value axis — the door for the log/linear toggle.
   *
   * Replants the current value range (domain) onto the new scale — a toggle
   * shouldn't change the window being viewed. `setArea` in the next frame
   * plants the range.
   */
  setYScale(next: Scale): void {
    requireObject(next, "setYScale(next)");
    if (typeof next.scale !== "function" || typeof next.invert !== "function") {
      throw new ContractError("setYScale(next) must be a Scale (scale, invert)");
    }
    const [min, max] = this.scale.getDomain();

    /**
     * **If the window falls outside the new scale's space, don't move it —
     * refit to the data instead.** A linear axis's domain already carries
     * additive padding, so the floor can be negative (10 to 300 becomes
     * `[-19, 329]`), and moving that onto a log scale hits its positive-only
     * contract. **A toggle is a change of axis, not a failure** — keeping
     * the current window is the priority, but when that can't be kept, the
     * right move isn't to throw, it's "show that data on the new axis instead."
     *
     * **Installation happens only after this succeeds.** Setting
     * `this.scale = next` first would mean that if even the fallback
     * throws, the pane is left holding a new axis with an invalid domain,
     * `notify()` never runs, and every `render()` after that rethrows the
     * same exception forever. So `next` is finished off to the side and
     * plugged in last — whatever throws along the way, `this.scale` is
     * still the old axis, so the screen stays alive.
     */
    if (!trySetDomain(next, min, max)) {
      const extent = this.valueExtent(null);

      /**
       * No data to measure. `next` still holds its constructor's default
       * domain, which is valid, so it's fine to plug in as is — the first
       * `fitValueDomain` overwrites it once data arrives. Throwing here
       * would mean **you can never change the axis on an empty chart**.
       */
      if (extent) {
        const [fitMin, fitMax] = expandFor(
          next,
          extent,
          this.valuePadding,
          this.expandHints(null),
        );
        next.setDomain(fitMin, fitMax);
      }
    }

    this.scale = next;

    // Both the drawn points and the state fields stay the same — just redraw.
    this.notify({ data: false, refit: false });
  }

  /**
   * Notifies you when a series or option changes. Returns an unsubscribe function.
   *
   * A Pane holds neither a renderer nor data, so it can't redraw itself.
   * Refitting the value axis and drawing are the Plot's job.
   *
   * This is a subscription rather than an assignment because the listener
   * isn't fixed to just one — plugging into a field would let a second
   * subscriber quietly push out the first.
   */
  subscribe(listener: (change: PaneChange) => void): () => void {
    this.listeners.push(listener);
    let off = false;

    return () => {
      // Safe to call twice — without the flag, subscribing the same
      // function twice would mean one unsubscribe removes **both**
      // (`indexOf` would just find the remaining one again).
      if (off) return;
      off = true;
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }

  /**
   * Omitting this means **the data changed** — that's what most call sites mean.
   *
   * The notification discipline matches what `emitter` sets: **copy the
   * list before iterating** (if a subscriber calls its own unsubscribe, the
   * indices shift and the next subscriber gets skipped), and **if one
   * throws, still call the rest, but don't swallow it.**
   *
   * Where this actually leaked when it sat outside the rule: `subscribe` is
   * a public contract on `PaneApi`, so a consumer can attach a handler, and
   * if one of them throws, **the chart's own `onPaneChange` never runs** —
   * someone else's code stops the chart.
   */
  private notify(change: PaneChange = { data: true, refit: false }): void {
    const failures = runAll(this.listeners.slice(), (listener) =>
      listener(change),
    );
    if (failures) throw throwable(failures, "a pane subscriber threw");
  }

  get area(): PlotArea {
    return this.assignedArea;
  }

  /**
   * Installs one extension on this pane and **returns exactly the API it built.**
   *
   * ```ts
   * const tools = plot.mainPane.use(drawingTools({ plot }));
   * plot.removePane(rsi);   // extensions attached there are cleaned up too
   * ```
   *
   * The line between this and installing on the chart (`plot.use`) is
   * **what it hangs off of.** An indicator that needs to create its own
   * pane (MACD) needs `PaneHost`, so it belongs to the chart; a toolbox
   * that draws on an existing pane belongs to that pane.
   */
  use<Api extends PluginApi>(plugin: Plugin<PaneApi, Api>): Api {
    if (this.detached) {
      throw new ContractError("cannot install an extension on a detached pane");
    }

    return install(this.plugins, this, plugin, "pane.use(plugin)");
  }

  /**
   * Whether this pane has detached from the chart. **Keeps `use` from
   * installing into a grave** — a `PaneApi` handed outside can be held onto
   * even after detaching, and without this check an extension the chart
   * doesn't know about would get installed and never cleaned up, even by `destroy()`.
   */
  private detached = false;

  /**
   * Tears down installed extensions in reverse order and **closes this
   * pane.** The chart calls this when detaching or destroying a pane.
   *
   * Iterates **while emptying** the list. Another extension could install
   * itself here or detach itself mid-teardown, and iterating by index would
   * let the array shift underneath, skipping one — and a skipped one is
   * never cleaned up.
   *
   * Runs to the end even if one throws (same rule as `Plot.destroy`).
   */
  detach(): unknown[] {
    this.detached = true;
    const failures: unknown[] = [];

    while (this.plugins.length > 0) {
      // Don't erase `pop()`'s `T | undefined` with an assertion — a
      // reentrant `dispose` can touch this loop's array underneath, so
      // looking at the value directly is more truthful than the length invariant.
      const api = this.plugins.pop();
      if (api === undefined) break;
      try {
        api.dispose();
      } catch (error) {
        failures.push(error);
      }
    }

    return failures;
  }

  /** Value at screen y (px) → `ValueCoordinates` */
  valueAt(pixel: number): number {
    return this.scale.invert(pixel);
  }

  /** Screen y (px) where a value lands → `ValueCoordinates` */
  pixelAtValue(value: number): number {
    return this.scale.scale(value);
  }

  /**
   * Plants the vertical slot as the value axis's range. **This is the one
   * place inversion lives.** Screen y increases downward, so the range is
   * flipped to put larger values up top — when inverted, leaving the range
   * top and bottom as is is itself the inversion.
   *
   * Kept separate from `setArea` because layout needs the range before it
   * needs the area — ticks are computed right after the vertical
   * allocation, and at that point the y-axis width isn't known yet, so the
   * area can't be finalized.
   */
  setValueRange(top: number, bottom: number): void {
    if (this.invert) this.scale.setRange(top, bottom);
    else this.scale.setRange(bottom, top);
  }

  /**
   * Takes a slice and fits the value axis to it.
   *
   * Doesn't touch the domain — the value range being viewed stays the same
   * even when the area changes.
   */
  setArea(area: PlotArea): void {
    this.assignedArea = area;
    this.setValueRange(area.top, area.bottom);
  }

  /**
   * Mounts a series. Whatever's mounted later draws on top.
   *
   * **Returns a handle** — the door for later replacing or extending this
   * registration's data. If all you need is disposal, drop `handle.dispose`
   * straight into an effect cleanup.
   */
  addSeries<
    TSource extends BaseDataPoint,
    TPoint extends BaseDataPoint = TSource,
  >(
    registration: SeriesRegistration<TSource, TPoint> | Series<TSource>,
  ): SeriesHandle<TSource, TPoint> {
    this.assertSeriesOwner("imperative", "addSeries");
    const entry = createEntry<TSource, TPoint>(registration, this.createDataManager);
    this.seriesOwner = "imperative";
    this.entries.push(entry);
    this.notify();

    return this.handleFor(entry);
  }

  private assertSeriesOwner(
    requested: "imperative" | "declarative",
    door: "addSeries" | "setSeries" | "syncSeries" | "clearSeries",
  ): void {
    if (this.seriesOwner === null || this.seriesOwner === requested) return;

    const owner = this.seriesOwner === "declarative" ? "syncSeries" : "addSeries/setSeries";
    const next = requested === "declarative" ? "syncSeries" : "addSeries/setSeries";
    throw new ContractError(
      `pane series are owned by ${owner}; ${door} cannot take them over. ` +
        `Clear the ${owner} list first, then use ${next}.`,
    );
  }

  /**
   * A handle pointing at one registration. **The refit verdict is decided
   * here.** Replacing outright means a new dataset, so it refits both
   * axes; extending keeps the current window in place.
   */
  private handleFor<
    TSource extends BaseDataPoint,
    TPoint extends BaseDataPoint,
  >(entry: TypedEntry<TSource>): SeriesHandle<TSource, TPoint> {
    /**
     * **A detached handle isn't used.** Without this check, an entry
     * dropped from the list could still be edited, and that's not a quiet
     * no-op — it actually moves the chart: `setData` fires a refit,
     * re-fitting the x window to the remaining series, and the user's held
     * pan position jumps for no reason.
     *
     * There are two ways to drop out, so this asks **whether it's in the
     * list** rather than checking a flag: `dispose()`, and eviction by
     * `syncSeries`, which owns the whole list. Only `dispose` is the
     * exception that stays idempotent.
     */
    const registered = (): boolean => this.entries.includes(entry);

    /**
     * Whether it's attached to the chart — **this is the asking side's
     * question.** Even with the registration alive, if the whole pane came
     * out (`removePane`, `destroy`), whatever was drawn lands nowhere, so
     * this is false. The reason it's kept apart from the throwing boundary
     * (`live`) is written in `SeriesHandle.attached`'s docs — a chart that
     * came down is an unmount path and should stay quiet.
     */
    const attached = (): boolean => !this.detached && registered();

    const live = (door: string): void => {
      if (registered()) return;
      throw new ContractError(
        `this is a detached series handle — ${door} can't revive it. ` +
          "to draw again, mount with addSeries",
      );
    };

    return {
      // The point type is sealed inside Entry. The only place outside that
      // knows that type is where the registration was called, so the
      // TPoint that came from there is recovered here.
      read: () => entry.read() as DataView<TPoint>,
      setData: (data) => {
        live("setData");
        entry.setData(data);
        this.notify({ data: true, refit: true });
      },
      /**
       * **The shape is checked here first.**
       *
       * Even with `entry` holding a guard, this wrapper reading
       * `points.length` **first** made a `null` blow up as `TypeError:
       * Cannot read properties of null (reading 'length')` — put the guard
       * on the inside and let the outside touch it first, and the inner
       * guard is never reached. **The public door is the handle side.**
       *
       * For the same reason, **detachment is also checked before the empty
       * array.** Put it after, and only `append([])` slips through quietly,
       * making *"the five write doors throw"* (`plot-contract.md`) false —
       * streaming that mixes in empty chunks happens to be exactly this
       * door's consumer.
       */
      prepend: (points) => {
        requireDataArray(points, "prepend(points)");
        live("prepend");
        if (points.length === 0) return;
        entry.prepend(points);
        this.notify();
      },
      append: (points) => {
        requireDataArray(points, "append(points)");
        live("append");
        if (points.length === 0) return;
        entry.append(points);
        this.notify();
      },
      updateLast: (point) => {
        live("updateLast");
        // Only the spot that picked the branch knows whether x moved — carry that answer through as is.
        const xValues = entry.updateLast(point);
        this.notify({ data: true, refit: false, xValues });
      },
      swapSeries: (next) => {
        live("swapSeries");
        entry.swapSeries(next);
        // Same notification as plot.setSeries — the drawn points stay the
        // same, but the value axis needs refitting to the new series's extent.
        this.notify();
      },
      get xRange() {
        return entry.xRange();
      },
      get attached() {
        return attached();
      },
      dispose: () => {
        const index = this.entries.indexOf(entry);
        if (index === -1) return; // already disposed

        this.entries.splice(index, 1);
        this.notify();
      },
    };
  }

  /** What this pane's decorations describe to put on the axis. In registration order — later ones on top. */
  collectAxisBadges(context: PaneDecorationContext): AxisBadge[] {
    const badges: AxisBadge[] = [];
    for (const { decoration } of this.decorations) {
      badges.push(...(decoration.axisBadges?.(context) ?? []));
    }
    return badges;
  }

  /**
   * Mounts a decoration on this pane. Doesn't participate in value-axis
   * refitting. Since the value domain stays the same there's nothing to
   * fit, but **it still notifies** — without that, the decoration would
   * only appear on screen "the next time something else happens."
   */
  addDecoration(
    decoration: PaneDecoration,
    options: DecorationOptions = {},
  ): () => void {
    const remove = addDecoration(this.decorations, decoration, options);
    this.notify({ data: false, refit: false });

    // **Notifies only once even if called twice** — the unsubscribe-function
    // convention is consistent across this repo (`Pane.subscribe`,
    // `Plot.on`, `FocusClaim.release`, and `claimCursor` all carry their own
    // flag). The inner `remove` is idempotent, but the notification sits
    // outside it, so an effect cleanup running twice alone gave every
    // subscriber a phantom frame.
    let off = false;
    return () => {
      if (off) return;
      off = true;
      remove();
      this.notify({ data: false, refit: false });
    };
  }

  /**
   * Fits the series list to what the array says. **Owns the whole list.**
   * It cannot be mixed with `addSeries`/`setSeries`; mixed ownership throws
   * before any entry is detached.
   * An explicit empty list releases declarative ownership, so it is the
   * deliberate reset before moving back to an imperative list.
   *
   * The identity is `id`. With a matching id, the Entry is kept as is and
   * only the series reference is swapped, so the derivation cache
   * survives — the user is free to build a new series on every render.
   * `deriveKey` decides whether the derivation reruns.
   *
   * **Draw order is array order.** `addSeries` pushes, so whatever was
   * turned on last always went on top; here, even something inserted late
   * conditionally lands in its rightful place.
   */
  syncSeries(specs: readonly SeriesSpec[]): void {
    if (!Array.isArray(specs)) {
      throw new ContractError("syncSeries(specs) must be an array");
    }
    /**
     * **All ids are checked first — before anything is changed.** Putting
     * the duplicate check inside the loop would mean a duplicate later in
     * the list throws after `swapSeries`/`feed` has already been committed
     * to a reused registration — the earlier one's new data sits inside its
     * manager with `notify()` never firing, so the chart refits neither the
     * x index nor the value axis. Moving the check up front means a
     * throwing path ends with nothing touched.
     */
    const seen = new Set<string>();
    for (const spec of specs) {
      if (seen.has(spec.id)) {
        throw new ContractError(`Duplicate series id: "${spec.id}"`);
      }
      seen.add(spec.id);
    }
    this.assertSeriesOwner("declarative", "syncSeries");

    const next = new Map<string, { spec: SeriesSpec; entry: Entry }>();
    const entries: Entry[] = [];
    let swapped = false;
    let fed = false;

    /**
     * **Building comes first, committing comes later.** If `toEntry` on the
     * next spec throws after `feed`/`swapSeries` has already been committed
     * to a reused registration, the earlier sibling's new data sits inside
     * its manager with `notify()` never firing, so the chart refits neither
     * the x index nor the value axis. So everything that can throw
     * (building a new registration) happens first — only once that whole
     * pass clears does it move on to committing the reused ones.
     *
     * **The window this leaves open**: if a reuse commit itself throws (bad
     * feed data), an earlier sibling's commit is left standing — a full
     * rollback would require the manager to have an undo door, which it doesn't.
     */
    type Step =
      | { spec: SeriesSpec; reuse: { spec: SeriesSpec; entry: Entry } }
      | { spec: SeriesSpec; built: Entry };
    const plan: Step[] = [];
    for (const spec of specs) {
      const prior = this.synced.get(spec.id);
      const reusable =
        prior &&
        sameDeriveKey(prior.spec.deriveKey, spec.deriveKey) &&
        prior.spec.input === spec.input;

      // Keep the Entry when the derivation is unchanged — this is where the
      // cache survives. For input, the reference is the identity: reusing
      // across a mode switch (data ↔ input) or an input swap would either
      // feed the old entry (the gatekeeper throws) or ignore the new input,
      // so it's rebuilt instead.
      plan.push(
        reusable && prior
          ? { spec, reuse: prior }
          : { spec, built: spec.toEntry(this.createDataManager) },
      );
    }

    this.seriesOwner = specs.length === 0 ? null : "declarative";

    for (const step of plan) {
      if ("reuse" in step) {
        const changes = reuseEntry(step.reuse, step.spec);
        swapped ||= changes.swapped;
        fed ||= changes.fed;

        next.set(step.spec.id, { spec: step.spec, entry: step.reuse.entry });
        entries.push(step.reuse.entry);
        continue;
      }

      next.set(step.spec.id, { spec: step.spec, entry: step.built });
      entries.push(step.built);
    }

    const changed =
      swapped ||
      fed ||
      entries.length !== this.entries.length ||
      entries.some((entry, index) => entry !== this.entries[index]);

    this.entries = entries;
    this.synced = next;

    // If nothing changed, there's no reason to refit the value axis either.
    if (changed) this.notify();
  }

  /**
   * Discards everything mounted and leaves just one.
   *
   * Without data given alongside it, this stands up **empty** — data
   * belongs to the registration and can't be inherited from the previous
   * one. To swap only the representation, hold onto the handle and give the
   * same id a new series through `syncSeries`, or give data here alongside it.
   */
  setSeries<
    TSource extends BaseDataPoint,
    TPoint extends BaseDataPoint = TSource,
  >(
    registration: SeriesRegistration<TSource, TPoint> | Series<TSource>,
  ): SeriesHandle<TSource, TPoint> {
    this.assertSeriesOwner("imperative", "setSeries");
    const entry = createEntry<TSource, TPoint>(registration, this.createDataManager, "setSeries");
    this.seriesOwner = "imperative";
    this.entries = [entry];
    this.synced.clear();
    this.notify();

    return this.handleFor(entry);
  }

  clearSeries(): void {
    this.assertSeriesOwner("imperative", "clearSeries");
    this.entries = [];
    this.synced.clear();
    this.seriesOwner = null;
    this.notify();
  }

  /**
   * The nearest point of each registration at a data x — the door tooltips
   * use to ask "what are the values under this cursor." **Based on drawn
   * points** — a derivation's result, if there is one. Empty registrations
   * are dropped. Order is registration order (draw order).
   */
  probe(x: number): SeriesSample[] {
    /**
     * **`NaN` means "pointing at nothing."** `nearest`'s selection compares
     * with `Math.abs(...) <= Math.abs(...)`, and with `NaN` both sides are
     * `NaN`, so every comparison is false and the first point is left
     * standing — measured: `probe(NaN)` returned the first bar's value **as
     * a normal sample.** A tooltip showing the first bar's price while
     * claiming it's the value under the cursor is the quietly-wrong side,
     * so an empty list is the right answer.
     */
    if (!Number.isFinite(x)) return [];

    const samples: SeriesSample[] = [];

    for (const entry of this.entries) {
      const nearest = entry.nearest(x);
      if (!nearest) continue;

      samples.push({
        series: entry.series,
        name: entry.name,
        color: entry.color,
        x: nearest.x,
        value: nearest.value,
        min: nearest.min,
        max: nearest.max,
        index: nearest.index,
      });
    }

    return samples;
  }

  getSeries(): readonly SeriesId[] {
    return this.entries.map((entry) => entry.series);
  }

  /**
   * Changes only what's given. Same rule as `Plot.applyOptions` — omitting means "leave as is."
   */
  applyOptions(options: PaneOptions): void {
    requireObject(options, "applyOptions(options)");
    checkPaneNumbers(options);

    // Whether a state field (PaneState) actually changed has to be checked before assigning.
    const state =
      (options.flex !== undefined && options.flex !== this.flexWeight) ||
      (options.autoScale !== undefined &&
        options.autoScale !== this.autoScaleFlag) ||
      (options.invert !== undefined && options.invert !== this.inverted) ||
      (options.stateKey !== undefined && options.stateKey !== this.stateKeyValue);

    if (options.stateKey !== undefined && options.stateKey !== this.stateKeyValue) {
      if (this.stateKeyValue !== null) {
        throw new ContractError(
          `pane stateKey is already "${this.stateKeyValue}" and cannot be changed; create a new pane for a new identity`,
        );
      }
      this.assertStateKeyAvailable?.(options.stateKey);
      this.stateKeyValue = options.stateKey;
    }

    if (options.valuePadding !== undefined) {
      this.valuePadding = options.valuePadding;
    }
    if (options.autoScale !== undefined) this.autoScaleFlag = options.autoScale;
    if (options.flex !== undefined) this.flexWeight = options.flex;
    if (options.minHeight !== undefined) this.minHeightPx = options.minHeight;
    if (options.axis !== undefined) {
      this.axisOptions = { ...this.axisOptions, ...options.axis };
    }
    if (options.invert !== undefined) this.inverted = options.invert;

    // Options don't touch the drawn points — the index and the value range both stay the same.
    this.notify({ data: false, refit: false, state });
  }

  /**
   * The value range spanning every series in this pane.
   *
   * Since each series occupies a different span (a line just its close, a
   * candle its low to high), the union has to be taken so nothing gets
   * clipped. `null` if there's nothing at all to measure — whether there
   * are no series, or they're all empty.
   */
  valueExtent(visible: Viewport | null = null): Range | null {
    if (visible !== null) requireObject(visible, "valueExtent(visible)");
    return unionOf(this.entries.map((entry) => entry.valueExtent(visible)));
  }

  /**
   * The x range drawn by this pane's series. `null` if all are empty.
   *
   * The Plot uses this when fitting the x domain and when asking "is there
   * anything to draw" — once data has gone down, only the registrations can answer that.
   */
  xRange(): Range | null {
    return unionOf(this.entries.map((entry) => entry.xRange()));
  }

  /**
   * The x list for each registration's drawn points. Raw material for the
   * bar-index mapping (`XMapping.rebuild`).
   *
   * Handed over per registration rather than merged — each registration is
   * already sorted, and merging them into an index is the
   * mapping's job. The Plot only collects them.
   */
  xValuesPerSeries(): readonly (readonly number[])[] {
    return this.entries.map((entry) => entry.xValues());
  }

  /**
   * Sets the value range directly. **Turns off `autoScale`** — set it while
   * still on and the next frame overwrites it (with it on, y is a derived
   * value, not state).
   *
   * Differs from calling `yScale.setDomain` directly in two ways: it
   * notifies that state changed (raw material for `stateChange`), and the
   * Plot's data-change path respects this range — RSI's fixed 0-100 doesn't
   * get overwritten by a streaming append.
   */
  setValueDomain(min: number, max: number): void {
    /**
     * **`autoScale` turns off only after the scale accepts the value.**
     *
     * The line that turns it off used to come first. `setValueDomain(NaN,
     * 200)` correctly throws `ContractError`, but **autoScale was already
     * permanently off** by then — if the consumer catches the error and
     * moves on, the y-axis stops following even as later ticks arrive. No
     * notification either.
     *
     * The sibling right below, `applyOptions`, calls `checkPaneNumbers`
     * first — **the two siblings answered differently** (the exact shape
     * of a bug this once caused).
     */
    this.yScale.setDomain(min, max);
    this.autoScaleFlag = false;
    this.notify({ data: false, refit: false, state: true });
  }

  /**
   * Fits this pane's y so every one of its series is visible.
   *
   * Given `visible`, measures **only that range.** If `autoScale` is off,
   * this is ignored and it fits to everything it has — that's what lets a
   * manually set value range survive.
   */
  fitValueDomain(visible: Viewport | null = null): void {
    if (visible !== null) requireObject(visible, "fitValueDomain(visible)");
    const window = this.autoScale ? visible : null;
    const extent = this.valueExtent(window);
    if (!extent) return;

    // **Asks the scale for the padding** — additive for linear, multiplicative for log.
    const [min, max] = expandFor(
      this.yScale,
      extent,
      this.valuePadding,
      this.expandHints(window),
    );
    this.yScale.setDomain(min, max);
  }

  /**
   * Things the scale **asks back for only when it needs to.**
   *
   * `minPositive()` is only called when a log axis hits a non-positive
   * floor, so a linear axis's frame doesn't pay a cent for this scan.
   * `trackVisibleValues` runs on every render (60fps for as long as a hand
   * stays on the screen), so that laziness pays off.
   */
  private expandHints(visible: Viewport | null): ExpandHints {
    return {
      minPositive: () => {
        let smallest: number | null = null;
        for (const entry of this.entries) {
          const candidate = entry.positiveFloor(visible);
          if (candidate === null) continue;
          if (smallest === null || candidate < smallest) smallest = candidate;
        }
        return smallest;
      },
    };
  }

  /**
   * Draws in this order: background decorations, then series, then foreground decorations.
   *
   * `zIndex` is both what splits the three tiers and what orders things
   * within each tier — decorations are kept in z order from the moment the
   * list inserts them (`decoration.ts`), while series are sorted right
   * here. Ties fall back to registration order.
   */
  draw(target: DrawTarget, context: PaneDrawContext): void {
    const decorationContext: PaneDecorationContext = {
      area: this.assignedArea,
      x: context.x,
      yScale: this.yScale,
      pane: this,
      ticks: context.ticks,
      readStyle: context.readStyle,
      formatX: context.formatX,
      formatY: this.formatValue,
    };

    forEachBelowSeries(this.decorations, (decoration) =>
      decoration.draw(target, decorationContext),
    );

    // zIndex ascending, registration order (stable sort) on ties — this is
    // where a band fill turned on late still lands underneath the candles.
    // Skips sorting entirely when all are 0.
    const ordered = this.entries.some((entry) => entry.zIndex !== 0)
      ? [...this.entries].sort((a, b) => a.zIndex - b.zIndex)
      : this.entries;

    for (const entry of ordered) {
      // Drawing is an ascending scan — this opens a scanning plane instead
      // of a per-point binary search (`toPixel`). The plane is born and
      // dies with a single registration's draw, so registrations can't
      // interfere with each other's cursor, and a series author uses the
      // same `x.toPixel` without ever knowing the idiom — the context is
      // what opens that door.
      const scanPixel = context.x.scanToPixel?.();
      /**
       * **This is delegation, not copying.**
       *
       * It used to be `{ ...context.x, toPixel }`. A spread carries over
       * **only its own enumerable properties**, so a mapping written as a
       * class (`createXMapping` is a legitimate public extension point and
       * arrives that way) reached the series with only `toPixel` left on
       * it. A third-party series calling `context.x.fromPixel` — legal by
       * the declared type — would throw forever inside the render loop, and
       * `screenXAt` would also fail to find `domainToPixel` and quietly
       * fall off the O(1) fast path — exactly the path this spread was
       * meant to open.
       *
       * `Object.create` keeps the original as a **prototype**, so nothing
       * fails to carry over. The original stays untouched — the override
       * is the new object's own property.
       */
      let scanning: XMapping | null = null;
      if (scanPixel) {
        // `Object.create` produces `any` — receiving it into the declared type needs no assertion.
        const delegate: XMapping = Object.create(context.x);
        delegate.toPixel = scanPixel;
        scanning = delegate;
      }
      entry.draw(target, {
        viewport: context.viewport,
        x: scanning ?? context.x,
        yScale: this.yScale,
        area: this.assignedArea,
        readStyle: context.readStyle,
      });
    }

    forEachAboveSeries(this.decorations, (decoration) =>
      decoration.draw(target, decorationContext),
    );
  }
}
