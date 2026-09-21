import { describeValue, requireAttachOptions, requireOptions } from "./kernels";
import type {
  Computation,
  LineDataPoint,
  LineSeriesStyleOverrides,
  OHLC,
  Pane,
  PaneHost,
  Plugin,
  PluginApi,
  SeriesHost,
  Source,
} from "@finchart/core";
import {
  ContractError,
  histogramSeries,
  lineSeries,
  pluginApi,
  priceLine,
} from "@finchart/core";
import type { BandSeriesOptions } from "./band-series";
import { bandSeries } from "./band-series";
import type {
  Adx,
  AdxOptions,
  Atr,
  AtrOptions,
  BollingerBands,
  BollingerOptions,
  Cci,
  CciOptions,
  DonchianChannels,
  DonchianOptions,
  KeltnerChannels,
  KeltnerOptions,
  PivotPoints,
  PivotPointsOptions,
  SuperTrend,
  SuperTrendOptions,
  WilliamsR,
  WilliamsROptions,
  StochasticRsi,
  StochasticRsiOptions,
  Mfi,
  MfiOptions,
  UltimateOscillator,
  UltimateOscillatorOptions,
  AwesomeOscillator,
  AwesomeOscillatorOptions,
  Momentum,
  MomentumOptions,
  ElderRay,
  ElderRayOptions,
  SqueezeMomentum,
  SqueezeMomentumOptions,
  Macd,
  MacdOptions,
  MovingAverage,
  MovingAverageOptions,
  Ichimoku,
  IchimokuOptions,
  Obv,
  ParabolicSar,
  ParabolicSarOptions,
  Bbi,
  BbiOptions,
  Brar,
  Cr,
  BrarOptions,
  CrOptions,
  Dma,
  DmaOptions,
  Emv,
  EmvOptions,
  Psy,
  Kdj,
  PsyOptions,
  KdjOptions,
  Roc,
  RocOptions,
  Pvt,
  Rsi,
  RsiOptions,
  Stochastic,
  StochasticOptions,
  Trix,
  TrixOptions,
  Vr,
  VrOptions,
  Vwap,
  VwapOptions,
} from "./factories";
import {
  ADX_DEFAULTS,
  ATR_DEFAULTS,
  BOLLINGER_DEFAULTS,
  CCI_DEFAULTS,
  DONCHIAN_DEFAULTS,
  ICHIMOKU_DEFAULTS,
  KELTNER_DEFAULTS,
  SUPERTREND_DEFAULTS,
  WILLIAMS_R_DEFAULTS,
  AWESOME_OSCILLATOR_DEFAULTS,
  ELDER_RAY_DEFAULTS,
  MACD_DEFAULTS,
  MFI_DEFAULTS,
  BBI_DEFAULTS,
  BRAR_DEFAULTS,
  CR_DEFAULTS,
  DMA_DEFAULTS,
  EMV_DEFAULTS,
  MOMENTUM_DEFAULTS,
  PSY_DEFAULTS,
  KDJ_DEFAULTS,
  ROC_DEFAULTS,
  TRIX_DEFAULTS,
  VR_DEFAULTS,
  MOVING_AVERAGE_DEFAULTS,
  SQUEEZE_MOMENTUM_DEFAULTS,
  STOCHASTIC_RSI_DEFAULTS,
  ULTIMATE_OSCILLATOR_DEFAULTS,
  PARABOLIC_SAR_DEFAULTS,
  RSI_DEFAULTS,
  STOCHASTIC_DEFAULTS,
  adx,
  atr,
  bollingerBands,
  cci,
  donchianChannels,
  keltnerChannels,
  pivotPoints,
  superTrend,
  williamsR,
  ichimoku,
  macd,
  movingAverage,
  obv,
  parabolicSar,
  awesomeOscillator,
  elderRay,
  mfi,
  bbi,
  brar,
  cr,
  dma,
  emv,
  momentum,
  psy,
  kdj,
  pvt,
  roc,
  trix,
  vr,
  rsi,
  squeezeMomentum,
  stochastic,
  stochasticRsi,
  ultimateOscillator,
  vwap,
} from "./factories";

/**
 * A wrapper for "one indicator = one install/dispose." A computed node
 * is just a value, so there's nothing to install, but real
 * usage repeats the same steps every time — pick a pane, mount a series,
 * keep track of a dispose function — so that wiring lives here. The node
 * comes back as part of the API because its branches are `Source` again,
 * so you can stack another indicator on top of a mounted one.
 */
export interface IndicatorApi<Node> extends PluginApi {
  node: Node;
}

/**
 * The API an indicator that can create its own pane returns — it also
 * hands back the pane it made. `null` when the pane was borrowed — the
 * consumer already holds that `PaneApi`, so there's nothing new to return.
 */
export interface OwnedPaneIndicatorApi<Node> extends IndicatorApi<Node> {
  pane: Pane | null;
}

const overlayStyle = (color?: string): LineSeriesStyleOverrides | undefined =>
  color
    ? { line: { color }, point: { radius: 0, color } }
    : { point: { radius: 0 } };

// The default palette. Code constants, not CSS variables, because this is
// a different layer. The names are roles, not colors. Up and down are the
// core's own defaults — a Squeeze pane draws its momentum bars (the core's
// histogram slots) beside its marker rows (these), so with no theme the two
// share one green and one red. A themed slot moves the bars, not these rows.
const PRIMARY_COLOR = "#3b82f6";
const SECONDARY_COLOR = "#f59e0b";
const UP_COLOR = "#16a34a";
const DOWN_COLOR = "#dc2626";
const LAGGING_COLOR = "#8b5cf6";

/**
 * Pivot Points' defaults are display defaults, not computation ones — the
 * factory takes only the consumer's `anchor` and always computes three
 * tiers; how many to draw is decided here, alongside the palette (3 tiers
 * means 7 legend rows, which is too much for a default).
 */
export const PIVOT_POINTS_DEFAULTS = { depth: 2 } as const;

/**
 * The default layout for an own pane — every pane-owning indicator shares
 * the same spot. flex 0.35 is the domain default for "a secondary
 * pane is smaller than the main one" (with equal flex, stacking even a
 * few panes squeezes the price pane down to the same size). Per-indicator
 * differentiation isn't decided yet.
 */
const OWNED_PANE_LAYOUT = { flex: 0.35, minHeight: 60 } as const;

type Keep = <T extends { dispose(): void }>(resource: T) => T;

/** Installation either returns its API or releases every resource it acquired. */
function attempt<T>(install: (keep: Keep) => T): T {
  const acquired: { dispose(): void }[] = [];
  try {
    return install((resource) => {
      acquired.push(resource);
      return resource;
    });
  } catch (error) {
    const failures: unknown[] = [error];
    for (const resource of acquired.reverse()) {
      try {
        resource.dispose();
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (failures.length > 1) throw new AggregateError(failures, "Indicator installation and cleanup failed");
    throw error;
  }
}

/**
 * The options shared by indicators that can create their own pane.
 * Passing `pane` and `ownPane` together throws — a borrowed pane has
 * nowhere to apply a size, and silently ignoring it would make the cause
 * hard to track down.
 */
export interface OwnedPaneOptions {
  /** Which pane to mount on. Omit it to create a new pane. */
  pane?: SeriesHost;
  /**
   * The size of the own pane to create. Omit it for `OWNED_PANE_LAYOUT`
   * (flex 0.35, minHeight 60). Meaningless if `pane` is given — giving
   * both throws `ContractError`.
   */
  ownPane?: {
    flex?: number;
    minHeight?: number;
    /**
     * The pane's identity in persisted view state (`"rsi"`, `"mfi"`).
     * Without one, a saved layout matches panes by position — add an
     * indicator, or reinstall one, and every saved height lands one pane
     * off.
     */
    stateKey?: string;
  };
}

/**
 * The pane ownership protocol — clean up only what you made. Disposing a
 * borrowed pane would delete something that belongs to someone else.
 * `wire` is the wiring (oscillator axis, reference lines) done only on an
 * owned pane — a borrowed pane's axis belongs to someone else.
 */
function ownedPane(
  plot: PaneHost,
  options: OwnedPaneOptions,
  keep: Keep,
  wire?: (owned: Pane) => void,
): { pane: SeriesHost; ownedPaneApi: Pane | null; disposeOwned: () => void } {
  if (options.pane) {
    if (options.ownPane) {
      throw new ContractError(
        "pane and ownPane cannot both be given — a borrowed pane has nowhere to apply a size",
      );
    }
    return { pane: options.pane, ownedPaneApi: null, disposeOwned: () => {} };
  }
  const owned = plot.addPane({
    flex: options.ownPane?.flex ?? OWNED_PANE_LAYOUT.flex,
    minHeight: options.ownPane?.minHeight ?? OWNED_PANE_LAYOUT.minHeight,
    ...(options.ownPane?.stateKey === undefined ? {} : { stateKey: options.ownPane.stateKey }),
  });
  keep({ dispose: () => plot.removePane(owned) });
  wire?.(owned);
  return {
    pane: owned,
    ownedPaneApi: owned,
    disposeOwned: () => plot.removePane(owned),
  };
}

/**
 * The legend name. Every `attach*` labels its series from the formula —
 * `RSI(14)`, `BB(20,2) Upper` — so two instances of one indicator on two
 * sources read the same. `name` replaces the head of that label; the
 * parts (`Upper`, `Signal`, `R1`) stay appended to it.
 */
export interface IndicatorNameOption {
  name?: string;
}

/**
 * The two ways into an `attach*`: from a `source` with the factory's own
 * options, or from a `node` you built with the factory yourself — the way
 * the declarative lane shares one calculation between drawings
 * (`bollingerBands(price).out.middle` under a line of its own). A node
 * does not carry its formula, so in that mode `name` is yours to give —
 * the label `MA(20)` cannot be made up from a node. The two are exclusive:
 * `node?: never` on one side and `source?: never` on the other keep
 * `{ source, node }` out at compile time, and the runtime refuses a
 * `node` key that is present but `undefined`.
 */
export type AttachFrom<TNode, TFactoryOptions, TLook> =
  | AttachFromSource<TFactoryOptions, TLook>
  | (TLook & { node: TNode; name: string; source?: never });

/** The source door's options — what `build` and the label formula read. */
export type AttachFromSource<TFactoryOptions, TLook> = TFactoryOptions &
  TLook & { source: Source<OHLC>; node?: never };

/**
 * Which door was taken, decided once: the node (built from the source, or
 * handed over) and the legend's head label (the given `name`, or the
 * formula spelled from the source-mode options). `given` inside `build`
 * and `formula` is the source door's options — narrowed by the branch,
 * which is why the factory's fields are readable there and nowhere else.
 */
function attachInputs<TNode, TFactoryOptions, TLook extends { name?: string }>(
  options: AttachFrom<TNode, TFactoryOptions, TLook>,
  who: string,
  build: (given: AttachFromSource<TFactoryOptions, TLook>) => TNode,
  formula: (given: AttachFromSource<TFactoryOptions, TLook>) => string,
  branches: readonly string[],
): { node: TNode; label: string } {
  if ("node" in options) {
    const node = options.node;
    if (node === undefined) {
      throw new ContractError(
        `${who}({ node }) is undefined — hand over the node you built, or leave the key out and give a source`,
      );
    }
    if (typeof options.name !== "string") {
      throw new ContractError(`${who}({ node }) needs a name — a node does not carry its formula`);
    }
    // Every branch this attach draws must be a Source *before* anything is
    // mounted — an own pane is created first, and a branch that fails inside
    // `addSeries` would leave that pane behind with no api to take it back.
    const out = typeof node === "object" && node !== null ? Reflect.get(node, "out") : undefined;
    for (const branch of branches) {
      const source = typeof out === "object" && out !== null ? Reflect.get(out, branch) : undefined;
      if (typeof source !== "object" || source === null || typeof Reflect.get(source, "read") !== "function") {
        throw new ContractError(
          `${who}({ node }) needs node.out.${branch} to be a Source (something with a read method): ${describeValue(source)}`,
        );
      }
    }
    return { node, label: options.name };
  }
  return { node: build(options), label: options.name ?? formula(options) };
}

export interface AttachMovingAverageLook extends IndicatorNameOption {
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachMovingAverageOptions = AttachFrom<MovingAverage, MovingAverageOptions, AttachMovingAverageLook>;

/**
 * Mounts a moving average on that pane.
 *
 * ```ts
 * const ma = plot.mainPane.use(attachMovingAverage({ source: price, period: 20 }));
 * ```
 *
 * The host is a pane because mounting a single series is all this needs
 * — taking the whole `PaneHost` when only `addSeries` gets used left the
 * indicator unaware if the pane it was mounted on later disappeared.
 */
export function attachMovingAverage(
  options: AttachMovingAverageOptions,
): Plugin<SeriesHost, IndicatorApi<MovingAverage>> {
  requireAttachOptions(options, "attachMovingAverage");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachMovingAverage",
      (given) => movingAverage(given.source, {
        period: given.period,
        type: given.type,
      }),
      (given) => `${(given.type ?? MOVING_AVERAGE_DEFAULTS.type) === "ema" ? "EMA" : "MA"}(${given.period})`,

      ["ma"],
    );
    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.ma,
      // The label follows the formula — writing MA(20) for an EMA would be a lie.
      name: label,
      color: options.color,
    }));

    return pluginApi({ node }, () => handle.dispose());
  });
}

export interface AttachMacdLook extends OwnedPaneOptions, IndicatorNameOption {
  /**
   * Which pane to mount on. Omit it to create a new pane — MACD's scale
   * differs from price, so overlapping them breaks the value axis. Size
   * it with `ownPane`.
   */
  pane?: SeriesHost;
  /** `histogram` is one colour for every bar — it overrides the up/down slots the bars' `tone` would pick. */
  colors?: { macd?: string; signal?: string; histogram?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachMacdOptions = AttachFrom<Macd, MacdOptions, AttachMacdLook>;

export function attachMacd(
  options: AttachMacdOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Macd>> {
  requireAttachOptions(options, "attachMacd");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachMacd",
      (given) => macd(given.source, {
        fast: given.fast,
        slow: given.slow,
        signal: given.signal,
      }),
      (given) => `MACD(${given.fast ?? MACD_DEFAULTS.fast},${given.slow ?? MACD_DEFAULTS.slow},${given.signal ?? MACD_DEFAULTS.signal})`,

      ["histogram", "macd", "signal"],
    );

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);

    // If both lines defaulted to the same color, there'd be no way to tell which is the signal.
    const macdColor = options.colors?.macd ?? PRIMARY_COLOR;
    const signalColor = options.colors?.signal ?? SECONDARY_COLOR;
    // The default label reads from the same source as the computation default (the factory's *_DEFAULTS).
    const handles = [
      // The histogram is a bar series that grows from 0.
      keep(pane.addSeries({
        series: histogramSeries({
          style: options.colors?.histogram
            ? { color: options.colors.histogram }
            : undefined,
        }),
        input: node.out.histogram,
        name: `${label} Histogram`,
        color: options.colors?.histogram,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(macdColor)),
        input: node.out.macd,
        name: label,
        color: macdColor,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(signalColor)),
        input: node.out.signal,
        name: `${label} Signal`,
        color: signalColor,
      })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachBollingerLook extends IndicatorNameOption {
  colors?: { middle?: string; edges?: string };
  band?: BandSeriesOptions;
  /**
   * Draw the middle line? Default true. It is the SMA of `period` over the
   * band's input — a simple `attachMovingAverage` of the same period on the
   * same input and pane sits exactly on top of it; turn this one off, or
   * draw one line from the shared node. `false` leaves the band and the two
   * edges.
   */
  middle?: boolean;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachBollingerOptions = AttachFrom<BollingerBands, BollingerOptions, AttachBollingerLook>;

/** Mounts the band on that pane — usually `mainPane`, since it shares price's axis. */
export function attachBollingerBands(
  options: AttachBollingerOptions,
): Plugin<SeriesHost, IndicatorApi<BollingerBands>> {
  requireAttachOptions(options, "attachBollingerBands");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachBollingerBands",
      (given) => bollingerBands(given.source, {
        period: given.period,
        multiplier: given.multiplier,
      }),
      (given) => `BB(${given.period ?? BOLLINGER_DEFAULTS.period},${given.multiplier ?? BOLLINGER_DEFAULTS.multiplier})`,

      ["band", "lower", "middle", "upper"],
    );
    const handles = [
      // The fill is zIndex -1 — even toggled on late, it sits under the
      // candles. The lines register after it, so they show above the band.
      keep(pane.addSeries({
        series: bandSeries(options.band),
        input: node.out.band,
        zIndex: -1,
        // Drawn for the eye — a tooltip row reading an edge value with no name says nothing.
        readout: false,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(options.colors?.edges)),
        input: node.out.upper,
        name: `${label} Upper`,
        color: options.colors?.edges,
      })),
      ...(options.middle === false
        ? []
        : [
            keep(pane.addSeries({
              series: lineSeries(overlayStyle(options.colors?.middle)),
              input: node.out.middle,
              name: label,
              color: options.colors?.middle,
            })),
          ]),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(options.colors?.edges)),
        input: node.out.lower,
        name: `${label} Lower`,
        color: options.colors?.edges,
      })),
    ];

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  });
}

/** Oscillator reference lines. Change the values or turn them off with `false`. */
export interface OscillatorLevels {
  overbought?: number;
  oversold?: number;
}

/**
 * The reference lines each oscillator draws on its own pane — exported so
 * a settings panel can show them, the same way the `*_DEFAULTS` show the
 * computation's numbers. They live here, not with the factory: a level is
 * a fact about the screen, and the factory knows nothing about screens.
 */
export const RSI_LEVELS = { overbought: 70, oversold: 30 } as const;
export const STOCHASTIC_LEVELS = { overbought: 80, oversold: 20 } as const;
export const STOCHASTIC_RSI_LEVELS = { overbought: 80, oversold: 20 } as const;
export const MFI_LEVELS = { overbought: 80, oversold: 20 } as const;
export const ULTIMATE_OSCILLATOR_LEVELS = { overbought: 70, oversold: 30 } as const;
export const CCI_LEVELS = { overbought: 100, oversold: -100 } as const;
export const WILLIAMS_R_LEVELS = { overbought: -20, oversold: -80 } as const;
export const PSY_LEVELS = { overbought: 75, oversold: 25 } as const;

/**
 * Wires oscillator setup (a fixed axis plus reference lines) only on an
 * owned pane. If the axis auto-scales, it wobbles as values move, which
 * erases the meaning of a reference line — so it's pinned with
 * `setValueDomain`. Never done on a borrowed pane — that would
 * mean changing someone else's axis.
 */
function wireOscillatorPane(
  pane: Pane,
  levels: OscillatorLevels | false | undefined,
  defaults: Required<OscillatorLevels>,
  /**
   * The value axis. Default 0..100 (RSI, Stochastic). Williams %R uses
   * −100..0, and an unbounded oscillator like CCI passes null — leave it
   * to autoScale and only draw the reference lines.
   */
  domain: readonly [number, number] | null = [0, 100],
): void {
  if (domain) pane.setValueDomain(domain[0], domain[1]);
  if (levels === false) return;

  // The reference lines keep priceLine's default style (a faint dashed line).
  pane.addDecoration(
    priceLine({ value: levels?.overbought ?? defaults.overbought }),
  );
  pane.addDecoration(
    priceLine({ value: levels?.oversold ?? defaults.oversold }),
  );
}

export interface AttachRsiLook extends OwnedPaneOptions, IndicatorNameOption {
  /**
   * Which pane to mount on. **Omit it and a new pane is created**, wired
   * with a fixed 0-100 axis and reference lines too. A borrowed pane only
   * gets the series mounted on it. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  color?: string;
  /** The reference line values. Default 70/30. Drawn only for an own pane. */
  levels?: OscillatorLevels | false;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachRsiOptions = AttachFrom<Rsi, RsiOptions, AttachRsiLook>;

export function attachRsi(
  options: AttachRsiOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Rsi>> {
  requireAttachOptions(options, "attachRsi");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachRsi",
      (given) => rsi(given.source, { period: given.period }),
      (given) => `RSI(${given.period ?? RSI_DEFAULTS.period})`,

      ["rsi"],
    );
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, RSI_LEVELS),
    );

    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.rsi,
      name: label,
      color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachAtrLook extends OwnedPaneOptions, IndicatorNameOption {
  /**
   * Omit it to create a new pane — ATR is a volatility measure, on a
   * different scale from price. It's not an oscillator, so the axis
   * stays autoScale. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachAtrOptions = AttachFrom<Atr, AtrOptions, AttachAtrLook>;

export function attachAtr(
  options: AttachAtrOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Atr>> {
  requireAttachOptions(options, "attachAtr");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachAtr",
      (given) => atr(given.source, { period: given.period }),
      (given) => `ATR(${given.period ?? ATR_DEFAULTS.period})`,

      ["atr"],
    );
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);

    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.atr,
      name: label,
      color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachStochasticLook extends OwnedPaneOptions, IndicatorNameOption {
  /**
   * Omit it to create a new pane, wired with a fixed 0-100 axis and
   * reference lines too. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  colors?: { k?: string; d?: string };
  /** The reference line values. Default 80/20. Drawn only for an own pane. */
  levels?: OscillatorLevels | false;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachStochasticOptions = AttachFrom<Stochastic, StochasticOptions, AttachStochasticLook>;

export function attachStochastic(
  options: AttachStochasticOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Stochastic>> {
  requireAttachOptions(options, "attachStochastic");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachStochastic",
      (given) => stochastic(given.source, {
        period: given.period,
        smooth: given.smooth,
        signal: given.signal,
      }),
      (given) => `Stoch(${given.period ?? STOCHASTIC_DEFAULTS.period},${given.smooth ?? STOCHASTIC_DEFAULTS.smooth},${given.signal ?? STOCHASTIC_DEFAULTS.signal})`,

      ["d", "k"],
    );

    const kColor = options.colors?.k ?? PRIMARY_COLOR;
    const dColor = options.colors?.d ?? SECONDARY_COLOR;
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, STOCHASTIC_LEVELS),
    );

    const handles = [
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(kColor)),
        input: node.out.k,
        name: `${label} %K`,
        color: kColor,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(dColor)),
        input: node.out.d,
        name: `${label} %D`,
        color: dColor,
      })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachStochasticRsiLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, wired with a fixed 0-100 axis and reference lines too. */
  pane?: SeriesHost;
  colors?: { k?: string; d?: string };
  /** The reference line values. Default `STOCHASTIC_RSI_LEVELS` (80/20). Drawn only for an own pane. */
  levels?: OscillatorLevels | false;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachStochasticRsiOptions = AttachFrom<StochasticRsi, StochasticRsiOptions, AttachStochasticRsiLook>;

export function attachStochasticRsi(
  options: AttachStochasticRsiOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<StochasticRsi>> {
  requireAttachOptions(options, "attachStochasticRsi");
  return (plot) => attempt((keep) => {
    const d = STOCHASTIC_RSI_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachStochasticRsi",
      (given) => stochasticRsi(given.source, {
        rsiPeriod: given.rsiPeriod,
        period: given.period,
        smooth: given.smooth,
        signal: given.signal,
      }),
      (given) => `StochRSI(${given.rsiPeriod ?? d.rsiPeriod},${given.period ?? d.period},${given.smooth ?? d.smooth},${given.signal ?? d.signal})`,

      ["d", "k"],
    );
    const kColor = options.colors?.k ?? PRIMARY_COLOR;
    const dColor = options.colors?.d ?? SECONDARY_COLOR;
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, STOCHASTIC_RSI_LEVELS),
    );

    const handles = [
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(kColor)),
        input: node.out.k,
        name: `${label} %K`,
        color: kColor,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(dColor)),
        input: node.out.d,
        name: `${label} %D`,
        color: dColor,
      })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachMfiLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, wired with a fixed 0-100 axis and reference lines too. */
  pane?: SeriesHost;
  color?: string;
  /** The reference line values. Default `MFI_LEVELS` (80/20). Drawn only for an own pane. */
  levels?: OscillatorLevels | false;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachMfiOptions = AttachFrom<Mfi, MfiOptions, AttachMfiLook>;

export function attachMfi(
  options: AttachMfiOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Mfi>> {
  requireAttachOptions(options, "attachMfi");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachMfi",
      (given) => mfi(given.source, { period: given.period }),
      (given) => `MFI(${given.period ?? MFI_DEFAULTS.period})`,

      ["mfi"],
    );
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, MFI_LEVELS),
    );

    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.mfi,
      name: label,
      color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachUltimateOscillatorLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, wired with a fixed 0-100 axis and reference lines too. */
  pane?: SeriesHost;
  color?: string;
  /** The reference line values. Default `ULTIMATE_OSCILLATOR_LEVELS` (70/30). Drawn only for an own pane. */
  levels?: OscillatorLevels | false;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachUltimateOscillatorOptions = AttachFrom<UltimateOscillator, UltimateOscillatorOptions, AttachUltimateOscillatorLook>;

export function attachUltimateOscillator(
  options: AttachUltimateOscillatorOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<UltimateOscillator>> {
  requireAttachOptions(options, "attachUltimateOscillator");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachUltimateOscillator",
      (given) => ultimateOscillator(given.source, {
        fast: given.fast,
        middle: given.middle,
        slow: given.slow,
      }),
      (given) => {
        const d = ULTIMATE_OSCILLATOR_DEFAULTS;
        // The label shows the windows the way the node uses them — shortest first.
        const [fast, middle, slow] = [given.fast ?? d.fast, given.middle ?? d.middle, given.slow ?? d.slow].sort(
          (a, b) => a - b,
        );
        return `UO(${fast},${middle},${slow})`;
      },

      ["uo"],
    );
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, ULTIMATE_OSCILLATOR_LEVELS),
    );

    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.uo,
      name: label,
      color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachAwesomeOscillatorLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane — an unbounded histogram, so the axis stays autoScale. */
  pane?: SeriesHost;
  /** One colour for every bar — overrides the up/down slots the bars' `tone` would pick. */
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachAwesomeOscillatorOptions = AttachFrom<AwesomeOscillator, AwesomeOscillatorOptions, AttachAwesomeOscillatorLook>;

/** Mounts the Awesome Oscillator as a histogram growing from 0; each bar wears its `tone`. */
export function attachAwesomeOscillator(
  options: AttachAwesomeOscillatorOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<AwesomeOscillator>> {
  requireAttachOptions(options, "attachAwesomeOscillator");
  return (plot) => attempt((keep) => {
    const d = AWESOME_OSCILLATOR_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachAwesomeOscillator",
      (given) => awesomeOscillator(given.source, { fast: given.fast, slow: given.slow }),
      (given) => `AO(${given.fast ?? d.fast},${given.slow ?? d.slow})`,

      ["ao"],
    );

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);

    const handle = keep(pane.addSeries({
      series: histogramSeries(options.color ? { style: { color: options.color } } : undefined),
      input: node.out.ao,
      name: label,
      color: options.color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachMomentumLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a zero line; the axis stays autoScale. */
  pane?: SeriesHost;
  colors?: { momentum?: string; signal?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachMomentumOptions = AttachFrom<Momentum, MomentumOptions, AttachMomentumLook>;

/** Mounts Momentum and its signal — two lines around a zero line on an own pane. */
export function attachMomentum(
  options: AttachMomentumOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Momentum>> {
  requireAttachOptions(options, "attachMomentum");
  return (plot) => attempt((keep) => {
    const d = MOMENTUM_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachMomentum",
      (given) => momentum(given.source, { period: given.period, signal: given.signal }),
      (given) => `MTM(${given.period ?? d.period},${given.signal ?? d.signal})`,

      ["momentum", "signal"],
    );
    return twoLinesAroundZero(plot, options, keep, node, node.out.momentum, node.out.signal, label, options.colors?.momentum, options.colors?.signal);
  });
}

export interface AttachElderRayLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a zero line; the axis stays autoScale. */
  pane?: SeriesHost;
  colors?: { bull?: string; bear?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachElderRayOptions = AttachFrom<ElderRay, ElderRayOptions, AttachElderRayLook>;

/**
 * Mounts Elder-Ray — bull power and bear power as two lines around a zero
 * line on an own pane. Lines, not histograms: two histograms growing from
 * the same baseline hide each other whenever they share a sign (a bearish
 * bar has both below zero), and the one drawn second wins.
 */
export function attachElderRay(
  options: AttachElderRayOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<ElderRay>> {
  requireAttachOptions(options, "attachElderRay");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachElderRay",
      (given) => elderRay(given.source, { period: given.period }),
      (given) => `Elder-Ray(${given.period ?? ELDER_RAY_DEFAULTS.period})`,

      ["bearPower", "bullPower"],
    );
    const bullColor = options.colors?.bull ?? UP_COLOR;
    const bearColor = options.colors?.bear ?? DOWN_COLOR;
    // The zero line is the reading — only on an own pane, never on a borrowed axis.
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) => {
      owned.addDecoration(priceLine({ value: 0 }));
    });

    const handles = [
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(bullColor)),
        input: node.out.bullPower,
        name: `${label} Bull`,
        color: bullColor,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(bearColor)),
        input: node.out.bearPower,
        name: `${label} Bear`,
        color: bearColor,
      })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachSqueezeMomentumLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane — an unbounded histogram, so the axis stays autoScale. */
  pane?: SeriesHost;
  /** `momentum` is one colour for every bar (overriding the up/down slots the bars' `tone` would pick); `squeezeOn`/`squeezeOff` colour the marker rows on the zero line. */
  colors?: { momentum?: string; squeezeOn?: string; squeezeOff?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachSqueezeMomentumOptions = AttachFrom<SqueezeMomentum, SqueezeMomentumOptions, AttachSqueezeMomentumLook>;

/**
 * Mounts Squeeze Momentum — the momentum as a histogram and the two squeeze
 * states as marker rows on its zero line (a zero-height bar still draws
 * one pixel). The marker rows are registered without a name: a legend
 * line reading "0.00" would say nothing, and `node.out.squeezeOn` is
 * there for anything that wants the state as data.
 */
export function attachSqueezeMomentum(
  options: AttachSqueezeMomentumOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<SqueezeMomentum>> {
  requireAttachOptions(options, "attachSqueezeMomentum");
  return (plot) => attempt((keep) => {
    const d = SQUEEZE_MOMENTUM_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachSqueezeMomentum",
      (given) => squeezeMomentum(given.source, {
        bbPeriod: given.bbPeriod,
        bbMultiplier: given.bbMultiplier,
        kcPeriod: given.kcPeriod,
        kcMultiplier: given.kcMultiplier,
      }),
      (given) => `Squeeze(${given.bbPeriod ?? d.bbPeriod},${given.bbMultiplier ?? d.bbMultiplier},${given.kcPeriod ?? d.kcPeriod},${given.kcMultiplier ?? d.kcMultiplier})`,

      ["momentum", "squeezeOff", "squeezeOn"],
    );
    const onColor = options.colors?.squeezeOn ?? DOWN_COLOR;
    const offColor = options.colors?.squeezeOff ?? UP_COLOR;
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);

    const handles = [
      keep(pane.addSeries({
        series: histogramSeries(options.colors?.momentum ? { style: { color: options.colors.momentum } } : undefined),
        input: node.out.momentum,
        name: label,
        color: options.colors?.momentum,
      })),
      // Marker rows on the zero line — their value is 0, so they are not read out.
      keep(pane.addSeries({ series: histogramSeries({ style: { color: onColor } }), input: node.out.squeezeOn, readout: false })),
      keep(pane.addSeries({ series: histogramSeries({ style: { color: offColor } }), input: node.out.squeezeOff, readout: false })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachRocLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a zero line; the axis stays autoScale. */
  pane?: SeriesHost;
  colors?: { roc?: string; signal?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachRocOptions = AttachFrom<Roc, RocOptions, AttachRocLook>;

/** Mounts ROC and its signal — two lines around a zero line on an own pane. */
export function attachRoc(options: AttachRocOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Roc>> {
  requireAttachOptions(options, "attachRoc");
  return (plot) => attempt((keep) => {
    const d = ROC_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachRoc",
      (given) => roc(given.source, { period: given.period, signal: given.signal }),
      (given) => `ROC(${given.period ?? d.period},${given.signal ?? d.signal})`,

      ["roc", "signal"],
    );
    return twoLinesAroundZero(plot, options, keep, node, node.out.roc, node.out.signal, label, options.colors?.roc, options.colors?.signal);
  });
}

export interface AttachTrixLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a zero line; the axis stays autoScale. */
  pane?: SeriesHost;
  colors?: { trix?: string; signal?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachTrixOptions = AttachFrom<Trix, TrixOptions, AttachTrixLook>;

/** Mounts TRIX and its signal — two lines around a zero line on an own pane. */
export function attachTrix(options: AttachTrixOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Trix>> {
  requireAttachOptions(options, "attachTrix");
  return (plot) => attempt((keep) => {
    const d = TRIX_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachTrix",
      (given) => trix(given.source, { period: given.period, signal: given.signal }),
      (given) => `TRIX(${given.period ?? d.period},${given.signal ?? d.signal})`,

      ["signal", "trix"],
    );
    return twoLinesAroundZero(plot, options, keep, node, node.out.trix, node.out.signal, label, options.colors?.trix, options.colors?.signal);
  });
}

/**
 * The Momentum door, shared: a main line and its signal on an own pane
 * with a zero line (only on an own pane — never on a borrowed axis).
 */
function twoLinesAroundZero<N extends Computation<Record<string, LineDataPoint[]>>>(
  plot: PaneHost,
  options: OwnedPaneOptions & { pane?: SeriesHost },
  keep: Keep,
  node: N,
  main: Source<LineDataPoint>,
  signal: Source<LineDataPoint>,
  label: string,
  mainColor: string | undefined,
  signalColor: string | undefined,
): PluginApi & OwnedPaneIndicatorApi<N> {
  const lineColor = mainColor ?? PRIMARY_COLOR;
  const secondColor = signalColor ?? SECONDARY_COLOR;
  const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) => {
    owned.addDecoration(priceLine({ value: 0 }));
  });
  const handles = [
    keep(pane.addSeries({ series: lineSeries(overlayStyle(lineColor)), input: main, name: label, color: lineColor })),
    keep(pane.addSeries({ series: lineSeries(overlayStyle(secondColor)), input: signal, name: `${label} Signal`, color: secondColor })),
  ];
  return pluginApi({ node, pane: ownedPaneApi }, () => {
    for (const handle of handles) handle.dispose();
    disposeOwned();
  });
}

export interface AttachPsyLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane with a fixed 0–100 axis and the reference lines. */
  pane?: SeriesHost;
  /** Reference lines. Default `PSY_LEVELS` (75/25); `false` draws none. */
  levels?: OscillatorLevels | false;
  colors?: { psy?: string; signal?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachPsyOptions = AttachFrom<Psy, PsyOptions, AttachPsyLook>;

/** Mounts PSY and its signal on a 0–100 pane with 75/25 reference lines. */
export function attachPsy(options: AttachPsyOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Psy>> {
  requireAttachOptions(options, "attachPsy");
  return (plot) => attempt((keep) => {
    const d = PSY_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachPsy",
      (given) => psy(given.source, { period: given.period, signal: given.signal }),
      (given) => `PSY(${given.period ?? d.period},${given.signal ?? d.signal})`,

      ["psy", "signal"],
    );
    const psyColor = options.colors?.psy ?? PRIMARY_COLOR;
    const signalColor = options.colors?.signal ?? SECONDARY_COLOR;
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, PSY_LEVELS),
    );

    const handles = [
      keep(pane.addSeries({ series: lineSeries(overlayStyle(psyColor)), input: node.out.psy, name: label, color: psyColor })),
      keep(pane.addSeries({ series: lineSeries(overlayStyle(signalColor)), input: node.out.signal, name: `${label} Signal`, color: signalColor })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachBbiLook extends IndicatorNameOption {
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachBbiOptions = AttachFrom<Bbi, BbiOptions, AttachBbiLook>;

/** Mounts BBI on the price pane — one line, labelled with its four windows. */
export function attachBbi(options: AttachBbiOptions): Plugin<SeriesHost, IndicatorApi<Bbi>> {
  requireAttachOptions(options, "attachBbi");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachBbi",
      (given) => bbi(given.source, { periods: given.periods }),
      // The factory has already refused anything but four windows.
      (given) => `BBI(${(given.periods ?? BBI_DEFAULTS.periods).join(",")})`,

      ["bbi"],
    );
    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.bbi,
      name: label,
      color: options.color,
    }));
    return pluginApi({ node }, () => handle.dispose());
  });
}

export interface AttachDmaLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a zero line; the axis stays autoScale. */
  pane?: SeriesHost;
  colors?: { dma?: string; signal?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachDmaOptions = AttachFrom<Dma, DmaOptions, AttachDmaLook>;

/** Mounts DMA and its signal — two lines around a zero line on an own pane. */
export function attachDma(options: AttachDmaOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Dma>> {
  requireAttachOptions(options, "attachDma");
  return (plot) => attempt((keep) => {
    const d = DMA_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachDma",
      (given) => dma(given.source, { fast: given.fast, slow: given.slow, signal: given.signal }),
      (given) => `DMA(${given.fast ?? d.fast},${given.slow ?? d.slow},${given.signal ?? d.signal})`,

      ["dma", "signal"],
    );
    return twoLinesAroundZero(plot, options, keep, node, node.out.dma, node.out.signal, label, options.colors?.dma, options.colors?.signal);
  });
}

export interface AttachBrarLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a line at 100 (the balance point); the axis stays autoScale. */
  pane?: SeriesHost;
  colors?: { br?: string; ar?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachBrarOptions = AttachFrom<Brar, BrarOptions, AttachBrarLook>;

/** Mounts BR and AR — two lines around the 100 line on an own pane. */
export function attachBrar(options: AttachBrarOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Brar>> {
  requireAttachOptions(options, "attachBrar");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachBrar",
      (given) => brar(given.source, { period: given.period }),
      (given) => `BRAR(${given.period ?? BRAR_DEFAULTS.period})`,

      ["ar", "br"],
    );
    const brColor = options.colors?.br ?? PRIMARY_COLOR;
    const arColor = options.colors?.ar ?? SECONDARY_COLOR;
    // 100 is where the two sums balance — the reading, like a zero line. Only on an own pane.
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) => {
      owned.addDecoration(priceLine({ value: 100 }));
    });

    const handles = [
      keep(pane.addSeries({ series: lineSeries(overlayStyle(brColor)), input: node.out.br, name: `${label} BR`, color: brColor })),
      keep(pane.addSeries({ series: lineSeries(overlayStyle(arColor)), input: node.out.ar, name: `${label} AR`, color: arColor })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachCrLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a line at 100 (the balance point); the axis stays autoScale. */
  pane?: SeriesHost;
  /** The band and its four averages. The averages share one colour by default — the legend tells them apart by name (the window from a source, `MA1`…`MA4` or `labels` from a node). */
  colors?: { cr?: string; ma1?: string; ma2?: string; ma3?: string; ma4?: string };
  /**
   * The four averages' legend names. From a source they read `MA(w)` with
   * each window; from a `node` the windows are not known, so they read
   * `MA1`…`MA4` unless you name them here.
   */
  labels?: [string, string, string, string];
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachCrOptions = AttachFrom<Cr, CrOptions, AttachCrLook>;

/** Mounts CR and its four displaced averages — five lines on an own pane, each average labelled with its window. */
export function attachCr(options: AttachCrOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Cr>> {
  requireAttachOptions(options, "attachCr");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachCr",
      (given) => cr(given.source, { period: given.period, periods: given.periods }),
      (given) => `CR(${given.period ?? CR_DEFAULTS.period})`,

      ["cr", "ma1", "ma2", "ma3", "ma4"],
    );
    // The factory has already refused anything but four windows — and a node
    // carries none, so its averages are named by position unless `labels` says.
    const windows = "node" in options ? null : (options.periods ?? CR_DEFAULTS.periods);
    const averageName = (i: 0 | 1 | 2 | 3) =>
      options.labels?.[i] ?? (windows ? `${label} MA(${windows[i]})` : `${label} MA${i + 1}`);
    const crColor = options.colors?.cr ?? PRIMARY_COLOR;
    // 100 is where the two sums balance — the reading, like a zero line. Only on an own pane.
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) => {
      owned.addDecoration(priceLine({ value: 100 }));
    });

    const average = (input: Cr["out"]["ma1"], name: string, color: string) =>
      keep(pane.addSeries({ series: lineSeries(overlayStyle(color)), input, name, color }));
    const handles = [
      keep(pane.addSeries({ series: lineSeries(overlayStyle(crColor)), input: node.out.cr, name: label, color: crColor })),
      average(node.out.ma1, averageName(0), options.colors?.ma1 ?? SECONDARY_COLOR),
      average(node.out.ma2, averageName(1), options.colors?.ma2 ?? SECONDARY_COLOR),
      average(node.out.ma3, averageName(2), options.colors?.ma3 ?? SECONDARY_COLOR),
      average(node.out.ma4, averageName(3), options.colors?.ma4 ?? SECONDARY_COLOR),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export const KDJ_LEVELS = { overbought: 80, oversold: 20 } as const;

export interface AttachKdjLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane with the reference lines; the axis stays autoScale (J runs outside 0–100). */
  pane?: SeriesHost;
  /** Reference lines. Default `KDJ_LEVELS` (80/20); `false` draws none. */
  levels?: OscillatorLevels | false;
  colors?: { k?: string; d?: string; j?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachKdjOptions = AttachFrom<Kdj, KdjOptions, AttachKdjLook>;

/** Mounts KDJ — %K, %D and %J on an own pane whose axis is left to autoScale, as CCI's is. */
export function attachKdj(options: AttachKdjOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Kdj>> {
  requireAttachOptions(options, "attachKdj");
  return (plot) => attempt((keep) => {
    const d = KDJ_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachKdj",
      (given) => kdj(given.source, { period: given.period, smooth: given.smooth, signal: given.signal }),
      (given) => `KDJ(${given.period ?? d.period},${given.smooth ?? d.smooth},${given.signal ?? d.signal})`,

      ["d", "j", "k"],
    );
    const kColor = options.colors?.k ?? PRIMARY_COLOR;
    const dColor = options.colors?.d ?? SECONDARY_COLOR;
    const jColor = options.colors?.j ?? LAGGING_COLOR;
    // J leaves 0–100 (a rebound from oversold reads near 130), so the axis is not fixed — only the lines are drawn.
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, KDJ_LEVELS, null),
    );

    const handles = [
      keep(pane.addSeries({ series: lineSeries(overlayStyle(kColor)), input: node.out.k, name: `${label} %K`, color: kColor })),
      keep(pane.addSeries({ series: lineSeries(overlayStyle(dColor)), input: node.out.d, name: `${label} %D`, color: dColor })),
      keep(pane.addSeries({ series: lineSeries(overlayStyle(jColor)), input: node.out.j, name: `${label} %J`, color: jColor })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachVrLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane; the axis stays autoScale (VR is unbounded above). */
  pane?: SeriesHost;
  colors?: { vr?: string; signal?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachVrOptions = AttachFrom<Vr, VrOptions, AttachVrLook>;

/** Mounts VR and its signal — two lines on an own pane. */
export function attachVr(options: AttachVrOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Vr>> {
  requireAttachOptions(options, "attachVr");
  return (plot) => attempt((keep) => {
    const d = VR_DEFAULTS;
    const { node, label } = attachInputs(
      options,
      "attachVr",
      (given) => vr(given.source, { period: given.period, signal: given.signal }),
      (given) => `VR(${given.period ?? d.period},${given.signal ?? d.signal})`,

      ["signal", "vr"],
    );
    const vrColor = options.colors?.vr ?? PRIMARY_COLOR;
    const signalColor = options.colors?.signal ?? SECONDARY_COLOR;
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);

    const handles = [
      keep(pane.addSeries({ series: lineSeries(overlayStyle(vrColor)), input: node.out.vr, name: label, color: vrColor })),
      keep(pane.addSeries({ series: lineSeries(overlayStyle(signalColor)), input: node.out.signal, name: `${label} Signal`, color: signalColor })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachEmvLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane, with a zero line; the axis stays autoScale. */
  pane?: SeriesHost;
  colors?: { emv?: string; signal?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachEmvOptions = AttachFrom<Emv, EmvOptions, AttachEmvLook>;

/** Mounts EMV and its signal — two lines around a zero line on an own pane. */
export function attachEmv(options: AttachEmvOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Emv>> {
  requireAttachOptions(options, "attachEmv");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachEmv",
      (given) => emv(given.source, { period: given.period }),
      (given) => `EMV(${given.period ?? EMV_DEFAULTS.period})`,

      ["emv", "signal"],
    );
    return twoLinesAroundZero(plot, options, keep, node, node.out.emv, node.out.signal, label, options.colors?.emv, options.colors?.signal);
  });
}

export interface AttachPvtLook extends OwnedPaneOptions, IndicatorNameOption {
  /** Omit it to create a new pane — a running sum on its own scale; the axis stays autoScale. */
  pane?: SeriesHost;
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachPvtOptions = AttachFrom<Pvt, unknown, AttachPvtLook>;

/** Mounts PVT — one line on an own pane, like OBV. */
export function attachPvt(options: AttachPvtOptions): Plugin<PaneHost, OwnedPaneIndicatorApi<Pvt>> {
  requireAttachOptions(options, "attachPvt");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachPvt",
      (given) => pvt(given.source),
      () => "PVT",

      ["pvt"],
    );
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);
    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.pvt,
      name: label,
      color: options.color,
    }));
    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachVwapLook extends IndicatorNameOption {
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachVwapOptions = AttachFrom<Vwap, VwapOptions, AttachVwapLook>;

/** Mounts VWAP on that pane — usually `mainPane`, since it shares price's axis. */
export function attachVwap(
  options: AttachVwapOptions,
): Plugin<SeriesHost, IndicatorApi<Vwap>> {
  requireAttachOptions(options, "attachVwap");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachVwap",
      (given) => vwap(given.source, { anchor: given.anchor }),
      () => "VWAP",

      ["vwap"],
    );
    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.vwap,
      name: label,
      color: options.color,
    }));

    return pluginApi({ node }, () => handle.dispose());
  });
}

export interface AttachObvLook extends OwnedPaneOptions, IndicatorNameOption {
  /**
   * Omit it to create a new pane — OBV accumulates volume, on a
   * different scale. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachObvOptions = AttachFrom<Obv, unknown, AttachObvLook>;

export function attachObv(
  options: AttachObvOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Obv>> {
  requireAttachOptions(options, "attachObv");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachObv",
      (given) => obv(given.source),
      () => "OBV",

      ["obv"],
    );

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);

    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.obv,
      name: label,
      color: options.color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachAdxLook extends OwnedPaneOptions, IndicatorNameOption {
  /**
   * Omit it to create a new pane — DI runs 0 to 100, but that's not a
   * fixed contract, so the axis stays autoScale. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  colors?: { adx?: string; plusDi?: string; minusDi?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachAdxOptions = AttachFrom<Adx, AdxOptions, AttachAdxLook>;

export function attachAdx(
  options: AttachAdxOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Adx>> {
  requireAttachOptions(options, "attachAdx");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachAdx",
      (given) => adx(given.source, { period: given.period }),
      (given) => `ADX(${given.period ?? ADX_DEFAULTS.period})`,

      ["adx", "minusDi", "plusDi"],
    );

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep);

    // Direction colors follow convention — +DI takes the up color, -DI the down color.
    const adxColor = options.colors?.adx ?? PRIMARY_COLOR;
    const plusColor = options.colors?.plusDi ?? UP_COLOR;
    const minusColor = options.colors?.minusDi ?? DOWN_COLOR;
    const handles = [
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(adxColor)),
        input: node.out.adx,
        name: label,
        color: adxColor,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(plusColor)),
        input: node.out.plusDi,
        name: `${label} +DI`,
        color: plusColor,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(minusColor)),
        input: node.out.minusDi,
        name: `${label} -DI`,
        color: minusColor,
      })),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachIchimokuLook extends IndicatorNameOption {
  colors?: {
    conversion?: string;
    base?: string;
    spanA?: string;
    spanB?: string;
    lagging?: string;
  };
  /** The cloud fill — the same options as bandSeries. */
  cloud?: BandSeriesOptions;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachIchimokuOptions = AttachFrom<Ichimoku, IchimokuOptions, AttachIchimokuLook>;

/** Mounts Ichimoku on that pane — an overlay on price. */
export function attachIchimoku(
  options: AttachIchimokuOptions,
): Plugin<SeriesHost, IndicatorApi<Ichimoku>> {
  requireAttachOptions(options, "attachIchimoku");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachIchimoku",
      (given) => ichimoku(given.source, {
        conversion: given.conversion,
        base: given.base,
        span: given.span,
        displacement: given.displacement,
        ahead: given.ahead,
      }),
      (given) => `Ichimoku(${given.conversion ?? ICHIMOKU_DEFAULTS.conversion},${given.base ?? ICHIMOKU_DEFAULTS.base},${given.span ?? ICHIMOKU_DEFAULTS.span})`,

      ["base", "cloud", "conversion", "lagging", "spanA", "spanB"],
    );
    // If all five lines defaulted to the same color, they'd be
    // indistinguishable — the convention palette: conversion/base take
    // the MACD pair (blue/orange), spans take the direction colors
    // (green/red).
    const lines: [
      "conversion" | "base" | "spanA" | "spanB" | "lagging",
      string,
      string,
    ][] = [
      ["conversion", options.colors?.conversion ?? PRIMARY_COLOR, "Conversion"],
      ["base", options.colors?.base ?? SECONDARY_COLOR, "Base"],
      ["spanA", options.colors?.spanA ?? UP_COLOR, "Span A"],
      ["spanB", options.colors?.spanB ?? DOWN_COLOR, "Span B"],
      ["lagging", options.colors?.lagging ?? LAGGING_COLOR, "Lagging"],
    ];

    const handles = [
      // The cloud is zIndex -1 — it sits under the candles.
      keep(pane.addSeries({
        series: bandSeries(options.cloud),
        input: node.out.cloud,
        zIndex: -1,
        // Drawn for the eye — a tooltip row reading an edge value with no name says nothing.
        readout: false,
      })),
      ...lines.map(([branch, color, part]) =>
        keep(pane.addSeries({
          series: lineSeries(overlayStyle(color)),
          input: node.out[branch],
          name: `${label} ${part}`,
          color,
        })),
      ),
    ];

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  });
}

export interface AttachParabolicSarLook extends IndicatorNameOption {
  color?: string;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachParabolicSarOptions = AttachFrom<ParabolicSar, ParabolicSarOptions, AttachParabolicSarLook>;

/**
 * Mounts SAR on that pane as dots — no new series type; lineSeries's
 * style already supports points. The line is transparent, leaving only
 * the dots.
 */
export function attachParabolicSar(
  options: AttachParabolicSarOptions,
): Plugin<SeriesHost, IndicatorApi<ParabolicSar>> {
  requireAttachOptions(options, "attachParabolicSar");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachParabolicSar",
      (given) => parabolicSar(given.source, {
        step: given.step,
        max: given.max,
      }),
      (given) => `SAR(${given.step ?? PARABOLIC_SAR_DEFAULTS.step},${given.max ?? PARABOLIC_SAR_DEFAULTS.max})`,

      ["sar"],
    );
    const color = options.color ?? PRIMARY_COLOR;

    const handle = keep(pane.addSeries({
      series: lineSeries({
        line: { color: "rgba(0, 0, 0, 0)" },
        point: { radius: 2.5, color },
      }),
      input: node.out.sar,
      name: label,
      color,
    }));

    return pluginApi({ node }, () => handle.dispose());
  });
}

export interface AttachCciLook extends OwnedPaneOptions, IndicatorNameOption {
  color?: string;
  /** Reference lines. Default ±100. `false` skips them. */
  levels?: OscillatorLevels | false;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachCciOptions = AttachFrom<Cci, CciOptions, AttachCciLook>;

export function attachCci(
  options: AttachCciOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Cci>> {
  requireAttachOptions(options, "attachCci");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachCci",
      (given) => cci(given.source, { period: given.period }),
      (given) => `CCI(${given.period ?? CCI_DEFAULTS.period})`,

      ["cci"],
    );
    const color = options.color ?? PRIMARY_COLOR;

    // CCI is unbounded — leave the axis to autoScale (pinning ±100 as
    // the domain would clip spikes) and only draw the reference lines.
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(owned, options.levels, CCI_LEVELS, null),
    );

    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.cci,
      name: label,
      color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachWilliamsRLook extends OwnedPaneOptions, IndicatorNameOption {
  color?: string;
  /** Reference lines. Default −20/−80. `false` skips them. */
  levels?: OscillatorLevels | false;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachWilliamsROptions = AttachFrom<WilliamsR, WilliamsROptions, AttachWilliamsRLook>;

export function attachWilliamsR(
  options: AttachWilliamsROptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<WilliamsR>> {
  requireAttachOptions(options, "attachWilliamsR");
  return (plot) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachWilliamsR",
      (given) => williamsR(given.source, { period: given.period }),
      (given) => `%R(${given.period ?? WILLIAMS_R_DEFAULTS.period})`,

      ["r"],
    );
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, keep, (owned) =>
      wireOscillatorPane(
        owned,
        options.levels,
        WILLIAMS_R_LEVELS,
        [-100, 0], // %R's domain — the mirror of RSI's 0..100
      ),
    );

    const handle = keep(pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.r,
      name: label,
      color,
    }));

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  });
}

export interface AttachDonchianLook extends IndicatorNameOption {
  colors?: { middle?: string; edges?: string };
  band?: BandSeriesOptions;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachDonchianOptions = AttachFrom<DonchianChannels, DonchianOptions, AttachDonchianLook>;

/** Mounts the channel on that pane — usually `mainPane`, since it shares price's axis. */
export function attachDonchianChannels(
  options: AttachDonchianOptions,
): Plugin<SeriesHost, IndicatorApi<DonchianChannels>> {
  requireAttachOptions(options, "attachDonchianChannels");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachDonchianChannels",
      (given) => donchianChannels(given.source, { period: given.period }),
      (given) => `DC(${given.period ?? DONCHIAN_DEFAULTS.period})`,

      ["band", "lower", "middle", "upper"],
    );
    return pluginApi({ node }, wireChannel(pane, keep, node, label, options));
  });
}

export interface AttachKeltnerLook extends IndicatorNameOption {
  colors?: { middle?: string; edges?: string };
  band?: BandSeriesOptions;
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachKeltnerOptions = AttachFrom<KeltnerChannels, KeltnerOptions, AttachKeltnerLook>;

/** Mounts Keltner Channels on that pane — the same mold as Bollinger. */
export function attachKeltnerChannels(
  options: AttachKeltnerOptions,
): Plugin<SeriesHost, IndicatorApi<KeltnerChannels>> {
  requireAttachOptions(options, "attachKeltnerChannels");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachKeltnerChannels",
      (given) => keltnerChannels(given.source, {
        period: given.period,
        multiplier: given.multiplier,
        atrPeriod: given.atrPeriod,
      }),
      (given) => `KC(${given.period ?? KELTNER_DEFAULTS.period},${given.multiplier ?? KELTNER_DEFAULTS.multiplier})`,

      ["band", "lower", "middle", "upper"],
    );
    return pluginApi({ node }, wireChannel(pane, keep, node, label, options));
  });
}

/**
 * The shared wiring for a channel (middle line + upper/lower + fill) —
 * the same shape Bollinger laid down first (fill at zIndex −1). Returns a
 * dispose function.
 */
function wireChannel(
  pane: SeriesHost,
  keep: Keep,
  node: DonchianChannels | KeltnerChannels,
  label: string,
  options: { colors?: { middle?: string; edges?: string }; band?: BandSeriesOptions },
): () => void {
  // This is an internal helper, so it doesn't take a source — it's `requireOptions`, not `requireAttachOptions`.
  requireOptions(options, "attachKeltnerChannels");
  const handles = [
    keep(pane.addSeries({
      series: bandSeries(options.band),
      input: node.out.band,
      zIndex: -1,
      // Drawn for the eye — a tooltip row reading an edge value with no name says nothing.
      readout: false,
    })),
    keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.colors?.edges)),
      input: node.out.upper,
      name: `${label} Upper`,
      color: options.colors?.edges,
    })),
    keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.colors?.middle)),
      input: node.out.middle,
      name: label,
      color: options.colors?.middle,
    })),
    keep(pane.addSeries({
      series: lineSeries(overlayStyle(options.colors?.edges)),
      input: node.out.lower,
      name: `${label} Lower`,
      color: options.colors?.edges,
    })),
  ];
  return () => {
    for (const handle of handles) handle.dispose();
  };
}

export interface AttachSuperTrendLook extends IndicatorNameOption {
  colors?: { up?: string; down?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachSuperTrendOptions = AttachFrom<SuperTrend, SuperTrendOptions, AttachSuperTrendLook>;

/**
 * Mounts SuperTrend on that pane — the two branches, the uptrend support
 * (up) and downtrend resistance (down), are each null over the other's
 * regime, so two differently colored lines alternate. The default colors
 * are the up/down palette — direction is the whole meaning of this
 * indicator.
 */
export function attachSuperTrend(
  options: AttachSuperTrendOptions,
): Plugin<SeriesHost, IndicatorApi<SuperTrend>> {
  requireAttachOptions(options, "attachSuperTrend");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachSuperTrend",
      (given) => superTrend(given.source, {
        period: given.period,
        multiplier: given.multiplier,
      }),
      (given) => `ST(${given.period ?? SUPERTREND_DEFAULTS.period},${given.multiplier ?? SUPERTREND_DEFAULTS.multiplier})`,

      ["down", "up"],
    );
    const upColor = options.colors?.up ?? UP_COLOR;
    const downColor = options.colors?.down ?? DOWN_COLOR;
    const handles = [
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(upColor)),
        input: node.out.up,
        name: `${label} Up`,
        color: upColor,
      })),
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(downColor)),
        input: node.out.down,
        name: `${label} Down`,
        color: downColor,
      })),
    ];

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  });
}

export interface AttachPivotPointsLook extends IndicatorNameOption {
  /**
   * How many tiers to draw — 1 gives the pivot (P) and the first
   * resistance and support (R1, S1); 3 goes out to the third pair (R3, S3).
   * Default 2. This is where the consumer controls the legend row count
   * (3 tiers = 7 rows is too much for a default).
   */
  depth?: 1 | 2 | 3;
  colors?: { p?: string; r?: string; s?: string };
}

/** From a `source` and the factory's options, or from a `node` you built — then `name` is yours to give. */
export type AttachPivotPointsOptions = AttachFrom<PivotPoints, PivotPointsOptions, AttachPivotPointsLook>;

/**
 * Mounts Pivot Points on that pane — the period boundary (`anchor`) is
 * the consumer's knowledge. P is the axis, R is resistance (down color),
 * S is support (up color).
 */
export function attachPivotPoints(
  options: AttachPivotPointsOptions,
): Plugin<SeriesHost, IndicatorApi<PivotPoints>> {
  requireAttachOptions(options, "attachPivotPoints");
  return (pane) => attempt((keep) => {
    const { node, label } = attachInputs(
      options,
      "attachPivotPoints",
      (given) => pivotPoints(given.source, { anchor: given.anchor }),
      () => "Pivot",

      ["p", "r1", "r2", "r3", "s1", "s2", "s3"],
    );
    const depth = options.depth ?? PIVOT_POINTS_DEFAULTS.depth;
    // "P" alone can't tell a daily pivot from a weekly one — the head names the indicator.
    const pColor = options.colors?.p ?? SECONDARY_COLOR;
    const rColor = options.colors?.r ?? DOWN_COLOR;
    const sColor = options.colors?.s ?? UP_COLOR;

    const levels: {
      input: PivotPoints["out"][keyof PivotPoints["out"]];
      name: string;
      color: string;
    }[] = [{ input: node.out.p, name: `${label} P`, color: pColor }];
    const tiers = [
      [node.out.r1, node.out.s1, 1],
      [node.out.r2, node.out.s2, 2],
      [node.out.r3, node.out.s3, 3],
    ] as const;
    for (const [resistance, support, tier] of tiers.slice(0, depth)) {
      levels.push(
        { input: resistance, name: `${label} R${tier}`, color: rColor },
        { input: support, name: `${label} S${tier}`, color: sColor },
      );
    }

    const handles = levels.map((level) =>
      keep(pane.addSeries({
        series: lineSeries(overlayStyle(level.color)),
        input: level.input,
        name: level.name,
        color: level.color,
      })),
    );

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  });
}
