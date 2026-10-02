/**
 * The value-axis exemption table — split between `boundary-values.test.ts`
 * and `state-residue.test.ts`, which both read it. **Why this isn't a test
 * file**: importing a test file would run that whole suite twice.
 */
/**
 * An exemption's reason is a tag, not free-form prose. Writing it as free
 * prose lets a sentence like "the result shows up immediately" slip past
 * the check net even when the thing actually throws. A tag is a kind of
 * promise, so a machine can attach the right probe per kind — `safe` is
 * caught in full by the `SAFE_ARG` probe, and `no-amplifier`'s state-
 * residue probe is stage 1b.
 */
export type Exemption =
  /** Takes no argument, or is a value — there is no door at all. */
  | { tag: "constant"; note: string }
  /** An error class in the contract vocabulary — the side a consumer catches. */
  | { tag: "error-type"; note: string }
  /** A bad value leaves no state behind and does not change the screen. Probe wiring is stage 1b. */
  | { tag: "no-amplifier"; note: string }
  /** A promise not to crash — checked in full by the `SAFE_ARG` probe. */
  | { tag: "safe"; note: string }
  /** Guarded by a different door — note names which one. */
  | { tag: "delegated"; note: string }
  /** The value comes from assembly/authoring code, not consumer data. */
  | { tag: "assembly"; note: string };

/** An exemption. A reason is mandatory — even "there is consistently none" counts as a reason, and writing it down is what lets a review tell inertia apart from an actual reason. */
export const EXEMPT: Record<string, Exemption> = {
  // Not a value but a shape/name — takes no number, or if it does, uses it only for drawing that same frame.
  ABOVE_SERIES: { tag: "constant", note: "a constant" },
  AXIS_LABEL_OFFSET: { tag: "constant", note: "a constant" },
  AXIS_LABEL_SPEC: { tag: "constant", note: "a constant" },
  BADGE_PADDING: { tag: "constant", note: "a constant" },
  BELOW_SERIES: { tag: "constant", note: "a constant" },
  DEFAULT_AREA_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_BAR_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_BASELINE_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_CANDLE_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_HISTOGRAM_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_LINE_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_PADDING: { tag: "constant", note: "a constant" },
  DEFAULT_PLOT_STYLE: { tag: "constant", note: "a constant" },
  LINEAR_GRADIENT: { tag: "constant", note: "a constant" },
  SERIES_Z: { tag: "constant", note: "a constant" },

  PANE_OPTION_DEFAULTS: { tag: "constant", note: "a constant — one set of pane defaults" },
  ContractError: { tag: "error-type", note: "an error type" },
  DataError: { tag: "error-type", note: "an error type" },
  RenderError: { tag: "error-type", note: "an error type" },

  // Series authoring — style and how to draw. The numbers are style, so a
  // bad value only shows up in that frame's drawing and leaves no state
  // behind.
  AreaSeries: { tag: "no-amplifier", note: "series — no amplifier (style leaves no state behind)" },
  BarSeries: { tag: "no-amplifier", note: "series — no amplifier (style leaves no state behind)" },
  BaselineSeries: { tag: "no-amplifier", note: "series — no amplifier (style leaves no state behind)" },
  CandleSeries: { tag: "no-amplifier", note: "series — no amplifier (style leaves no state behind)" },
  HistogramSeries: { tag: "no-amplifier", note: "series — no amplifier (style leaves no state behind)" },
  LineSeries: { tag: "no-amplifier", note: "series — no amplifier (style leaves no state behind)" },
  StepLineSeries: { tag: "no-amplifier", note: "series — same as LineSeries (only the draw path differs)" },
  lineSeries: { tag: "no-amplifier", note: "series factory — no amplifier (style leaves no state behind)" },
  stepLineSeries: { tag: "no-amplifier", note: "series factory — the same door as lineSeries (same requireObject)" },
  areaSeries: { tag: "no-amplifier", note: "series factory — no amplifier (style leaves no state behind)" },
  barSeries: { tag: "no-amplifier", note: "series factory — no amplifier (style leaves no state behind)" },
  baselineSeries: { tag: "no-amplifier", note: "series factory — no amplifier (style leaves no state behind)" },
  candleSeries: { tag: "no-amplifier", note: "series factory — no amplifier (style leaves no state behind)" },
  histogramSeries: { tag: "no-amplifier", note: "series factory — no amplifier (style leaves no state behind)" },
  /**
   * Two readback guards — `color` and `font` are exactly where a consumer
   * value arrives, and accepting and demoting both is this function's job.
   * Whatever comes in, it demotes without throwing. This runs once per
   * command every frame, so there is no room for a `requireObject`, and
   * adding one would gain nothing — if the context is wrong, nothing shows
   * up on the first frame anyway.
   */
  applyColor: { tag: "safe", note: "a readback guard — accepting any color string and demoting it is its job" },
  applyFont: { tag: "safe", note: "a readback guard — accepting any font value and demoting it is its job" },
  /**
   * Two judgment containers — take no argument and build fresh. `get`/`set`
   * are two lines over a `Map`, so no key throws, and if the value is off,
   * only next frame's color/font gets demoted (the side that hands out the
   * container is also the side that reads it).
   */
  ColorVerdicts: { tag: "constant", note: "assembly — takes no arguments" },
  FontVerdicts: { tag: "constant", note: "assembly — takes no arguments" },
  FALLBACK_FONT: { tag: "constant", note: "a constant" },
  priceFormat: { tag: "delegated", note: "chokepoint — precision and minMove pass through the numeric door" },
  slotWidth: { tag: "safe", note: "pure arithmetic — the result shows up immediately" },

  // The data contract. Finiteness is checked by `SimpleDataManager` at the
  // data door (chokepoint 6) — these names are the handle that opens that
  // door, not the door itself.
  LttbDecimation: { tag: "delegated", note: "decimation — finiteness is checked by the data door (chokepoint 6)" },
  M4Decimation: { tag: "delegated", note: "decimation — finiteness is checked by the data door (chokepoint 6)" },
  SimpleDecimation: { tag: "delegated", note: "decimation — finiteness is checked by the data door (chokepoint 6)" },
  LineDataAccessor: { tag: "delegated", note: "accessor — finiteness is checked by the data door (chokepoint 6)" },
  OHLCAccessor: { tag: "delegated", note: "accessor — finiteness is checked by the data door (chokepoint 6)" },
  defaultCoordinates: { tag: "delegated", note: "accessor — finiteness is checked by the data door (chokepoint 6)" },
  isGap: { tag: "safe", note: "a predicate — returns a boolean no matter what comes in. There is no place for it to throw" },
  tailDelta: { tag: "safe", note: "a check — only pointer-compares two arrays. It never reads a number, and when it cannot tell, null is the answer itself (the full path)" },
  reuseUnchanged: { tag: "safe", note: "an identity pass — compares points as plain data and never reads a number as a number; anything it cannot judge is handed on as is, for the data door to name" },
  // "Takes no numbers" was only half true — the number it carries
  // (pointsPerPixel) passes through with no check. That number is checked
  // by the wiring's door (presets's requirePositive).
  mergePolicy: { tag: "delegated", note: "policy merging — the numbers it carries are accepted by the wiring's door (presets)" },
  computation: { tag: "delegated", note: "a computation node — its output is series data, so it passes through the data door again" },

  // Coordinate system and wiring. Wraps a scale, but the domain is guarded by chokepoint 1.
  barIndexX: { tag: "delegated", note: "x mapping — the domain is guarded by chokepoint 1" },
  continuousX: { tag: "delegated", note: "x mapping — the domain is guarded by chokepoint 1" },

  // Assembly — wires collaborators together. Takes an object, not a number.
  createPlotModel: { tag: "delegated", note: "assembly — the size goes to Plot (chokepoints 2 and 3)" },
  createCanvasRenderer: { tag: "assembly", note: "assembly — takes a collaborator" },
  createCanvasTextMeasurer: { tag: "assembly", note: "assembly — takes a collaborator" },
  createCanvasAxisLabels: { tag: "assembly", note: "assembly — takes a collaborator" },
  createMemoryLayers: { tag: "assembly", note: "assembly — takes a collaborator" },
  recordingRenderer: { tag: "assembly", note: "assembly — takes a collaborator" },
  emitter: { tag: "assembly", note: "assembly — takes a collaborator" },
  pluginApi: { tag: "assembly", note: "assembly — takes a collaborator" },
  teardown: { tag: "assembly", note: "assembly — takes a collaborator" },
  seriesSpec: { tag: "delegated", note: "declaration — the value passes through the data door at registration" },

  // Scheduler — time, not coordinates. A bad value shows up on the first
  // frame.
  // Not "no amplifier" — there is simply no door to measure. Keep the tag honest.
  conflated: { tag: "assembly", note: "takes a handle and callbacks — no numeric slot; the points flowing through push() are accepted by updateLast's own gate" },
  createScope: { tag: "constant", note: "takes no argument — the door is add(), which takes only a callback (no numeric slot)" },
  validateSeriesData: { tag: "safe", note: "the validator itself — reporting bad values as issues is its output, never a throw" },
  validateSeriesPoint: { tag: "safe", note: "the tick validator — the same per-point rules as updateLast, reported as issues, never a throw" },
  frameScheduler: { tag: "assembly", note: "assembly vocabulary — has no numeric slot (only a callback). The old reason (no amplifier) was empty, since there was no door to measure" },
  // Not "no amplifier" — there is simply no door to measure. Keep the tag honest.
  immediateScheduler: { tag: "assembly", note: "assembly vocabulary — has no numeric slot (only a callback). The old reason (no amplifier) was empty, since there was no door to measure" },
  // Not "no amplifier" — there is simply no door to measure. Keep the tag honest.
  manualScheduler: { tag: "assembly", note: "assembly vocabulary — has no numeric slot (only a callback). The old reason (no amplifier) was empty, since there was no door to measure" },

  // Input stack — coordinates are pixels and leave no state behind.
  InputRouter: { tag: "no-amplifier", note: "input router — coordinates leave no state behind" },

  // Style and drawing — shows up only in that frame's drawing.
  // Not "no amplifier" — there is simply no door to measure. Keep the tag honest.
  cssVarExpr: { tag: "assembly", note: "style utility — has no numeric slot, its leaves are all strings" },
  styleSpec: { tag: "assembly", note: "assembly vocabulary — the identity at runtime, and it reads no field of what it is handed. Has no numeric slot" },
  styleVars: { tag: "no-amplifier", note: "style — no amplifier" },
  resolveStyle: { tag: "no-amplifier", note: "style — no amplifier" },
  // Not "no amplifier" — there is simply no door to measure. Keep the tag honest.
  noStyle: { tag: "constant", note: "a value — a single reader. Has no numeric slot" },
  drawCustom: { tag: "no-amplifier", note: "drawing — no amplifier" },
  eachFallback: { tag: "no-amplifier", note: "drawing — no amplifier" },
  fillLinearGradient: { tag: "no-amplifier", note: "drawing — no amplifier" },
  paintLinearGradient: { tag: "no-amplifier", note: "drawing — no amplifier" },
  isLinearGradientParams: { tag: "no-amplifier", note: "a predicate — no amplifier" },

  // Extension — sits on top of the stage. The numbers are style/offset and leave no state behind.
  crosshair: { tag: "no-amplifier", note: "extension — no amplifier" },
  crosshairLine: { tag: "no-amplifier", note: "extension — no amplifier" },
  markers: { tag: "no-amplifier", note: "extension — no amplifier" },
  priceLine: { tag: "no-amplifier", note: "extension — no amplifier" },
  span: { tag: "no-amplifier", note: "extension — no amplifier" },
  syncCrosshair: { tag: "no-amplifier", note: "extension — no amplifier" },
  syncX: { tag: "delegated", note: "extension — the domain is guarded by chokepoint 1" },
  timeCursor: { tag: "no-amplifier", note: "extension — no amplifier" },
  paneMaximize: { tag: "assembly", note: "extension — has no numeric slot (gestures is a boolean; the flex it writes is read from the panes)" },
  // Not "no amplifier" — there is simply no door to measure. Keep the tag honest.
  watermark: { tag: "assembly", note: "extension — has no numeric slot (text, font, and color are all strings)" },

  // Format and ticks — pure functions. A bad value shows up on the label immediately.
  labelFont: { tag: "assembly", note: "style resolution — takes no numbers (a chain of string fallbacks)" },
  labelFontFamily: { tag: "assembly", note: "style resolution — takes no numbers (a chain of string fallbacks)" },
  timeTicks: { tag: "delegated", note: "tick strategy — backed in depth by the axis's count ceiling" },
};

/**
 * The rule for deciding which doors need a guard. "Every function that
 * takes a number" is not the answer — most of them show a bad value right
 * at the call site the moment it comes in. What needs a guard is a door
 * where a bad value passes through silently and blows up far from the
 * call site. It qualifies if it matches any one of three amplifiers:
 *
 * - Persisted — gets serialized and stays in storage
 * - Delayed — sits in state and blows up later, under some later condition
 * - Amplified — becomes a loop boundary or a layout
 */
export const GUARDED: Record<string, string> = {
  barAggregator:
    "chokepoint 11 — a trade's price and volume, checked here because folding "
    + "erases them: a price that is not a number lands only on the close and the "
    + "next trade overwrites it, while its volume stays in the sum, so the data "
    + "door is handed a bar that adds up wrong and looks well formed "
    + "(guarded in data/__tests__/aggregate.test.ts)",
  fixedBars:
    "chokepoint 9 — interval becomes the grid every bar is floored onto, and "
    + "a bar's x is stored. **The returned function is a second door** and "
    + "takes the number that matters: a bar's own x (both throw; guarded in "
    + "time/__tests__/bar-start.test.ts)",
  sessionStart:
    "chokepoint 10 — the door that matters is the function it returns: it "
    + "takes a bar's x and answers the x a session is stored under (the "
    + "options are checked too, but a time zone is a name, not a number). "
    + "A `NaN` answer violates idempotence and backward-only: `f(f(x)) === f(x)` "
    + "and `f(x) <= x` are false, and their logical negations are true. An "
    + "opposite comparison such as `f(x) > x` is also false, so it cannot "
    + "detect that violation; non-finite inputs are refused at the call "
    + "(guarded in time/__tests__/bar-start.test.ts)",
  LinearScale: "chokepoint 1 — the domain becomes the boundary of the axis-tick loop (amplified)",
  LogScale: "chokepoint 1 — the domain becomes the boundary of the axis-tick loop (amplified)",
  // An export with multiple doors can sit in this table with a checkmark
  // even if only one of them is guarded — setViewport was, while
  // applyOptions once had no numeric check at all.
  Plot: "chokepoints 2/3/6 — setViewport, applyOptions, and the constructor become dimensions and the domain, and the handle's updateLast is a data door (amplified, delayed)",
  createPlotDeps:
    "chokepoint 7 — maxPoints and pointsPerPixel become the trimming budget "
    + "(delayed). This used to be exempted as "
    + "\"assembly — takes a collaborator\", but that reason only counted the "
    + "collaborator and never counted the two numbers",
  infiniteHistory:
    "chokepoint 8 — options.from seeds every `before` the fetch is asked for, "
    + "and screensAhead scales the pull threshold (both throw at the door; "
    + "guarded in extensions/__tests__/infinite-history.test.ts)",
};

/**
 * Doors that block a value shaped wrong with a contract error. This is
 * split from `GUARDED` because they check a different axis — the numeric
 * axis asks "is the value finite," the shape axis asks "is the value the
 * right shape." A door can block on numbers while leaving shape unguarded,
 * or the reverse.
 */
export const SHAPE_GUARDED: Record<string, string> = {
  barAggregator: "the options object and its barStart, which would otherwise fail at the first trade",
  fixedBars: "interval, where an exchange's bar width arrives as a string",
  sessionStart: "timeZone, which must be given — a missing one used to mean the runtime's",
  createPlotModel: "the size object and its dimensions. Layout arithmetic runs directly on it",
  Plot: "the constructor's size, and the data doors (setData, append, prepend, updateLast)",
  markers: "where garbage coordinates used to get drawn as-is",
  priceLine: "used to pass even when value was a string",
  span: "the from/to range",
  watermark: "the options object",
  paneMaximize: "the options object and its gestures flag, which used to throw a raw TypeError on every input event",
  /**
   * The exemption reason was "the result shows up on the label
   * immediately," but there was no result — it threw. The `tickSize` an
   * exchange hands over is a string (`"0.01000000"`), and
   * `Number(localStorage…)` is `NaN`.
   */
  priceFormat: "precision, minMove, locale. Where tickSize used to arrive as a string",

  /**
   * All three exemption reasons here were false. "Style leaves no state
   * behind" — `lineSeries(42)` passed through silently and drew with the
   * default, and all the consumer saw was "the style isn't taking effect."
   * "Belongs to renderer authors" — `fillLinearGradient` receives a
   * consumer value that arrived via `areaSeries({ fill })`, and a raw
   * `TypeError` leaked out on all six hostile shapes. Both were wrong
   * because they only said who calls it, never where the value comes from.
   */
  lineSeries: "the style argument. 42 passed through and drew with the default",
  stepLineSeries: "the same door as lineSeries (same requireObject)",
  areaSeries: "the style argument. 42 passed through and drew with the default (fill reaches all the way to fillLinearGradient)",
  barSeries: "the style argument. 42 passed through and drew with the default (fill reaches all the way to fillLinearGradient)",
  baselineSeries: "the style argument. 42 passed through and drew with the default (fill reaches all the way to fillLinearGradient)",
  candleSeries: "the style argument. 42 passed through and drew with the default (fill reaches all the way to fillLinearGradient)",
  histogramSeries: "the style argument. 42 passed through and drew with the default (fill reaches all the way to fillLinearGradient)",
  fillLinearGradient: "areaSeries({fill}) arrives here. All six were raw TypeErrors",
};

export const SHAPE_EXEMPT: Record<string, Exemption> = {
  PANE_OPTION_DEFAULTS: { tag: "constant", note: "a constant — takes no arguments" },
  // Assembly vocabulary — for extension authors. Calling it wrong fails assembly immediately.
  createPlotDeps: { tag: "assembly", note: "assembly vocabulary — wires up a collaborator. A mistake shows up on the first render" },
  createCanvasRenderer: { tag: "assembly", note: "assembly vocabulary — wires up a collaborator. A mistake shows up on the first render" },
  createCanvasTextMeasurer: { tag: "assembly", note: "assembly vocabulary — wires up a collaborator. A mistake shows up on the first render" },
  createCanvasAxisLabels: { tag: "assembly", note: "assembly vocabulary — wires up a collaborator. A mistake shows up on the first render" },
  createMemoryLayers: { tag: "assembly", note: "assembly vocabulary — wires up a collaborator. A mistake shows up on the first render" },
  recordingRenderer: { tag: "constant", note: "assembly vocabulary — takes no arguments" },
  emitter: { tag: "constant", note: "assembly vocabulary — takes no arguments" },
  pluginApi: { tag: "assembly", note: "assembly vocabulary — for extension authors" },
  seriesSpec: { tag: "delegated", note: "assembly vocabulary — builds a registration spec. The value is checked again at the data door" },
  computation: { tag: "delegated", note: "assembly vocabulary — a computation node. Its output passes through the data door again" },
  teardown: { tag: "assembly", note: "assembly vocabulary — a bundle of cleanup functions" },
  conflated: { tag: "assembly", note: "assembly vocabulary — wires a handle to a schedule; data shape is judged by updateLast at delivery" },
  infiniteHistory: { tag: "assembly", note: "assembly vocabulary — wires plot events to a sink and a fetch; a landed page's shape is judged at the landing (ascending check, cursor trim) and by the sink's own target" },
  createScope: { tag: "constant", note: "takes no argument — resource lifetimes, not data; add() takes only a callback" },
  validateSeriesData: { tag: "safe", note: "the validator itself — a payload of any shape comes back as issues, never a throw" },
  validateSeriesPoint: { tag: "safe", note: "the tick validator — a point of any shape comes back as issues, never a throw" },
  frameScheduler: { tag: "assembly", note: "assembly vocabulary — a scheduler factory" },
  immediateScheduler: { tag: "constant", note: "a value — a stateless scheduler" },
  manualScheduler: { tag: "constant", note: "assembly vocabulary — takes no arguments" },

  // Style utilities — used by extension authors when building their own spec.
  /**
   * The old reason was "belongs to spec authors," but the third argument is
   * every series factory's consumer-facing option. That door does not
   * throw — it tames the value instead, because it sits on the draw path,
   * where falling back is the contract. It is not a throwing door, so it
   * is not in GUARDED, but the exemption reason has to say so.
   */
  resolveStyle: { tag: "safe", note: "coerceLeaf tames the override — neither a numeric leaf nor a string leaf throws, both demote to the fallback" },
  /**
   * These two follow a different policy than `resolveStyle`. `resolveStyle`
   * sits on the draw path that runs every frame, where falling back is the
   * contract, but these two are authoring-time doors — if a broken spec
   * returned an empty array, or `var(undefined, …)`, the manifest test
   * would pass silently with "zero variables." Silence costs more here.
   */
  styleVars: { tag: "assembly", note: "style utility — throws ContractError if it is not a spec. This is an authoring-time door, so throwing beats staying silent" },
  cssVarExpr: { tag: "assembly", note: "style utility — throws ContractError if it is not a leaf. This is where a third-party extension's typo'd leaf name used to blow up on the render path" },
  styleSpec: { tag: "assembly", note: "assembly vocabulary — the identity at runtime (`(spec) => spec`), so there is no shape it can be given wrong. Everything it does happens in the type system, and a spec that is not one fails to compile" },
  noStyle: { tag: "constant", note: "a value — a single reader" },
  labelFont: { tag: "assembly", note: "style resolution — takes a reader" },
  labelFontFamily: { tag: "assembly", note: "style resolution — takes a reader" },
  eachFallback: { tag: "assembly", note: "render utility — for renderer authors" },
  drawCustom: { tag: "assembly", note: "render utility — for renderer authors" },
  isLinearGradientParams: { tag: "safe", note: "a predicate — accepting any value is its job" },
  paintLinearGradient: { tag: "assembly", note: "render utility — already blocked by a contract error" },

  /**
   * Two readback guards — `color` and `font` are exactly where a consumer
   * value arrives, and accepting and demoting both is this function's job.
   * Whatever comes in, it demotes without throwing. This runs once per
   * command every frame, so there is no room for a `requireObject`, and
   * adding one would gain nothing — if the context is wrong, nothing shows
   * up on the first frame anyway.
   */
  applyColor: { tag: "safe", note: "a readback guard — accepting any color string and demoting it is its job" },
  applyFont: { tag: "safe", note: "a readback guard — accepting any font value and demoting it is its job" },
  ColorVerdicts: { tag: "constant", note: "assembly vocabulary — takes no arguments" },
  FontVerdicts: { tag: "constant", note: "assembly vocabulary — takes no arguments" },
  FALLBACK_FONT: { tag: "constant", note: "a constant" },

  // Coordinates and ticks — the value is checked at each one's own data door.
  slotWidth: { tag: "safe", note: "geometry — a pure function, the result shows up immediately" },
  barIndexX: { tag: "delegated", note: "coordinate-system factory — the value is checked at the data door" },
  continuousX: { tag: "delegated", note: "coordinate-system factory — the value is checked at the data door" },
  timeTicks: { tag: "delegated", note: "tick strategy — backed by the axis's count ceiling" },
  defaultCoordinates: { tag: "delegated", note: "accessor — the data door checks the point's shape" },
  isGap: { tag: "safe", note: "a predicate — takes one argument and returns a boolean for any value" },
  tailDelta: { tag: "safe", note: "a check — only compares identity, so there is no good or bad value; falls back to null when it does not know" },
  reuseUnchanged: { tag: "safe", note: "an identity pass — a value of any shape is simply not judged and comes back as is; nothing to throw about" },

  // Extensions — installed onto the stage, and each one's value is checked at its own door.
  crosshair: { tag: "assembly", note: "extension — surfaces at install time" },
  crosshairLine: { tag: "assembly", note: "extension — surfaces at install time" },
  syncCrosshair: { tag: "assembly", note: "extension — takes two stages" },
  syncX: { tag: "assembly", note: "extension — takes two stages" },
  timeCursor: { tag: "assembly", note: "extension — takes two stages" },

  // Decimation and classes — constructor arguments are assembly vocabulary.
  LttbDecimation: { tag: "assembly", note: "decimation — assembly vocabulary" },
  M4Decimation: { tag: "assembly", note: "decimation — assembly vocabulary" },
  SimpleDecimation: { tag: "assembly", note: "decimation — assembly vocabulary" },
  mergePolicy: { tag: "assembly", note: "policy merging — assembly vocabulary" },
  LineDataAccessor: { tag: "assembly", note: "accessor — assembly vocabulary" },
  OHLCAccessor: { tag: "assembly", note: "accessor — assembly vocabulary" },
  LinearScale: { tag: "delegated", note: "chokepoint 1 checks the number" },
  LogScale: { tag: "delegated", note: "chokepoint 1 checks the number" },
  InputRouter: { tag: "no-amplifier", note: "input stack — for extension authors" },

  // Constants and error types — there is no call at all.
  ABOVE_SERIES: { tag: "constant", note: "a constant" },
  AXIS_LABEL_OFFSET: { tag: "constant", note: "a constant" },
  AXIS_LABEL_SPEC: { tag: "constant", note: "a constant" },
  BADGE_PADDING: { tag: "constant", note: "a constant" },
  BELOW_SERIES: { tag: "constant", note: "a constant" },
  DEFAULT_AREA_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_BAR_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_BASELINE_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_CANDLE_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_HISTOGRAM_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_LINE_STYLE: { tag: "constant", note: "a constant" },
  DEFAULT_PADDING: { tag: "constant", note: "a constant" },
  DEFAULT_PLOT_STYLE: { tag: "constant", note: "a constant" },
  LINEAR_GRADIENT: { tag: "constant", note: "a constant" },
  SERIES_Z: { tag: "constant", note: "a constant" },
  ContractError: { tag: "error-type", note: "an error type" },
  DataError: { tag: "error-type", note: "an error type" },
  RenderError: { tag: "error-type", note: "an error type" },
  AreaSeries: { tag: "assembly", note: "series class — same reasoning as the factory" },
  BarSeries: { tag: "assembly", note: "series class — same reasoning as the factory" },
  BaselineSeries: { tag: "assembly", note: "series class — same reasoning as the factory" },
  CandleSeries: { tag: "assembly", note: "series class — same reasoning as the factory" },
  HistogramSeries: { tag: "assembly", note: "series class — same reasoning as the factory" },
  LineSeries: { tag: "assembly", note: "series class — same reasoning as the factory" },
  StepLineSeries: { tag: "assembly", note: "series class — same reasoning as the factory" },
};

/**
 * A two-axis view keyed by door — the four tables above stay where they are,
 * with their prose intact, and a machine uses this view to see both the
 * value and shape verdicts for each door at a glance. If a door ends up
 * missing an axis, each of boundary-values's two censuses fails on its own.
 */
export interface DoorAxes {
  value: { tag: "guarded"; note: string } | Exemption;
  shape: { tag: "guarded"; note: string } | Exemption;
}

export function doorVerdicts(): Record<string, DoorAxes> {
  const doors: Record<string, DoorAxes> = {};
  const names = new Set([
    ...Object.keys(GUARDED),
    ...Object.keys(EXEMPT),
    ...Object.keys(SHAPE_GUARDED),
    ...Object.keys(SHAPE_EXEMPT),
  ]);
  for (const name of names) {
    const value =
      name in GUARDED
        ? ({ tag: "guarded", note: GUARDED[name] } as const)
        : EXEMPT[name];
    const shape =
      name in SHAPE_GUARDED
        ? ({ tag: "guarded", note: SHAPE_GUARDED[name] } as const)
        : SHAPE_EXEMPT[name];
    doors[name] = { value, shape };
  }
  return doors;
}
