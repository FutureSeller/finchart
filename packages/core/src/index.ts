/**
 * @finchart/core public API — **only what's listed here is public**
 *
 * A module's index is an internal convenience layer; this file
 * explicitly re-lists what's public. Under `export *`, one internal
 * helper landing in a module index made it public automatically — now
 * both adding and removing something here is a deliberate diff on this
 * file. `scripts/public-barrel-check.mjs` holds every published barrel
 * to that rule (explicit enumeration is itself the lock — no separate
 * name snapshot).
 *
 * Module dependencies point one way (a DAG, not a chain):
 *   primitives ← data · scale · render · interaction   (unaware of each other)
 *   scale · render ← axis
 *   data · scale · render ← series                     (interaction is unaware of this)
 *   everything else ← plot
 * The exact allowlist is enforced by `__tests__/module-boundaries.test.ts`.
 *
 * What's kept public is decided by consumer evidence and assembly
 * vocabulary; what's hidden is "the default implementation
 * behind a contract".
 *
 * **`Pane` isn't a class — it's a narrowed face** (`PaneApi`). The spots
 * the stage uses every frame (`setArea`, `draw`, `collectAxisBadges`,
 * `xValuesPerSeries`) never leave this module — calling them would let
 * the next frame overwrite state, or leak a command outside a commit.
 * There's no need to construct a pane directly either, so no constructor
 * is exported: use what `plot.mainPane` or `addPane()` gives you.
 *
 * **`Entry` and `TypedEntry` are deliberately absent.** That's where the
 * point-type seal would leak: `Entry.feed` is a cast hole whose own
 * comment says "for `syncSeries` only," and `swapSeries` stands on an
 * unwritable contract — "the same id means the same point type." Calling
 * either from outside just breaks the seal. As long as a consumer builds
 * a `SeriesSpec` through `seriesSpec()` instead of by hand, there's never
 * a need for that name — the React wrapper itself only ever goes through
 * that path.
 */

// ---- style variable names ----
export type { StyleVarName } from "./style-var-names";

// ---- primitives: geometry and errors ----
export { ContractError, DataError, RenderError, createScope } from "./primitives";
export type { Disposer, Padding, Point, PlotArea, Scope } from "./primitives";

// ---- data: points, accessors, decimation, computed nodes ----
export {
  computation,
  defaultCoordinates,
  isGap,
  validateSeriesData,
  LineDataAccessor,
  LttbDecimation,
  M4Decimation,
  mergePolicy,
  OHLCAccessor,
  SimpleDecimation,
  tailDelta,
} from "./data";
export type {
  BaseDataPoint,
  Computation,
  ComputationSpec,
  CoordinateAccessor,
  DataManager,
  DataManagerFactory,
  DataView,
  DataPoint,
  DecimationFactory,
  DecimationPolicy,
  DecimationStrategy,
  IndexRange,
  LineDataPoint,
  OHLC,
  Range,
  SeriesDataIssue,
  SeriesDataIssueCode,
  Source,
  TailChange,
  Viewport,
} from "./data";

// ---- scale: value-axis arithmetic and the x coordinate system ----
export { barIndexX, continuousX, LinearScale, LogScale } from "./scale";
export type {
  ExpandHints,
  Scale,
  TickGeometry,
  XMapping,
  XMappingFactory,
  XMappingProbe,
} from "./scale";

// ---- render: the drawing surface contract and wiring factories ----
export {
  ColorVerdicts,
  createCanvasRenderer,
  createCanvasTextMeasurer,
  createMemoryLayers,
  cssVarExpr,
  drawCustom,
  eachFallback,
  applyColor,
  applyFont,
  FALLBACK_FONT,
  FontVerdicts,
  fillLinearGradient,
  isLinearGradientParams,
  LINEAR_GRADIENT,
  noStyle,
  paintLinearGradient,
  recordingRenderer,
  resolveStyle,
  styleSpec,
  styleVars,
} from "./render";
export type {
  Canvas2DContext,
  CanvasBrush,
  CanvasColorChannels,
  CanvasGradientLike,
  CanvasPatternLike,
  CanvasRendererOptions,
  StyleVarNamesOf,
  ChartLayers,
  StyleReader,
  StyleReaderFactory,
  CustomDraw,
  CustomPainter,
  DrawCommand,
  DrawSurface,
  DrawTarget,
  FallbackCommand,
  GradientStop,
  LayersFactory,
  LinearGradientParams,
  LineStyle,
  RecordingRenderer,
  Renderer,
  RendererFactory,
  ResolutionObserver,
  ShapeParams,
  SizeObserver,
  StyleOf,
  StyleOverridesOf,
  StyleSpec,
  StyleVar,
  TextMeasurer,
  TextMeasurerFactory,
  TextMetricsLike,
  TextParams,
  TextSize,
  TextStyle,
} from "./render";

// ---- axis: tick strategy and the label surface ----
// Label placement constants and token specs are assembly vocabulary for a label implementation (@finchart/dom, or a custom one).
export {
  AXIS_LABEL_OFFSET,
  AXIS_LABEL_SPEC,
  BADGE_PADDING,
  createCanvasAxisLabels,
  labelFont,
  labelFontFamily,
  priceFormat,
  timeTicks,
} from "./axis";
export type {
  AxisBadge,
  AxisLabelRenderer,
  AxisLabelsFactory,
  AxisLabelsHost,
  AxisLabelsInput,
  PriceFormatOptions,
  Tick,
  TickStrategy,
  TickStrategyContext,
  TimeTicksOptions,
} from "./axis";

// ---- interaction: the input stack ----
// The core exports only the stack (InputRouter) and the pure data
// contract (InputEvent) — the default interaction that translates
// pointer events into InputEvent (pointerInteractions) belongs to the
// shell that attaches to an element, so it lives in @finchart/dom.
export { InputRouter } from "./interaction";
export type {
  InputConsumer,
  InputConsumerOptions,
  InputEvent,
  InteractionHandler,
  InteractionTarget,
} from "./interaction";

// ---- series: six ways to draw, plus authoring tools ----
export {
  AreaSeries,
  areaSeries,
  BarSeries,
  barSeries,
  BaselineSeries,
  baselineSeries,
  CandleSeries,
  candleSeries,
  DEFAULT_AREA_STYLE,
  DEFAULT_BAR_STYLE,
  DEFAULT_BASELINE_STYLE,
  DEFAULT_CANDLE_STYLE,
  DEFAULT_HISTOGRAM_STYLE,
  DEFAULT_LINE_STYLE,
  HistogramSeries,
  histogramSeries,
  LineSeries,
  lineSeries,
  StepLineSeries,
  stepLineSeries,
  slotWidth,
} from "./series";
export type {
  AreaSeriesOptions,
  AreaSeriesStyle,
  AreaSeriesStyleOverrides,
  BarSeriesStyle,
  BarSeriesStyleOverrides,
  BaselineSeriesOptions,
  BaselineSeriesStyle,
  BaselineSeriesStyleOverrides,
  CandleDrawOptions,
  CandleSeriesStyle,
  CandleSeriesStyleOverrides,
  HistogramPoint,
  HistogramSeriesOptions,
  HistogramSeriesStyle,
  HistogramSeriesStyleOverrides,
  LineSeriesOptions,
  LineSeriesStyle,
  LineSeriesStyleOverrides,
  PointStyle,
  Series,
  SeriesContext,
} from "./series";

// ---- extensions: built-in extensions on top of the stage ----
export {
  crosshair,
  crosshairLine,
  infiniteHistory,
  markers,
  conflated,
  paneMaximize,
  priceLine,
  span,
  syncCrosshair,
  syncX,
  timeCursor,
  watermark,
} from "./extensions";
export type {
  ConflatableHandle,
  ConflatedFeed,
  ConflatedOptions,
  CrosshairLine,
  CrosshairLineOptions,
  HistoryFetch,
  HistoryLoader,
  HistorySink,
  HistoryStatus,
  InfiniteHistoryHost,
  InfiniteHistoryOptions,
  Marker,
  PaneMaximizeApi,
  PaneMaximizeOptions,
  PriceLineOptions,
  SpanOptions,
  TimeCursor,
  WatermarkOptions,
} from "./extensions";

// ---- plot: the stage ----
export {
  ABOVE_SERIES,
  BELOW_SERIES,
  createPlotDeps,
  createPlotModel,
  DEFAULT_PADDING,
  DEFAULT_PLOT_STYLE,
  PANE_OPTION_DEFAULTS,
  Plot,
  SERIES_Z,
} from "./plot";
export { seriesSpec } from "./registration";
export { emitter, pluginApi, teardown } from "./primitives";
export { frameScheduler, immediateScheduler, manualScheduler } from "./render";
export type {
  AxisOptions,
  ChartState,
  CrosshairPayload,
  DataProbe,
  CursorHost,
  Decoration,
  DecorationHost,
  DecorationOptions,
  DividerBoundary,
  DividerFactory,
  DividerRenderer,
  FocusAreaHost,
  FormatSource,
  InputHost,
  OverlayHost,
  PaneApi as Pane,
  PaneChange,
  PaneDecoration,
  PaneDecorationHost,
  PaneDecorationContext,
  PaneDrawContext,
  PaneHost,
  PaneOptions,
  PaneState,
  PlotConfig,
  PlotDecoration,
  PlotDecorationContext,
  PlotDeps,
  PlotDepsOptions,
  PlotEventSource,
  PlotEvents,
  PlotModel,
  PlotModelDepsOptions,
  PlotModelOptions,
  PlotOptions,
  PlotOptionsPatch,
  PlotStyle,
  PluginHost,
  RenderRequester,
  ResolvedPlotConfig,
  ResolvedXAxisOptions,
  ResolvedYAxisOptions,
  SeriesHandle,
  SeriesHost,
  SeriesSample,
  ValueCoordinates,
  ValueFormatSource,
  ViewportControl,
  ViewportDimensions,
  XAxisOptions,
  XCoordinates,
  XDomainChangePayload,
  YAxisOptions,
} from "./plot";
export type {
  ConfigurablePluginApi,
  Emitter,
  Observable,
  Plugin,
  PluginApi,
} from "./primitives";
export type { ManualScheduler, RenderScheduler, SchedulerFactory } from "./render";
export type { FocusClaim } from "./interaction";
export type { SeriesId, SeriesRegistration, SeriesSpec } from "./registration";
