import type {
  BaseDataPoint,
  Computation,
  LineDataPoint,
  OHLC,
  Source,
} from "@finchart/core";
import { computation } from "@finchart/core";
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
import type { RecursiveState } from "./kernels";
import { assertDisplacement, assertPredicate, assertRatio } from "./kernels";

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
    options.type === "ema" ? emaFold : smaFold;
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
     * generic interpreter does the rest (prefix rerun, tail reuse); the
     * tail checkpoints stay untouched — the tail's own fold path didn't
     * move.
     */
    headLookback:
      options.type === "ema"
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
  histogram: LineDataPoint[];
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
      const histogramLine: (number | null)[] = new Array(data.length);

      for (let i = 0; i < data.length; i++) {
        if (i === data.length - 1) beforeLast = snapshotOf(folds);
        const step = advance(folds, value(data[i]));
        macdLine[i] = step.macd;
        signalLine[i] = step.signal;
        histogramLine[i] = step.histogram;
      }
      atEnd = snapshotOf(folds);

      return {
        macd: points(data, macdLine),
        signal: points(data, signalLine),
        histogram: points(data, histogramLine),
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
      const histogramTail: LineDataPoint[] = new Array(count);

      for (let i = from; i < data.length; i++) {
        if (i === data.length - 1) beforeLast = snapshotOf(tailFolds);
        const step = advance(tailFolds, value(data[i]));
        macdTail[i - from] = { x: data[i].x, y: step.macd };
        signalTail[i - from] = { x: data[i].x, y: step.signal };
        histogramTail[i - from] = { x: data[i].x, y: step.histogram };
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
     * horizon on top of that settled line.
     */
    headLookback:
      decayHorizon(2 / (slow + 1)) + decayHorizon(2 / (signalPeriod + 1)),
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

  return computation({
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
  });
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

  return computation({
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
  });
}

// --- ATR ---

export interface AtrOptions {
  /** Default 14. */
  period?: number;
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const ATR_DEFAULTS = { period: 14 } as const;

export type Atr = Computation<{ atr: LineDataPoint[] }>;

/** True Range — `max(high-low, |high-prevClose|, |low-prevClose|)`. The first candle is just high-low (Wilder convention). */
function trueRanges(data: readonly OHLC[]): number[] {
  return data.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = data[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
}

/** ATR — the Wilder average of True Range. No `value` overload — it's a computation that uses high, low, and close together, so a single-value accessor doesn't fit. */
export function atr(source: Source<OHLC>, options: AtrOptions = {}): Atr {
  requireOptions(options, "atr");
  const period = options.period ?? ATR_DEFAULTS.period;

  return computation({
    inputs: [source],
    /** Wilder smoothing's decay horizon, plus one bar for the true range. */
    headLookback: decayHorizon(1 / period) + 1,
    calc: (data) => ({ atr: points(data, rma(trueRanges(data), period)) }),
  });
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

  return computation({
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
  });
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

  return computation({
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
  });
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

  return computation({
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
  });
}

// --- VWAP ---

export interface VwapOptions {
  /**
   * Resets accumulation on the candle where this is true — session
   * boundaries are the consumer's knowledge. A reset also clears any
   * break caused by missing volume: the new accumulation doesn't depend
   * on that candle.
   */
  anchor?: (point: OHLC, index: number) => boolean;
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

  return computation({
    inputs: [source],
    calc: (data) => {
      const out: (number | null)[] = new Array(data.length).fill(null);
      let weighted = 0;
      let total = 0;
      let broken = false;

      for (let index = 0; index < data.length; index++) {
        const candle = data[index];
        if (anchor?.(candle, index)) {
          weighted = 0;
          total = 0;
          broken = false;
        }

        if (broken || candle.volume === undefined) {
          broken = true;
          continue;
        }

        const typical = (candle.high + candle.low + candle.close) / 3;
        weighted += typical * candle.volume;
        total += candle.volume;
        out[index] = total === 0 ? null : weighted / total;
      }

      return { vwap: points(data, out) };
    },
  });
}

// --- OBV ---

export type Obv = Computation<{ obv: LineDataPoint[] }>;

/**
 * OBV — a running sum of volume, signed by the direction of the close.
 * The first value is vol₀ (TA-Lib convention — the absolute level is
 * meaningless, only the shape matters). The missing-volume rule is the
 * same as vwap's — null from that candle to the end, and since there's no
 * anchor, it never comes back.
 */
export function obv(source: Source<OHLC>): Obv {
  return computation({
    inputs: [source],
    calc: (data) => {
      const out: (number | null)[] = new Array(data.length).fill(null);
      let state = 0;
      let broken = false;

      for (let index = 0; index < data.length; index++) {
        const volume = data[index].volume;
        if (broken || volume === undefined) {
          broken = true;
          continue;
        }

        if (index === 0) {
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

  return computation({
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
  });
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

  return computation({
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
  });
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

  return computation({
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
  });
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

  return computation({
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
  });
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

  return computation({
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
  });
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

  return computation({
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
  });
}

// --- Pivot Points ---

export interface PivotPointsOptions {
  /**
   * The candle where a new period opens — required. Period (day/week/
   * session) boundaries are the consumer's knowledge; core and the
   * indicator don't invent them.
   */
  anchor: (point: OHLC, index: number) => boolean;
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

  return computation({
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
        const opens = index === 0 || anchor(candle, index);

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
  });
}
