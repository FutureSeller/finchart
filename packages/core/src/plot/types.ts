import type { Padding } from "../primitives";
import type { AxisLabelsFactory } from "../axis";
import type { DataManagerFactory } from "../data";
import type { InteractionHandler } from "../interaction";
import type {
  StyleReaderFactory,
  LayersFactory,
  LineStyle,
  RendererFactory,
  ResolutionObserver,
  SizeObserver,
  TextMeasurerFactory,
} from "../render";
import type { DividerFactory } from "./dividers";
import type { SchedulerFactory } from "../render";
import type { Scale, XMappingFactory } from "../scale";
import type { TickStrategy } from "../axis";

/**
 * **How ticks are picked and shown.** Can be overridden per pane.
 *
 * Placement (`size`, `position`) isn't here because there's only one axis
 * slice per chart, so there's no room to give different panes different
 * widths or sides.
 */
export interface AxisOptions {
  /** Whether tick labels are shown on the overlay. Default `true`. */
  showLabels?: boolean;
  /**
   * Tick value to display string. If a `ticks` strategy is present, this
   * isn't used for ticks themselves, but it's still used, regardless of
   * the strategy, as the default formatting for decorations (crosshair
   * badge, tooltip, legend, priceLine). The second argument is the tick
   * spacing, used to pick how many digits distinguish neighboring ticks.
   */
  format?: (value: number, step?: number) => string;
  /** Minimum pixels one tick occupies. Falls back to a per-direction default if omitted. */
  minTickSpacing?: number;
  /**
   * Placement and labeling of ticks, as one unit — where `timeTicks` (the
   * time axis) goes. **Read for both x and y, and per pane too.** If a
   * strategy is present, the default arithmetic and `format` aren't used.
   */
  ticks?: TickStrategy;
}

/** What the x-axis (bottom) has in addition. */
export interface XAxisOptions extends AxisOptions {
  /**
   * Fixed height (px) of the axis space. Skips measurement if given.
   * A label bigger than this gets clipped — that's what "fixed" means.
   */
  size?: number;
}

/** What the y-axis (value axis) has in addition. **Both fields are chart-wide.** */
export interface YAxisOptions extends AxisOptions {
  /** Fixed width (px) of the axis space. Skips measurement if given. */
  size?: number;
  /**
   * Which side the y-axis is on. Left by default. **Chart-wide** — there's
   * only one slice, so different panes can't have different sides.
   */
  position?: "left" | "right";
}

export interface PlotConfig {
  /** Outer margin. `DEFAULT_PADDING` if omitted. */
  padding?: Padding;
  /** Whether grid lines are drawn. On if omitted. */
  showGrid?: boolean;
  /** Gap between panes (px). Defaults to 0 if omitted. */
  paneGap?: number;
  /**
   * When a new bar arrives, **if the last bar was in view**, shift the
   * window right by that much. Doesn't shift while looking at history —
   * the window mustn't get dragged along mid-scroll. **Off by default**:
   * silently moving the window is the worse mistake.
   */
  shiftVisibleRangeOnNewBar?: boolean;
  /** Whether dragging a divider can resize pane heights. Enabled if omitted. */
  resizablePanes?: boolean;
  /**
   * Whether dragging on an axis slice can adjust the scale. Enabled if
   * omitted. Vertical drag on the y-axis = that pane's value axis
   * (`autoScale` turns off); horizontal drag on the x-axis = zooming x.
   * A tool (an input consumer) always gets first claim.
   */
  axisDrag?: boolean;
  /**
   * Empty space after the last bar, in domain units (bar count, for a
   * bar-index coordinate system). Only applies to fitting (`fitDomains`,
   * first data) — pan/zoom belong to the user.
   */
  rightOffset?: number;
  /**
   * Lower and upper bound, in pixels, for how much space one bar occupies
   * — the limits of zoom. A zoom that would push one domain unit outside
   * this pixel range is clamped on the spot.
   *
   * Defaults to the coordinate system's own default if omitted — the
   * bar-index coordinate system (`barIndexX`) uses min 0.5 / max 200, and
   * a continuous coordinate system has no limit. **`0` turns off the limit
   * in that direction** — a value that says "none" on top of the default.
   */
  minBarSpacing?: number;
  maxBarSpacing?: number;
  /**
   * x is shared by every pane; y is per pane.
   * The `y` here is the default, and an individual pane overrides it via
   * `PaneOptions.axis` — but **placement (`size`, `position`) is decided
   * only here** (see `YAxisOptions`).
   */
  axis?: { x?: XAxisOptions; y?: YAxisOptions };
  /** Overrides the CSS variable / default only for the fields given here. */
  style?: { grid?: Partial<LineStyle> };
}

/**
 * The config after the door's resolution — every field with a static
 * default is present, so a read site takes the value as-is instead of
 * re-deciding a default locally. (The local version got copied — the same
 * `?? 0` in three files — and drifted; one table at the door makes a
 * second copy of a default impossible to express.)
 *
 * Consumers write the loose `PlotConfig`; the constructor / `applyOptions`
 * doors are the only producers of this shape, and `getOptions` hands it
 * back — what you get from a chart is always fully resolved.
 *
 * `minBarSpacing`/`maxBarSpacing` stay optional — their default belongs to
 * the coordinate system (`XMapping.barSpacingDefaults`), `0` carries the
 * meaning "no limit in that direction", and the single read site
 * (`x-viewport.ts`) is where that computed default applies.
 */
export interface ResolvedPlotConfig extends PlotConfig {
  padding: Padding;
  showGrid: boolean;
  paneGap: number;
  shiftVisibleRangeOnNewBar: boolean;
  resizablePanes: boolean;
  axisDrag: boolean;
  rightOffset: number;
  axis: { x: ResolvedXAxisOptions; y: ResolvedYAxisOptions };
  style: { grid?: Partial<LineStyle> };
}

/**
 * `format`, `ticks`, and `size` stay optional in the resolved shape —
 * there their absence is a behavior (default arithmetic, measuring),
 * not a default value.
 */
export interface ResolvedXAxisOptions extends XAxisOptions {
  showLabels: boolean;
  minTickSpacing: number;
}

export interface ResolvedYAxisOptions extends YAxisOptions {
  showLabels: boolean;
  minTickSpacing: number;
  position: "left" | "right";
}

/**
 * What's passed to `applyOptions`. **Anything omitted is left alone.** The
 * unit of replacement for a given field differs per field, and is
 * documented below — if everything merged by field, there'd be no way to
 * reset a style back to its default; if everything replaced wholesale,
 * changing one margin would require writing out all four sides.
 */
export interface PlotOptionsPatch {
  /** **Field merge.** You don't have to write out all four sides. Only the given sides change. */
  padding?: Partial<Padding>;
  showGrid?: boolean;
  paneGap?: number;
  resizablePanes?: boolean;
  shiftVisibleRangeOnNewBar?: boolean;
  axisDrag?: boolean;
  rightOffset?: number;
  minBarSpacing?: number;
  maxBarSpacing?: number;
  /** **Field merge, per axis.** Giving only `x` leaves `y` untouched. */
  axis?: { x?: XAxisOptions; y?: YAxisOptions };
  /**
   * **Wholesale replacement.** What you give becomes this chart's entire style.
   *
   * The reason this one doesn't merge is that **it has to be resettable**
   * — `style: { grid: {} }` means "back to default", and a merge could
   * never say that. This is the path back when React's `gridStyle` prop
   * disappears.
   */
  style?: { grid?: Partial<LineStyle> };
}

/**
 * The collaborators Plot assembles. Series isn't here — it's swappable, so
 * it comes in separately through registration. There's no data
 * collaborator either — each registration builds its own manager, leaving
 * only **how to build one**. That's why there's no point-type parameter
 * here — `Plot<T>` figures out what it's drawing from the registration.
 */
export interface PlotDeps {
  /**
   * **A factory, not an instance** — like every other collaborator here.
   * One deps object serves every chart on a page (and React StrictMode
   * mounts twice from one), so a scale instance placed here would be
   * shared: panning one chart would move the other. Each Plot calls this
   * once and owns what it gets.
   */
  xScale: () => Scale;
  /**
   * Where data's x lands on screen. **Continuous if omitted** — the domain
   * is data x itself, and an empty span takes up empty screen space too.
   * If a financial chart wants a bar-index coordinate system (weekends
   * and closed sessions don't open up gaps), pass `barIndexX`.
   */
  createXMapping?: XMappingFactory;
  /**
   * **`mainPane`'s value axis.** Not the default for every pane — a pane
   * created later either gets its own via `addPane({ yScale })` or falls
   * back to linear. A factory for the same reason `xScale` is one.
   */
  mainPaneYScale: () => Scale;
  /**
   * Used when a registration builds its own manager. Policy (strategy,
   * density) is decided by whoever knows the point type — registration >
   * `Series` > the default built here.
   */
  createDataManager: DataManagerFactory;
  /**
   * The surface to draw on. **The only required collaborator here** — no
   * surface, no chart.
   */
  createLayers: LayersFactory;
  /**
   * Puts up tick labels. **No labels shown if omitted.** No null object is
   * used here — the way to turn it off is to not supply it, so that code
   * doesn't even make it into the bundle. This is the slot for a chart
   * with no axis at all, like a sparkline.
   */
  createAxisLabels?: AxisLabelsFactory;
  /** Handles between panes. **None placed if omitted** — height is decided by `flex` alone. */
  createDividers?: DividerFactory;
  /**
   * Accepts mouse/touch. **No input is accepted if omitted.** Even without
   * it, the `pan`/`zoom` API still works, so the host can drive it
   * directly.
   */
  interactions?: InteractionHandler;
  /** Takes commands and puts them on the surface. **Required** — there's no such thing as a chart that doesn't draw. */
  createRenderer: RendererFactory;
  /**
   * How a style key resolves to a concrete value. **Required.** A chart
   * without CSS just needs a `(name) => string`, whether backed by a JS
   * theme object or by constants.
   */
  createStyleReader: StyleReaderFactory;
  /**
   * How to measure text before drawing it. **Not measured if omitted** —
   * layout that needs measurement (like a y-axis width that tracks its
   * longest label) falls back to a fixed default. Swap the renderer and
   * swap this alongside it.
   */
  createTextMeasurer?: TextMeasurerFactory;
  /**
   * When to run a render. Immediate if omitted. `immediateScheduler` is a
   * few lines that know nothing about the DOM, so it isn't a burden for
   * whoever doesn't need it either.
   */
  createScheduler?: SchedulerFactory;
  /**
   * Tracks the container's size. **Doesn't track it if omitted.**
   * `createPlotDeps({ autoSize: true })` is the default wiring.
   */
  observeSize?: SizeObserver;
  /**
   * Redraws when the resolution ratio changes. **Doesn't track it if
   * omitted.** This is split from `observeSize` because when only the
   * ratio changes, the CSS pixel size stays the same, so `observeSize`
   * alone has no way to signal that event.
   */
  observeResolution?: ResolutionObserver;
}
