import type {
  BaseDataPoint,
  Computation,
  ComputationSpec,
  HistogramPoint,
  LineDataPoint,
  OHLC,
  Source,
} from "@finchart/core";
import { computation, reuseUnchanged } from "@finchart/core";
import {
  decayHorizon,
  ema,
  highest,
  lowest,
  meanAbsDeviation,
  requireOptions,
  rma,
  sma,
  stddev,
  emaFold,
  smaFold,
} from "./kernels";
import type { ExtremumFold, LagFold, LinregFold, RecursiveFold, RecursiveState, SeededRecursiveFold, SmaFold, StddevFold, SumFold } from "./kernels";
import {
  assertDisplacement,
  assertFourPeriods,
  committable,
  assertPredicate,
  assertRatio,
  highestFold,
  lagFold,
  linregFold,
  lowestFold,
  rmaFold,
  seededRmaFold,
  trueRanges,
  stddevFold,
  sumFold,
  volumeOf,
} from "./kernels";
import type { ExtremumState, LagState, LinregState, SeededRecursiveState, SmaState, StddevState, SumState } from "./kernels";
import { foldNode } from "./fold-node";
import { toneOf } from "./tone";

/**
 * Pulls a value out of a point. null means "no value" — the
 * kernel carries it forward as warmup.
 */
export type ValueAccessor<T extends BaseDataPoint> = (
  point: T,
) => number | null;

/**
 * Defaults to close — for points that aren't OHLC, the overload requires
 * `value`. The `as unknown as` cast exists because the implementation
 * signature can't re-prove what the overload has already guaranteed.
 */
const closeOf: ValueAccessor<OHLC> = (candle) => candle.close;

/** x carries over unchanged from the input point. */
function points<T extends BaseDataPoint>(
  source: readonly T[],
  values: readonly (number | null)[],
): LineDataPoint[] {
  return source.map((point, index) => ({ x: point.x, y: values[index] }));
}

/**
 * A kernel with no cheap resume point recomputes wholesale on every tick
 * — but its consumers still get the tail path, because the previous
 * output objects are handed back wherever the recompute produced the
 * same point. The output points are this file's own `{ x, y }` literals,
 * which is what makes them comparable as plain data.
 */
function recomputing<
  const TIn extends readonly Source<any>[],
  TOut extends Record<string, BaseDataPoint[]>,
>(spec: ComputationSpec<TIn, TOut>): ComputationSpec<TIn, TOut> {
  return {
    ...spec,
    calcLast: (previous, inputs) => reuseUnchanged(previous, spec.calc(...inputs)),
  };
}

function valuesOf<T extends BaseDataPoint>(
  source: readonly T[],
  value: ValueAccessor<T>,
): (number | null)[] {
  return source.map(value);
}

// --- Moving average ---

export interface MovingAverageOptions {
  period: number;
  /** The kind of average. Default is simple (sma) — exponential is `"ema"`. */
  type?: "sma" | "ema";
}

export type MovingAverage = Computation<{ ma: LineDataPoint[] }>;

/** `period` has no default — it is the indicator. The kind of average does. */
export const MOVING_AVERAGE_DEFAULTS = { type: "sma" } as const;

/**
 * Moving average — simple (default) or exponential. There's only one
 * branch, `ma`, but it's a computed node because it can serve as
 * another indicator's input (`Source`).
 *
 * ```ts
 * const ma20 = movingAverage(price, { period: 20 });
 * const ema20 = movingAverage(price, { period: 20, type: "ema" });
 * pane.addSeries({ series: lineSeries(), input: ma20.out.ma });
 * ```
 */
export function movingAverage(
  source: Source<OHLC>,
  options: MovingAverageOptions,
): MovingAverage;
export function movingAverage<T extends BaseDataPoint>(
  source: Source<T>,
  options: MovingAverageOptions & { value: ValueAccessor<T> },
): MovingAverage;
export function movingAverage<T extends BaseDataPoint>(
  source: Source<T>,
  options: MovingAverageOptions & { value?: ValueAccessor<T> },
): MovingAverage {
  requireOptions(options, "movingAverage");
  const value = options.value ?? (closeOf as unknown as ValueAccessor<T>);

  /**
   * `calc` (full) and `calcLast` (tail) stand on the same fold, so the
   * results can't diverge. There are two checkpoints, kept separately per
   * node: just before the last step (`beforeLast`, for resuming a
   * replace) and at the end (`atEnd`, for resuming on a new candle).
   */
  interface Fold {
    step(value: number | null): number | null;
    snapshot(): unknown;
    restore(state: unknown): void;
  }
  const makeFold: (period: number) => Fold =
    (options.type ?? MOVING_AVERAGE_DEFAULTS.type) === "ema" ? emaFold : smaFold;
  const tailFold = makeFold(options.period);
  let beforeLast: unknown = null;
  let atEnd: unknown = null;

  return computation({
    inputs: [source],

    calc: (data) => {
      const fold = makeFold(options.period);
      const out: LineDataPoint[] = new Array(data.length);
      for (let i = 0; i < data.length; i++) {
        if (i === data.length - 1) beforeLast = fold.snapshot();
        out[i] = { x: data[i].x, y: fold.step(value(data[i])) };
      }
      atEnd = fold.snapshot();
      return { ma: out };
    },

    calcLast: (previous, [data], [change]) => {
      if (change.kind === "none") return previous;
      // The checkpoint only covers the last single step — a deeper replace falls back to a full recompute.
      if (change.kind === "replace" && change.count !== 1) return null;
      const resume = change.kind === "replace" ? beforeLast : atEnd;
      if (resume === null) return null;

      tailFold.restore(resume);
      const count = change.count;
      const tail: LineDataPoint[] = new Array(count);
      for (let i = data.length - count; i < data.length; i++) {
        if (i === data.length - 1) beforeLast = tailFold.snapshot();
        tail[i - (data.length - count)] = {
          x: data[i].x,
          y: tailFold.step(value(data[i])),
        };
      }
      atEnd = tailFold.snapshot();

      const keep = previous.ma.length - (change.kind === "replace" ? count : 0);
      // Reuses the front of the previous array — so downstream sees the same tail verdict.
      return { ma: previous.ma.slice(0, keep).concat(tail) };
    },

    /**
     * A landing corrects the window's warmup for an sma and the decay
     * horizon for an ema — past that horizon the restarted fold agrees
     * with the old values to below the landing bound. `headLookback`'s
     * generic interpreter does the rest (prefix rerun, tail reuse). That
     * prefix rerun is a real call to `calc`, so `beforeLast`/`atEnd` then
     * describe the prefix's end — stale for the tail. The node knows: the
     * first tick after a landing is a full `calc`, which takes them fresh
     * again over the whole input.
     */
    headLookback:
      (options.type ?? MOVING_AVERAGE_DEFAULTS.type) === "ema"
        ? decayHorizon(2 / (options.period + 1))
        : options.period - 1,
  });
}

// --- MACD ---

export interface MacdOptions {
  /** Fast EMA. Default 12. */
  fast?: number;
  /** Slow EMA. Default 26. */
  slow?: number;
  /** Signal EMA. Default 9. */
  signal?: number;
}

/** Single source of truth for defaults — computation and the label (plugins) read the same values. */
export const MACD_DEFAULTS = { fast: 12, slow: 26, signal: 9 } as const;

export type Macd = Computation<{
  macd: LineDataPoint[];
  signal: LineDataPoint[];
  /** Each bar carries its direction against the bar before as `tone`. */
  histogram: HistogramPoint[];
}>;

/**
 * MACD — one computation produces three branches (macd, signal,
 * histogram). signal is an EMA on top of the macd line, so the kernel's
 * null rule carries straight through. The consumer picks the bar series
 * that draws the histogram.
 */
export function macd(source: Source<OHLC>, options?: MacdOptions): Macd;
export function macd<T extends BaseDataPoint>(
  source: Source<T>,
  options: MacdOptions & { value: ValueAccessor<T> },
): Macd;
export function macd<T extends BaseDataPoint>(
  source: Source<T>,
  options: MacdOptions & { value?: ValueAccessor<T> } = {},
): Macd {
  requireOptions(options, "macd");
  const value = options.value ?? (closeOf as unknown as ValueAccessor<T>);
  const fast = options.fast ?? MACD_DEFAULTS.fast;
  const slow = options.slow ?? MACD_DEFAULTS.slow;
  const signalPeriod = options.signal ?? MACD_DEFAULTS.signal;

  /**
   * Holds separate checkpoints for the three EMA folds (fast, slow,
   * signal). One step is atomic: one value → fold fast and slow → feed
   * their difference (the macd line) into signal. The full computation
   * and the tail resume both use the same single `advance`.
   */
  const makeFolds = () => ({
    fast: emaFold(fast),
    slow: emaFold(slow),
    signal: emaFold(signalPeriod),
  });
  type Checkpoint = {
    fast: RecursiveState;
    slow: RecursiveState;
    signal: RecursiveState;
  };
  const tailFolds = makeFolds();
  let beforeLast: Checkpoint | null = null;
  let atEnd: Checkpoint | null = null;

  const snapshotOf = (folds: ReturnType<typeof makeFolds>): Checkpoint => ({
    fast: folds.fast.snapshot(),
    slow: folds.slow.snapshot(),
    signal: folds.signal.snapshot(),
  });

  const advance = (
    folds: ReturnType<typeof makeFolds>,
    raw: number | null,
  ): { macd: number | null; signal: number | null; histogram: number | null } => {
    const fastValue = folds.fast.step(raw);
    const slowValue = folds.slow.step(raw);
    const macdValue =
      fastValue === null || slowValue === null ? null : fastValue - slowValue;
    const signalValue = folds.signal.step(macdValue);
    return {
      macd: macdValue,
      signal: signalValue,
      histogram:
        macdValue === null || signalValue === null
          ? null
          : macdValue - signalValue,
    };
  };

  return computation({
    inputs: [source],

    calc: (data) => {
      const folds = makeFolds();
      const macdLine: (number | null)[] = new Array(data.length);
      const signalLine: (number | null)[] = new Array(data.length);
      const histogram: HistogramPoint[] = new Array(data.length);

      for (let i = 0; i < data.length; i++) {
        if (i === data.length - 1) beforeLast = snapshotOf(folds);
        const step = advance(folds, value(data[i]));
        macdLine[i] = step.macd;
        signalLine[i] = step.signal;
        histogram[i] = {
          x: data[i].x,
          y: step.histogram,
          tone: toneOf(i > 0 ? histogram[i - 1].y : undefined, step.histogram),
        };
      }
      atEnd = snapshotOf(folds);

      return {
        macd: points(data, macdLine),
        signal: points(data, signalLine),
        histogram,
      };
    },

    calcLast: (previous, [data], [change]) => {
      if (change.kind === "none") return previous;
      if (change.kind === "replace" && change.count !== 1) return null;
      const resume = change.kind === "replace" ? beforeLast : atEnd;
      if (resume === null) return null;

      tailFolds.fast.restore(resume.fast);
      tailFolds.slow.restore(resume.slow);
      tailFolds.signal.restore(resume.signal);

      const count = change.count;
      const from = data.length - count;
      const macdTail: LineDataPoint[] = new Array(count);
      const signalTail: LineDataPoint[] = new Array(count);
      const histogramTail: HistogramPoint[] = new Array(count);

      for (let i = from; i < data.length; i++) {
        if (i === data.length - 1) beforeLast = snapshotOf(tailFolds);
        const step = advance(tailFolds, value(data[i]));
        macdTail[i - from] = { x: data[i].x, y: step.macd };
        signalTail[i - from] = { x: data[i].x, y: step.signal };
        // The tail's first bar looks back into the kept prefix — the previous
        // value is data, not fold state (the same seam `foldNode` handles).
        const back = i === from ? previous.histogram[from - 1] : histogramTail[i - from - 1];
        histogramTail[i - from] = { x: data[i].x, y: step.histogram, tone: toneOf(back?.y, step.histogram) };
      }
      atEnd = snapshotOf(tailFolds);

      const keep = previous.macd.length - (change.kind === "replace" ? 1 : 0);
      return {
        macd: previous.macd.slice(0, keep).concat(macdTail),
        signal: previous.signal.slice(0, keep).concat(signalTail),
        histogram: previous.histogram.slice(0, keep).concat(histogramTail),
      };
    },

    /**
     * A landing's corrected zone stacks the chained memories: the slow
     * EMA's horizon to settle the macd line, plus the signal EMA's
     * horizon on top of that settled line, plus the one-bar diff the
     * histogram's tone remembers.
     */
    headLookback:
      decayHorizon(2 / (slow + 1)) + decayHorizon(2 / (signalPeriod + 1)) + 1,
  });
}

// --- Bollinger Bands ---

export interface BollingerOptions {
  /** Default 20. */
  period?: number;
  /** Standard deviation multiplier. Default 2. */
  multiplier?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const BOLLINGER_DEFAULTS = { period: 20, multiplier: 2 } as const;

export interface BandPoint extends BaseDataPoint {
  upper: number | null;
  lower: number | null;
}

export type BollingerBands = Computation<{
  upper: LineDataPoint[];
  middle: LineDataPoint[];
  lower: LineDataPoint[];
  /** A branch carrying upper and lower in one point — `bandSeries` fills between them. */
  band: BandPoint[];
}>;

/**
 * Bollinger Bands — middle (sma) ± multiplier × standard deviation. The
 * `band` branch carries upper and lower in one point so the fill polygon
 * can be drawn directly.
 */
export function bollingerBands(
  source: Source<OHLC>,
  options?: BollingerOptions,
): BollingerBands;
export function bollingerBands<T extends BaseDataPoint>(
  source: Source<T>,
  options: BollingerOptions & { value: ValueAccessor<T> },
): BollingerBands;
export function bollingerBands<T extends BaseDataPoint>(
  source: Source<T>,
  options: BollingerOptions & { value?: ValueAccessor<T> } = {},
): BollingerBands {
  requireOptions(options, "bollingerBands");
  const value = options.value ?? (closeOf as unknown as ValueAccessor<T>);
  const period = options.period ?? BOLLINGER_DEFAULTS.period;
  const multiplier = options.multiplier ?? BOLLINGER_DEFAULTS.multiplier;
  assertRatio(multiplier, "multiplier", "bollingerBands");

  return computation(recomputing({
    inputs: [source],
    /** The window's warmup — sma and stddev share it. */
    headLookback: period - 1,
    calc: (data) => {
      const values = valuesOf(data, value);
      const middle = sma(values, period);
      const spread = stddev(values, period);

      const upper = middle.map((mean, index) => {
        const width = spread[index];
        return mean === null || width === null
          ? null
          : mean + multiplier * width;
      });
      const lower = middle.map((mean, index) => {
        const width = spread[index];
        return mean === null || width === null
          ? null
          : mean - multiplier * width;
      });

      return {
        upper: points(data, upper),
        middle: points(data, middle),
        lower: points(data, lower),
        band: data.map((point, index) => ({
          x: point.x,
          upper: upper[index],
          lower: lower[index],
        })),
      };
    },
  }));
}

// --- RSI ---

export interface RsiOptions {
  /** Default 14. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const RSI_DEFAULTS = { period: 14 } as const;

export type Rsi = Computation<{ rsi: LineDataPoint[] }>;

/**
 * RSI — the ratio of Wilder averages (rma) of gains and losses. 0 to 100.
 * The first point has no change, so it's null; rma handles warmup. When
 * avgLoss is 0, the result is 100 (TA-Lib convention).
 */
export function rsi(source: Source<OHLC>, options?: RsiOptions): Rsi;
export function rsi<T extends BaseDataPoint>(
  source: Source<T>,
  options: RsiOptions & { value: ValueAccessor<T> },
): Rsi;
export function rsi<T extends BaseDataPoint>(
  source: Source<T>,
  options: RsiOptions & { value?: ValueAccessor<T> } = {},
): Rsi {
  requireOptions(options, "rsi");
  const value = options.value ?? (closeOf as unknown as ValueAccessor<T>);
  const period = options.period ?? RSI_DEFAULTS.period;

  return computation(recomputing({
    inputs: [source],
    /** Wilder smoothing's decay horizon, plus one bar for the diff. */
    headLookback: decayHorizon(1 / period) + 1,
    calc: (data) => {
      const values = valuesOf(data, value);

      const gains: (number | null)[] = new Array(values.length).fill(null);
      const losses: (number | null)[] = new Array(values.length).fill(null);
      for (let index = 1; index < values.length; index++) {
        const current = values[index];
        const previous = values[index - 1];
        if (current === null || previous === null) continue;
        const change = current - previous;
        gains[index] = Math.max(change, 0);
        losses[index] = Math.max(-change, 0);
      }

      const avgGain = rma(gains, period);
      const avgLoss = rma(losses, period);

      const out = avgGain.map((gain, index) => {
        const loss = avgLoss[index];
        if (gain === null || loss === null) return null;
        if (loss === 0) return 100;
        return 100 - 100 / (1 + gain / loss);
      });

      return { rsi: points(data, out) };
    },
  }));
}

// --- ATR ---

export interface AtrOptions {
  /** Default 14. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const ATR_DEFAULTS = { period: 14 } as const;

export type Atr = Computation<{ atr: LineDataPoint[] }>;

/** ATR — the Wilder average of True Range. No `value` overload — it's a computation that uses high, low, and close together, so a single-value accessor doesn't fit. */
export function atr(source: Source<OHLC>, options: AtrOptions = {}): Atr {
  requireOptions(options, "atr");
  const period = options.period ?? ATR_DEFAULTS.period;

  return computation(recomputing({
    inputs: [source],
    /** Wilder smoothing's decay horizon, plus one bar for the true range. */
    headLookback: decayHorizon(1 / period) + 1,
    calc: (data) => ({ atr: points(data, rma(trueRanges(data), period)) }),
  }));
}

// --- ADX ---

export interface AdxOptions {
  /** Default 14. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const ADX_DEFAULTS = { period: 14 } as const;

export type Adx = Computation<{
  adx: LineDataPoint[];
  plusDi: LineDataPoint[];
  minusDi: LineDataPoint[];
}>;

/**
 * ADX — the directional index. Smooths ±DM and TR with rma to make DI±,
 * then smooths their ratio (DX) with rma again — a double warmup, so adx
 * settles later than DI. The first candle has null DM/TR. If the DI sum
 * is 0, DX is also null.
 */
export function adx(source: Source<OHLC>, options: AdxOptions = {}): Adx {
  requireOptions(options, "adx");
  const period = options.period ?? ADX_DEFAULTS.period;

  return computation(recomputing({
    inputs: [source],
    /** Two chained Wilder smoothings (DI, then ADX), plus one bar for the DM diff. */
    headLookback: decayHorizon(1 / period) * 2 + 1,
    calc: (data) => {
      const plusDm: (number | null)[] = new Array(data.length).fill(null);
      const minusDm: (number | null)[] = new Array(data.length).fill(null);
      for (let index = 1; index < data.length; index++) {
        const up = data[index].high - data[index - 1].high;
        const down = data[index - 1].low - data[index].low;
        plusDm[index] = up > down && up > 0 ? up : 0;
        minusDm[index] = down > up && down > 0 ? down : 0;
      }
      const tr = trueRanges(data).map((value, index) =>
        index === 0 ? null : value,
      );

      const smoothTr = rma(tr, period);
      const di = (dm: (number | null)[]) =>
        rma(dm, period).map((value, index) => {
          const range = smoothTr[index];
          return value === null || range === null || range === 0
            ? null
            : (100 * value) / range;
        });
      const plusDi = di(plusDm);
      const minusDi = di(minusDm);

      const dx = plusDi.map((plus, index) => {
        const minus = minusDi[index];
        if (plus === null || minus === null) return null;
        const sum = plus + minus;
        return sum === 0 ? null : (100 * Math.abs(plus - minus)) / sum;
      });

      return {
        adx: points(data, rma(dx, period)),
        plusDi: points(data, plusDi),
        minusDi: points(data, minusDi),
      };
    },
  }));
}

// --- Parabolic SAR ---

export interface ParabolicSarOptions {
  /** The acceleration factor's step. Default 0.02. */
  step?: number;
  /** The acceleration factor's ceiling. Default 0.2. */
  max?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const PARABOLIC_SAR_DEFAULTS = { step: 0.02, max: 0.2 } as const;

export type ParabolicSar = Computation<{ sar: LineDataPoint[] }>;

/**
 * Parabolic SAR — Wilder's trend-reversal state machine. It updates
 * trend, extreme point (EP), and acceleration (AF), and reverses when
 * price crosses the SAR (the reversal candle's SAR = the previous EP).
 * The first candle is null. SAR can't move inside the previous two
 * candles' low (uptrend) / high (downtrend) — the Wilder clamp.
 */
export function parabolicSar(
  source: Source<OHLC>,
  options: ParabolicSarOptions = {},
): ParabolicSar {
  requireOptions(options, "parabolicSar");
  const step = options.step ?? PARABOLIC_SAR_DEFAULTS.step;
  const max = options.max ?? PARABOLIC_SAR_DEFAULTS.max;
  assertRatio(step, "step", "parabolicSar");
  assertRatio(max, "max", "parabolicSar");

  return computation(recomputing({
    inputs: [source],
    calc: (data) => {
      const out: (number | null)[] = new Array(data.length).fill(null);
      if (data.length >= 2) {
        let rising = data[1].close >= data[0].close;
        let sar = rising ? data[0].low : data[0].high;
        let extreme = rising
          ? Math.max(data[0].high, data[1].high)
          : Math.min(data[0].low, data[1].low);
        let af = step;

        for (let index = 1; index < data.length; index++) {
          sar += af * (extreme - sar);

          const first = data[index - 1];
          const second = data[Math.max(index - 2, 0)];
          const candle = data[index];

          if (rising) {
            sar = Math.min(sar, first.low, second.low);
            if (candle.low < sar) {
              rising = false;
              sar = extreme;
              extreme = candle.low;
              af = step;
            } else if (candle.high > extreme) {
              extreme = candle.high;
              af = Math.min(af + step, max);
            }
          } else {
            sar = Math.max(sar, first.high, second.high);
            if (candle.high > sar) {
              rising = true;
              sar = extreme;
              extreme = candle.high;
              af = step;
            } else if (candle.low < extreme) {
              extreme = candle.low;
              af = Math.min(af + step, max);
            }
          }

          out[index] = sar;
        }
      }

      return { sar: points(data, out) };
    },
  }));
}

// --- Ichimoku ---

export interface IchimokuOptions {
  /** The conversion line's window. Default 9. */
  conversion?: number;
  /** The base line's window. Default 26. */
  base?: number;
  /** Leading Span B's window. Default 52. */
  span?: number;
  /** How far the leading and lagging spans shift. Default 26. */
  displacement?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const ICHIMOKU_DEFAULTS = {
  conversion: 9,
  base: 26,
  span: 52,
  displacement: 26,
} as const;

export type Ichimoku = Computation<{
  conversion: LineDataPoint[];
  base: LineDataPoint[];
  spanA: LineDataPoint[];
  spanB: LineDataPoint[];
  lagging: LineDataPoint[];
  /** The cloud — a branch carrying spanA and spanB in one point. `bandSeries` consumes it. */
  cloud: BandPoint[];
}>;

/**
 * Ichimoku — three midlines of the form (windowed high + low)/2, plus
 * leading and lagging spans shifted by index. The shift is index-based —
 * x carries over from the input unchanged, so it never invents a future
 * x, and no cloud is drawn past the last candle. Branch names use English
 * domain vocabulary (not romanized Japanese).
 */
export function ichimoku(
  source: Source<OHLC>,
  options: IchimokuOptions = {},
): Ichimoku {
  requireOptions(options, "ichimoku");
  const conversionPeriod = options.conversion ?? ICHIMOKU_DEFAULTS.conversion;
  const basePeriod = options.base ?? ICHIMOKU_DEFAULTS.base;
  const spanPeriod = options.span ?? ICHIMOKU_DEFAULTS.span;
  const displacement = options.displacement ?? ICHIMOKU_DEFAULTS.displacement;
  assertDisplacement(displacement, "ichimoku");

  return computation(recomputing({
    inputs: [source],
    calc: (data) => {
      const highs = data.map((candle) => candle.high);
      const lows = data.map((candle) => candle.low);
      const midline = (period: number) => {
        const top = highest(highs, period);
        const bottom = lowest(lows, period);
        return top.map((high, index) => {
          const low = bottom[index];
          return high === null || low === null ? null : (high + low) / 2;
        });
      };

      const conversion = midline(conversionPeriod);
      const baseline = midline(basePeriod);
      const rawSpanA = conversion.map((fast, index) => {
        const slow = baseline[index];
        return fast === null || slow === null ? null : (fast + slow) / 2;
      });
      const rawSpanB = midline(spanPeriod);

      const forward = (values: (number | null)[]) =>
        values.map((_, index) => {
          const from = index - displacement;
          return from < 0 ? null : values[from];
        });
      const spanA = forward(rawSpanA);
      const spanB = forward(rawSpanB);
      const lagging = data.map((_, index) => {
        const from = index + displacement;
        return from < data.length ? data[from].close : null;
      });

      return {
        conversion: points(data, conversion),
        base: points(data, baseline),
        spanA: points(data, spanA),
        spanB: points(data, spanB),
        lagging: points(data, lagging),
        cloud: data.map((point, index) => ({
          x: point.x,
          upper: spanA[index],
          lower: spanB[index],
        })),
      };
    },
  }));
}

// --- VWAP ---

/**
 * **Where a new period opens.** Given a bar, its index, and the bar before
 * it — `null` where there is nothing behind, which is what `vwap` passes
 * at index 0. `pivotPoints` opens its first period without asking at all,
 * so a predicate written for it is never called with `null`.
 *
 * The third argument is what makes a session boundary answerable: "did a
 * new one open here" is a comparison between two bars, not a property of
 * one, and without it every consumer closed over the array to index it
 * again. `periodAnchor` turns any rule about where a bar starts into one
 * of these, so a venue's own calendar needs the rule and nothing else.
 *
 * **A predicate may declare fewer parameters than it is given** — one or
 * two is ordinary TypeScript and nothing about that changed. What changed
 * is what an indicator passes: code that reads this type back out and
 * calls it with two arguments, or assigns it to a two-parameter type, has
 * to name the third now.
 */
export type AnchorPredicate = (
  point: OHLC,
  index: number,
  previous: OHLC | null,
) => boolean;

export interface VwapOptions {
  /**
   * Resets accumulation on the candle where this is true — session
   * boundaries are the consumer's knowledge. A reset also clears any
   * break caused by missing volume: the new accumulation doesn't depend
   * on that candle.
   */
  anchor?: AnchorPredicate;
}

export type Vwap = Computation<{ vwap: LineDataPoint[] }>;

/**
 * VWAP — the volume-weighted cumulative average of the typical price
 * ((high+low+close)/3). It's a cumulative indicator, so from the candle
 * missing volume through the next anchor, everything is null (skipping
 * over it would pretend later values still hold). Fixed to
 * `Source<OHLC>` — it's a computation that uses volume too, so a
 * single-value accessor doesn't fit.
 */
export function vwap(source: Source<OHLC>, options: VwapOptions = {}): Vwap {
  requireOptions(options, "vwap");
  const anchor = options.anchor;

  return computation(recomputing({
    inputs: [source],
    calc: (data) => {
      const out: (number | null)[] = new Array(data.length).fill(null);
      let weighted = 0;
      let total = 0;
      let broken = false;

      for (let index = 0; index < data.length; index++) {
        const candle = data[index];
        if (anchor?.(candle, index, index === 0 ? null : data[index - 1])) {
          weighted = 0;
          total = 0;
          broken = false;
        }

        // A gap is `null` as much as `undefined` — a feed's JSON says
        // `"volume": null`, and `=== undefined` let it through as 0.
        const volume = volumeOf(candle);
        if (broken || volume === null) {
          broken = true;
          continue;
        }

        const typical = (candle.high + candle.low + candle.close) / 3;
        weighted += typical * volume;
        total += volume;
        out[index] = total === 0 ? null : weighted / total;
      }

      return { vwap: points(data, out) };
    },
  }));
}

// --- OBV ---

export type Obv = Computation<{ obv: LineDataPoint[] }>;

/**
 * OBV — a running sum of volume, signed by the direction of the close.
 * The first value is vol₀ (TA-Lib convention — the absolute level is
 * meaningless, only the shape matters). A bar without volume is null and
 * the sum **resumes on the next bar that has one**: since the level is
 * arbitrary anyway, a gap costs exactly one bar's contribution and
 * nothing else — every later up/down is real information, and throwing
 * it away for good (as VWAP must, whose weights are unknown until its
 * anchor) would be pretending the shape is unknowable. The direction on
 * the resuming bar is against the previous bar's close, gap or not — a
 * gap is missing volume, not a missing price.
 */
export function obv(source: Source<OHLC>): Obv {
  return computation(recomputing({
    inputs: [source],
    calc: (data) => {
      const out: (number | null)[] = new Array(data.length).fill(null);
      let state: number | null = null;

      for (let index = 0; index < data.length; index++) {
        const volume = volumeOf(data[index]);
        if (volume === null) continue;

        if (state === null) {
          state = volume;
        } else {
          const change = data[index].close - data[index - 1].close;
          if (change > 0) state += volume;
          else if (change < 0) state -= volume;
        }
        out[index] = state;
      }

      return { obv: points(data, out) };
    },
  }));
}

// --- Stochastic RSI ---

export interface StochasticRsiOptions {
  /** The RSI's Wilder window. Default 14. */
  rsiPeriod?: number;
  /** The stochastic window over the RSI. Default 14. */
  period?: number;
  /** The sma window that smooths raw %K. Default 3. */
  smooth?: number;
  /** %D = an sma window over %K. Default 3. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const STOCHASTIC_RSI_DEFAULTS = { rsiPeriod: 14, period: 14, smooth: 3, signal: 3 } as const;

export type StochasticRsi = Computation<{ k: LineDataPoint[]; d: LineDataPoint[] }>;

interface StochasticRsiFolds {
  previous: LagFold;
  gain: RecursiveFold;
  loss: RecursiveFold;
  highest: ExtremumFold;
  lowest: ExtremumFold;
  k: SmaFold;
  d: SmaFold;
}
interface StochasticRsiState {
  previous: LagState;
  gain: RecursiveState;
  loss: RecursiveState;
  highest: ExtremumState;
  lowest: ExtremumState;
  k: SmaState;
  d: SmaState;
}

/**
 * Stochastic RSI — the stochastic of the RSI: where the RSI sits in its
 * own recent range, 0 to 100, then smoothed twice (%K, %D) like the
 * Stochastic. Same conventions as its parents: the RSI is 100 when the
 * average loss is 0, and a flat RSI window (highest = lowest) gives null,
 * not 0 or 100. Folds all the way down, so a tick is one step.
 */
export function stochasticRsi(
  source: Source<OHLC>,
  options: StochasticRsiOptions = {},
): StochasticRsi {
  requireOptions(options, "stochasticRsi");
  const rsiPeriod = options.rsiPeriod ?? STOCHASTIC_RSI_DEFAULTS.rsiPeriod;
  const period = options.period ?? STOCHASTIC_RSI_DEFAULTS.period;
  const smooth = options.smooth ?? STOCHASTIC_RSI_DEFAULTS.smooth;
  const signal = options.signal ?? STOCHASTIC_RSI_DEFAULTS.signal;

  return foldNode<OHLC, StochasticRsiFolds, StochasticRsiState, "k" | "d">(source, {
    keys: ["k", "d"],
    make: () => ({
      previous: lagFold(1),
      gain: rmaFold(rsiPeriod),
      loss: rmaFold(rsiPeriod),
      highest: highestFold(period),
      lowest: lowestFold(period),
      k: smaFold(smooth),
      d: smaFold(signal),
    }),
    snapshot: (f) => ({
      previous: f.previous.snapshot(),
      gain: f.gain.snapshot(),
      loss: f.loss.snapshot(),
      highest: f.highest.snapshot(),
      lowest: f.lowest.snapshot(),
      k: f.k.snapshot(),
      d: f.d.snapshot(),
    }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      f.gain.restore(state.gain);
      f.loss.restore(state.loss);
      f.highest.restore(state.highest);
      f.lowest.restore(state.lowest);
      f.k.restore(state.k);
      f.d.restore(state.d);
    },
    step: (f, candle) => {
      const previous = f.previous.step(candle.close);
      const change = previous === null ? null : candle.close - previous;
      const gain = f.gain.step(change === null ? null : Math.max(change, 0));
      const loss = f.loss.step(change === null ? null : Math.max(-change, 0));
      let rsi: number | null = null;
      if (gain !== null && loss !== null) rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      const top = f.highest.step(rsi);
      const bottom = f.lowest.step(rsi);
      const raw =
        rsi === null || top === null || bottom === null || top === bottom
          ? null
          : (100 * (rsi - bottom)) / (top - bottom);
      const k = f.k.step(raw);
      const d = f.d.step(k);
      return { k, d };
    },
    /** The RSI's decay horizon and its one-bar diff, then the three windows stacked on it. */
    headLookback: decayHorizon(1 / rsiPeriod) + 1 + (period - 1) + (smooth - 1) + (signal - 1),
  });
}

// --- MFI ---

export interface MfiOptions {
  /** Default 14. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const MFI_DEFAULTS = { period: 14 } as const;

export type Mfi = Computation<{ mfi: LineDataPoint[] }>;

interface MfiFolds {
  previous: LagFold;
  positive: SumFold;
  negative: SumFold;
}
interface MfiState {
  previous: LagState;
  positive: SumState;
  negative: SumState;
}

/**
 * Money Flow Index — RSI's shape over money flow (typical price × volume):
 * the flow counts as positive when the typical price rose, negative when
 * it fell, and neither when it didn't move. 0 to 100; 100 when the
 * negative sum is 0 (the RSI convention), null when both sums are 0.
 * A bar without volume has no flow, so every window that holds it is null
 * and the value comes back once it has left — the window rule, applied to
 * volume.
 */
export function mfi(source: Source<OHLC>, options: MfiOptions = {}): Mfi {
  requireOptions(options, "mfi");
  const period = options.period ?? MFI_DEFAULTS.period;

  return foldNode<OHLC, MfiFolds, MfiState, "mfi">(source, {
    keys: ["mfi"],
    make: () => ({ previous: lagFold(1), positive: sumFold(period), negative: sumFold(period) }),
    snapshot: (f) => ({
      previous: f.previous.snapshot(),
      positive: f.positive.snapshot(),
      negative: f.negative.snapshot(),
    }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      f.positive.restore(state.positive);
      f.negative.restore(state.negative);
    },
    step: (f, candle) => {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const previous = f.previous.step(typical);
      const volume = volumeOf(candle);
      let positive: number | null = null;
      let negative: number | null = null;
      if (previous !== null && volume !== null) {
        const flow = typical * volume;
        positive = typical > previous ? flow : 0;
        negative = typical < previous ? flow : 0;
      }
      const up = f.positive.step(positive);
      const down = f.negative.step(negative);
      if (up === null || down === null) return { mfi: null };
      if (down === 0) return { mfi: up === 0 ? null : 100 };
      return { mfi: 100 - 100 / (1 + up / down) };
    },
    /** The window, plus the one-bar diff of the typical price. */
    headLookback: period - 1 + 1,
  });
}

// --- Ultimate Oscillator ---

export interface UltimateOscillatorOptions {
  /** The short window. Default 7. The three are sorted — the 4/2/1 weights go shortest to longest. */
  fast?: number;
  /** The middle window. Default 14. */
  middle?: number;
  /** The long window. Default 28. */
  slow?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. Weights are 4/2/1, the definition's. */
export const ULTIMATE_OSCILLATOR_DEFAULTS = { fast: 7, middle: 14, slow: 28 } as const;

export type UltimateOscillator = Computation<{ uo: LineDataPoint[] }>;

interface UltimateOscillatorFolds {
  previous: LagFold;
  pressure: [SumFold, SumFold, SumFold];
  range: [SumFold, SumFold, SumFold];
}
interface UltimateOscillatorState {
  previous: LagState;
  pressure: [SumState, SumState, SumState];
  range: [SumState, SumState, SumState];
}

/**
 * Ultimate Oscillator — buying pressure over true range, averaged over
 * three windows and weighted 4/2/1 toward the shortest. Buying pressure is
 * `close − min(low, previous close)`, true range `max(high, previous
 * close) − min(low, previous close)`; the first bar has no previous close
 * and is null (the Wilder habit of seeding the first true range with
 * `high − low` is not this indicator's). A window whose true range sums
 * to 0 is null.
 */
export function ultimateOscillator(
  source: Source<OHLC>,
  options: UltimateOscillatorOptions = {},
): UltimateOscillator {
  requireOptions(options, "ultimateOscillator");
  // The weights belong to the shortest, middle and longest window, not to
  // the option names — TA-Lib sorts too, so `{fast: 3, middle: 1, slow: 2}`
  // means the same indicator as `{1, 2, 3}`.
  const [fast, middle, slow] = [
    options.fast ?? ULTIMATE_OSCILLATOR_DEFAULTS.fast,
    options.middle ?? ULTIMATE_OSCILLATOR_DEFAULTS.middle,
    options.slow ?? ULTIMATE_OSCILLATOR_DEFAULTS.slow,
  ].sort((a, b) => a - b);

  return foldNode<OHLC, UltimateOscillatorFolds, UltimateOscillatorState, "uo">(source, {
    keys: ["uo"],
    make: () => ({
      previous: lagFold(1),
      pressure: [sumFold(fast), sumFold(middle), sumFold(slow)],
      range: [sumFold(fast), sumFold(middle), sumFold(slow)],
    }),
    snapshot: (f) => ({
      previous: f.previous.snapshot(),
      pressure: [f.pressure[0].snapshot(), f.pressure[1].snapshot(), f.pressure[2].snapshot()],
      range: [f.range[0].snapshot(), f.range[1].snapshot(), f.range[2].snapshot()],
    }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      for (let i = 0; i < 3; i++) {
        f.pressure[i].restore(state.pressure[i]);
        f.range[i].restore(state.range[i]);
      }
    },
    step: (f, candle) => {
      const previous = f.previous.step(candle.close);
      let pressure: number | null = null;
      let range: number | null = null;
      if (previous !== null) {
        const low = Math.min(candle.low, previous);
        pressure = candle.close - low;
        range = Math.max(candle.high, previous) - low;
      }
      const averages: (number | null)[] = [];
      for (let i = 0; i < 3; i++) {
        const bp = f.pressure[i].step(pressure);
        const tr = f.range[i].step(range);
        averages.push(bp === null || tr === null || tr === 0 ? null : bp / tr);
      }
      const [a, b, c] = averages;
      if (a === null || b === null || c === null) return { uo: null };
      return { uo: (100 * (4 * a + 2 * b + c)) / 7 };
    },
    /** The longest window, plus the one-bar diff. */
    headLookback: Math.max(fast, middle, slow) - 1 + 1,
  });
}

// --- Awesome Oscillator ---

export interface AwesomeOscillatorOptions {
  /** The short sma over the median price. Default 5. */
  fast?: number;
  /** The long sma. Default 34. Not sorted — swapping the two flips the sign, which is a different indicator. */
  slow?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const AWESOME_OSCILLATOR_DEFAULTS = { fast: 5, slow: 34 } as const;

/** Each bar carries its direction against the bar before as `tone`. */
export type AwesomeOscillator = Computation<{ ao: HistogramPoint[] }>;

interface AwesomeOscillatorFolds {
  fast: SmaFold;
  slow: SmaFold;
}
interface AwesomeOscillatorState {
  fast: SmaState;
  slow: SmaState;
}

/**
 * Awesome Oscillator — the short sma of the median price `(high + low) / 2`
 * minus the long one. Whether a bar rose or fell against the one before is
 * the bar's `tone`; the theme picks the colour.
 */
export function awesomeOscillator(
  source: Source<OHLC>,
  options: AwesomeOscillatorOptions = {},
): AwesomeOscillator {
  requireOptions(options, "awesomeOscillator");
  const fast = options.fast ?? AWESOME_OSCILLATOR_DEFAULTS.fast;
  const slow = options.slow ?? AWESOME_OSCILLATOR_DEFAULTS.slow;

  return foldNode<OHLC, AwesomeOscillatorFolds, AwesomeOscillatorState, "ao", "ao">(source, {
    keys: ["ao"],
    toneKeys: ["ao"],
    make: () => ({ fast: smaFold(fast), slow: smaFold(slow) }),
    snapshot: (f) => ({ fast: f.fast.snapshot(), slow: f.slow.snapshot() }),
    restore: (f, state) => {
      f.fast.restore(state.fast);
      f.slow.restore(state.slow);
    },
    step: (f, candle) => {
      const median = (candle.high + candle.low) / 2;
      const short = f.fast.step(median);
      const long = f.slow.step(median);
      return { ao: short === null || long === null ? null : short - long };
    },
    /** The longer of the two windows, plus the one-bar diff the tone remembers. */
    headLookback: Math.max(fast, slow) - 1 + 1,
  });
}

// --- Momentum ---

export interface MomentumOptions {
  /** How many bars back the close is compared against. Default 12. */
  period?: number;
  /** An sma window over the momentum. Default 6. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const MOMENTUM_DEFAULTS = { period: 12, signal: 6 } as const;

export type Momentum = Computation<{ momentum: LineDataPoint[]; signal: LineDataPoint[] }>;

interface MomentumFolds {
  back: LagFold;
  signal: SmaFold;
}
interface MomentumState {
  back: LagState;
  signal: SmaState;
}

/**
 * Momentum (MTM) — the close minus the close `period` bars back, and an sma
 * of that as its signal. null for the first `period` bars; the signal
 * follows the window rule on top.
 */
export function momentum(source: Source<OHLC>, options: MomentumOptions = {}): Momentum {
  requireOptions(options, "momentum");
  const period = options.period ?? MOMENTUM_DEFAULTS.period;
  const signal = options.signal ?? MOMENTUM_DEFAULTS.signal;

  return foldNode<OHLC, MomentumFolds, MomentumState, "momentum" | "signal">(source, {
    keys: ["momentum", "signal"],
    make: () => ({ back: lagFold(period), signal: smaFold(signal) }),
    snapshot: (f) => ({ back: f.back.snapshot(), signal: f.signal.snapshot() }),
    restore: (f, state) => {
      f.back.restore(state.back);
      f.signal.restore(state.signal);
    },
    step: (f, candle) => {
      const back = f.back.step(candle.close);
      const value = back === null ? null : candle.close - back;
      return { momentum: value, signal: f.signal.step(value) };
    },
    /** The lag's full `period` (not `period − 1`), plus the signal window. */
    headLookback: period + (signal - 1),
  });
}

// --- Elder-Ray ---

export interface ElderRayOptions {
  /** The ema window. Default 13. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const ELDER_RAY_DEFAULTS = { period: 13 } as const;

export type ElderRay = Computation<{ bullPower: LineDataPoint[]; bearPower: LineDataPoint[] }>;

interface ElderRayFolds {
  ema: RecursiveFold;
}
interface ElderRayState {
  ema: RecursiveState;
}

/**
 * Elder-Ray Index — bull power `high − ema(close)` and bear power
 * `low − ema(close)`, two branches because they are two quantities. Not
 * TradingView's single-value "Bull Bear Power" (their sum); that one is a
 * different indicator.
 */
export function elderRay(source: Source<OHLC>, options: ElderRayOptions = {}): ElderRay {
  requireOptions(options, "elderRay");
  const period = options.period ?? ELDER_RAY_DEFAULTS.period;

  return foldNode<OHLC, ElderRayFolds, ElderRayState, "bullPower" | "bearPower">(source, {
    keys: ["bullPower", "bearPower"],
    make: () => ({ ema: emaFold(period) }),
    snapshot: (f) => ({ ema: f.ema.snapshot() }),
    restore: (f, state) => f.ema.restore(state.ema),
    step: (f, candle) => {
      const average = f.ema.step(candle.close);
      return {
        bullPower: average === null ? null : candle.high - average,
        bearPower: average === null ? null : candle.low - average,
      };
    },
    /** The ema's decay horizon. */
    headLookback: decayHorizon(2 / (period + 1)),
  });
}

// --- Squeeze Momentum ---

export interface SqueezeMomentumOptions {
  /** The Bollinger window. Default 20. */
  bbPeriod?: number;
  /** The Bollinger deviation multiplier. Default 2. */
  bbMultiplier?: number;
  /** The Keltner window — also the momentum's window. Default 20. */
  kcPeriod?: number;
  /** The Keltner range multiplier. Default 1.5. */
  kcMultiplier?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const SQUEEZE_MOMENTUM_DEFAULTS = { bbPeriod: 20, bbMultiplier: 2, kcPeriod: 20, kcMultiplier: 1.5 } as const;

export type SqueezeMomentum = Computation<{
  /** Each bar carries its direction against the bar before as `tone`. */
  momentum: HistogramPoint[];
  squeezeOn: LineDataPoint[];
  squeezeOff: LineDataPoint[];
}>;

interface SqueezeMomentumFolds {
  previous: LagFold;
  bbMean: SmaFold;
  bbDeviation: StddevFold;
  kcMean: SmaFold;
  kcRange: SmaFold;
  highest: ExtremumFold;
  lowest: ExtremumFold;
  fit: LinregFold;
}
interface SqueezeMomentumState {
  previous: LagState;
  bbMean: SmaState;
  bbDeviation: StddevState;
  kcMean: SmaState;
  kcRange: SmaState;
  highest: ExtremumState;
  lowest: ExtremumState;
  fit: LinregState;
}

/**
 * Squeeze Momentum (LazyBear's) — a squeeze is on while the Bollinger Bands
 * sit inside the Keltner Channel, off while they sit outside, and neither
 * in between; the momentum is the end point of a least-squares line over
 * the close's distance from the midpoint of the Keltner window's range
 * and its sma. Three branches: `momentum`, and two marker rows —
 * `squeezeOn`/`squeezeOff` are 0 while their state holds and null
 * otherwise, so both null means no squeeze (and the warmup).
 *
 * The Keltner here is the script's — sma of the close, sma of the true
 * range — not this package's `keltnerChannels` (ema and Wilder's rma),
 * because the squeeze is an inequality between the two bands and a
 * different channel turns it on and off on different days. The script's
 * own quirk — multiplying the Bollinger deviation by the *Keltner*
 * multiplier — is not reproduced: `bbMultiplier` does what it says. Set
 * both multipliers equal to match that screen exactly.
 */
export function squeezeMomentum(
  source: Source<OHLC>,
  options: SqueezeMomentumOptions = {},
): SqueezeMomentum {
  requireOptions(options, "squeezeMomentum");
  const bbPeriod = options.bbPeriod ?? SQUEEZE_MOMENTUM_DEFAULTS.bbPeriod;
  const bbMultiplier = options.bbMultiplier ?? SQUEEZE_MOMENTUM_DEFAULTS.bbMultiplier;
  const kcPeriod = options.kcPeriod ?? SQUEEZE_MOMENTUM_DEFAULTS.kcPeriod;
  const kcMultiplier = options.kcMultiplier ?? SQUEEZE_MOMENTUM_DEFAULTS.kcMultiplier;
  assertRatio(bbMultiplier, "bbMultiplier", "squeezeMomentum");
  assertRatio(kcMultiplier, "kcMultiplier", "squeezeMomentum");

  return foldNode<OHLC, SqueezeMomentumFolds, SqueezeMomentumState, "momentum" | "squeezeOn" | "squeezeOff", "momentum">(source, {
    keys: ["momentum", "squeezeOn", "squeezeOff"],
    // The marker rows say a state, not a direction — they stay plain.
    toneKeys: ["momentum"],
    make: () => ({
      previous: lagFold(1),
      bbMean: smaFold(bbPeriod),
      bbDeviation: stddevFold(bbPeriod),
      kcMean: smaFold(kcPeriod),
      kcRange: smaFold(kcPeriod),
      highest: highestFold(kcPeriod),
      lowest: lowestFold(kcPeriod),
      fit: linregFold(kcPeriod),
    }),
    snapshot: (f) => ({
      previous: f.previous.snapshot(),
      bbMean: f.bbMean.snapshot(),
      bbDeviation: f.bbDeviation.snapshot(),
      kcMean: f.kcMean.snapshot(),
      kcRange: f.kcRange.snapshot(),
      highest: f.highest.snapshot(),
      lowest: f.lowest.snapshot(),
      fit: f.fit.snapshot(),
    }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      f.bbMean.restore(state.bbMean);
      f.bbDeviation.restore(state.bbDeviation);
      f.kcMean.restore(state.kcMean);
      f.kcRange.restore(state.kcRange);
      f.highest.restore(state.highest);
      f.lowest.restore(state.lowest);
      f.fit.restore(state.fit);
    },
    step: (f, candle) => {
      const close = candle.close;
      const previous = f.previous.step(close);
      // The script's `tr`: null on the first bar, where there is no previous
      // close — so the Keltner range starts one bar after its basis, as on
      // that screen (Wilder's `high − low` seed is not this indicator's).
      const trueRange =
        previous === null
          ? null
          : Math.max(candle.high - candle.low, Math.abs(candle.high - previous), Math.abs(candle.low - previous));
      const bbMean = f.bbMean.step(close);
      const bbDeviation = f.bbDeviation.step(close);
      const kcMean = f.kcMean.step(close);
      const kcRange = f.kcRange.step(trueRange);
      const top = f.highest.step(candle.high);
      const bottom = f.lowest.step(candle.low);

      const deviation =
        top === null || bottom === null || kcMean === null ? null : close - ((top + bottom) / 2 + kcMean) / 2;
      const momentum = f.fit.step(deviation);

      let squeezeOn: number | null = null;
      let squeezeOff: number | null = null;
      if (bbMean !== null && bbDeviation !== null && kcMean !== null && kcRange !== null) {
        const upperBB = bbMean + bbMultiplier * bbDeviation;
        const lowerBB = bbMean - bbMultiplier * bbDeviation;
        const upperKC = kcMean + kcMultiplier * kcRange;
        const lowerKC = kcMean - kcMultiplier * kcRange;
        if (lowerBB > lowerKC && upperBB < upperKC) squeezeOn = 0;
        else if (lowerBB < lowerKC && upperBB > upperKC) squeezeOff = 0;
      }
      return { momentum, squeezeOn, squeezeOff };
    },
    /** The Bollinger window, or the momentum's two Keltner windows stacked, or the Keltner window plus the true range's lag — plus the one-bar diff the tone remembers. */
    headLookback: Math.max(bbPeriod - 1, 2 * (kcPeriod - 1), kcPeriod) + 1,
  });
}

// --- ROC ---

export interface RocOptions {
  /** How many bars back the close is compared against. Default 12. */
  period?: number;
  /** An sma window over the ROC. Default 6. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const ROC_DEFAULTS = { period: 12, signal: 6 } as const;

export type Roc = Computation<{ roc: LineDataPoint[]; signal: LineDataPoint[] }>;

interface RocFolds {
  back: LagFold;
  signal: SmaFold;
}
interface RocState {
  back: LagState;
  signal: SmaState;
}

/**
 * Rate of Change (ROC) — the close against the close `period` bars back, as
 * a percentage, and an sma of that as its signal. null for the first
 * `period` bars and wherever the close it compares against is 0 (the
 * canonical KLineChart writes 0 there — a reading where there is none).
 */
export function roc(source: Source<OHLC>, options: RocOptions = {}): Roc {
  requireOptions(options, "roc");
  const period = options.period ?? ROC_DEFAULTS.period;
  const signal = options.signal ?? ROC_DEFAULTS.signal;

  return foldNode<OHLC, RocFolds, RocState, "roc" | "signal">(source, {
    keys: ["roc", "signal"],
    make: () => ({ back: lagFold(period), signal: smaFold(signal) }),
    snapshot: (f) => ({ back: f.back.snapshot(), signal: f.signal.snapshot() }),
    restore: (f, state) => {
      f.back.restore(state.back);
      f.signal.restore(state.signal);
    },
    step: (f, candle) => {
      const back = f.back.step(candle.close);
      const value = back === null || back === 0 ? null : ((candle.close - back) / back) * 100;
      return { roc: value, signal: f.signal.step(value) };
    },
    /** The lag's full `period` (not `period − 1`), plus the signal window. */
    headLookback: period + (signal - 1),
  });
}

// --- TRIX ---

export interface TrixOptions {
  /** The ema window, applied three times. Default 12. */
  period?: number;
  /** An sma window over the TRIX. Default 9. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const TRIX_DEFAULTS = { period: 12, signal: 9 } as const;

export type Trix = Computation<{ trix: LineDataPoint[]; signal: LineDataPoint[] }>;

interface TrixFolds {
  first: RecursiveFold;
  second: RecursiveFold;
  third: RecursiveFold;
  previous: LagFold;
  signal: SmaFold;
}
interface TrixState {
  first: RecursiveState;
  second: RecursiveState;
  third: RecursiveState;
  previous: LagState;
  signal: SmaState;
}

/**
 * TRIX — the one-bar percent change of a triple-smoothed ema of the close,
 * and an sma of that as its signal. Each ema seeds with an sma, as the
 * canonical does. Two places are null: the first triple-ema value, which
 * has no predecessor (the canonical writes 0 there), and a bar whose
 * predecessor is exactly 0 (the canonical divides by it — Infinity or NaN);
 * a percent change from 0 has no finite value.
 */
export function trix(source: Source<OHLC>, options: TrixOptions = {}): Trix {
  requireOptions(options, "trix");
  const period = options.period ?? TRIX_DEFAULTS.period;
  const signal = options.signal ?? TRIX_DEFAULTS.signal;

  return foldNode<OHLC, TrixFolds, TrixState, "trix" | "signal">(source, {
    keys: ["trix", "signal"],
    make: () => ({
      first: emaFold(period),
      second: emaFold(period),
      third: emaFold(period),
      previous: lagFold(1),
      signal: smaFold(signal),
    }),
    snapshot: (f) => ({
      first: f.first.snapshot(),
      second: f.second.snapshot(),
      third: f.third.snapshot(),
      previous: f.previous.snapshot(),
      signal: f.signal.snapshot(),
    }),
    restore: (f, state) => {
      f.first.restore(state.first);
      f.second.restore(state.second);
      f.third.restore(state.third);
      f.previous.restore(state.previous);
      f.signal.restore(state.signal);
    },
    step: (f, candle) => {
      const tr = f.third.step(f.second.step(f.first.step(candle.close)));
      const previous = f.previous.step(tr);
      const value = tr === null || previous === null || previous === 0 ? null : ((tr - previous) / previous) * 100;
      return { trix: value, signal: f.signal.step(value) };
    },
    /** Three chained ema horizons, plus the one-bar diff, plus the signal window. */
    headLookback: 3 * decayHorizon(2 / (period + 1)) + 1 + (signal - 1),
  });
}

// --- PSY ---

export interface PsyOptions {
  /** The window the up-closes are counted over. Default 12. */
  period?: number;
  /** An sma window over the PSY. Default 6. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const PSY_DEFAULTS = { period: 12, signal: 6 } as const;

export type Psy = Computation<{ psy: LineDataPoint[]; signal: LineDataPoint[] }>;

interface PsyFolds {
  previous: LagFold;
  ups: SumFold;
  signal: SmaFold;
}
interface PsyState {
  previous: LagState;
  ups: SumState;
  signal: SmaState;
}

/**
 * Psychological Line (PSY) — the share of bars in the window that closed
 * above the bar before them, 0 to 100, and an sma of that as its signal. An
 * unchanged close is not an up-close. The first bar has no predecessor, so
 * it is no observation — where the canonical counts it as a non-up bar.
 * Observable difference: the first PSY lands at index `period` (canonical:
 * `period − 1`) and the signal one bar later as well.
 */
export function psy(source: Source<OHLC>, options: PsyOptions = {}): Psy {
  requireOptions(options, "psy");
  const period = options.period ?? PSY_DEFAULTS.period;
  const signal = options.signal ?? PSY_DEFAULTS.signal;

  return foldNode<OHLC, PsyFolds, PsyState, "psy" | "signal">(source, {
    keys: ["psy", "signal"],
    make: () => ({ previous: lagFold(1), ups: sumFold(period), signal: smaFold(signal) }),
    snapshot: (f) => ({ previous: f.previous.snapshot(), ups: f.ups.snapshot(), signal: f.signal.snapshot() }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      f.ups.restore(state.ups);
      f.signal.restore(state.signal);
    },
    step: (f, candle) => {
      const previous = f.previous.step(candle.close);
      const up = previous === null ? null : candle.close > previous ? 1 : 0;
      const ups = f.ups.step(up);
      const value = ups === null ? null : (ups / period) * 100;
      return { psy: value, signal: f.signal.step(value) };
    },
    /** The one-bar diff, plus the counting window, plus the signal window. */
    headLookback: 1 + (period - 1) + (signal - 1),
  });
}

// --- BBI ---

/** Four sma windows — the indicator is their mean, so the count is part of its definition. */
export type FourPeriods = readonly [number, number, number, number];

export interface BbiOptions {
  /** The four sma windows. Default `[3, 6, 12, 24]`. */
  periods?: FourPeriods;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const BBI_DEFAULTS = { periods: [3, 6, 12, 24] } as const satisfies { periods: FourPeriods };

export type Bbi = Computation<{ bbi: LineDataPoint[] }>;

interface BbiFolds {
  means: [SmaFold, SmaFold, SmaFold, SmaFold];
}
interface BbiState {
  means: [SmaState, SmaState, SmaState, SmaState];
}

/**
 * Bull and Bear Index (BBI) — the mean of four smas of the close, drawn on
 * the price pane. The canonical divides by a literal 4, so four windows is
 * the definition, not a default — the tuple type says so, and the door
 * refuses any other count from a JavaScript caller.
 */
export function bbi(source: Source<OHLC>, options: BbiOptions = {}): Bbi {
  requireOptions(options, "bbi");
  const periods = options.periods ?? BBI_DEFAULTS.periods;
  assertFourPeriods(periods, "bbi");

  return foldNode<OHLC, BbiFolds, BbiState, "bbi">(source, {
    keys: ["bbi"],
    make: () => ({ means: [smaFold(periods[0]), smaFold(periods[1]), smaFold(periods[2]), smaFold(periods[3])] }),
    snapshot: (f) => ({ means: [f.means[0].snapshot(), f.means[1].snapshot(), f.means[2].snapshot(), f.means[3].snapshot()] }),
    restore: (f, state) => {
      for (let i = 0; i < 4; i++) f.means[i].restore(state.means[i]);
    },
    step: (f, candle) => {
      const a = f.means[0].step(candle.close);
      const b = f.means[1].step(candle.close);
      const c = f.means[2].step(candle.close);
      const d = f.means[3].step(candle.close);
      return { bbi: a === null || b === null || c === null || d === null ? null : (a + b + c + d) / 4 };
    },
    /** The longest window. */
    headLookback: Math.max(periods[0], periods[1], periods[2], periods[3]) - 1,
  });
}

// --- DMA ---

export interface DmaOptions {
  /** The short sma window. Default 10. */
  fast?: number;
  /** The long sma window. Default 50. */
  slow?: number;
  /** An sma window over the difference. Default 10. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const DMA_DEFAULTS = { fast: 10, slow: 50, signal: 10 } as const;

export type Dma = Computation<{ dma: LineDataPoint[]; signal: LineDataPoint[] }>;

interface DmaFolds {
  fast: SmaFold;
  slow: SmaFold;
  signal: SmaFold;
}
interface DmaState {
  fast: SmaState;
  slow: SmaState;
  signal: SmaState;
}

/**
 * Different of Moving Average (DMA) — the short sma of the close minus the
 * long one, and an sma of that difference as its signal (the canonical's
 * `AMA`). Not sorted — swapping the windows flips the sign.
 */
export function dma(source: Source<OHLC>, options: DmaOptions = {}): Dma {
  requireOptions(options, "dma");
  const fast = options.fast ?? DMA_DEFAULTS.fast;
  const slow = options.slow ?? DMA_DEFAULTS.slow;
  const signal = options.signal ?? DMA_DEFAULTS.signal;

  return foldNode<OHLC, DmaFolds, DmaState, "dma" | "signal">(source, {
    keys: ["dma", "signal"],
    make: () => ({ fast: smaFold(fast), slow: smaFold(slow), signal: smaFold(signal) }),
    snapshot: (f) => ({ fast: f.fast.snapshot(), slow: f.slow.snapshot(), signal: f.signal.snapshot() }),
    restore: (f, state) => {
      f.fast.restore(state.fast);
      f.slow.restore(state.slow);
      f.signal.restore(state.signal);
    },
    step: (f, candle) => {
      const short = f.fast.step(candle.close);
      const long = f.slow.step(candle.close);
      const value = short === null || long === null ? null : short - long;
      return { dma: value, signal: f.signal.step(value) };
    },
    /** The longer window, plus the signal window. */
    headLookback: Math.max(fast, slow) - 1 + (signal - 1),
  });
}

// --- BRAR ---

export interface BrarOptions {
  /** The window both ratios sum over. Default 26. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const BRAR_DEFAULTS = { period: 26 } as const;

export type Brar = Computation<{ br: LineDataPoint[]; ar: LineDataPoint[] }>;

interface BrarFolds {
  previous: LagFold;
  highOpen: SumFold;
  openLow: SumFold;
  highClose: SumFold;
  closeLow: SumFold;
}
interface BrarState {
  previous: LagState;
  highOpen: SumState;
  openLow: SumState;
  highClose: SumState;
  closeLow: SumState;
}

/**
 * BRAR — two sentiment ratios over one window, each × 100. AR (from the
 * open): Σ(high − open) / Σ(open − low). BR (from the previous close):
 * Σ max(0, high − close[1]) / Σ max(0, close[1] − low). BR clips each bar
 * at 0 as the literature does — a gap counts on one side only; the
 * canonical KLineChart sums the signed differences and can read a negative
 * BR. AR is not clipped: with a well-formed bar both of its terms are ≥ 0,
 * and clipping would quietly hide a feed whose high sits below its open.
 * A zero denominator is null on its own ratio. BR has no first bar (no
 * previous close), so its first value lands one bar after AR's and one bar
 * after the canonical's — which reads the first bar's own close as its
 * previous close. AR does not look back and reads from the first bar.
 */
export function brar(source: Source<OHLC>, options: BrarOptions = {}): Brar {
  requireOptions(options, "brar");
  const period = options.period ?? BRAR_DEFAULTS.period;

  return foldNode<OHLC, BrarFolds, BrarState, "br" | "ar">(source, {
    keys: ["br", "ar"],
    make: () => ({
      previous: lagFold(1),
      highOpen: sumFold(period),
      openLow: sumFold(period),
      highClose: sumFold(period),
      closeLow: sumFold(period),
    }),
    snapshot: (f) => ({
      previous: f.previous.snapshot(),
      highOpen: f.highOpen.snapshot(),
      openLow: f.openLow.snapshot(),
      highClose: f.highClose.snapshot(),
      closeLow: f.closeLow.snapshot(),
    }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      f.highOpen.restore(state.highOpen);
      f.openLow.restore(state.openLow);
      f.highClose.restore(state.highClose);
      f.closeLow.restore(state.closeLow);
    },
    step: (f, candle) => {
      const previous = f.previous.step(candle.close);
      const ho = f.highOpen.step(candle.high - candle.open);
      const ol = f.openLow.step(candle.open - candle.low);
      const hc = f.highClose.step(previous === null ? null : Math.max(0, candle.high - previous));
      const cl = f.closeLow.step(previous === null ? null : Math.max(0, previous - candle.low));
      return {
        ar: ho === null || ol === null || ol === 0 ? null : (ho / ol) * 100,
        br: hc === null || cl === null || cl === 0 ? null : (hc / cl) * 100,
      };
    },
    /** The one-bar diff BR needs, plus the window. */
    headLookback: 1 + (period - 1),
  });
}

// --- CR ---

export interface CrOptions {
  /** The window both sums cover. Default 26. */
  period?: number;
  /**
   * The four sma windows over the CR; each average is drawn displaced back by
   * `ceil(p / 2.5 + 1)` bars. Default `[10, 20, 40, 60]`.
   */
  periods?: FourPeriods;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const CR_DEFAULTS = { period: 26, periods: [10, 20, 40, 60] } as const satisfies { period: number; periods: FourPeriods };

export type Cr = Computation<{ cr: LineDataPoint[]; ma1: LineDataPoint[]; ma2: LineDataPoint[]; ma3: LineDataPoint[]; ma4: LineDataPoint[] }>;

interface CrFolds {
  mid: LagFold;
  above: SumFold;
  below: SumFold;
  means: [SmaFold, SmaFold, SmaFold, SmaFold];
  shifts: [LagFold, LagFold, LagFold, LagFold];
}
interface CrState {
  mid: LagState;
  above: SumState;
  below: SumState;
  means: [SmaState, SmaState, SmaState, SmaState];
  shifts: [LagState, LagState, LagState, LagState];
}

/** How far back each of CR's averages is drawn — the canonical's `M / 2.5 + 1`, rounded up. */
function crDisplacement(period: number): number {
  return Math.ceil(period / 2.5 + 1);
}

/**
 * CR — the energy band: `Σ max(0, high − mid[1]) / Σ max(0, mid[1] − low) × 100`
 * over the window, `mid[1]` the previous bar's midpoint, formed as
 * `high[1] / 2 + low[1] / 2` (the same double as `(high + low) / 2` except
 * where that sum would overflow, or where a half rounds — the smallest
 * doubles); and four smas of the CR, each drawn `ceil(p / 2.5 + 1)` bars
 * back — the value at a bar is the average that stood that many bars
 * earlier. The sums are the literature's (`SUM(…, N)`) and the canonical's
 * own docstring; the canonical's code divides bar by bar, writes 0 where a
 * bar has no downward pressure (its low at or above the previous midpoint), and
 * uses N only as a start delay. Bar by bar under this package's null rule
 * would leave the averages empty around every such bar; the window sums
 * carry them across it. No first bar (no previous midpoint); a window whose
 * downward sum is 0 has no ratio — null, where the canonical writes 0. With
 * the defaults the CR reads from the
 * 27th bar and MA(60), the furthest displaced, from the 111th — 110 bars
 * of memory, the declared lookback.
 */
export function cr(source: Source<OHLC>, options: CrOptions = {}): Cr {
  requireOptions(options, "cr");
  const period = options.period ?? CR_DEFAULTS.period;
  const periods = options.periods ?? CR_DEFAULTS.periods;
  assertFourPeriods(periods, "cr");
  const shifts = [crDisplacement(periods[0]), crDisplacement(periods[1]), crDisplacement(periods[2]), crDisplacement(periods[3])] as const;

  return foldNode<OHLC, CrFolds, CrState, "cr" | "ma1" | "ma2" | "ma3" | "ma4">(source, {
    keys: ["cr", "ma1", "ma2", "ma3", "ma4"],
    make: () => ({
      mid: lagFold(1),
      above: sumFold(period),
      below: sumFold(period),
      means: [smaFold(periods[0]), smaFold(periods[1]), smaFold(periods[2]), smaFold(periods[3])],
      shifts: [lagFold(shifts[0]), lagFold(shifts[1]), lagFold(shifts[2]), lagFold(shifts[3])],
    }),
    snapshot: (f) => ({
      mid: f.mid.snapshot(),
      above: f.above.snapshot(),
      below: f.below.snapshot(),
      means: [f.means[0].snapshot(), f.means[1].snapshot(), f.means[2].snapshot(), f.means[3].snapshot()],
      shifts: [f.shifts[0].snapshot(), f.shifts[1].snapshot(), f.shifts[2].snapshot(), f.shifts[3].snapshot()],
    }),
    restore: (f, state) => {
      f.mid.restore(state.mid);
      f.above.restore(state.above);
      f.below.restore(state.below);
      for (let i = 0; i < 4; i++) {
        f.means[i].restore(state.means[i]);
        f.shifts[i].restore(state.shifts[i]);
      }
    },
    step: (f, candle) => {
      const previousMid = f.mid.step(candle.high / 2 + candle.low / 2);
      const above = f.above.step(previousMid === null ? null : Math.max(0, candle.high - previousMid));
      const below = f.below.step(previousMid === null ? null : Math.max(0, previousMid - candle.low));
      // No downward pressure in the window is the undefined case, decided on the sum itself.
      const value = above === null || below === null || below === 0 ? null : (above / below) * 100;
      return {
        cr: value,
        ma1: f.shifts[0].step(f.means[0].step(value)),
        ma2: f.shifts[1].step(f.means[1].step(value)),
        ma3: f.shifts[2].step(f.means[2].step(value)),
        ma4: f.shifts[3].step(f.means[3].step(value)),
      };
    },
    /** The previous midpoint, the window, then the longest average plus its displacement. */
    headLookback: 1 + (period - 1) + Math.max(periods[0] - 1 + shifts[0], periods[1] - 1 + shifts[1], periods[2] - 1 + shifts[2], periods[3] - 1 + shifts[3]),
  });
}

// --- VR ---

export interface VrOptions {
  /** The window the up, down and flat volumes are summed over. Default 26. */
  period?: number;
  /** An sma window over the VR. Default 6. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const VR_DEFAULTS = { period: 26, signal: 6 } as const;

export type Vr = Computation<{ vr: LineDataPoint[]; signal: LineDataPoint[] }>;

interface VrFolds {
  previous: LagFold;
  up: SumFold;
  down: SumFold;
  flat: SumFold;
  signal: SmaFold;
}
interface VrState {
  previous: LagState;
  up: SumState;
  down: SumState;
  flat: SumState;
  signal: SmaState;
}

/**
 * Volume Ratio (VR) — `((up + flat/2) × 100) / (down + flat/2)`, the window's
 * volume on up-closes plus half its flat volume against its volume on
 * down-closes plus half the flat, the ×100 applied before the division; and an
 * sma of that as its signal. Up, down and flat are against the previous
 * close. A bar without volume, or the first bar (no previous close), is no
 * observation and nulls every window that holds it — the MFI rule. A window
 * with no down volume and no flat volume has no denominator — null, where
 * the canonical writes 0.
 */
export function vr(source: Source<OHLC>, options: VrOptions = {}): Vr {
  requireOptions(options, "vr");
  const period = options.period ?? VR_DEFAULTS.period;
  const signal = options.signal ?? VR_DEFAULTS.signal;

  return foldNode<OHLC, VrFolds, VrState, "vr" | "signal">(source, {
    keys: ["vr", "signal"],
    make: () => ({
      previous: lagFold(1),
      up: sumFold(period),
      down: sumFold(period),
      flat: sumFold(period),
      signal: smaFold(signal),
    }),
    snapshot: (f) => ({
      previous: f.previous.snapshot(),
      up: f.up.snapshot(),
      down: f.down.snapshot(),
      flat: f.flat.snapshot(),
      signal: f.signal.snapshot(),
    }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      f.up.restore(state.up);
      f.down.restore(state.down);
      f.flat.restore(state.flat);
      f.signal.restore(state.signal);
    },
    step: (f, candle) => {
      const previous = f.previous.step(candle.close);
      const volume = volumeOf(candle);
      const known = previous !== null && volume !== null;
      const up = f.up.step(known ? (candle.close > previous ? volume : 0) : null);
      const down = f.down.step(known ? (candle.close < previous ? volume : 0) : null);
      const flat = f.flat.step(known ? (candle.close === previous ? volume : 0) : null);
      let value: number | null = null;
      if (up !== null && down !== null && flat !== null) {
        // ×100 before the division so a tiny ratio keeps its digits; the sums are added as they
        // are, and only when that addition leaves the double range are they scaled by their
        // largest magnitude first (the ratio is scale-invariant — this trades a few digits for
        // a reading that would otherwise not exist).
        const halfFlat = flat / 2;
        let numerator = up + halfFlat;
        let denominator = down + halfFlat;
        if (!committable(numerator) || !committable(denominator)) {
          // A side that left the range (or saturated) is rebuilt from its scaled
          // terms; a side that did not is scaled after the addition, so its
          // cancellation survives. This is the ratio's own rescaling — the one
          // place the formula rescues an overflowed intermediate.
          const scale = Math.max(Math.abs(up), Math.abs(down), Math.abs(flat));
          numerator = committable(numerator) ? numerator / scale : up / scale + halfFlat / scale;
          denominator = committable(denominator) ? denominator / scale : down / scale + halfFlat / scale;
        }
        // No down volume and no flat volume in the window is the undefined case,
        // decided on the sums themselves (the canonical writes 0). A denominator
        // that merely rounds to 0 — a flat volume whose half is below the smallest
        // double — is arithmetic: the ratio leaves the range and the builder
        // reads null for that reason, as it would for any overflow.
        value = down === 0 && flat === 0 ? null : (numerator * 100) / denominator;
      }
      return { vr: value, signal: f.signal.step(value) };
    },
    /** The one-bar diff, plus the window, plus the signal window. */
    headLookback: 1 + (period - 1) + (signal - 1),
  });
}

// --- EMV ---

export interface EmvOptions {
  /** The sma window that makes the signal from the bar-by-bar value. Default 14. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const EMV_DEFAULTS = { period: 14 } as const;

export type Emv = Computation<{ emv: LineDataPoint[]; signal: LineDataPoint[] }>;

interface EmvFolds {
  previousHigh: LagFold;
  previousLow: LagFold;
  signal: SmaFold;
}
interface EmvState {
  previousHigh: LagState;
  previousLow: LagState;
  signal: SmaState;
}

/**
 * Ease of Movement (EMV) — how far the bar's midpoint moved against the
 * previous bar's, per unit of volume over range: `dm × ((range / volume) ×
 * 1e8)` in that order, with `dm` the mean of the two extremes' moves (the
 * canonical KLineChart scale; other charting packages use
 * other constants, so their readings differ by that factor), and an sma of that as
 * its signal — the canonical's `maEmv`. The canonical also declares a
 * second window it never reads; this takes one option instead. No
 * observation on the first bar, on a bar without volume, with zero volume
 * or with zero range — the canonical's own formulation is the move over a
 * box ratio `volume / range`, which has no value at either zero — so null,
 * where the canonical writes 0 for the last three (a missing volume is 0
 * to it). A definition on the inputs, not a door on the arithmetic.
 */
export function emv(source: Source<OHLC>, options: EmvOptions = {}): Emv {
  requireOptions(options, "emv");
  const period = options.period ?? EMV_DEFAULTS.period;

  return foldNode<OHLC, EmvFolds, EmvState, "emv" | "signal">(source, {
    keys: ["emv", "signal"],
    make: () => ({ previousHigh: lagFold(1), previousLow: lagFold(1), signal: smaFold(period) }),
    snapshot: (f) => ({
      previousHigh: f.previousHigh.snapshot(),
      previousLow: f.previousLow.snapshot(),
      signal: f.signal.snapshot(),
    }),
    restore: (f, state) => {
      f.previousHigh.restore(state.previousHigh);
      f.previousLow.restore(state.previousLow);
      f.signal.restore(state.signal);
    },
    step: (f, candle) => {
      const previousHigh = f.previousHigh.step(candle.high);
      const previousLow = f.previousLow.step(candle.low);
      const volume = volumeOf(candle);
      const range = candle.high - candle.low;
      let value: number | null = null;
      // Zero volume or zero range: the box ratio is undefined — a definition, not a door.
      if (previousHigh !== null && previousLow !== null && volume !== null && volume !== 0 && range !== 0) {
        // The midpoint's move as the mean of the two extremes' moves: neighbouring
        // bars' differences are exact where the midpoints themselves would round to
        // the same double. Range over volume first: price per unit of volume, a
        // ratio that stays moderate when both run large, so neither a huge bar
        // overflows nor a tiny move over a huge volume loses its digits. A sum of
        // moves that leaves the range is caught by the builder; what rounds to a
        // subnormal or to 0 is the reading.
        const distance = (candle.high - previousHigh + (candle.low - previousLow)) / 2;
        value = distance * ((range / volume) * 100000000);
      }
      return { emv: value, signal: f.signal.step(value) };
    },
    /** The one-bar diff, plus the signal window. */
    headLookback: 1 + (period - 1),
  });
}

// --- PVT ---

export type Pvt = Computation<{ pvt: LineDataPoint[] }>;

interface PvtFolds {
  previous: LagFold;
  /** The running sum and its Neumaier compensation — both are the state, so both are checkpointed. */
  total: number;
  compensation: number;
}
interface PvtState {
  previous: LagState;
  total: number;
  compensation: number;
}

/**
 * Price and Volume Trend (PVT) — a running sum of the close's percent
 * change times volume, starting at 0 (the absolute level is meaningless, as
 * for OBV — only the shape matters). A bar contributes when it has volume
 * and a previous close; a bar with volume but no previous close reads the
 * sum so far (0 on the first bar). A bar without volume, one whose previous close is 0, or
 * one whose contribution or resulting sum leaves the double range or lands
 * on its largest value is null and the sum stays where it was, resuming on
 * the next bar — against the previous bar's close, gap or not, as OBV does.
 * The sum is compensated (Neumaier): contributions are fractional and the
 * history is unbounded, so a naive sum would drop small terms next to
 * large ones. The running sum has no bounded lookback, so this declares no
 * head door.
 */
export function pvt(source: Source<OHLC>): Pvt {
  return foldNode<OHLC, PvtFolds, PvtState, "pvt">(source, {
    keys: ["pvt"],
    make: () => ({ previous: lagFold(1), total: 0, compensation: 0 }),
    snapshot: (f) => ({ previous: f.previous.snapshot(), total: f.total, compensation: f.compensation }),
    restore: (f, state) => {
      f.previous.restore(state.previous);
      f.total = state.total;
      f.compensation = state.compensation;
    },
    step: (f, candle) => {
      const previous = f.previous.step(candle.close);
      const volume = volumeOf(candle);
      if (volume === null) return { pvt: null };
      if (previous === null) return { pvt: f.total + f.compensation };
      if (previous === 0) return { pvt: null };
      const term = ((candle.close - previous) / previous) * volume;
      // An unrepresentable or saturated contribution or sum is no reading — and must not poison the state.
      if (!committable(term)) return { pvt: null };
      const next = f.total + term;
      const compensation =
        f.compensation + (Math.abs(f.total) >= Math.abs(term) ? f.total - next + term : term - next + f.total);
      // A sum that left the range, or saturated at the largest double — in either
      // part or in the compensated result — is no reading and no state.
      const result = next + compensation;
      // (The compensation is itself a running total — of every step's rounding error since
      // the first bar — so it is checked like one, not trusted to stay small.)
      if (!committable(next) || !committable(compensation) || !committable(result)) return { pvt: null };
      f.total = next;
      f.compensation = compensation;
      return { pvt: result };
    },
  });
}

// --- KDJ ---

export interface KdjOptions {
  /** The RSV window — the high-low range the close is placed in. Default 9. */
  period?: number;
  /** K = a Wilder-style recursion over RSV with this period. Default 3. */
  smooth?: number;
  /** D = the same recursion over K with this period. Default 3. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const KDJ_DEFAULTS = { period: 9, smooth: 3, signal: 3 } as const;

/** Where K and D start — the literature's substitute for a missing previous value. */
const KDJ_SEED = 50;

export type Kdj = Computation<{ k: LineDataPoint[]; d: LineDataPoint[]; j: LineDataPoint[] }>;

interface KdjFolds {
  highest: ExtremumFold;
  lowest: ExtremumFold;
  k: SeededRecursiveFold;
  d: SeededRecursiveFold;
}
interface KdjState {
  highest: ExtremumState;
  lowest: ExtremumState;
  k: SeededRecursiveState;
  d: SeededRecursiveState;
}

/**
 * KDJ — the seeded stochastic. `rsv = ((close/2 − low_n/2) / (high_n/2 − low_n/2)) × 100`
 * over the window — the halves, so that a window spanning more than half the
 * double range cannot overflow the differences (which would collapse the
 * ratio to a wrong finite 0). Wherever every half is still a normal double
 * (magnitudes of 2⁻¹⁰²¹ and up) and the full differences would not
 * overflow, the halves' differences are exactly half the full ones, so the
 * ratio is the same double as `(close − low_n) / (high_n − low_n)`; where
 * the full differences would overflow, the halves are the reading and the
 * full form is not. In the lowest binade and below, halving rounds and the
 * two can differ — a window one ulp wide there may read or, if its halved
 * range rounds to 0, be no reading. Then
 * `k = ((smooth − 1) · k[1] + rsv) / smooth` and
 * `d = ((signal − 1) · d[1] + k) / signal`, both starting at 50 and applying
 * the recurrence from the first RSV on (a first RSV of 80 reads K 60, D 53.3);
 * `j = 3k − 2d`, which runs outside 0–100. The same option words as
 * `stochastic`, a different number: that one smooths with sma windows, this
 * one with Wilder-style recursions from a seed, so the same `k` reads
 * differently — the label says which. A window whose high equals its low is
 * the undefined case — null, where the canonical divides by 1 instead; the
 * recursions skip that bar and keep their state. No lookback is
 * declared: the recursions' memory is counted in observations, not bars,
 * and a flat stretch of any length holds the state across it — so a
 * landing recomputes the whole history, as PVT's does.
 */
export function kdj(source: Source<OHLC>, options: KdjOptions = {}): Kdj {
  requireOptions(options, "kdj");
  const period = options.period ?? KDJ_DEFAULTS.period;
  const smooth = options.smooth ?? KDJ_DEFAULTS.smooth;
  const signal = options.signal ?? KDJ_DEFAULTS.signal;

  return foldNode<OHLC, KdjFolds, KdjState, "k" | "d" | "j">(source, {
    keys: ["k", "d", "j"],
    make: () => ({
      highest: highestFold(period),
      lowest: lowestFold(period),
      k: seededRmaFold(smooth, KDJ_SEED),
      d: seededRmaFold(signal, KDJ_SEED),
    }),
    snapshot: (f) => ({ highest: f.highest.snapshot(), lowest: f.lowest.snapshot(), k: f.k.snapshot(), d: f.d.snapshot() }),
    restore: (f, state) => {
      f.highest.restore(state.highest);
      f.lowest.restore(state.lowest);
      f.k.restore(state.k);
      f.d.restore(state.d);
    },
    step: (f, candle) => {
      const top = f.highest.step(candle.high);
      const bottom = f.lowest.step(candle.low);
      // A flat window is the undefined case, decided on the extremes themselves. The halves: see the JSDoc.
      const rsv = top === null || bottom === null || top === bottom ? null : ((candle.close / 2 - bottom / 2) / (top / 2 - bottom / 2)) * 100;
      const k = f.k.step(rsv);
      const d = f.d.step(k);
      return { k, d, j: k === null || d === null ? null : 3 * k - 2 * d };
    },
  });
}

// --- Stochastic ---

export interface StochasticOptions {
  /** %K's window. Default 14. */
  period?: number;
  /** The sma window that smooths raw %K. Default 3 — 1 gives fast stochastic. */
  smooth?: number;
  /** %D = an sma window over %K. Default 3. */
  signal?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const STOCHASTIC_DEFAULTS = { period: 14, smooth: 3, signal: 3 } as const;

export type Stochastic = Computation<{
  k: LineDataPoint[];
  d: LineDataPoint[];
}>;

/**
 * Stochastic — where the close sits within the window's high-low range.
 * 0 to 100. Like `atr`, it uses high, low, and close together, so there's
 * no `value` overload. If the window's high equals its low (a zero
 * denominator), the result is null — neither 0 nor 100.
 */
export function stochastic(
  source: Source<OHLC>,
  options: StochasticOptions = {},
): Stochastic {
  requireOptions(options, "stochastic");
  const period = options.period ?? STOCHASTIC_DEFAULTS.period;
  const smooth = options.smooth ?? STOCHASTIC_DEFAULTS.smooth;
  const signal = options.signal ?? STOCHASTIC_DEFAULTS.signal;

  return computation(recomputing({
    inputs: [source],
    /** The %K window plus both smoothing windows stacked on it. */
    headLookback: period - 1 + (smooth - 1) + (signal - 1),
    calc: (data) => {
      const highestHigh = highest(
        data.map((candle) => candle.high),
        period,
      );
      const lowestLow = lowest(
        data.map((candle) => candle.low),
        period,
      );

      const rawK = data.map((candle, index) => {
        const top = highestHigh[index];
        const bottom = lowestLow[index];
        if (top === null || bottom === null || top === bottom) return null;
        return (100 * (candle.close - bottom)) / (top - bottom);
      });

      const k = sma(rawK, smooth);
      const d = sma(k, signal);

      return { k: points(data, k), d: points(data, d) };
    },
  }));
}

// --- CCI ---

export interface CciOptions {
  /** Default 20. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const CCI_DEFAULTS = { period: 20 } as const;

export type Cci = Computation<{ cci: LineDataPoint[] }>;

/**
 * CCI — (typical price − sma) / (0.015 × mean absolute deviation).
 * Typical price = (high+low+close)/3. A window with zero deviation
 * (every candle the same value) can't divide, so it's null.
 */
export function cci(source: Source<OHLC>, options: CciOptions = {}): Cci {
  requireOptions(options, "cci");
  const period = options.period ?? CCI_DEFAULTS.period;

  return computation(recomputing({
    inputs: [source],
    /** One window — the mean and its deviation read the same one. */
    headLookback: period - 1,
    calc: (data) => {
      const typical = data.map(
        (candle) => (candle.high + candle.low + candle.close) / 3,
      );
      const mean = sma(typical, period);
      const deviation = meanAbsDeviation(typical, period);

      const out = mean.map((center, index) => {
        const spread = deviation[index];
        return center === null || spread === null || spread === 0
          ? null
          : (typical[index] - center) / (0.015 * spread);
      });

      return { cci: points(data, out) };
    },
  }));
}

// --- Williams %R ---

export interface WilliamsROptions {
  /** Default 14. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const WILLIAMS_R_DEFAULTS = { period: 14 } as const;

export type WilliamsR = Computation<{ r: LineDataPoint[] }>;

/**
 * Williams %R — −100 × (windowed high − close) / windowed high-low range.
 * Values run −100..0. The inverted twin of Stochastic %K — it stands on
 * the same windowed extremes. A zero range means null.
 */
export function williamsR(
  source: Source<OHLC>,
  options: WilliamsROptions = {},
): WilliamsR {
  requireOptions(options, "williamsR");
  const period = options.period ?? WILLIAMS_R_DEFAULTS.period;

  return computation(recomputing({
    inputs: [source],
    /** The high/low window's warmup. */
    headLookback: period - 1,
    calc: (data) => {
      const highs = highest(data.map((candle) => candle.high), period);
      const lows = lowest(data.map((candle) => candle.low), period);

      const out = highs.map((high, index) => {
        const low = lows[index];
        if (high === null || low === null || high === low) return null;
        const value = (-100 * (high - data[index].close)) / (high - low);
        // When close = windowed high, this produces −0 — a value that would print as "-0" in a label, so normalize to +0.
        return value === 0 ? 0 : value;
      });

      return { r: points(data, out) };
    },
  }));
}

// --- Donchian Channels ---

export interface DonchianOptions {
  /** Default 20. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const DONCHIAN_DEFAULTS = { period: 20 } as const;

export type DonchianChannels = Computation<{
  upper: LineDataPoint[];
  middle: LineDataPoint[];
  lower: LineDataPoint[];
  band: BandPoint[];
}>;

/**
 * Donchian Channels — the windowed high, low, and their midpoint (a
 * breakout channel from the Turtle lineage). Same branch shape as
 * Bollinger — `bandSeries` consumes `band` directly.
 */
export function donchianChannels(
  source: Source<OHLC>,
  options: DonchianOptions = {},
): DonchianChannels {
  requireOptions(options, "donchianChannels");
  const period = options.period ?? DONCHIAN_DEFAULTS.period;

  return computation(recomputing({
    inputs: [source],
    /** The channel window's warmup. */
    headLookback: period - 1,
    calc: (data) => {
      const upper = highest(data.map((candle) => candle.high), period);
      const lower = lowest(data.map((candle) => candle.low), period);
      const middle = upper.map((high, index) => {
        const low = lower[index];
        return high === null || low === null ? null : (high + low) / 2;
      });

      return {
        upper: points(data, upper),
        middle: points(data, middle),
        lower: points(data, lower),
        band: data.map((point, index) => ({
          x: point.x,
          upper: upper[index],
          lower: lower[index],
        })),
      };
    },
  }));
}

// --- Keltner Channels ---

export interface KeltnerOptions {
  /** The middle line's EMA window. Default 20. */
  period?: number;
  /** ATR multiplier. Default 2. */
  multiplier?: number;
  /** ATR window. Default 10 (TradingView's built-in default). */
  atrPeriod?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const KELTNER_DEFAULTS = {
  period: 20,
  multiplier: 2,
  atrPeriod: 10,
} as const;

export type KeltnerChannels = Computation<{
  upper: LineDataPoint[];
  middle: LineDataPoint[];
  lower: LineDataPoint[];
  band: BandPoint[];
}>;

/**
 * Keltner Channels — middle (ema) ± multiplier × ATR. Bollinger's
 * volatility counterpart (ATR instead of standard deviation). Also used
 * as material for squeeze-type setups (deciding a compression when
 * Bollinger moves inside Keltner).
 */
export function keltnerChannels(
  source: Source<OHLC>,
  options: KeltnerOptions = {},
): KeltnerChannels {
  requireOptions(options, "keltnerChannels");
  const period = options.period ?? KELTNER_DEFAULTS.period;
  const multiplier = options.multiplier ?? KELTNER_DEFAULTS.multiplier;
  assertRatio(multiplier, "multiplier", "keltnerChannels");
  const atrPeriod = options.atrPeriod ?? KELTNER_DEFAULTS.atrPeriod;

  return computation(recomputing({
    inputs: [source],
    /** The wider of the two parallel memories (EMA middle, Wilder ATR width), plus one bar for the true range. */
    headLookback: Math.max(decayHorizon(2 / (period + 1)), decayHorizon(1 / atrPeriod)) + 1,
    calc: (data) => {
      const middle = ema(data.map((candle) => candle.close), period);
      const width = rma(trueRanges(data), atrPeriod);

      const edge = (sign: 1 | -1) =>
        middle.map((center, index) => {
          const range = width[index];
          return center === null || range === null
            ? null
            : center + sign * multiplier * range;
        });
      const upper = edge(1);
      const lower = edge(-1);

      return {
        upper: points(data, upper),
        middle: points(data, middle),
        lower: points(data, lower),
        band: data.map((point, index) => ({
          x: point.x,
          upper: upper[index],
          lower: lower[index],
        })),
      };
    },
  }));
}

// --- SuperTrend ---

export interface SuperTrendOptions {
  /** ATR window. Default 10. */
  period?: number;
  /** ATR multiplier. Default 3. */
  multiplier?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const SUPERTREND_DEFAULTS = { period: 10, multiplier: 3 } as const;

export type SuperTrend = Computation<{
  /** The support line during an uptrend — null during a downtrend, so the line breaks. */
  up: LineDataPoint[];
  /** The resistance line during a downtrend — null during an uptrend. */
  down: LineDataPoint[];
}>;

/**
 * SuperTrend — a ratcheting band around (high+low)/2 ± multiplier × ATR.
 * During an uptrend the lower band is the support line (a band never
 * moves down), and once the close breaks it, direction flips to a
 * downtrend and the upper band becomes resistance. There are two
 * branches not for color but for meaning — up is support, down is
 * resistance, and the opposite regime is null, breaking the line
 * The default (10, 3) is the original (Olivier Seban) and
 * TradingView's built-in default.
 */
export function superTrend(
  source: Source<OHLC>,
  options: SuperTrendOptions = {},
): SuperTrend {
  requireOptions(options, "superTrend");
  const period = options.period ?? SUPERTREND_DEFAULTS.period;
  const multiplier = options.multiplier ?? SUPERTREND_DEFAULTS.multiplier;
  assertRatio(multiplier, "multiplier", "superTrend");

  return computation(recomputing({
    inputs: [source],
    calc: (data) => {
      const width = rma(trueRanges(data), period);
      const up: (number | null)[] = new Array(data.length).fill(null);
      const down: (number | null)[] = new Array(data.length).fill(null);

      let direction: 1 | -1 = 1;
      let finalUpper = Number.NaN;
      let finalLower = Number.NaN;

      for (let index = 0; index < data.length; index++) {
        const range = width[index];
        if (range === null) continue; // ATR warmup — both branches null

        const candle = data[index];
        const mid = (candle.high + candle.low) / 2;
        // The first valid candle decides direction — a constant seed would
        // plot a false support line until the first reversal if a downtrend starts.
        if (Number.isNaN(finalUpper) && Number.isNaN(finalLower)) {
          direction = candle.close >= mid ? 1 : -1;
        }
        const basicUpper = mid + multiplier * range;
        const basicLower = mid - multiplier * range;
        const previousClose = index > 0 ? data[index - 1].close : candle.close;

        // Ratchet — a band never retreats against the trend. If the previous
        // close was outside the band, release the ratchet and restart from the raw value.
        finalUpper =
          Number.isNaN(finalUpper) ||
          basicUpper < finalUpper ||
          previousClose > finalUpper
            ? basicUpper
            : finalUpper;
        finalLower =
          Number.isNaN(finalLower) ||
          basicLower > finalLower ||
          previousClose < finalLower
            ? basicLower
            : finalLower;

        if (direction === 1 && candle.close < finalLower) direction = -1;
        else if (direction === -1 && candle.close > finalUpper) direction = 1;

        if (direction === 1) up[index] = finalLower;
        else down[index] = finalUpper;
      }

      return { up: points(data, up), down: points(data, down) };
    },
  }));
}

// --- Pivot Points ---

export interface PivotPointsOptions {
  /**
   * The candle where a new period opens — required. Period (day/week/
   * session) boundaries are the consumer's knowledge; core and the
   * indicator don't invent them.
   */
  anchor: AnchorPredicate;
}

export type PivotPoints = Computation<{
  p: LineDataPoint[];
  r1: LineDataPoint[];
  r2: LineDataPoint[];
  r3: LineDataPoint[];
  s1: LineDataPoint[];
  s2: LineDataPoint[];
  s3: LineDataPoint[];
}>;

/**
 * Pivot Points (Floor/Classic) — draws this period's pivot, support, and
 * resistance from the previous period's high, low, and close:
 * the pivot is P=(H+L+C)/3, then resistance R1=2P−L, R2=P+(H−L),
 * R3=H+2(P−L) and support S1=2P−H, S2=P−(H−L), S3=L−2(H−P).
 * Levels are constant within a period (horizontal segments), and a
 * period's first candle is null, so the diagonal between periods breaks
 * (TradingView doesn't connect it either). The first period
 * has no predecessor, so it's entirely null.
 */
export function pivotPoints(
  source: Source<OHLC>,
  options: PivotPointsOptions,
): PivotPoints {
  requireOptions(options, "pivotPoints");
  const { anchor } = options;
  // vwap's anchor is optional (`anchor?.()`), but here it's required.
  assertPredicate(anchor, "anchor", "pivotPoints");

  return computation(recomputing({
    inputs: [source],
    calc: (data) => {
      const branches = {
        p: new Array<number | null>(data.length).fill(null),
        r1: new Array<number | null>(data.length).fill(null),
        r2: new Array<number | null>(data.length).fill(null),
        r3: new Array<number | null>(data.length).fill(null),
        s1: new Array<number | null>(data.length).fill(null),
        s2: new Array<number | null>(data.length).fill(null),
        s3: new Array<number | null>(data.length).fill(null),
      };

      /** The extremes of the period in progress — become the material for the next period's levels once it closes. */
      let high = Number.NaN;
      let low = Number.NaN;
      let close = Number.NaN;
      let levels: {
        p: number; r1: number; r2: number; r3: number;
        s1: number; s2: number; s3: number;
      } | null = null;

      for (let index = 0; index < data.length; index++) {
        const candle = data[index];
        const opens = index === 0 || anchor(candle, index, data[index - 1]);

        if (opens) {
          // Closes the previous period — its H, L, C become this period's levels.
          if (!Number.isNaN(high)) {
            const p = (high + low + close) / 3;
            levels = {
              p,
              r1: 2 * p - low,
              s1: 2 * p - high,
              r2: p + (high - low),
              s2: p - (high - low),
              r3: high + 2 * (p - low),
              s3: low - 2 * (high - p),
            };
          }
          high = candle.high;
          low = candle.low;
          close = candle.close;

          continue; // A period's first candle is null — the gap that breaks the diagonal connector
        }

        high = Math.max(high, candle.high);
        low = Math.min(low, candle.low);
        close = candle.close;

        if (levels) {
          branches.p[index] = levels.p;
          branches.r1[index] = levels.r1;
          branches.r2[index] = levels.r2;
          branches.r3[index] = levels.r3;
          branches.s1[index] = levels.s1;
          branches.s2[index] = levels.s2;
          branches.s3[index] = levels.s3;
        }
      }

      return {
        p: points(data, branches.p),
        r1: points(data, branches.r1),
        r2: points(data, branches.r2),
        r3: points(data, branches.r3),
        s1: points(data, branches.s1),
        s2: points(data, branches.s2),
        s3: points(data, branches.s3),
      };
    },
  }));
}
