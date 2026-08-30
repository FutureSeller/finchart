import { requireAttachOptions, requireOptions } from "./kernels";
import type {
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
  Macd,
  MacdOptions,
  MovingAverage,
  MovingAverageOptions,
  Ichimoku,
  IchimokuOptions,
  Obv,
  ParabolicSar,
  ParabolicSarOptions,
  Rsi,
  RsiOptions,
  Stochastic,
  StochasticOptions,
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
  MACD_DEFAULTS,
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
  rsi,
  stochastic,
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
// a different layer. The names are roles, not colors.
const PRIMARY_COLOR = "#3b82f6";
const SECONDARY_COLOR = "#f59e0b";
const UP_COLOR = "#10b981";
const DOWN_COLOR = "#ef4444";
const LAGGING_COLOR = "#8b5cf6";

/**
 * The default pivot tier count — a display default rather than a
 * computation one, so it lives here alongside the palette (3 tiers means
 * 7 legend rows, which is too much for a default).
 */
const PIVOT_DEPTH_DEFAULT = 2;

/**
 * The default layout for an own pane — the six pane-owning indicators
 * share the same spot. flex 0.35 is the domain default for "a secondary
 * pane is smaller than the main one" (with equal flex, stacking even a
 * few panes squeezes the price pane down to the same size). Per-indicator
 * differentiation isn't decided yet.
 */
const OWNED_PANE_LAYOUT = { flex: 0.35, minHeight: 60 } as const;

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
  ownPane?: { flex?: number; minHeight?: number };
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
  });
  wire?.(owned);
  return {
    pane: owned,
    ownedPaneApi: owned,
    disposeOwned: () => plot.removePane(owned),
  };
}

export interface AttachMovingAverageOptions extends MovingAverageOptions {
  source: Source<OHLC>;
  color?: string;
}

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
  return (pane) => {
    const node = movingAverage(options.source, {
      period: options.period,
      type: options.type,
    });
    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.ma,
      // The label follows the formula — writing MA(20) for an EMA would be a lie.
      name: `${options.type === "ema" ? "EMA" : "MA"}(${options.period})`,
      color: options.color,
    });

    return pluginApi({ node }, () => handle.dispose());
  };
}

export interface AttachMacdOptions extends MacdOptions, OwnedPaneOptions {
  source: Source<OHLC>;
  /**
   * Which pane to mount on. Omit it to create a new pane — MACD's scale
   * differs from price, so overlapping them breaks the value axis. Size
   * it with `ownPane`.
   */
  pane?: SeriesHost;
  colors?: { macd?: string; signal?: string; histogram?: string };
}

export function attachMacd(
  options: AttachMacdOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Macd>> {
  requireAttachOptions(options, "attachMacd");
  return (plot) => {
    const node = macd(options.source, {
      fast: options.fast,
      slow: options.slow,
      signal: options.signal,
    });

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options);

    // If both lines defaulted to the same color, there'd be no way to tell which is the signal.
    const macdColor = options.colors?.macd ?? PRIMARY_COLOR;
    const signalColor = options.colors?.signal ?? SECONDARY_COLOR;
    // The default label reads from the same source as the computation default (the factory's *_DEFAULTS).
    const label = `MACD(${options.fast ?? MACD_DEFAULTS.fast},${options.slow ?? MACD_DEFAULTS.slow},${options.signal ?? MACD_DEFAULTS.signal})`;

    const handles = [
      // The histogram is a bar series that grows from 0.
      pane.addSeries({
        series: histogramSeries({
          style: options.colors?.histogram
            ? { color: options.colors.histogram }
            : undefined,
        }),
        input: node.out.histogram,
        name: `${label} Histogram`,
        color: options.colors?.histogram,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(macdColor)),
        input: node.out.macd,
        name: label,
        color: macdColor,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(signalColor)),
        input: node.out.signal,
        name: `${label} Signal`,
        color: signalColor,
      }),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachBollingerOptions extends BollingerOptions {
  source: Source<OHLC>;
  colors?: { middle?: string; edges?: string };
  band?: BandSeriesOptions;
}

/** Mounts the band on that pane — usually `mainPane`, since it shares price's axis. */
export function attachBollingerBands(
  options: AttachBollingerOptions,
): Plugin<SeriesHost, IndicatorApi<BollingerBands>> {
  requireAttachOptions(options, "attachBollingerBands");
  return (pane) => {
    const node = bollingerBands(options.source, {
      period: options.period,
      multiplier: options.multiplier,
    });
    const label = `BB(${options.period ?? BOLLINGER_DEFAULTS.period},${options.multiplier ?? BOLLINGER_DEFAULTS.multiplier})`;

    const handles = [
      // The fill is zIndex -1 — even toggled on late, it sits under the
      // candles. The lines register after it, so they show above the band.
      pane.addSeries({
        series: bandSeries(options.band),
        input: node.out.band,
        zIndex: -1,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(options.colors?.edges)),
        input: node.out.upper,
        name: `${label} Upper`,
        color: options.colors?.edges,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(options.colors?.middle)),
        input: node.out.middle,
        name: label,
        color: options.colors?.middle,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(options.colors?.edges)),
        input: node.out.lower,
        name: `${label} Lower`,
        color: options.colors?.edges,
      }),
    ];

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  };
}

/** Oscillator reference lines. Change the values or turn them off with `false`. */
export interface OscillatorLevels {
  overbought?: number;
  oversold?: number;
}

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

export interface AttachRsiOptions extends RsiOptions, OwnedPaneOptions {
  source: Source<OHLC>;
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

export function attachRsi(
  options: AttachRsiOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Rsi>> {
  requireAttachOptions(options, "attachRsi");
  return (plot) => {
    const node = rsi(options.source, { period: options.period });
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, (owned) =>
      wireOscillatorPane(owned, options.levels, { overbought: 70, oversold: 30 }),
    );

    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.rsi,
      name: `RSI(${options.period ?? RSI_DEFAULTS.period})`,
      color,
    });

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachAtrOptions extends AtrOptions, OwnedPaneOptions {
  source: Source<OHLC>;
  /**
   * Omit it to create a new pane — ATR is a volatility measure, on a
   * different scale from price. It's not an oscillator, so the axis
   * stays autoScale. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  color?: string;
}

export function attachAtr(
  options: AttachAtrOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Atr>> {
  requireAttachOptions(options, "attachAtr");
  return (plot) => {
    const node = atr(options.source, { period: options.period });
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options);

    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.atr,
      name: `ATR(${options.period ?? ATR_DEFAULTS.period})`,
      color,
    });

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachStochasticOptions
  extends StochasticOptions,
    OwnedPaneOptions {
  source: Source<OHLC>;
  /**
   * Omit it to create a new pane, wired with a fixed 0-100 axis and
   * reference lines too. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  colors?: { k?: string; d?: string };
  /** The reference line values. Default 80/20. Drawn only for an own pane. */
  levels?: OscillatorLevels | false;
}

export function attachStochastic(
  options: AttachStochasticOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Stochastic>> {
  requireAttachOptions(options, "attachStochastic");
  return (plot) => {
    const node = stochastic(options.source, {
      period: options.period,
      smooth: options.smooth,
      signal: options.signal,
    });

    const kColor = options.colors?.k ?? PRIMARY_COLOR;
    const dColor = options.colors?.d ?? SECONDARY_COLOR;
    const label = `Stoch(${options.period ?? STOCHASTIC_DEFAULTS.period},${options.smooth ?? STOCHASTIC_DEFAULTS.smooth},${options.signal ?? STOCHASTIC_DEFAULTS.signal})`;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, (owned) =>
      wireOscillatorPane(owned, options.levels, { overbought: 80, oversold: 20 }),
    );

    const handles = [
      pane.addSeries({
        series: lineSeries(overlayStyle(kColor)),
        input: node.out.k,
        name: `${label} %K`,
        color: kColor,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(dColor)),
        input: node.out.d,
        name: `${label} %D`,
        color: dColor,
      }),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachVwapOptions extends VwapOptions {
  source: Source<OHLC>;
  color?: string;
}

/** Mounts VWAP on that pane — usually `mainPane`, since it shares price's axis. */
export function attachVwap(
  options: AttachVwapOptions,
): Plugin<SeriesHost, IndicatorApi<Vwap>> {
  requireAttachOptions(options, "attachVwap");
  return (pane) => {
    const node = vwap(options.source, { anchor: options.anchor });
    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.vwap,
      name: "VWAP",
      color: options.color,
    });

    return pluginApi({ node }, () => handle.dispose());
  };
}

export interface AttachObvOptions extends OwnedPaneOptions {
  source: Source<OHLC>;
  /**
   * Omit it to create a new pane — OBV accumulates volume, on a
   * different scale. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  color?: string;
}

export function attachObv(
  options: AttachObvOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Obv>> {
  requireAttachOptions(options, "attachObv");
  return (plot) => {
    const node = obv(options.source);

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options);

    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(options.color)),
      input: node.out.obv,
      name: "OBV",
      color: options.color,
    });

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachAdxOptions extends AdxOptions, OwnedPaneOptions {
  source: Source<OHLC>;
  /**
   * Omit it to create a new pane — DI runs 0 to 100, but that's not a
   * fixed contract, so the axis stays autoScale. Size it with `ownPane`.
   */
  pane?: SeriesHost;
  colors?: { adx?: string; plusDi?: string; minusDi?: string };
}

export function attachAdx(
  options: AttachAdxOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Adx>> {
  requireAttachOptions(options, "attachAdx");
  return (plot) => {
    const node = adx(options.source, { period: options.period });

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options);

    // Direction colors follow convention — +DI takes the up color, -DI the down color.
    const adxColor = options.colors?.adx ?? PRIMARY_COLOR;
    const plusColor = options.colors?.plusDi ?? UP_COLOR;
    const minusColor = options.colors?.minusDi ?? DOWN_COLOR;
    const period = options.period ?? ADX_DEFAULTS.period;

    const handles = [
      pane.addSeries({
        series: lineSeries(overlayStyle(adxColor)),
        input: node.out.adx,
        name: `ADX(${period})`,
        color: adxColor,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(plusColor)),
        input: node.out.plusDi,
        name: `+DI(${period})`,
        color: plusColor,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(minusColor)),
        input: node.out.minusDi,
        name: `-DI(${period})`,
        color: minusColor,
      }),
    ];

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      for (const handle of handles) handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachIchimokuOptions extends IchimokuOptions {
  source: Source<OHLC>;
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

/** Mounts Ichimoku on that pane — an overlay on price. */
export function attachIchimoku(
  options: AttachIchimokuOptions,
): Plugin<SeriesHost, IndicatorApi<Ichimoku>> {
  requireAttachOptions(options, "attachIchimoku");
  return (pane) => {
    const node = ichimoku(options.source, {
      conversion: options.conversion,
      base: options.base,
      span: options.span,
      displacement: options.displacement,
    });
    const label = `Ichimoku(${options.conversion ?? ICHIMOKU_DEFAULTS.conversion},${options.base ?? ICHIMOKU_DEFAULTS.base},${options.span ?? ICHIMOKU_DEFAULTS.span})`;

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
      pane.addSeries({
        series: bandSeries(options.cloud),
        input: node.out.cloud,
        zIndex: -1,
      }),
      ...lines.map(([branch, color, part]) =>
        pane.addSeries({
          series: lineSeries(overlayStyle(color)),
          input: node.out[branch],
          name: `${label} ${part}`,
          color,
        }),
      ),
    ];

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  };
}

export interface AttachParabolicSarOptions extends ParabolicSarOptions {
  source: Source<OHLC>;
  color?: string;
}

/**
 * Mounts SAR on that pane as dots — no new series type; lineSeries's
 * style already supports points. The line is transparent, leaving only
 * the dots.
 */
export function attachParabolicSar(
  options: AttachParabolicSarOptions,
): Plugin<SeriesHost, IndicatorApi<ParabolicSar>> {
  requireAttachOptions(options, "attachParabolicSar");
  return (pane) => {
    const node = parabolicSar(options.source, {
      step: options.step,
      max: options.max,
    });
    const color = options.color ?? PRIMARY_COLOR;

    const handle = pane.addSeries({
      series: lineSeries({
        line: { color: "rgba(0, 0, 0, 0)" },
        point: { radius: 2.5, color },
      }),
      input: node.out.sar,
      name: `SAR(${options.step ?? PARABOLIC_SAR_DEFAULTS.step},${options.max ?? PARABOLIC_SAR_DEFAULTS.max})`,
      color,
    });

    return pluginApi({ node }, () => handle.dispose());
  };
}

export interface AttachCciOptions extends CciOptions, OwnedPaneOptions {
  source: Source<OHLC>;
  color?: string;
  /** Reference lines. Default ±100. `false` skips them. */
  levels?: OscillatorLevels | false;
}

export function attachCci(
  options: AttachCciOptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<Cci>> {
  requireAttachOptions(options, "attachCci");
  return (plot) => {
    const node = cci(options.source, { period: options.period });
    const color = options.color ?? PRIMARY_COLOR;

    // CCI is unbounded — leave the axis to autoScale (pinning ±100 as
    // the domain would clip spikes) and only draw the reference lines.
    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, (owned) =>
      wireOscillatorPane(owned, options.levels, { overbought: 100, oversold: -100 }, null),
    );

    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.cci,
      name: `CCI(${options.period ?? CCI_DEFAULTS.period})`,
      color,
    });

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachWilliamsROptions extends WilliamsROptions, OwnedPaneOptions {
  source: Source<OHLC>;
  color?: string;
  /** Reference lines. Default −20/−80. `false` skips them. */
  levels?: OscillatorLevels | false;
}

export function attachWilliamsR(
  options: AttachWilliamsROptions,
): Plugin<PaneHost, OwnedPaneIndicatorApi<WilliamsR>> {
  requireAttachOptions(options, "attachWilliamsR");
  return (plot) => {
    const node = williamsR(options.source, { period: options.period });
    const color = options.color ?? PRIMARY_COLOR;

    const { pane, ownedPaneApi, disposeOwned } = ownedPane(plot, options, (owned) =>
      wireOscillatorPane(
        owned,
        options.levels,
        { overbought: -20, oversold: -80 },
        [-100, 0], // %R's domain — the mirror of RSI's 0..100
      ),
    );

    const handle = pane.addSeries({
      series: lineSeries(overlayStyle(color)),
      input: node.out.r,
      name: `%R(${options.period ?? WILLIAMS_R_DEFAULTS.period})`,
      color,
    });

    return pluginApi({ node, pane: ownedPaneApi }, () => {
      handle.dispose();
      disposeOwned();
    });
  };
}

export interface AttachDonchianOptions extends DonchianOptions {
  source: Source<OHLC>;
  colors?: { middle?: string; edges?: string };
  band?: BandSeriesOptions;
}

/** Mounts the channel on that pane — usually `mainPane`, since it shares price's axis. */
export function attachDonchianChannels(
  options: AttachDonchianOptions,
): Plugin<SeriesHost, IndicatorApi<DonchianChannels>> {
  requireAttachOptions(options, "attachDonchianChannels");
  return (pane) => {
    const node = donchianChannels(options.source, { period: options.period });
    const label = `DC(${options.period ?? DONCHIAN_DEFAULTS.period})`;
    return pluginApi({ node }, wireChannel(pane, node, label, options));
  };
}

export interface AttachKeltnerOptions extends KeltnerOptions {
  source: Source<OHLC>;
  colors?: { middle?: string; edges?: string };
  band?: BandSeriesOptions;
}

/** Mounts Keltner Channels on that pane — the same mold as Bollinger. */
export function attachKeltnerChannels(
  options: AttachKeltnerOptions,
): Plugin<SeriesHost, IndicatorApi<KeltnerChannels>> {
  requireAttachOptions(options, "attachKeltnerChannels");
  return (pane) => {
    const node = keltnerChannels(options.source, {
      period: options.period,
      multiplier: options.multiplier,
      atrPeriod: options.atrPeriod,
    });
    const label = `KC(${options.period ?? KELTNER_DEFAULTS.period},${options.multiplier ?? KELTNER_DEFAULTS.multiplier})`;
    return pluginApi({ node }, wireChannel(pane, node, label, options));
  };
}

/**
 * The shared wiring for a channel (middle line + upper/lower + fill) —
 * the same shape Bollinger laid down first (fill at zIndex −1). Returns a
 * dispose function.
 */
function wireChannel(
  pane: SeriesHost,
  node: DonchianChannels | KeltnerChannels,
  label: string,
  options: { colors?: { middle?: string; edges?: string }; band?: BandSeriesOptions },
): () => void {
  // This is an internal helper, so it doesn't take a source — it's `requireOptions`, not `requireAttachOptions`.
  requireOptions(options, "attachKeltnerChannels");
  const handles = [
    pane.addSeries({
      series: bandSeries(options.band),
      input: node.out.band,
      zIndex: -1,
    }),
    pane.addSeries({
      series: lineSeries(overlayStyle(options.colors?.edges)),
      input: node.out.upper,
      name: `${label} Upper`,
      color: options.colors?.edges,
    }),
    pane.addSeries({
      series: lineSeries(overlayStyle(options.colors?.middle)),
      input: node.out.middle,
      name: label,
      color: options.colors?.middle,
    }),
    pane.addSeries({
      series: lineSeries(overlayStyle(options.colors?.edges)),
      input: node.out.lower,
      name: `${label} Lower`,
      color: options.colors?.edges,
    }),
  ];
  return () => {
    for (const handle of handles) handle.dispose();
  };
}

export interface AttachSuperTrendOptions extends SuperTrendOptions {
  source: Source<OHLC>;
  colors?: { up?: string; down?: string };
}

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
  return (pane) => {
    const node = superTrend(options.source, {
      period: options.period,
      multiplier: options.multiplier,
    });
    const upColor = options.colors?.up ?? UP_COLOR;
    const downColor = options.colors?.down ?? DOWN_COLOR;
    const label = `ST(${options.period ?? SUPERTREND_DEFAULTS.period},${options.multiplier ?? SUPERTREND_DEFAULTS.multiplier})`;

    const handles = [
      pane.addSeries({
        series: lineSeries(overlayStyle(upColor)),
        input: node.out.up,
        name: `${label} Up`,
        color: upColor,
      }),
      pane.addSeries({
        series: lineSeries(overlayStyle(downColor)),
        input: node.out.down,
        name: `${label} Down`,
        color: downColor,
      }),
    ];

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  };
}

export interface AttachPivotPointsOptions extends PivotPointsOptions {
  source: Source<OHLC>;
  /**
   * How many tiers to draw — 1 gives the pivot (P) and the first
   * resistance and support (R1, S1); 3 goes out to the third pair (R3, S3).
   * Default 2. This is where the consumer controls the legend row count
   * (3 tiers = 7 rows is too much for a default).
   */
  depth?: 1 | 2 | 3;
  colors?: { p?: string; r?: string; s?: string };
}

/**
 * Mounts Pivot Points on that pane — the period boundary (`anchor`) is
 * the consumer's knowledge. P is the axis, R is resistance (down color),
 * S is support (up color).
 */
export function attachPivotPoints(
  options: AttachPivotPointsOptions,
): Plugin<SeriesHost, IndicatorApi<PivotPoints>> {
  requireAttachOptions(options, "attachPivotPoints");
  return (pane) => {
    const node = pivotPoints(options.source, { anchor: options.anchor });
    const depth = options.depth ?? PIVOT_DEPTH_DEFAULT;
    const pColor = options.colors?.p ?? SECONDARY_COLOR;
    const rColor = options.colors?.r ?? DOWN_COLOR;
    const sColor = options.colors?.s ?? UP_COLOR;

    const levels: {
      input: PivotPoints["out"][keyof PivotPoints["out"]];
      name: string;
      color: string;
    }[] = [{ input: node.out.p, name: "P", color: pColor }];
    const tiers = [
      [node.out.r1, node.out.s1, 1],
      [node.out.r2, node.out.s2, 2],
      [node.out.r3, node.out.s3, 3],
    ] as const;
    for (const [resistance, support, tier] of tiers.slice(0, depth)) {
      levels.push(
        { input: resistance, name: `R${tier}`, color: rColor },
        { input: support, name: `S${tier}`, color: sColor },
      );
    }

    const handles = levels.map((level) =>
      pane.addSeries({
        series: lineSeries(overlayStyle(level.color)),
        input: level.input,
        name: level.name,
        color: level.color,
      }),
    );

    return pluginApi({ node }, () => {
      for (const handle of handles) handle.dispose();
    });
  };
}
