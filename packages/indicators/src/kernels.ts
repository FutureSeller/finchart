import type { OHLC } from "@finchart/core";
import { ContractError, isGap } from "@finchart/core";

/**
 * The layer that holds only an indicator's math — it knows nothing about
 * points or coordinates, just `(number | null)[]`. null means "no value"
 * (warmup or a gap). The reason a kernel deals with null
 * directly is indicators built on indicators — MACD's signal runs on top
 * of the macd line (an array with leading nulls).
 */
export type Values = readonly (number | null)[];

/**
 * An SMA that folds one step at a time — both the array form (`sma`) and
 * the tail increment come out of this one. null when the window isn't
 * full yet or has a gap (it never pretends to have a value). The state is
 * the last window (a `window` ring), and `snapshot`/`restore` are the
 * resume checkpoints.
 */
export interface SmaFold {
  /** Folds the next value and produces the output at that position. null if the window isn't full yet or there's a gap. */
  step(value: number | null): number | null;
  /** A resume checkpoint — a copy of the internal state. */
  snapshot(): SmaState;
  /** Restores to a checkpoint. Only accepts what `snapshot` handed out. */
  restore(state: SmaState): void;
}

/** Treat this opaquely — its shape can change between versions. */
export type SmaState = SumState;

/**
 * The window mean is the window sum over the period — `sumFold`'s ring,
 * summed afresh each step. It used to keep a running total that subtracted
 * what left the window, and that total carried two flaws no order of
 * operations fixes: the residual a departing outlier leaves behind
 * (`[1e20, 1, 1, 1]` over 3 answered 1/3 — the ones were rounded away while
 * the spike was inside — where the window's mean is 1), and a sum that
 * finite inputs pushed past the double range stayed Infinity for good.
 * Recomputing costs O(period) per step; the state is just the ring.
 */
export function smaFold(period: number): SmaFold {
  const total = sumFold(period);
  return {
    step(value) {
      const sum = total.step(value);
      return sum === null ? null : sum / period;
    },
    snapshot: () => total.snapshot(),
    restore: (state) => total.restore(state),
  };
}

export function sma(values: Values, period: number): (number | null)[] {
  const fold = smaFold(period);
  const out: (number | null)[] = new Array(values.length);
  for (let index = 0; index < values.length; index++) {
    out[index] = fold.step(values[index]);
  }
  return out;
}

/**
 * Exponential moving average. The seed is a simple average of period
 * consecutive values — leading nulls (another indicator's warmup) are
 * skipped, and collection starts after them. A gap before the seed
 * restarts collection from scratch; a gap after the seed nulls only that
 * position (EMA is state, not a window, so one missing value doesn't
 * discard everything).
 */
export function ema(values: Values, period: number): (number | null)[] {
  const alpha = 2 / (period + 1);
  return stateful(
    values,
    period,
    (state, value) => value * alpha + state * (1 - alpha),
  );
}

/** Windowed standard deviation (population) — the width of Bollinger Bands. Same null rule as sma. */
/**
 * Windowed population standard deviation — `stddevFold` in a loop, so the
 * array form pays the fold's O(period) per element: 100k × 20 ≈ 7 ms,
 * 100k × 200 ≈ 60 ms (measured). Bollinger's full path is the caller;
 * its tick re-runs only the bars the tick reaches, a window, not the
 * history.
 */
export function stddev(values: Values, period: number): (number | null)[] {
  const fold = stddevFold(period);
  const out: (number | null)[] = new Array(values.length);
  for (let index = 0; index < values.length; index++) out[index] = fold.step(values[index]);
  return out;
}

/** True Range — `max(high-low, |high-prevClose|, |low-prevClose|)`. The first candle is just high-low (Wilder convention). */
export function trueRanges(data: readonly OHLC[]): number[] {
  return data.map((candle, index) => trueRange(candle, index === 0 ? null : data[index - 1].close));
}

/** One bar's True Range — just `high − low` where there is no previous close. */
export function trueRange(candle: OHLC, previousClose: number | null): number {
  return previousClose === null
    ? candle.high - candle.low
    : Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      );
}

/**
 * Wilder's moving average (RMA) — not just EMA with a different α. The
 * seed is the same, but the recurrence is
 * `(state·(period−1)+value)/period` (α=1/period). Used by RSI, ATR, ADX.
 * Same null rule as ema.
 */
export function rma(values: Values, period: number): (number | null)[] {
  return stateful(
    values,
    period,
    (state, value) => (state * (period - 1) + value) / period,
  );
}

/**
 * A recursive kernel that folds one step at a time — ema and rma differ
 * by only one recurrence line, and they share a single `stateful` for the
 * seed/gap rule (seed on period consecutive values, a gap before the seed
 * restarts from scratch, a gap after the seed nulls only that position).
 * The state is one value plus seed progress, so a checkpoint is cheap —
 * O(1).
 */
export interface RecursiveFold {
  step(value: number | null): number | null;
  snapshot(): RecursiveState;
  restore(state: RecursiveState): void;
}

/** Treat this opaquely — its shape is the fold's own business. */
export interface RecursiveState {
  state: number | null;
  seedSum: number;
  seedCount: number;
}

function recursiveFold(
  period: number,
  advance: (state: number, value: number) => number,
): RecursiveFold {
  assertPeriod(period);

  let state: number | null = null;
  let seedSum = 0;
  let seedCount = 0;

  return {
    step(value) {
      value = observation(value);
      if (value === null) {
        if (state === null) {
          seedSum = 0;
          seedCount = 0;
        }
        return null;
      }

      if (state === null) {
        const sum = seedSum + value;
        if (!committable(sum)) {
          // The seed left the range — start collecting afresh, as after a gap.
          seedSum = 0;
          seedCount = 0;
          return null;
        }
        seedSum = sum;
        seedCount++;
        if (seedCount === period) {
          state = seedSum / period;
          return state;
        }
        return null;
      }

      const next = advance(state, value);
      // A step that left the range is no reading and no state.
      if (!committable(next)) return null;
      state = next;
      return state;
    },

    snapshot() {
      return { state, seedSum, seedCount };
    },

    restore(next) {
      state = next.state;
      seedSum = next.seedSum;
      seedCount = next.seedCount;
    },
  };
}

/** EMA's fold form — the same step as `ema`. */
export function emaFold(period: number): RecursiveFold {
  const alpha = 2 / (period + 1);
  return recursiveFold(period, (state, value) => value * alpha + state * (1 - alpha));
}

/** RMA (Wilder)'s fold form — the same step as `rma`. */
export function rmaFold(period: number): RecursiveFold {
  return recursiveFold(
    period,
    (state, value) => (state * (period - 1) + value) / period,
  );
}

/**
 * A Wilder recursion whose state starts at a constant and applies the
 * recurrence from the first observation on — KDJ's K and D start at 50, so
 * a first RSV of 80 reads K = (50·2 + 80) / 3 = 60, not 80. A null input
 * (a gap, or a value that is not an observation) is no reading and leaves
 * the state where it was — the recursion's memory is counted in
 * observations, not bars, so a node built on it declares no lookback. A
 * step that leaves the range is no reading and no state, like `rmaFold`'s.
 */
export interface SeededRecursiveFold {
  step(value: number | null): number | null;
  snapshot(): SeededRecursiveState;
  restore(state: SeededRecursiveState): void;
}

/** Treat this opaquely — its shape is the fold's own business. */
export interface SeededRecursiveState {
  state: number;
}

/** See `SeededRecursiveFold`. `seed` must be committable — a state the recursion could have reached. */
export function seededRmaFold(period: number, seed: number): SeededRecursiveFold {
  assertPeriod(period);
  if (!committable(seed)) {
    throw new ContractError(`seed must be a finite number short of the largest double, got ${seed}`);
  }
  let state = seed;
  return {
    step(value) {
      value = observation(value);
      if (value === null) return null;
      const next = (state * (period - 1) + value) / period;
      if (!committable(next)) return null;
      state = next;
      return state;
    },
    snapshot() {
      return { state };
    },
    restore(next) {
      state = next.state;
    },
  };
}

function stateful(
  values: Values,
  period: number,
  step: (state: number, value: number) => number,
): (number | null)[] {
  const fold = recursiveFold(period, step);
  const out: (number | null)[] = new Array(values.length);
  for (let index = 0; index < values.length; index++) {
    out[index] = fold.step(values[index]);
  }
  return out;
}

/**
 * The one place a kernel reads a candle's volume: a gap (`null` or
 * absent — see `isGap`) is null here, a number is the number. Every
 * volume-dependent indicator goes through this door, so the README's
 * "needs volume" column can be derived from a call to it — and a `.volume`
 * read anywhere else in this file is refused by the matrix check.
 */
export function volumeOf(candle: OHLC): number | null {
  return isGap(candle.volume) ? null : candle.volume;
}

/**
 * A windowed sum as a fold — `smaFold`'s ring, summed afresh each step
 * rather than kept as a running total: a running sum subtracts what
 * leaves, and after a 1e20 spike leaves a window of ones it answers 1 for
 * `[1, 1, 1]` (the ones were rounded away while the spike was inside —
 * measured; `smaFold` had the same flaw until it became this fold over the
 * period). The division is left to the
 * caller (UO and MFI divide one sum by another). Same null rule: null
 * until the window is full or while it holds a gap — and null when the sum
 * of finite inputs leaves the double range or saturates at its largest value
 * (a ratio of two such sums would read NaN; line data is finite or null).
 * O(period) per step by design; the state is just the ring.
 */
export interface SumFold {
  step(value: number | null): number | null;
  snapshot(): SumState;
  restore(state: SumState): void;
}

/** Treat this opaquely — its shape can change between versions. */
export interface SumState {
  window: (number | null)[];
  at: number;
  count: number;
  filled: number;
}

export function sumFold(period: number): SumFold {
  assertPeriod(period);
  const n = period;
  let window: (number | null)[] = new Array(n).fill(null);
  let at = 0;
  let count = 0;
  let filled = 0;

  return {
    step(value) {
      value = observation(value);
      const leaving = count >= n ? window[at] : null;
      if (leaving !== null) filled--;
      window[at] = value;
      at = (at + 1) % n;
      count++;
      if (value !== null) filled++;
      if (count < n || filled !== n) return null;
      // Oldest first, over the ring's two contiguous runs — `at` is the oldest slot.
      let sum = 0;
      for (let i = at; i < n; i++) sum += window[i] ?? 0;
      for (let i = 0; i < at; i++) sum += window[i] ?? 0;
      // Finite inputs whose sum leaves the double range, or lands on its largest
      // value, have no sum — a ratio of two such sums would read NaN, and line
      // data is finite or null.
      return committable(sum) ? sum : null;
    },
    snapshot() {
      return { window: window.slice(), at, count, filled };
    },
    restore(state) {
      window = state.window.slice();
      at = state.at;
      count = state.count;
      filled = state.filled;
    },
  };
}

/**
 * The windowed extremum as a fold — `highest`/`lowest`'s monotonic deque,
 * with the array's absolute index replaced by a step counter so the state
 * can be snapshotted and resumed. Amortized O(1) per step; a snapshot
 * copies the ring and the deque (O(period)).
 */
export interface ExtremumFold {
  step(value: number | null): number | null;
  snapshot(): ExtremumState;
  restore(state: ExtremumState): void;
}

/** Treat this opaquely — its shape can change between versions. */
export interface ExtremumState {
  ring: (number | null)[];
  count: number;
  filled: number;
  /** Step indices of the extremum candidates, oldest first. */
  deque: number[];
}

function extremumFold(
  period: number,
  keep: (incumbent: number, entering: number) => boolean,
): ExtremumFold {
  assertPeriod(period);
  let ring: (number | null)[] = new Array(period).fill(null);
  let count = 0;
  let filled = 0;
  let deque: number[] = [];

  return {
    step(value) {
      value = observation(value);
      const index = count;
      count++;
      const slot = index % period;
      const leavingIndex = index - period;
      // The slot still holds the value that is leaving the window.
      if (leavingIndex >= 0 && ring[slot] !== null) filled--;
      while (deque.length > 0 && deque[0] <= leavingIndex) deque.shift();
      ring[slot] = value;
      if (value !== null) {
        filled++;
        while (deque.length > 0) {
          const incumbent = ring[deque[deque.length - 1] % period];
          if (incumbent === null || keep(incumbent, value)) break;
          deque.pop();
        }
        deque.push(index);
      }
      if (index < period - 1 || filled !== period) return null;
      return ring[deque[0] % period];
    },
    snapshot() {
      return { ring: ring.slice(), count, filled, deque: deque.slice() };
    },
    restore(state) {
      ring = state.ring.slice();
      count = state.count;
      filled = state.filled;
      deque = state.deque.slice();
    },
  };
}

/** `highest`'s fold form — same tie rule (the later index wins). */
export function highestFold(period: number): ExtremumFold {
  return extremumFold(period, (incumbent, entering) => incumbent > entering);
}

/** `lowest`'s fold form. */
export function lowestFold(period: number): ExtremumFold {
  return extremumFold(period, (incumbent, entering) => incumbent < entering);
}

/**
 * The windowed population standard deviation as a fold — and the one
 * copy of the arithmetic: the array `stddev` is this fold in a loop.
 *
 * Numerics, since a variance is where running sums fail: `Σy²/n − mean²`
 * cancels catastrophically when the spread is small next to the level
 * (prices near 1e6 with a spread of 0.03 came out 700% wrong — measured),
 * and an incremental update that *subtracts* a departing value cancels
 * again whenever that value dwarfs what remains (a 1e9 spike leaving a
 * window of 1e6 prices left the residual 20% wrong; two such departures
 * in a row slipped past a guard). So nothing is subtracted, ever: each
 * step sweeps the window twice — a mean, then squared deviations — with
 * every value taken relative to the window's oldest value so the sums
 * are the size of the spread, not the level. O(period) per step by
 * design; period is in the tens, and the tick's own `slice + concat`
 * over the whole history is a hundred thousand pointers. The state is
 * just the ring.
 */
export interface StddevFold {
  step(value: number | null): number | null;
  snapshot(): StddevState;
  restore(state: StddevState): void;
}

/** Treat this opaquely — its shape can change between versions. */
export interface StddevState {
  window: (number | null)[];
  at: number;
  count: number;
  filled: number;
}

export function stddevFold(period: number): StddevFold {
  assertPeriod(period);
  const n = period;
  let window: (number | null)[] = new Array(n).fill(null);
  let at = 0;
  let count = 0;
  let filled = 0;

  return {
    step(value) {
      value = observation(value);
      const leaving = count >= n ? window[at] : null;
      if (leaving !== null) filled--;
      window[at] = value;
      at = (at + 1) % n;
      count++;
      if (value !== null) filled++;
      if (count < n || filled !== n) return null;
      // Two passes over the ring's two contiguous runs (`at` is the oldest
      // slot) — the origin is the oldest value.
      const origin = window[at] ?? 0;
      let sum = 0;
      for (let i = at; i < n; i++) sum += (window[i] ?? 0) - origin;
      for (let i = 0; i < at; i++) sum += (window[i] ?? 0) - origin;
      const mean = sum / n;
      let squares = 0;
      for (let i = at; i < n; i++) {
        const deviation = (window[i] ?? 0) - origin - mean;
        squares += deviation * deviation;
      }
      for (let i = 0; i < at; i++) {
        const deviation = (window[i] ?? 0) - origin - mean;
        squares += deviation * deviation;
      }
      const deviation = Math.sqrt(squares / n);
      return committable(deviation) ? deviation : null;
    },
    snapshot() {
      return { window: window.slice(), at, count, filled };
    },
    restore(state) {
      window = state.window.slice();
      at = state.at;
      count = state.count;
      filled = state.filled;
    },
  };
}

/**
 * The value `lag` steps ago — Momentum's `close[n]`, and the previous
 * close/typical price the range-based kernels compare against. null until
 * `lag` steps have gone by; a lagged null stays null. Its share of a
 * landing's lookback is `lag`, not `lag − 1`.
 */
export interface LagFold {
  step(value: number | null): number | null;
  snapshot(): LagState;
  restore(state: LagState): void;
}

/** Treat this opaquely — its shape can change between versions. */
export interface LagState {
  ring: (number | null)[];
  at: number;
  count: number;
}

export function lagFold(lag: number): LagFold {
  if (!Number.isInteger(lag) || lag < 1) {
    throw new ContractError(`lag must be a positive integer, got ${lag}`);
  }
  const size = lag + 1;
  let ring: (number | null)[] = new Array(size).fill(null);
  let at = 0;
  let count = 0;

  return {
    step(value) {
      value = observation(value);
      ring[at] = value;
      at = (at + 1) % size;
      count++;
      // `at` now points at the oldest slot — the value `lag` steps back.
      return count > lag ? ring[at] : null;
    },
    snapshot() {
      return { ring: ring.slice(), at, count };
    },
    restore(state) {
      ring = state.ring.slice();
      at = state.at;
      count = state.count;
    },
  };
}

/**
 * The end point of a least-squares line over the last `period` values —
 * TradingView's `linreg(source, length, 0)`, the Squeeze histogram. Fitted
 * afresh each step, centered: with `ȳ` the window mean and `k̄ = (n − 1)/2`,
 * `slope = Σ(k − k̄)(y − ȳ) / Σ(k − k̄)²` and the end point is `ȳ + slope ·
 * (n − 1 − k̄)`. Every value is taken relative to the **newest** one: the
 * end point sits near it, so what is added back to it is small, and for
 * `n = 2` the answer is that value exactly (a two-point line ends on its
 * second point) — returned as such. No running sum is kept, so nothing
 * is ever subtracted out — the rolling form (`T' = T − S + y₀ + (n − 1)·y`)
 * drifted and lost its digits whenever a departing value dwarfed the
 * rest. O(period) per step by design, like `stddevFold`. The state is
 * just the ring.
 *
 * Conditioning is the data's, not the kernel's: a window whose values
 * span fourteen orders of magnitude (a 1e20 spike among 1e6 prices) has
 * no double-precision fit to better than about `n · max|y| · ε` in
 * absolute terms, whatever the algorithm — every one of the `n` shifted
 * terms carries the spike's rounding. Relative to the end point that is
 * still ~1e-10 (measured: period 4096, trailing 1e20 spike).
 */
export interface LinregFold {
  step(value: number | null): number | null;
  snapshot(): LinregState;
  restore(state: LinregState): void;
}

/** Treat this opaquely — its shape can change between versions. */
export interface LinregState {
  window: (number | null)[];
  at: number;
  count: number;
  filled: number;
}

export function linregFold(period: number): LinregFold {
  assertPeriod(period);
  const n = period;
  const meanK = (n - 1) / 2;
  let denominator = 0;
  for (let k = 0; k < n; k++) denominator += (k - meanK) * (k - meanK);
  let window: (number | null)[] = new Array(n).fill(null);
  let at = 0;
  let count = 0;
  let filled = 0;

  return {
    step(value) {
      value = observation(value);
      const leaving = count >= n ? window[at] : null;
      if (leaving !== null) filled--;
      window[at] = value;
      at = (at + 1) % n;
      count++;
      if (value !== null) filled++;
      if (count < n || filled !== n) return null;
      // `at` is the oldest slot; the newest sits just before it.
      const newest = window[(at + n - 1) % n] ?? 0;
      if (n <= 2) return newest;
      let sum = 0;
      for (let i = at; i < n; i++) sum += (window[i] ?? 0) - newest;
      for (let i = 0; i < at; i++) sum += (window[i] ?? 0) - newest;
      const mean = sum / n;
      let covariance = 0;
      let k = 0;
      for (let i = at; i < n; i++, k++) covariance += (k - meanK) * ((window[i] ?? 0) - newest - mean);
      for (let i = 0; i < at; i++, k++) covariance += (k - meanK) * ((window[i] ?? 0) - newest - mean);
      const slope = covariance / denominator;
      const fit = newest + mean + slope * (n - 1 - meanK);
      return committable(fit) ? fit : null;
    },
    snapshot() {
      return { window: window.slice(), at, count, filled };
    },
    restore(state) {
      window = state.window.slice();
      at = state.at;
      count = state.count;
      filled = state.filled;
    },
  };
}

/** Windowed maximum — `highestFold` in a loop, so one implementation and one null rule. Used by Stochastic and Williams %R. */
export function highest(values: Values, period: number): (number | null)[] {
  return folded(highestFold(period), values);
}

/** Windowed minimum. `highest`'s counterpart — same rule. */
export function lowest(values: Values, period: number): (number | null)[] {
  return folded(lowestFold(period), values);
}

/** A fold over a whole array — the array kernels are their folds in a loop. */
function folded(fold: { step(value: number | null): number | null }, values: Values): (number | null)[] {
  const out: (number | null)[] = new Array(values.length);
  for (let index = 0; index < values.length; index++) out[index] = fold.step(values[index]);
  return out;
}

/** An array from outside — if it's null, this names the factory instead of throwing a bare `TypeError`. */
/**
 * How far back a recursive fold's memory reaches, in steps — the smallest
 * k where a disturbance at the seed has decayed below `epsilon` of its
 * size ((1-alpha)^k < epsilon).
 *
 * This is what lets an EMA-family kernel land a history page: the landing
 * restarts the fold at the new beginning of time, and past this horizon
 * the restarted values agree with the old ones to below the landing
 * contract's bound — not an approximation, just a very wide corrected
 * zone. EMA(20) comes out around 340 at 1e-12.
 */
export function decayHorizon(alpha: number, epsilon = 1e-12): number {
  if (!(alpha > 0 && alpha <= 1)) {
    throw new ContractError(`decayHorizon: alpha must be in (0, 1], got ${alpha}`);
  }
  // Full weight on the current value — the fold has no memory to reach back into.
  if (alpha === 1) return 0;
  return Math.ceil(Math.log(epsilon) / Math.log(1 - alpha));
}

export function requireSourceArray<T>(value: readonly T[], name: string): readonly T[] {
  if (!Array.isArray(value)) {
    throw new ContractError(
      `${name} input must be an array, got ${value === null ? "null" : typeof value}`,
    );
  }
  return value;
}

/** If options is null, this names the factory instead of throwing a bare `TypeError`. */
export function requireOptions<T>(options: T, name: string): T {
  if (typeof options !== "object" || options === null) {
    throw new ContractError(
      `${name} options must be an object, got ${options === null ? "null" : typeof options}`,
    );
  }
  return options;
}

/** Reports the value honestly — a string shows up quoted, distinguishing it from a real number. */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `array(length ${value.length})`;
  if (typeof value === "object" && value !== null) return "object";
  return String(value);
}

/**
 * The door for numeric parameters (`multiplier`, `step`, `max`). Values
 * can arrive as strings from `localStorage`, URL parameters, and the
 * like, and `+`/`*` operations let a string slip through by accident,
 * quietly producing NaN — the error surfaces much later and points
 * suspicion at some other call's data instead.
 */
export function assertRatio(value: number, name: string, factory: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ContractError(
      `${factory}({ ${name} }) must be a positive number, got ${describeValue(value)}`,
    );
  }
}

/**
 * Validates the options together with `source` — leaving source
 * validation to core's `computation` alone means the error speaks by
 * position, so the consumer can't tell which option key (`source`) they
 * left out.
 */
export function requireAttachOptions<T extends { source?: unknown; node?: unknown }>(
  options: T,
  name: string,
): T {
  requireOptions(options, name);
  // Two doors, one taken: a `node` key that is present decides for the node
  // door even when it is undefined — the type keeps `{ source, node }` out,
  // and here a present-but-undefined node is refused rather than silently
  // falling back to the source it was probably meant to replace.
  if ("node" in options) {
    const node = options.node;
    // `typeof null === "object"` — an `out` of null is not a record either.
    const out = typeof node === "object" && node !== null ? Reflect.get(node, "out") : null;
    if (typeof out !== "object" || out === null) {
      throw new ContractError(
        `${name}({ node }) must be a computed node (something with an out record): ${describeValue(node)}`,
      );
    }
    if (options.source !== undefined) {
      throw new ContractError(`${name}: give a source or a node, not both`);
    }
    if (typeof Reflect.get(options, "name") !== "string") {
      throw new ContractError(`${name}({ node }) needs a name — a node does not carry its formula`);
    }
    return options;
  }
  const source = options.source;
  // `Reflect.get` returns `unknown` — the idiom for reading an unknown shape without an assertion.
  if (
    typeof source !== "object" ||
    source === null ||
    typeof Reflect.get(source, "read") !== "function"
  ) {
    throw new ContractError(
      `${name}({ source }) must be a Source (something with a read method): ${describeValue(source)}`,
    );
  }
  return options;
}

export function assertPredicate(
  value: unknown,
  name: string,
  factory: string,
): void {
  if (typeof value !== "function") {
    throw new ContractError(
      `${factory}({ ${name} }) must be a function, got ${describeValue(value)}`,
    );
  }
}

/**
 * The displacement must be a non-negative integer. Violate it and it
 * becomes `NaN`, which quietly drops the `y` key from `spanA`/`spanB`
 * points — the consumer ends up doubting their own data's field names.
 */
export function assertDisplacement(value: number, factory: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ContractError(
      `${factory}({ displacement }) must be a non-negative integer, got ${describeValue(value)}`,
    );
  }
}

/**
 * What a fold may observe: a committable number, or null for "no value".
 * Finite inputs whose arithmetic left the double range arrive as Infinity,
 * NaN or the largest double, and a fold that kept one in its state (a
 * running sum, a recursion) would never come back — a signal window fed
 * +MAX and −MAX would even average them to a wrong 0. So every fold's
 * `step` takes them as null; what a fold carries is therefore committable
 * too.
 */
function observation(value: number | null): number | null {
  return value === null || committable(value) ? value : null;
}

/**
 * What a fold may keep as state or hand on: finite, and short of the largest
 * double — a value that saturated there has stopped being a sum. Finite inputs
 * can produce anything else (a seed sum of two 1e308s), and a fold that kept
 * it would never come back.
 */
export function committable(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) < Number.MAX_VALUE;
}

/**
 * A tuple option that must be exactly four windows (BBI, CR — the count is
 * part of the definition). The type says so; this is the door for a
 * JavaScript caller, whose short array would otherwise reach `assertPeriod`
 * as `undefined` and whose long array would quietly use four of many.
 */
export function assertFourPeriods(periods: readonly number[], factory: string): void {
  if (!Array.isArray(periods) || periods.length !== 4) {
    throw new ContractError(
      `${factory}({ periods }) must be exactly four windows, got ${describeValue(periods)}`,
    );
  }
}

/** The door every windowed indicator's `period` passes — a positive integer. Package-internal: `atrPriceStep` shares it. */
export function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    // Throws ContractError — the contract that the error reporter filters
    // by name crosses the package boundary. It skips describeValue because
    // assertPeriod runs through every indicator and is sensitive to bundle
    // size.
    throw new ContractError(`period must be an integer of at least 1, got ${period}`);
  }
}

/**
 * Windowed mean absolute deviation — CCI's denominator. Looks at the
 * window twice (mean, then deviation) — O(n·period), but period is in the
 * tens so that's fine. Same null rule as sma. `?? mean` is unreachable
 * defensive type narrowing (if it ever leaks through, that term is 0).
 */
export function meanAbsDeviation(
  values: Values,
  period: number,
): (number | null)[] {
  const means = sma(values, period);
  const out: (number | null)[] = new Array(values.length).fill(null);

  for (let index = period - 1; index < values.length; index++) {
    const mean = means[index];
    if (mean === null) continue;

    let sum = 0;
    for (let back = 0; back < period; back++) {
      sum += Math.abs((values[index - back] ?? mean) - mean);
    }
    out[index] = sum / period;
  }

  return out;
}
