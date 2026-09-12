import type { AxisBadge, Tick } from "../axis";
import { DEFAULT_Y_FORMAT, type ValueFormat } from "../axis";
import { ContractError, emitter, install, requireObject, type PlotArea } from "../primitives";
import type { Plugin, PluginApi } from "../primitives";
import type { BaseDataPoint, DataManagerFactory, Range, Viewport } from "../data";
import type { StyleReader, DrawTarget } from "../render";
import type { ExpandHints, Scale, XMapping } from "../scale";
import type { Series } from "../series";
import { createEntry } from "../registration";
import type { SeriesId, SeriesRegistration, SeriesSpec } from "../registration";
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
  emptyDecorations,
  forEachAboveSeries,
  forEachBelowSeries,
  mountDecoration,
} from "./decoration";
import {
  applyPaneOptions,
  settleOptions,
  type PaneOptions,
  type PaneSettings,
} from "./pane-options";
import { createSeriesHandle, type SeriesHandle } from "./series-handle";
import { SeriesList, type SeriesSample } from "./series-list";
import type { ResolvedYAxisOptions, AxisOptions } from "./types";
import { fitScale, formatOnAxis, replantScale } from "./value-axis";

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

const DATA_CHANGED: PaneChange = { data: true, refit: false };
const PICTURE_ONLY: PaneChange = { data: false, refit: false };

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
  /**
   * Hands the value axis back to `autoScale` — the named form of
   * `applyOptions({ autoScale: true })`. The next render fits it to the
   * visible range; a y-axis double-click lands here.
   */
  resetValueAxis(): void;
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
 *
 * What the pane keeps for itself is the **decisions**: which notification a
 * change earns, when the value axis is refit, what a handle may still do.
 * The list and its two owners live in `series-list.ts`, the handle in
 * `series-handle.ts`, the axis rules in `value-axis.ts`, and the options
 * door in `pane-options.ts`.
 */
export class Pane implements PaneApi {
  /** The series drawn here, in draw order, and who owns that list → `series-list.ts` */
  private readonly series = new SeriesList();

  /**
   * Extensions installed on this pane. **Cleaned up together when the pane
   * detaches.**
   *
   * Same rule as the chart's: stack in install order, tear down in reverse,
   * and let a dead one go at the next install → `Plot.use`
   */
  private readonly plugins: PluginApi[] = [];

  /** Every option, settled. Rewritten as a whole by `applyOptions` → `pane-options.ts` */
  private settings: PaneSettings;

  /** The assigned vertical slice. The Plot sets this before every render. */
  private assignedArea: PlotArea = EMPTY_AREA;

  /**
   * The change channel. The same discipline as the chart's events — the
   * same function subscribed twice counts as two, a subscriber that throws
   * doesn't stop the rest, and nothing is swallowed. A consumer can attach
   * a handler through the public `subscribe`, and if it throws, **the
   * chart's own `onPaneChange` must still run.**
   */
  private readonly changes = emitter<PaneChange>("a pane subscriber");
  private readonly decorations = emptyDecorations<PaneDecoration>();

  /** Whether the value axis follows the visible range. */
  get autoScale(): boolean {
    return this.settings.autoScale;
  }

  /** Share of the leftover vertical space this pane takes. Updates when a divider is dragged. */
  get flex(): number {
    return this.settings.flex;
  }

  /** Never shrinks below this (px). */
  get minHeight(): number {
    return this.settings.minHeight;
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
    return { ...this.settings.axis };
  }

  /** Whether the value axis is inverted → PaneOptions.invert */
  get invert(): boolean {
    return this.settings.invert;
  }

  get stateKey(): string | null {
    return this.settings.stateKey;
  }

  /**
   * The value axis. **Can be swapped out** — the log/linear toggle arrives
   * via `setYScale`. The constructor's is just the initial wiring.
   */
  get yScale(): Scale {
    return this.scale;
  }

  /**
   * **When a format is set, five surfaces use the same ruler — down to
   * the tick spacing.** Axis, badge, tooltip, legend and priceLine all
   * read this, so their formatting can't drift apart → `formatOnAxis`.
   * With no format set they deliberately differ: ticks print the value
   * as-is while the badge surfaces fall back to two decimals — a split
   * kept on purpose, because unifying it changes every chart that never
   * touched formatting. An arrow function because it's carried into
   * decoration contexts as `formatY`.
   */
  formatValue = (value: number): string => {
    const inherited = this.inheritedYAxis?.();
    const format = this.settings.axis.format ?? inherited?.format;
    if (!format) return DEFAULT_Y_FORMAT(value);

    return formatOnAxis(
      this.scale,
      format,
      this.settings.axis.minTickSpacing ?? inherited?.minTickSpacing,
      value,
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
    private readonly inheritedYAxis?: () => ResolvedYAxisOptions,
    /** Plot-owned uniqueness check for the persistent state identity. */
    private readonly assertStateKeyAvailable?: (key: string) => void,
  ) {
    this.settings = settleOptions(options);
    if (this.settings.stateKey !== null) {
      this.assertStateKeyAvailable?.(this.settings.stateKey);
    }
  }

  /**
   * Swaps out the value axis — the door for the log/linear toggle.
   *
   * Replants the current value range (domain) onto the new scale — a toggle
   * shouldn't change the window being viewed; when it can't be kept, the
   * data is refit on the new axis instead → `replantScale`. `setArea` in
   * the next frame plants the range.
   *
   * **Installation happens only after that succeeds.** Setting
   * `this.scale = next` first would mean that if even the fallback throws,
   * the pane is left holding a new axis with an invalid domain, no
   * notification runs, and every `render()` after that rethrows the same
   * exception forever. So `next` is finished off to the side and plugged in
   * last — whatever throws along the way, `this.scale` is still the old
   * axis, so the screen stays alive.
   */
  setYScale(next: Scale): void {
    replantScale(
      next,
      this.scale,
      this.valueExtent(null),
      this.settings.valuePadding,
      this.expandHints(null),
    );

    this.scale = next;

    // Both the drawn points and the state fields stay the same — just redraw.
    this.notify(PICTURE_ONLY);
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
    return this.changes.subscribe(listener);
  }

  /** Omitting this means **the data changed** — that's what most call sites mean. */
  private notify(change: PaneChange = DATA_CHANGED): void {
    this.changes.emit(change);
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
    const entry = createEntry<TSource, TPoint>(registration, this.createDataManager);
    this.series.add(entry);
    this.notify();

    return this.handleFor(entry);
  }

  /**
   * A handle pointing at one registration. **Whether it's attached is the
   * asking side's question**: even with the registration alive, if the
   * whole pane came out (`removePane`, `destroy`), whatever was drawn lands
   * nowhere, so `attached` is false — while the write doors keep throwing
   * only on the registration being gone. Why the two are kept apart is
   * written on `SeriesHandle.attached` → `series-handle.ts`
   */
  private handleFor<
    TSource extends BaseDataPoint,
    TPoint extends BaseDataPoint,
  >(entry: Parameters<typeof createSeriesHandle<TSource, TPoint>>[0]): SeriesHandle<TSource, TPoint> {
    return createSeriesHandle<TSource, TPoint>(entry, {
      registered: () => this.series.has(entry),
      attached: () => !this.detached && this.series.has(entry),
      remove: () => void this.series.remove(entry),
      notify: (change) => this.notify(change),
    });
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
    return mountDecoration(this.decorations, decoration, options, () =>
      this.notify(PICTURE_ONLY),
    );
  }

  /**
   * Fits the series list to what the array says. **Owns the whole list.**
   * It cannot be mixed with `addSeries`/`setSeries`; mixed ownership throws
   * before any entry is detached. What "changed" means, and why the
   * derivation cache survives a matching id → `SeriesList.sync`
   */
  syncSeries(specs: readonly SeriesSpec[]): void {
    // If nothing changed, there's no reason to refit the value axis either.
    if (this.series.sync(specs, this.createDataManager)) this.notify();
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
    const entry = createEntry<TSource, TPoint>(registration, this.createDataManager, "setSeries");
    this.series.replace(entry);
    this.notify();

    return this.handleFor(entry);
  }

  clearSeries(): void {
    this.series.clear();
    this.notify();
  }

  /** The nearest point of each registration at a data x — what tooltips ask → `SeriesList.probe` */
  probe(x: number): SeriesSample[] {
    return this.series.probe(x);
  }

  getSeries(): readonly SeriesId[] {
    return this.series.entries.map((entry) => entry.series);
  }

  /**
   * Changes only what's given. Same rule as `Plot.applyOptions` — omitting
   * means "leave as is." Which changes count as state, and why a stateKey
   * can't be changed once claimed → `applyPaneOptions`
   */
  applyOptions(options: PaneOptions): void {
    const { next, state } = applyPaneOptions(
      this.settings,
      options,
      this.assertStateKeyAvailable,
    );
    this.settings = next;

    // Options don't touch the drawn points — the index and the value range both stay the same.
    this.notify({ data: false, refit: false, state });
  }

  /** The value range spanning every series in this pane. `null` if there's nothing at all to measure. */
  valueExtent(visible: Viewport | null = null): Range | null {
    if (visible !== null) requireObject(visible, "valueExtent(visible)");
    return this.series.valueExtent(visible);
  }

  /**
   * The x range drawn by this pane's series. `null` if all are empty.
   *
   * The Plot uses this when fitting the x domain and when asking "is there
   * anything to draw" — once data has gone down, only the registrations can answer that.
   */
  xRange(): Range | null {
    return this.series.xRange();
  }

  /** The x list for each registration's drawn points — raw material for the bar-index mapping. */
  xValuesPerSeries(): readonly (readonly number[])[] {
    return this.series.xValuesPerSeries();
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
     * The sibling right above, `applyOptions`, checks its numbers first —
     * **the two siblings answered differently** (the exact shape of a bug
     * this once caused).
     */
    this.yScale.setDomain(min, max);
    this.settings = { ...this.settings, autoScale: false };
    this.notify({ data: false, refit: false, state: true });
  }

  resetValueAxis(): void {
    this.applyOptions({ autoScale: true });
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

    fitScale(this.yScale, extent, this.settings.valuePadding, this.expandHints(window));
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
    return { minPositive: () => this.series.minPositive(visible) };
  }

  /**
   * Draws in this order: background decorations, then series, then foreground decorations.
   *
   * `zIndex` is both what splits the three tiers and what orders things
   * within each tier — decorations are kept in z order from the moment the
   * list inserts them (`decoration.ts`), while series are sorted by the
   * list as it draws (`SeriesList.draw`). Ties fall back to registration order.
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

    this.series.draw(target, {
      viewport: context.viewport,
      x: context.x,
      yScale: this.yScale,
      area: this.assignedArea,
      readStyle: context.readStyle,
    });

    forEachAboveSeries(this.decorations, (decoration) =>
      decoration.draw(target, decorationContext),
    );
  }
}
