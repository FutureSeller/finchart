import type { AxisLabelsFactory } from "../axis";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataManager,
  DataManagerFactory,
  DecimationFactory,
  DecimationPolicy,
} from "../data";
import { M4Decimation, SimpleDataManager } from "../data";
import { requirePositive } from "../primitives";
import type { InteractionHandler } from "../interaction";
import type {
  StyleReaderFactory,
  LayersFactory,
  RendererFactory,
  ResolutionObserver,
  SizeObserver,
  TextMeasurerFactory,
} from "../render";
import type { Scale, XMappingFactory } from "../scale";
import { LinearScale } from "../scale";
import type { DividerFactory } from "./dividers";
import type { SchedulerFactory } from "./scheduler";
import type { PlotDeps } from "./types";

/**
 * The raw material for building the wiring. **Used two ways.** `createPlotDeps`
 * only fills in what's given here; `browserDeps` in `@finchart/dom` fills
 * whatever's missing with browser defaults. Either way, a collaborator
 * that's left out means **Plot just doesn't do that job** — there's no null
 * object standing in, so it doesn't even end up in the bundle.
 */
export interface PlotDepsOptions {
  /**
   * A ceiling unrelated to screen width. **No default** — width decides it.
   * Set it below the width and you can't even draw one point per pixel.
   */
  maxPoints?: number;
  /** Target data points per pixel. Default is 4 — one pixel column's worth. */
  pointsPerPixel?: number;
  /**
   * Whether to keep halved tiers stacked up. Off by default. Turn it on for
   * large static datasets you zoom far out on and view for a long time —
   * it costs up to double the memory, and rebuilds the tiers on every
   * append, which is a net loss for a live chart.
   */
  tiered?: boolean;
  /**
   * Dev-time full re-validation of declared history-page landings. Normal
   * landings validate their new head and structurally retain the manager's
   * own accepted tail; with this on, every `adoptHeadRetainingTail` result
   * also walks that tail, catching illegal mutation during development and
   * dogfooding. Fresh derived output is fully validated in every build.
   */
  verifyLandings?: boolean;
  /**
   * How to build the decimation strategy. Default is M4 — for every pixel
   * column it picks first, last, min, and max, so extremes never get lost.
   * **Only applies to registrations that don't specify a policy** — a
   * strategy tied to a point type, like candles, comes with the series
   * itself. `createDecimation: (coords) => new LttbDecimation(coords)`
   */
  createDecimation?: DecimationFactory;
  /**
   * Default is linear. Pass `() => new LogScale()` for a log axis. A
   * factory, so one wiring can serve several charts without them sharing
   * an axis — the instance is only ever made by the Plot that owns it.
   */
  xScale?: () => Scale;
  /**
   * Default is continuous — the domain is data x itself. Financial charts
   * pass `barIndexX` to switch on a bar-index coordinate system (weekends
   * and closed sessions don't open up gaps).
   */
  createXMapping?: XMappingFactory;
  /** `mainPane`'s value axis, as a factory like `xScale`. A pane created later gets its own via `addPane({ yScale })`. */
  mainPaneYScale?: () => Scale;
  /** No input is accepted if this is left out. `browserDeps` fills it in with mouse/touch. */
  interactions?: InteractionHandler;
  /**
   * The surface to draw on. **Required in `createPlotDeps`** — this, along
   * with `createRenderer` and `createStyleReader`, form the three that
   * answer where, with what, and in what style.
   */
  createLayers?: LayersFactory;
  /** No tick labels are shown if this is left out. */
  createAxisLabels?: AxisLabelsFactory;
  /** No handles are placed between panes if this is left out. */
  createDividers?: DividerFactory;
  /**
   * Draws immediately (`immediateScheduler`) if this is left out — you see
   * the result on the next line after changing state. Coalescing to once
   * per frame is wiring `browserDeps` supplies via `frameScheduler()`.
   */
  createScheduler?: SchedulerFactory;
  /**
   * What style to draw in. **Required in `createPlotDeps`** (one of the
   * three). Browser wiring gets a computed style reader (`cssReader`) from
   * `browserDeps`; tests and headless code pass a fake, or `noStyle`.
   */
  createStyleReader?: StyleReaderFactory;
  /**
   * What to draw with. **Required in `createPlotDeps`** (one of the
   * three). Pass `recordingRenderer` to only capture the draw commands.
   */
  createRenderer?: RendererFactory;
  /**
   * How to measure text before drawing it. No measurement happens if this
   * is left out — measurement-based layout falls back to a fixed default.
   * **Swap the renderer and swap this alongside it.**
   */
  createTextMeasurer?: TextMeasurerFactory;
  /**
   * How to track size. The element is something the implementation already
   * knows about — `browserDeps`'s `autoSize` wires this in as a browser
   * convenience.
   */
  observeSize?: SizeObserver;
  /**
   * How to redraw when the resolution ratio changes. Nothing tracks it if
   * this is left out — a chart that never redraws stays blurry after the
   * window moves to another monitor. `browserDeps` fills this slot **by
   * default** (there's nothing to choose for this kind of observation).
   */
  observeResolution?: ResolutionObserver;
}

/**
 * **Only what's passed in gets included.** The only things filled in
 * regardless are the three that don't require knowing about the browser —
 * the x and y scales and the manager factory. Axis labels, dividers, and
 * interactions are all absent unless given.
 *
 * Three things are required: where (`createLayers`), with what
 * (`createRenderer`), and in what style (`createStyleReader`) to draw.
 *
 * For the common, fully-equipped wiring, use `browserDeps()`.
 */
export function createPlotDeps(
  options: PlotDepsOptions & {
    createLayers: LayersFactory;
    createRenderer: RendererFactory;
    createStyleReader: StyleReaderFactory;
  },
): PlotDeps {
  /**
   * **The decimation budget is a numeric gate too.** `maxPoints` and
   * `pointsPerPixel` become the culling budget
   * (`Math.max(1, Math.min(maxPoints, width * pointsPerPixel))`) — if a bad
   * value (negative, zero, `NaN`) leaks through, the budget drops to zero
   * or below and the data line silently disappears.
   *
   * Only positive values are accepted: `0` can't mean "no limit", since
   * that would mean "draw nothing" instead — it can't carry both meanings.
   * The idiom for "no limit" is to just not pass it (why `maxPoints`
   * defaults to `Infinity`).
   */
  if (options.maxPoints !== undefined) {
    requirePositive(options.maxPoints, "maxPoints");
  }
  if (options.pointsPerPixel !== undefined) {
    requirePositive(options.pointsPerPixel, "pointsPerPixel");
  }

  const {
    maxPoints,
    pointsPerPixel,
    tiered,
    verifyLandings,
    xScale = linearScale,
    createXMapping,
    mainPaneYScale = linearScale,
    interactions,
    createLayers,
    createAxisLabels,
    createDividers,
    createScheduler,
    createStyleReader,
    createRenderer,
    createTextMeasurer,
    createDecimation = defaultDecimation,
    observeSize,
    observeResolution,
  } = options;

  /**
   * Keeps how every registration builds the same policy (ceiling, tiers)
   * in one place. Manager instances can't be shared — each holds different
   * data. If a registration doesn't specify a policy, this default (M4 +
   * `pointsPerPixel`) wins; if it does, that wins instead.
   */
  const createDataManager: DataManagerFactory = <P extends BaseDataPoint>(
    coords: CoordinateAccessor<P>,
    policy?: DecimationPolicy<P>,
  ): DataManager<P> =>
    new SimpleDataManager<P>({
      decimation: policy?.strategy ?? createDecimation(coords),
      coordinates: coords,
      // A registration's own budget passes through the same gate as the wiring's — skip it here, and one
      // `decimation: { pointsPerPixel: 0 }` registration silently erases its line.
      pointsPerPixel:
        policy?.pointsPerPixel !== undefined
          ? requirePositive(policy.pointsPerPixel, "decimation.pointsPerPixel")
          : pointsPerPixel,
      maxPoints,
      tiered,
      verifyAdoptions: verifyLandings,
    });

  return {
    xScale,
    createXMapping,
    mainPaneYScale,
    createDataManager,
    interactions,
    createLayers,
    createAxisLabels,
    createDividers,
    createScheduler,
    createStyleReader,
    createRenderer,
    createTextMeasurer,
    observeSize,
    observeResolution,
  };
}

const linearScale = (): Scale => new LinearScale();

const defaultDecimation: DecimationFactory = (coordinates) =>
  new M4Decimation(coordinates);
