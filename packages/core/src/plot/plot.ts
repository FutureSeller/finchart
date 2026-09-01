import { labelFont, type AxisLabelRenderer } from "../axis";
import {
  ContractError,
  plotAreaOf,
  RenderError,
  requireFinite,
  requireInterval,
  requireNonNegative,
  requireObject,
  requirePoint,
  throwable,
  createScope,
  type PlotArea,
  type Point,
  type Scope,
} from "../primitives";
import type { BaseDataPoint, Range, Viewport } from "../data";
import {
  InputRouter,
  type InputConsumer,
  type InputConsumerOptions,
  type InputEvent,
  type InteractionTarget,
} from "../interaction";
import {
  type ChartLayers,
  type StyleReader,
  type Renderer,
  type TextMeasurer,
} from "../render";
import type { Series } from "../series";
import { continuousX, LinearScale, type Scale, type XMapping } from "../scale";
import { axisDragConsumer } from "./axis-drag";
import type {
  CursorHost,
  DecorationHost,
  FocusAreaHost,
  FocusClaim,
  FormatSource,
  InputHost,
  OverlayHost,
  PaneHost,
  PlotEventSource,
  PluginHost,
  RenderRequester,
  ViewportControl,
  XCoordinates,
} from "./capabilities";
import type { DecorationOptions, PlotDecoration } from "./decoration";
import { BELOW_SERIES, emptyDecorations, mountDecoration } from "./decoration";
import { gridDecoration } from "./grid";
import { clampDividerDrag, type DividerRenderer } from "./dividers";
import {
  checkPlotNumbers,
  checkViewportSize,
  copyConfig,
  mergeOptions,
  resolveConfig,
  type ViewportDimensions,
} from "./config";
import { cursorClaims, type CursorClaims, focusClaims } from "../interaction";
import { eventChannel } from "../primitives";
import type { CrosshairPayload, PlotEvents } from "./events";
import { DEFAULT_X_FORMAT } from "../axis";
import { layoutFrame, type Frame } from "./frame";
import type { AxisSlices } from "./layout";
import type { SeriesId, SeriesRegistration } from "../registration";
import type { PaneApi, PaneChange } from "./pane";
import type { PaneOptions } from "./pane-options";
import type { SeriesHandle } from "./series-handle";
import { PaneStack } from "./panes";
import { paintFrame, type PaintStage } from "./painter";
import { install } from "../primitives";
import type { Plugin, PluginApi } from "../primitives";
import { immediateScheduler, type RenderScheduler } from "../render";
import { applyPaneState, matchPaneState, paneStateOf, type ChartState } from "./state";
import { XViewport } from "./x-viewport";
import type {
  PlotConfig,
  PlotDeps,
  PlotOptionsPatch,
  ResolvedPlotConfig,
} from "./types";

/**
 * What it takes to stand up a `Plot`.
 *
 * This used to be five positional arguments; now it's named. `new Plot(el,
 * deps, config, null, size)` gave no way to tell what the fourth argument was
 * just by reading the call site.
 *
 * **There's no series here.** When there was, nothing checked that `series`
 * and `data` agreed on point type — a class constructor can't be generic, so
 * it fell back to `PlotOptions<BaseDataPoint>`, which disarmed the
 * registration union's discriminant (`SeriesRegistration`) entirely.
 * `{ series: lineSeries(), data: candles }` **compiled and read `.y` at
 * runtime as undefined** — the exact bug the discriminant was supposed to
 * block, alive on this one path.
 *
 * The place to mount one is `plot.mainPane.addSeries()`. Being a method
 * generic lets the registration's point type flow through, and it hands back
 * a handle besides. `PlotBuilder` and `createPlotModel` both go through that
 * door internally.
 */
export interface PlotOptions {
  /**
   * `container` isn't here — where the chart mounts is
   * something the wiring (deps) already knows. Browser assembly's
   * `browserDeps(options)` returns a recipe whose `build(el)` feeds it an
   * element to produce container-bound deps, and headless assembly
   * (`createPlotModel`) has no such slot to begin with. Keeping element
   * types out of the core contract is half of what makes headless headless.
   */
  deps: PlotDeps;
  /** May be left out — every static default is filled at this door (`resolveConfig`). */
  config?: PlotConfig;
  /** Initial size of the layers. Changed afterward with `setViewport`. */
  size: ViewportDimensions;
  /**
   * A parent lifetime to live under. When the given scope is disposed, this
   * chart is destroyed with it — a page-level scope can own several charts
   * and their sibling subscriptions, and one `dispose()` walks out of all
   * of it. Destroying the chart yourself first is fine (the parent then has
   * nothing left to do), and a chart mounted into an already-disposed scope
   * is destroyed on the spot rather than living unowned.
   */
  scope?: Scope;
}

/**
 * The chart. Owns the layers, scales, grid, and interaction.
 *
 * Data representation belongs to `Series`, swapped out with `setSeries`.
 * Swapping it leaves everything here alone — overlay annotations, pan/zoom
 * position, all of it.
 *
 * **The `implements` list is long. That's the point** — an extension
 * doesn't require this class, only whichever of the capabilities below it
 * actually uses, and this list is the complete answer to "what does the
 * chart lend out" (see `capabilities.ts`). The compiler keeps the pairing
 * honest.
 */
export class Plot
  implements
    InteractionTarget,
    RenderRequester,
    DecorationHost,
    PlotEventSource,
    PaneHost,
    InputHost,
    OverlayHost,
    ViewportControl,
    XCoordinates,
    // The three below were missing from this list for a long time — because
    // typing is structural, consumers (`CursorHost & FocusAreaHost` in
    // `@finchart/tools`, `FormatSource` in `@finchart/dom`) still worked, but
    // that means a signature mismatch here would compile quietly and blow up
    // **in someone else's package.** Adding them makes the class docstring's
    // claim — "the compiler keeps the pairing honest" — actually true.
    FormatSource,
    CursorHost,
    FocusAreaHost,
    PluginHost<Plot>
{
  /** What the chart announces → `events.ts`. Cleared first on destroy. */
  private readonly events = eventChannel<PlotEvents>();
  private readonly scheduler: RenderScheduler;
  private readonly layers: ChartLayers;
  private readonly renderer: Renderer;
  /** null unless supplied. Not mounting labels is the normal state. */
  private readonly axisLabels: AxisLabelRenderer | null;
  /** null unless supplied — axis slices then fall back to a fixed width. */
  private readonly measurer: TextMeasurer | null;
  /** null unless supplied. Pane heights are then set by flex alone. */
  private readonly dividers: DividerRenderer | null;

  /**
   * The default pane that holds series. Always exists.
   *
   * If you never create another pane, every series lands here, so having
   * one pane matches the library's original behavior exactly.
   *
   * **Only a narrow face is exposed outward** — the frame wiring
   * (`setArea`, `draw`, …) belongs to the chart → `PaneApi`
   */
  get mainPane(): PaneApi {
    return this.paneStack.main;
  }

  /**
   * The pane list and its two doors. The main pane is born there; the
   * decision a pane change triggers stays here (`onPaneChange`) → `panes.ts`
   */
  private readonly paneStack: PaneStack;
  private readonly decorations = emptyDecorations<PlotDecoration>();

  /**
   * The APIs of installed plugins. **Pushed in install order, torn down in
   * reverse.**
   *
   * Treated as a stack because a later plugin may have been built on top of
   * an earlier one. A disposed plugin drops out at the next install → `install`
   * in `plugin.ts`
   */
  private readonly plugins: PluginApi[] = [];
  /**
   * Owns the release of everything the constructor acquires (layers,
   * renderer surface, labels, dividers, input, observers). Each acquiring
   * line registers its release right below itself, so `destroy()` carries
   * no checklist to forget a line from.
   */
  private readonly scope = createScope();
  private destroyed = false;

  private readonly deps: PlotDeps;

  /**
   * Where a data x lands on screen. Both series and decorations look at
   * nothing else.
   *
   * The wiring chooses this — continuous is the default (the domain is
   * simply the data's x), and financial charts turn on bar-index coordinates
   * with `barIndexX`. **The scale's domain belongs to the mapping**, so it's
   * exchanged with the data-side world (slicing, events, crosshair) via
   * `toDomain`/`fromDomain`
   */
  private readonly x: XMapping;
  /** Made once from `deps.xScale()` — this Plot's own, never the wiring's. */
  private readonly xScale: Scale;
  /** How many times the x index has been recounted → `Viewport.xEpoch` (the key to the slot cache). */
  private xEpoch = 0;

  /**
   * The visible x range. **The state trio (has it fitted, pending restore,
   * previous end) lives there.**
   *
   * Split out because it's the window's job, not the chart's — when it lived
   * here, that trio was scattered across two dozen-odd fields, and the two
   * subtlest rules (a restore that arrives before data, deciding whether a
   * new bar counts as a shift) could only be tested by standing up the whole
   * chart → `x-viewport.ts`
   */
  private readonly xViewport: XViewport;

  /**
   * What the painter is lent — built once, after the collaborators above
   * exist. The pane list and `decorations` go in as the live references, so
   * no frame has to rebuild this → `painter.ts`
   */
  private readonly stage: PaintStage;

  private config: ResolvedPlotConfig;

  constructor(options: PlotOptions) {
    // The options object **itself** is a door too — `checkViewportSize`
    // guarded `size` but not this, so `new Plot(null)` threw
    // "Cannot destructure property 'deps'". Destructuring happened before
    // the check below, so the internal name leaked straight through.
    requireObject(options, "Plot(options)");
    const { deps, size } = options;
    // Say so here if a required collaborator is missing — `checkPlotNumbers`
    // destructures first, so `{}` alone produced a raw TypeError. `config`
    // may be left out entirely (every static default is filled at this
    // door), but a given one must be an object — `null` stays an error.
    requireObject(deps, "Plot({ deps })");
    const config = options.config === undefined ? {} : options.config;
    requireObject(config, "Plot({ config })");

    // Both the constructor and applyOptions pass through this — only one
    // getting fixed is exactly the accident this guard exists to prevent
    // (see the checkPlotNumbers docstring).
    checkPlotNumbers(config);
    checkViewportSize(size);

    this.deps = deps;
    /**
     * **Doesn't hold onto the caller's object as-is.** Keeping the
     * reference would let whoever still holds it mutate the chart around
     * `applyOptions` — no render scheduled, no `stateChange`.
     * `@finchart/dom`'s `PlotBuilder` is exactly that shape: `build()` hands
     * over its own fields as-is, and `setShowGrid`-style calls can still be
     * made afterward, so building twice from one builder splits the config
     * between them. Copying here is what makes it true that `applyOptions`
     * is the one door for changes. **Nested objects included** — `padding`
     * is read on every layout, so a shallow copy let `config.padding.left =
     * 0` after mounting move the plot area with no render scheduled.
     *
     * Resolution rides on the same pass — every static default is filled
     * here, exactly once, so read sites downstream take values instead of
     * re-deciding defaults locally (`resolveConfig`).
     */
    this.config = resolveConfig(config);
    this.viewportSize = { width: size.width, height: size.height };

    this.scheduler = (deps.createScheduler ?? immediateScheduler)(() =>
      this.render(),
    );
    this.layers = deps.createLayers(size.width, size.height);
    this.scope.add(() => this.layers.destroy());
    // Read through `this.layers` on each transition rather than detaching
    // `setCursor` — a layer written as a class keeps its receiver that way.
    this.cursor = cursorClaims((cursor) => this.layers.setCursor?.(cursor));
    this.renderer = deps.createRenderer(this.layers.data);
    // Not a release — the last frame is erased so a still-mounted canvas
    // doesn't keep showing a dead chart. Runs before layers go (reverse order).
    this.scope.add(() => {
      this.renderer.clear();
      this.renderer.commit();
    });
    this.axisLabels =
      deps.createAxisLabels?.({
        overlay: this.layers.overlay,
        target: this.renderer,
      }) ?? null;
    this.scope.add(() => this.axisLabels?.destroy());
    // Give it the same surface as the renderer — the place that measures
    // and the place that draws must be the same engine.
    this.measurer = deps.createTextMeasurer?.(this.layers.data) ?? null;
    this.dividers =
      deps.createDividers?.(this.layers.overlay, (index, dy) =>
        this.resizeBetween(index, dy),
      ) ?? null;
    this.scope.add(() => this.dividers?.destroy());

    this.xScale = deps.xScale();
    this.x = (deps.createXMapping ?? continuousX)(this.xScale);
    this.paneStack = new PaneStack(deps.mainPaneYScale(), {
      createDataManager: deps.createDataManager,
      yAxisOptions: () => this.config.axis.y,
      onCreate: (pane) => this.addGrid(pane),
      onChange: (change) => this.onPaneChange(change),
    });
    this.stage = {
      renderer: this.renderer,
      axisLabels: this.axisLabels,
      dividers: this.dividers,
      decorations: this.decorations,
      panes: this.paneStack.list,
      x: this.x,
      formatX: this.formatX,
    };
    this.xViewport = new XViewport({
      scale: this.xScale,
      x: this.x,
      dataRange: () => this.dataRange,
      // A reader function, not a value — changed via applyOptions.
      options: () => this.config,
      onChange: (visible) => {
        this.emitStateChange();

        /**
         * **Don't build the payload if nobody's listening** — the same door
         * its sibling `emitStateChange` puts up before building a snapshot.
         *
         * `dataRange` is a walk over every series in every pane
         * (`Plot.dataRange`), and this spot runs on **every pointermove**
         * of a drag pan (state is synchronous, it doesn't coalesce into a
         * frame). On a high-polling-rate trackpad this fires more
         * often than frames do.
         */
        if (!this.events.has("xDomainChange")) return;
        this.events.emit("xDomainChange", {
          ...visible,
          // Series decide "empty means null" themselves — Plot doesn't
          // second-guess it.
          dataRange: this.dataRange,
        });
      },
    });

    // The chart always starts empty — series only arrive through addSeries
    // (see PlotOptions). When the first data arrives, onPaneChange fits x,
    // and the new-bar detection baseline (lastDataMax) is set there too.

    this.installAxisDrag();

    // Input and size observation know for themselves where they attach —
    // assembly bound the element up front (the browserDeps recipe). Headless
    // wiring doesn't supply these collaborators.
    this.deps.interactions?.connect(this);
    this.scope.add(() => this.deps.interactions?.disconnect());
    const unobserveSize = this.deps.observeSize?.((width, height) =>
      this.followContainer(width, height),
    );
    if (unobserveSize) this.scope.add(unobserveSize);
    /**
     * Redraw when the scale changes — **that's all.**
     *
     * Neither the viewport nor the domain is touched. Reacquiring the
     * backing store is `layers.resize()`, called from `render()`, and the
     * surface reads its own `devicePixelRatio` inside that call
     * itself. All this does is trigger that, so leaving it unwired
     * behaves exactly as before.
     */
    const unobserveResolution = this.deps.observeResolution?.(() =>
      this.scheduleRender(),
    );
    if (unobserveResolution) this.scope.add(unobserveResolution);

    /**
     * Last, once every acquisition above has succeeded — the parent must
     * never hold a teardown for a chart that failed to finish being born.
     * `destroy()` is idempotent, so the consumer destroying the chart
     * early leaves the parent's entry a no-op, not a double free.
     */
    options.scope?.add(() => this.destroy());
  }

  /**
   * Stacking order, top to bottom.
   *
   * **This is a copy.** `readonly` is only a
   * compiler promise — handing out the original lets `splice` work at
   * runtime, and that array is the very list the chart draws from. Pulling
   * a pane out from outside would remove it with no `detach`, no
   * unsubscribe, so an extension's `dispose` would never be called. The
   * only doors that change the list are `addPane` and `removePane`.
   */
  get panes(): readonly PaneApi[] {
    return [...this.paneStack.list];
  }

  /**
   * The grid is a built-in decoration attached once per pane.
   *
   * Its config is passed as a reader function, not a value — so toggling
   * the grid via `applyOptions` never requires re-registering it.
   */
  private addGrid(pane: PaneApi): void {
    pane.addDecoration(
      gridDecoration(() => ({
        show: this.config.showGrid,
        overrides: this.config.style?.grid,
      })),
      { zIndex: BELOW_SERIES },
    );
  }

  /**
   * Installs one extension and **returns exactly the API it built.**
   *
   * ```ts
   * const maximize = plot.use(paneMaximize());  // the type just comes along
   * maximize.maximize(plot.mainPane);
   * ```
   *
   * **What splits the chart's things from a pane's things is what they hang
   * off of.** The example above used to be drawing tools, and that was
   * **the wrong example** — drawing tools is `pane.use(drawingTools({ plot
   * }))` (it uses the pane's value axis). JSDoc ships into the published
   * `.d.ts` and becomes editor tooltips, so a wrong snippet here travels
   * further than the docs do.
   *
   * (Don't quote the wrong form even in a comment: `snippet-drift.test.ts`
   *  scans the published source and blocks a call with no arguments, so
   *  writing it as an aside gets flagged as a violation too. This trap was
   *  hit twice — the first time was a stale token name that slipped through.)
   *
   * **Doesn't merge methods onto the instance.** TanStack Table v8 does that
   * with `_features` (`table.getSortedRowModel()`), which needs type
   * gymnastics and makes the core type different per plugin. Returning the
   * API instead means `Plot`'s type never changes because of a plugin, and
   * no declaration merging is needed.
   *
   * Install order is **not draw order.** z-index decides that.
   */
  use<Api extends PluginApi>(plugin: Plugin<Plot, Api>): Api {
    if (this.destroyed) {
      throw new ContractError("cannot install a plugin on a destroyed Plot");
    }

    return install(this.plugins, this, plugin, "plot.use(plugin)");
  }

  /**
   * Mounts a decoration over the whole chart. Anything that doesn't need a
   * value axis comes here — crosshair, range shading, watermark.
   *
   * If y is needed, use `pane.addDecoration` — x belongs to `Plot`, y
   * belongs to `Pane`.
   */
  addDecoration(
    decoration: PlotDecoration,
    options: DecorationOptions = {},
  ): () => void {
    // Removal is idempotent — the same door `Pane.addDecoration` uses.
    return mountDecoration(this.decorations, decoration, options, () =>
      this.scheduleRender(),
    );
  }

  /**
   * Requests a redraw on the next frame.
   *
   * The door a decoration that holds its own state (like the crosshair)
   * uses to refresh the screen. Unlike `render()`, requests within the same
   * frame are coalesced into one.
   */
  requestRender(): void {
    this.scheduleRender();
  }

  /**
   * A pane changed. **Whether to refit x is decided right here.**
   *
   * The imperative `handle.setData` fits, because it's a new dataset. Data
   * that arrived declaratively does **not** fit — a window
   * showing BTC shouldn't jump to a union just because ETH was mounted
   * later, and infinite scroll re-handing the array also comes through
   * here. So under the declarative path, refitting happens only once for
   * the first data and via `fitDomains()`.
   *
   * **The first time must fit.** Until then the x domain is the scale's
   * default [0,1], and nothing is in place.
   */
  private onPaneChange(change: PaneChange): void {
    /**
     * If the drawn points haven't changed, **only redraw the picture.**
     *
     * Value-axis swaps, decorations, and options (padding, flex, autoScale)
     * come through here. There used to be no such branch, so changing even
     * a single padding value recounted the entire x index — a full merge
     * sort of every point under bar-index coordinates.
     */
    if (!change.data) {
      if (change.state) this.emitStateChange();
      this.scheduleRender();
      return;
    }

    /**
     * The index is derived from data, so it can't go stale before the data
     * does — both refit and render run on top of this rebuild.
     *
     * **But if x hasn't moved, there's nothing to recount.**
     * A tick on an in-progress bar sets a different value at
     * the same x, so the x set stays the same. The omission leans toward
     * safety — any change that doesn't record `xValues` recounts anyway.
     */
    if (change.xValues !== false) this.rebuildX();

    // The baseline for detecting a new bar is "the end we knew before" —
    // update it and hold the old value. Even the path that falls through to
    // a refit must update the baseline so the next bar is recognized.
    const range = this.dataRange;
    const previousMax = this.xViewport.noteData(range);

    if (change.state) this.emitStateChange();

    if (change.refit || !this.xViewport.fitted) {
      this.fitDomains();
      return;
    }

    this.xViewport.followNewBar(previousMax, range);

    // An autoScale pane is fitted to the settled visible range by the render.
    // Do not scan its full value extent here; prepend notifications can arrive
    // many times before that scheduled render.
    this.scheduleRender();
  }

  /**
   * Has the bar-index mapping recount its index.
   *
   * A continuous mapping has no `rebuild`, and in that case gathering x at
   * all is skipped — the default wiring has no reason to build an array on
   * every data change.
   */
  private rebuildX(): void {
    if (!this.x.rebuild) return;
    this.x.rebuild(this.paneStack.xValuesPerSeries());
    // Place is derived from the index, so it goes stale on rebuild — the
    // invalidation key for the place cache.
    this.xEpoch += 1;
  }

  /**
   * Stacks one more pane below.
   *
   * For indicators with a value range that doesn't fit alongside price
   * (RSI, volume). An indicator that only needs to overlay on top of price
   * doesn't need a pane — use `mainPane.addSeries` instead.
   *
   * Its value axis is its own — linear by default, with log available if
   * you need it.
   */
  addPane(options: PaneOptions & { yScale?: Scale } = {}): PaneApi {
    requireObject(options, "addPane(options)");
    /**
     * **No standing up a pane in a graveyard.**
     * `Pane.detached` is the same door raised for `use`, and it prevents the
     * same leak — a pane created here goes into the stack with its
     * subscription, but `destroy()` has already torn the stack down and
     * **won't run again.** That pane's `detached` is
     * false, so `pane.use(plugin)` works, and nobody ever calls that
     * extension's `dispose`.
     *
     * The path that reaches this is exactly the one the contract already
     * documents as normal — *"an event handler arriving late during
     * unmount"*: if `plot.addPane()` after `await fetchConfig()` lands after
     * a React unmount, the pane's manager, data, and any extension timers
     * live until the tab dies.
     */
    if (this.destroyed) {
      throw new ContractError("cannot add a pane to a destroyed Plot");
    }

    const pane = this.paneStack.add(options.yScale ?? new LinearScale(), options);
    // The state's panes array grew by one — keyed panes match semantically
    // and legacy panes by index, so a shape change is state too.
    this.emitStateChange();
    this.scheduleRender();

    return pane;
  }

  /** mainPane always survives — otherwise series would have nowhere to go. */
  removePane(pane: PaneApi): void {
    requireObject(pane, "removePane(pane)");

    // Extensions are cleaned up first and removal finishes even if one of
    // them throws — and survives one of them removing a neighbor → `PaneStack.remove`
    const failures = this.paneStack.remove(pane);
    if (failures === null) return;

    // Unsubscribing happened first, so the pane side won't report in —
    // recount directly.
    this.rebuildX();
    this.emitStateChange();
    this.scheduleRender();

    if (failures.length > 0) {
      throw throwable(failures, "cleaning up a pane's extensions failed");
    }
  }

  // --- XCoordinates ---

  /**
   * The **data x** under a screen x (px). Not an index even in bar-index
   * coordinates.
   *
   * The door an extension doing hit testing uses — this door didn't used to
   * exist, so `@finchart/tools` was stashing the draw context in a variable
   * on the side.
   */
  xAt(pixel: number): number {
    return this.x.fromPixel(pixel);
  }

  /** The screen x (px) where a data x lands. */
  pixelAtX(x: number): number {
    return this.x.toPixel(x);
  }

  /**
   * The resolved x notation — `config.axis.x.format`, or a rounded
   * integer if none is given. x belongs to the chart, so this lives here
   * The decoration context and the `FormatSource` default that
   * tooltips fall back to both read this. It's an arrow function because it
   * gets carried as a function into the context.
   */
  formatX = (value: number): string => {
    const format = this.config.axis.x.format;
    return format ? format(value) : DEFAULT_X_FORMAT(value);
  };

  /**
   * The DOM layer that annotations and tooltips mount on.
   * Whatever is attached here survives a canvas redraw or a series swap.
   *
   * **The core doesn't know what this is** — it hands out whatever the
   * layers supplied (`ChartLayers.overlay`) as-is. A DOM consumer narrows it
   * with `requireOverlayElement`. A headless chart has none (null) — no DOM,
   * nowhere to mount.
   */
  get overlay(): unknown {
    return this.layers.overlay;
  }

  /**
   * When the container reports a change.
   *
   * Two things need filtering out. **Zero is not accepted** — that's what
   * arrives for `display: none`, and passing it through collapses the
   * scale's range to a single point. And **the same size is not accepted**
   * either — `ResizeObserver` calls once with the current size when
   * observation starts, so without this filter, every mount adds one wasted
   * render.
   */
  private followContainer(width: number, height: number): void {
    if (this.destroyed) return;
    if (width === 0 || height === 0) return;

    const current = this.viewport;
    if (width === current.width && height === current.height) return;

    this.setViewport({ width, height });
  }

  /**
   * The chart's viewport size (CSS px). **`Plot` owns it as state.**
   *
   * This used to be read off the layers, which meant changing the size
   * meant clearing the bitmap right then, so "state is synchronous, drawing
   * is per-frame" couldn't be kept. State changes immediately here, and the
   * bitmap catches up right before drawing.
   */
  private viewportSize: ViewportDimensions;

  private get viewport(): ViewportDimensions {
    return this.viewportSize;
  }

  private get area(): PlotArea {
    return plotAreaOf(this.viewport, this.config.padding);
  }

  /**
   * Sets the visible x range **in data x** (the lightweight
   * `setVisibleRange`).
   *
   * The same arithmetic as `applyState`'s xDomain piece — under bar-index
   * coordinates, `toDomain` recovers the index. If data hasn't arrived yet,
   * it reconciles from pending.
   */
  setVisibleRange(fromX: number, toX: number): void {
    /**
     * **Caught at the door.** Before data
     * arrives, this value would just sit in `pending` and blow up **inside
     * the first `setData`** — a `ContractError` naming the scale would come
     * out of the data door, so you'd see a door you never called. The same
     * discipline `checkPlotNumbers` applies to options.
     */
    requireInterval(fromX, toX, "setVisibleRange");

    this.xViewport.setVisibleRange(fromX, toX);
    this.scheduleRender();
  }

  /**
   * Keeps the window's width and returns to live (last bar + rightOffset)
   * (the lightweight `scrollToRealTime`). Unlike `fitDomains`, the zoom
   * level survives — this is the destination of the "jump back to now"
   * button after browsing the past.
   */
  scrollToRealTime(): void {
    this.xViewport.scrollToRealTime();
    this.scheduleRender();
  }

  /** Refits both axes so all data currently held is visible. */
  fitDomains(): void {
    this.xViewport.fit();
    // An explicit refit also refits a manual value range — "make everything
    // visible" is the request. This is where it diverges from the path data
    // changes take (fitValueDomain).
    for (const pane of this.paneStack.list) {
      pane.fitValueDomain();
    }
    this.scheduleRender();
  }

  /**
   * Swaps mainPane for this one registration. Returns a handle.
   *
   * The x domain is untouched, so the visible range (pan/zoom) is
   * preserved. y is refit because different series occupy different ranges
   * (a line uses close, a candle uses low through high).
   *
   * **Data doesn't carry over** — it belongs to the registration, so a new
   * registration brings its own.
   */
  setSeries<
    TSource extends BaseDataPoint,
    TPoint extends BaseDataPoint = TSource,
  >(
    registration: SeriesRegistration<TSource, TPoint> | Series<TSource>,
  ): SeriesHandle<TSource, TPoint> {
    // Value-axis recomputation and rendering are the Pane subscriber's job.
    return this.mainPane.setSeries<TSource, TPoint>(registration);
  }

  /**
   * The first series mounted on mainPane. Use `mainPane.getSeries()` to see
   * more than one. undefined if nothing has been mounted yet.
   *
   * Not narrowed, since a derived series can have a different point type
   * than its source — this is for identity comparison.
   */
  getSeries(): SeriesId | undefined {
    return this.mainPane.getSeries()[0];
  }

  /**
   * Changes only the config. Neither the layers nor the domain is touched.
   *
   * Recreating a `Plot` for something like toggling the grid would spin up
   * a new canvas, throwing away pan position and any overlay annotations
   * entirely.
   *
   * **Only the fields given change.** Giving `axis: { x }` leaves `y` alone
   * — the old `setConfig` did a shallow merge, so it silently vanished
   * there. Which fields swap as a unit is documented on `PlotOptionsPatch`.
   */
  applyOptions(options: PlotOptionsPatch): void {
    // Vocabulary cleanup — a wrong shape used to blow up in
    // the destructuring below under someone else's name.
    requireObject(options, "applyOptions(options)");
    checkPlotNumbers(options);

    // Which fields merge and which replace, and why an explicit `undefined`
    // is "not given" everywhere but `axis` → `mergeOptions` in `config.ts`
    const merged = mergeOptions(this.config, options);

    /**
     * The **merged** result goes through the door too, before it's
     * installed. A patch can be fine on its own and still cross a
     * standing value (`minBarSpacing: 100` onto a config holding
     * `maxBarSpacing: 50`) — and validating after assignment would leave
     * the config half-landed in exactly the state the check refuses.
     */
    checkPlotNumbers(merged);
    this.config = merged;

    this.scheduleRender();
  }

  /**
   * A **copy** of the current config. Editing it doesn't touch the chart —
   * the one door for changes is `applyOptions`.
   *
   * When this was a shallow copy, `getOptions().padding.left = 0` mutated
   * the internals directly.
   */
  getOptions(): ResolvedPlotConfig {
    return copyConfig(this.config);
  }

  /**
   * **Keeps "only what's given changes" true to the letter.**
   *
   * This used to be `{ ...this.viewportSize, ...viewport }`. A spread
   * **treats an explicit `undefined` as a value too**, so `setViewport({
   * width: 640, height: undefined })` erased the height — and
   * `@finchart/react` calls it exactly that way (`use-chart.ts`: receiving
   * only a width prop sends height through as `undefined`). The erased
   * height became `NaN` in layout arithmetic and flowed all the way to the
   * scale's range.
   *
   * 1,283 tests didn't catch this — nobody asserted on the resulting range,
   * and `NaN` draws silently. The numeric door's `requireFinite` is what
   * caught it.
   */
  setViewport(viewport: Partial<ViewportDimensions>): void {
    // Check the shape first, in the same vocabulary as its sibling doors —
    // without this, `null` leaked an internal variable name through a raw
    // TypeError, and a string skipped both branches, **succeeding silently
    // while changing nothing** (you'd never know the resize didn't take).
    requireObject(viewport, "setViewport(viewport)");

    const next = { ...this.viewportSize };
    if (viewport.width !== undefined) {
      next.width = requireNonNegative(viewport.width, "viewport width");
    }
    if (viewport.height !== undefined) {
      next.height = requireNonNegative(viewport.height, "viewport height");
    }

    // The layers aren't touched here — reacquiring the backing store right
    // now would leave the picture gone until the next frame. render() is
    // what catches it up.
    this.viewportSize = next;
    this.scheduleRender();
  }

  /** Returns an unsubscribe function. Safe to call twice. */
  on<E extends keyof PlotEvents>(
    event: E,
    handler: (payload: PlotEvents[E]) => void,
  ): () => void {
    return this.events.on(event, handler);
  }

  // --- InteractionTarget ---

  /** The input stack. With no consumers, no input is captured at all — default gestures pass through unchanged. */
  private readonly inputRouter = new InputRouter();

  /** Last frame's slices — the basis axis drag uses to decide "is this over an axis." */
  private lastSlices: AxisSlices | null = null;

  /**
   * Wiring for axis-drag scaling. The behavior lives in
   * `axisDragConsumer` — this only lends out `Plot`'s internals through a
   * narrow door.
   *
   * **Priority is −100, so tools (default 0) always go first.**
   */
  private installAxisDrag(): void {
    this.inputRouter.add(
      axisDragConsumer({
        /**
         * **The option is checked fresh on every read.** Checking it only
         * once at install time would make
         * `applyOptions({ axisDrag })` a silently dead option — created off,
         * it could never be turned on, and vice versa. `PlotOptionsPatch`
         * carries this field, so that dead-option behavior broke its
         * promise.
         *
         * Not giving out slices is enough: `axisAt` is then always null, so
         * neither a grab nor a cursor claim ever happens.
         */
        slices: () =>
          this.config.axisDrag ? this.lastSlices : null,
        paneAt: (y) => this.paneStack.atY(y),
        zoomAroundCenter: (factor) => {
          const [min, max] = this.xScale.getDomain();
          this.zoom(factor, (min + max) / 2);
        },
        requestRender: () => this.scheduleRender(),
        claimCursor: (cursor) => this.claimCursor(cursor),
      }),
      { priority: -100 },
    );
  }

  /**
   * Mounts a consumer that gets first look at input — drawing tools and
   * axis drag go here.
   *
   * Same shape as `addDecoration`: returns an unsubscribe function, which
   * plugs straight into a plugin's teardown. Higher priority goes first;
   * ties go to whichever registered later — the convention that whatever's
   * drawn on top gets first grab.
   */
  addInputConsumer(
    consumer: InputConsumer,
    options: InputConsumerOptions = {},
  ): () => void {
    return this.inputRouter.add(consumer, options);
  }

  /** Who gets to say what shape the pointer is — built once the layers exist. */
  private readonly cursor: CursorClaims;
  /** Extensions contesting the keyboard. */
  private readonly focus = focusClaims();

  /**
   * Claims a cursor shape — this is where a tool's drag, drawing, or axis
   * hover goes. The later claim wins and release falls back to whatever's
   * underneath → `cursor-claims.ts`
   */
  claimCursor(cursor: string): () => void {
    return this.cursor.claim(cursor);
  }

  /**
   * Proposes normalized input to the stack. A handler calls this before
   * gesture translation — true means it was consumed, and it won't fall
   * through to pan/zoom/crosshair.
   *
   * When a host drives input directly (no handler), feeding it through this
   * door too keeps consumers behaving under the same rules.
   */
  routeInput(event: InputEvent): boolean {
    return this.inputRouter.route(event);
  }

  /**
   * Shifts the x domain by offset. y is untouched.
   *
   * offset is in **domain units** — data x under continuous, bar count
   * under bar-index. `panByPixels`, which starts from pixels, is correct
   * regardless of coordinate system for that reason.
   */
  pan(offset: number): void {
    // Its sibling `zoom` already has this door — without it, NaN would
    // sail straight through `clampPan`'s min/max and blow up in
    // `setDomain`, with the error naming **the scale** so you'd see a door
    // you never called (the "delayed amplifier" from `x-viewport.ts`).
    requireFinite(offset, "pan(offset)");

    this.xViewport.pan(offset);
    this.scheduleRender();
  }

  /** Zooms the x domain by factor while holding center fixed (factor > 1 zooms in). */
  zoom(factor: number, center: number): void {
    this.xViewport.zoom(factor, center);
    this.scheduleRender();
  }

  /**
   * Converts a drag distance into a domain shift.
   * Dragging right should reveal the earlier range, so the sign is flipped.
   */
  panByPixels(dx: number): void {
    requireFinite(dx, "panByPixels(dx)");

    this.xViewport.panByPixels(dx);
    this.scheduleRender();
  }

  /** Zooms while holding the point under the wheel cursor fixed. */
  zoomAtPixel(factor: number, screenX: number): void {
    this.xViewport.zoomAtPixel(factor, screenX);
    this.scheduleRender();
  }

  /**
   * Turns the point under the cursor from coordinates into meaning.
   *
   * The value comes from a different scale per pane, so which pane it's
   * over is found first. If it's over padding or a pane gap, there's
   * nothing to read.
   */
  crosshair(position: Point): void {
    this.events.emit("crosshair", this.pointPayload(position, "crosshair(position)"));
  }

  /**
   * The current screen as a PNG data URL.
   *
   * Pixels belong to the layers, so this delegates. **A frame is drawn now,
   * before the shot is taken** — with wiring where the scheduler defers a
   * frame (rAF), taking the shot with only a render scheduled would capture
   * the old picture. Throws if the layers don't offer the capability
   * (headless).
   *
   * With DOM label wiring, the shot is missing labels — a complete
   * screenshot requires `createCanvasAxisLabels` wiring.
   */
  takeScreenshot(): string {
    if (!this.layers.screenshot) {
      throw new RenderError(
        "this layer has no pixels to capture — a headless chart uses commands() instead",
      );
    }

    this.render();
    return this.layers.screenshot();
  }

  /** Click set — the same echo as crosshair, with the same payload shape. */
  click(position: Point): void {
    this.events.emit("click", this.pointPayload(position, "click(position)"));
  }

  doubleClick(position: Point): void {
    this.events.emit("dblclick", this.pointPayload(position, "doubleClick(position)"));
  }

  contextMenu(position: Point): void {
    this.events.emit("contextmenu", this.pointPayload(position, "contextMenu(position)"));
  }

  /**
   * All four pass through this one door — the **public path for composing
   * coordinates**, which doesn't go through the router. The
   * most common way in is a consumer trying to clear the crosshair on
   * `pointerleave` by passing `null`, which used to leak an internal field
   * name through `Cannot read properties of null (reading 'x')`. `label`
   * says which of the four doors this is.
   */
  private pointPayload(position: Point, door: string): CrosshairPayload {
    const point = requirePoint(position, door);
    const pane = this.paneStack.at(point);
    return {
      position: point,
      x: this.x.fromPixel(position.x),
      pane,
      value: pane ? pane.yScale.invert(position.y) : null,
    };
  }

  /**
   * `FocusAreaHost` — the door that separates *"the cursor went to
   * **someone contesting the keyboard**"* from *"it went to no one."*
   * Registering is itself the declaration *"I contest the keyboard too"*
   * → `focus-claims.ts`
   */
  claimFocusArea(areaOf: () => PlotArea | null): FocusClaim {
    return this.focus.claim(areaOf);
  }

  // --- state ---

  /**
   * A snapshot of the view state. **A value you can hold onto from outside**

   *
   * xDomain is **data x**, not the domain (mapping space) — indices never
   * leave. Serialize it, restore it in a different session, and
   * under bar-index coordinates the same spot comes back once the index is
   * recounted against that session's data.
   *
   * xDomain is null if it has never fitted to data — the scale's default
   * [0,1] isn't state the user created, so there's nothing worth persisting.
   */
  getState(): ChartState {
    return {
      xDomain: this.xViewport.visibleRange(),
      panes: this.paneStack.list.map(paneStateOf),
    };
  }

  /**
   * Called everywhere a piece of state changes — setXDomain, divider drag,
   * pane options, adding or removing a pane. Assembling the snapshot has a
   * cost too, so nothing is built when no one's listening.
   */
  private emitStateChange(): void {
    if (this.applyingState) {
      this.stateChangedWhileApplying = true;
      return;
    }
    if (!this.events.has("stateChange")) return;
    this.events.emit("stateChange", this.getState());
  }

  /** Coalesces notifications while changing several pieces at once → coalesceState */
  private applyingState = false;
  private stateChangedWhileApplying = false;

  /**
   * **Coalesces notifications into one** while changing several state
   * pieces at once.
   *
   * The goal is to keep whatever's mirroring state (URL persistence, React)
   * from seeing an intermediate state. There are two consumers: `applyState`
   * from outside, and divider drag, which rewrites flex per pane. The
   * latter runs on every pointermove, so firing once per pane would have the
   * listener redo that many times' worth of work per frame.
   */
  private coalesceState(run: () => void): void {
    if (this.applyingState) {
      run();
      return;
    }

    /**
     * **The notification is inside `finally` too.**
     *
     * The emit used to sit **outside** the try/finally, so if `run()` threw
     * partway through, the exception skipped that line. Both consumers are
     * partial-write loops — `applyState`'s `panes.forEach` and divider
     * drag's per-pane loop — so the panes already applied stay applied
     * while the mirror hears nothing at all. Not late, **never**: the next
     * `coalesceState` resets the flag to false.
     *
     * Measured: `applyState({panes:[{flex:7, autoScale:false,
     * valueDomain:{5,5}}]})` throws inside `setValueDomain`, but flex 7 and
     * autoScale false are already applied, and `stateChange` fired zero
     * times — the React mirror draws flex 1 forever.
     *
     * **Can't just call it plainly inside `finally`.** `emit` collects and
     * rethrows if a subscriber throws (`"${event}" subscriber threw`), and
     * an exception inside `finally` **replaces** the one already in flight
     * — instead of the `ContractError` the consumer's own code caused,
     * they'd get someone else's listener error. So both are collected and
     * handed to `throwable`: one alone comes through as-is, two become an
     * `AggregateError` (the same rule as `Plot.destroy` and `emit`).
     */
    const failures: unknown[] = [];

    this.applyingState = true;
    this.stateChangedWhileApplying = false;
    try {
      run();
    } catch (error) {
      failures.push(error);
    } finally {
      this.applyingState = false;
    }

    if (this.stateChangedWhileApplying) {
      try {
        this.emitStateChange();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) throw throwable(failures, "applying state failed");
  }

  /**
   * Applies a state piece from outside. **Only the piece given changes** —
   * partial application is exactly the material a partially controlled
   * shape needs, like "only zoom controlled from outside."
   *
   * Unlike TanStack, the source of truth for state isn't moved outside — on
   * a canvas where pan runs at 60fps, that round trip becomes a drag that
   * lags a frame behind. The core is mirror + feedback (getState /
   * stateChange / applyState), and a React wrapper assembles a controlled
   * shape from these three.
   *
   * `xDomain: null` is a "before fit" snapshot with nothing to apply — it's
   * ignored. Keyed pane slices match `PaneOptions.stateKey`; snapshots and
   * panes with no keys retain the legacy index pairing. A slice whose pane
   * does not currently exist is dropped — whoever creates panes (the
   * wrapper) reapplies it once the list changes.
   */
  applyState(state: Partial<ChartState>): void {
    /**
     * **This door validates its own input.**
     *
     * There is no string parser in front of it any more — state comes from
     * whatever the consumer built, so a null or a wrong shape has to be
     * caught here. It once was caught upstream instead, and a null slipping
     * through threw `TypeError: Cannot read properties of null (reading
     * 'xDomain')` from inside this method.
     */
    requireObject(state, "applyState(state)");

    /**
     * **The x piece passes through the same door as `setVisibleRange`.**
     *
     * `setVisibleRange` catches this at the door because *"before data
     * arrives, this value would just sit in `pending` and blow up inside
     * the first `setData`"* — **but this spot, landing in that same
     * `pending` through the same arithmetic, had no such door.** Measured:
     * `applyState({ xDomain: { min: 5, max: 5 } })` passed silently, and the
     * consumer's next `addSeries({ data })` died with `ContractError:
     * domain min(5) must be less than max(5)` — a door you never called.
     *
     * Shape is checked too. `applyState` is a public door taking a
     * hand-built object, so `{ min: 10 }` alone would have
     * `toDomain(undefined)` plant `setDomain(NaN, NaN)` — silently.
     */
    if (state.xDomain != null) {
      requireObject(state.xDomain, "applyState({ xDomain })");
      requireInterval(
        state.xDomain.min,
        state.xDomain.max,
        "applyState({ xDomain })",
      );
    }

    const paneChanges = state.panes === undefined
      ? []
      : matchPaneState(this.paneStack.list, state.panes);

    this.coalesceState(() => {
      // If there's no data yet, the window holds it as pending and consumes
      // it at the first fit.
      if (state.xDomain != null) this.xViewport.restore(state.xDomain);

      for (const { pane, slice } of paneChanges) applyPaneState(pane, slice);
    });

    this.scheduleRender();
  }

  // --- domain ---

  /**
   * The x range of the data the chart holds. **Asks the series.**
   *
   * Once data has been handed down to a registration, `Plot` doesn't know
   * data anymore. Different series can hold different ranges, so this is a
   * union, and null if all of them are empty — that null itself is the
   * answer "there's nothing to draw," so no separate empty-state guard is
   * needed.
   */
  private get dataRange(): Range | null {
    return this.paneStack.xRange();
  }

  /**
   * Refits the value axis to the visible range. **Runs every render, right
   * before drawing.**
   *
   * Skips a pane with `autoScale` off — that's what keeps a manually set
   * value range from being overwritten every frame. In other words, **while
   * it's on, the value domain isn't state — it's derived.**
   */
  private trackVisibleValues(viewport: Viewport): void {
    for (const pane of this.paneStack.list) {
      if (pane.autoScale) pane.fitValueDomain(viewport);
    }
  }

  /**
   * Settles this frame's geometry — axis slices, pane areas, scale ranges,
   * ticks.
   *
   * The computation is `frame.ts`'s job. All that's left here is **handing
   * over what the chart knows**: the area minus padding, the pane list,
   * axis config, and whether there's a labeler mounted and able to measure.
   */
  private layout(readStyle: StyleReader): Frame | null {
    const { measurer } = this;
    const frame = layoutFrame({
      area: this.area,
      panes: this.paneStack.list,
      gap: this.config.paneGap,
      axis: this.config.axis,
      xScale: this.xScale,
      x: this.x,
      labels: this.axisLabels !== null,
      // Measurement uses the font the DOM label actually draws with — the
      // variable contract lives in the same place. The measurer is bound
      // locally so the closure keeps the narrowed type — with `this.measurer!`
      // the narrowing above used to unravel inside the arrow function and get
      // papered over with an assertion — a type has to be true.
      measure: measurer && this.axisLabels
        ? {
            font: labelFont(readStyle),
            of: (text: string, font: string) => measurer.measure(text, font),
          }
        : null,
    });

    // A degenerate frame doesn't leave slices behind either — if axis drag
    // judged a zero-width axis as "over the axis," the result would be a
    // drag that can never be grabbed.
    //
    // **Clearing it is what makes that claim true.**
    // Just returning here would leave the previous frame's slices in
    // place, so that spot keeps being judged "over the y-axis" even after
    // the axis is gone — once grabbed once, `setValueDomain` turns that
    // pane's autoScale off permanently.
    if (frame === null) {
      this.lastSlices = null;
      return null;
    }

    // The basis axis drag uses to decide "is this over an axis" — last
    // frame's slices.
    this.lastSlices = frame.slices;
    return frame;
  }

  /**
   * Reports that a redraw is needed. When it actually draws is up to the
   * scheduler.
   *
   * Every state-changing method calls this. No matter how many times it's
   * called in the same frame, there's one render — this is what stops
   * several pointermoves during a pan, or a composite API mounting series
   * one at a time, from redrawing everything on each call.
   */
  private scheduleRender(): void {
    if (this.destroyed) return;
    this.scheduler.request();
  }

  /**
   * Draws now, without waiting for a scheduled slot.
   *
   * Does nothing once destroyed. It doesn't throw because an event handler
   * arriving late during unmount calling this is a normal path.
   */
  render(): void {
    if (this.destroyed) return;

    /**
     * **A draw request made while already drawing doesn't reopen this
     * frame.**
     *
     * `RenderRequester` is the proper door an extension uses to refresh the
     * screen (*"a decoration that holds its own state…"*), and calling it
     * from inside `draw` is the natural shape for an animated decoration.
     * But the default scheduler (`immediateScheduler` — the default for
     * both `createPlotDeps` and `createPlotModel`) makes `request` equal to
     * `render`, so that one line **calls itself again.** Measured: one
     * decoration calling `requestRender()` from `draw` produced
     * `RangeError: Maximum call stack size exceeded` on the first frame.
     *
     * The scheduler's contract already answers this — *"if a render is
     * already scheduled, nothing happens."* What's drawing right now is
     * itself the scheduled render, so reentrancy is coalesced away. Wiring
     * that spreads frames out (`frameScheduler`) has no reentrancy to begin
     * with, so it never reaches this door.
     */
    if (this.rendering) return;
    this.rendering = true;
    try {
      this.renderFrame();
    } finally {
      this.rendering = false;
    }
  }

  /** The reentrancy guard belongs to `render` — this is the body of one frame. */
  private rendering = false;

  private renderFrame(): void {
    // Drop anything scheduled — there's no reason to draw the same picture twice.
    this.scheduler.cancel();

    /**
     * The bitmap is caught up here. **Clearing and drawing must be the same
     * task.**
     *
     * If the size is unchanged, nothing happens (`ChartLayers.resize`'s
     * contract).
     */
    this.layers.resize(this.viewportSize.width, this.viewportSize.height);
    this.renderer.clear();

    // There's nothing at all to draw. This frame's job is to clear the axis labels.
    if (!this.dataRange) {
      /**
       * **Slices and handles are cleared along with it** — the same reason
       * the degenerate-frame branch does (see the comment on `layout()`).
       * Just returning here would leave the previous frame's axis strip in
       * `lastSlices`, so **axis drag can be grabbed on an empty screen.**
       * Measured: after `setData([])`, pressing where the y-axis used to be
       * makes `grabbed === true`, and a single pointermove calls
       * `setValueDomain`, turning that pane's `autoScale` off
       * **permanently** — the y-axis never follows again even once data
       * comes back. The divider handle stays in the DOM too, and can still
       * be dragged.
       */
      this.lastSlices = null;
      this.dividers?.clear();
      this.axisLabels?.clear();
      this.renderer.commit();
      this.events.emit("render", {});
      return;
    }

    // The domain is the mapping's own space, but slicing is done with x —
    // the index is a monotonic function of x, so converting a range back to
    // an x range leaves the manager's binary search intact.
    const [startDomain, endDomain] = this.xScale.getDomain();
    const { width, height } = this.viewport;
    const viewport: Viewport = {
      startX: this.x.fromDomain(startDomain),
      endX: this.x.fromDomain(endDomain),
      width,
      height,
    };
    /**
     * Only a mapping whose domain is its own space (bar-index) carries the
     * **scan-slot factory** for screen-position lookups. Under continuous,
     * x is already the screen position, so there's no reason to open a
     * scan.
     *
     * **The mapping's own function is passed through as-is** — this used to
     * build a `(x) => this.x.toDomain(x)`
     * closure and hand out one shared function, so every consumer stepped
     * on the same cursor inside it. Now whoever does the scanning opens the
     * slot and owns the cursor → `XMapping.scanToDomain`,
     * `Viewport.screenXScan`
     */
    /**
     * **Doesn't detach the receiver.** Pulling out just the property loses
     * `this`, and whoever opens the scan slot calls it as a bare function.
     * The built-in mappings are object literals plus closures, so they're
     * unaffected, but `createXMapping` is a public extension point — a
     * **mapping written as a class** legitimately arrives here, and its
     * prototype method would throw a `TypeError` on the first frame and
     * every frame after (the chart dies permanently).
     *
     * The mapping is bound locally and called through that — narrowing
     * carries into the closure with no assertion needed.
     */
    const mapping = this.x;
    const scan = mapping.scanToDomain;
    if (scan) {
      viewport.screenXScan = () => scan.call(mapping);
      viewport.xEpoch = this.xEpoch;
    }

    /**
     * The value axis is fit here. **Before layout** — the y domain decides
     * the tick labels, and those labels decide the y-axis width. The
     * viewport comes from the domain alone (the "visible range" that
     * auto-scaling fits to), so there's nothing to wait on layout for.
     */
    this.trackVisibleValues(viewport);

    /**
     * Computed style is captured once for this frame.
     *
     * `getComputedStyle` flushes pending style computation, so if the grid
     * and each series called it separately, it would repeat once per series
     * every frame.
     */
    const readStyle = this.deps.createStyleReader();

    const frame = this.layout(readStyle);

    /**
     * A size that can't be drawn — something like a collapsing sidebar's
     * width mid-transition. **Ends at the same
     * spot as when there's no `dataRange`**: clear, blank the labels, commit
     * the frame. See `isDegenerate` in `frame.ts` for why this doesn't
     * throw.
     */
    if (frame === null) {
      /**
       * The same cleanup as the empty-data branch, for the same measured
       * reason: leaving `lastSlices` keeps the previous frame's axis
       * strip grabbable (one pointermove turns `autoScale` off for
       * good), and the divider handle stays in the DOM and can still be
       * dragged over a frame that no longer exists.
       */
      this.lastSlices = null;
      this.dividers?.clear();
      this.axisLabels?.clear();
      this.renderer.commit();
      this.events.emit("render", {});
      return;
    }

    paintFrame(this.stage, this.config, frame, viewport, readStyle);

    this.renderer.commit();
    this.events.emit("render", {});
  }

  /**
   * Recomputes the upper and lower panes' shares when a divider is dragged
   * by dy.
   *
   * The distance is clamped against both sides' minHeight. The result is
   * frozen by writing the current pixel heights straight into flex — since
   * flex is relative, the ratio survives exactly, and if the window resizes,
   * the ratio the user set follows proportionally.
   *
   * Even untouched panes are all rewritten because converting just the two
   * to pixels would leave the rest out of unit sync with whatever flex they
   * were still holding.
   *
   * **Writes through the proper door (`applyOptions`).** This used to
   * assign `pane.flex` directly and fill in the state notification by hand
   * — because going through the subscriber recounts the x index — but now
   * that `PaneChange.data` names that branch, there's no reason left to
   * dodge it. The notification firing once per pane is coalesced into one
   * by `coalesceState`.
   */
  private resizeBetween(index: number, dy: number): void {
    const panes = this.paneStack.list;
    const upper = panes[index];
    const lower = panes[index + 1];
    if (!upper || !lower) return;

    const heights = panes.map(
      (pane) => pane.area.bottom - pane.area.top,
    );
    const upperHeight = heights[index];
    const lowerHeight = heights[index + 1];

    // Clamped between both sides' minHeight, and 0 when a squeezed pair can't
    // move in that direction → `clampDividerDrag`
    const delta = clampDividerDrag(
      dy,
      { height: upperHeight, minHeight: upper.minHeight },
      { height: lowerHeight, minHeight: lower.minHeight },
    );
    if (delta === 0) return;

    heights[index] = upperHeight + delta;
    heights[index + 1] = lowerHeight - delta;

    this.coalesceState(() => {
      panes.forEach((pane, slot) => {
        pane.applyOptions({ flex: heights[slot] });
      });
    });

    this.scheduleRender();
  }

  destroy(): void {
    /**
     * **Safe to call twice** — the same rule this repo requires of every
     * lifecycle primitive (`PluginApi.dispose`: *"must be safe to call more
     * than once"*). Without it, the cleanup steps below would hit resources
     * already released a second time — the panes, the plugins and
     * the scheduler below all qualify, and any
     * error there rides the `throwable` at the bottom out **through the
     * unmount path.** React StrictMode's double effect run is exactly that
     * route.
     */
    if (this.destroyed) return;

    /**
     * Two teardown mechanisms live here, split by one rule: the scope owns
     * resources whose whole ordering contract is "reverse of acquisition"
     * (the constructor's collaborators). Anything whose order or reporting
     * shape is a contract of its own — the scheduler first, notifications
     * cut before plugins, plugins before panes, pane detach returning its
     * failures — stays an explicit phase below.
     */

    // Keep an already-scheduled render from touching layers that have already been torn down.
    this.destroyed = true;
    this.scheduler.cancel();

    /**
     * **Notifications are cut off first.** If a plugin below removes a pane
     * it created, `stateChange` would fire — but that isn't a state change
     * the user made, it's the chart's last breath. It looks like a setState
     * landing on a React tree mid-unmount, and the consumer has no way to
     * trace where it came from.
     */
    this.events.clear();

    /**
     * **Goes all the way through even if one step throws.** There used to
     * be no guard, so if one plugin's dispose threw, the plugins after it,
     * the size observer, and `layers.destroy` never ran — a spot where the
     * canvas and the `ResizeObserver` leaked outright. Cleanup should be
     * "finish everything, then report."
     *
     * **External resources** a plugin created — timers, a
     * `ResizeObserver`, a worker — are cleaned up here too. The chart takes
     * responsibility for whatever's left when a consumer never called the
     * unsubscribe function.
     */
    const failures: unknown[] = [];
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (error) {
        failures.push(error);
      }
    };

    for (let i = this.plugins.length - 1; i >= 0; i--) {
      const api = this.plugins[i];
      attempt(() => api.dispose());
    }
    this.plugins.length = 0;

    /**
     * Extensions attached to a pane are held by the pane — once the chart
     * is gone, so are they.
     *
     * The stack walks a copy, because an extension's cleanup can call
     * `removePane` (MACD removing its own pane is exactly that shape) →
     * `PaneStack.detachAll`
     */
    failures.push(...this.paneStack.detachAll());

    /**
     * Everything the constructor acquired comes back out through the scope
     * — observers, input, dividers, labels, the canvas erase, layers, in
     * reverse acquisition order. The acquiring line registered its own
     * release, so nothing here can fall out of step with the constructor.
     * Its failures fold flat into the same report as everything above.
     */
    try {
      this.scope.dispose();
    } catch (error) {
      if (error instanceof AggregateError) failures.push(...error.errors);
      else failures.push(error);
    }

    // Every resource has been released. What failed, if anything, is reported after.
    if (failures.length > 0) throw throwable(failures, "cleaning up Plot failed");
  }
}
