import { ContractError } from "@finchart/core";

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
export interface SmaState {
  window: (number | null)[];
  at: number;
  count: number;
  sum: number;
  filled: number;
}

export function smaFold(period: number): SmaFold {
  assertPeriod(period);

  // A ring of the last period values — running the fold requires knowing what's leaving.
  let window: (number | null)[] = new Array(period).fill(null);
  let at = 0;
  let count = 0;
  let sum = 0;
  let filled = 0;

  return {
    step(value) {
      const leaving = count >= period ? window[at] : null;
      if (leaving !== null) {
        sum -= leaving;
        filled--;
      }

      window[at] = value;
      at = (at + 1) % period;
      count++;
      if (value !== null) {
        sum += value;
        filled++;
      }

      return count >= period && filled === period ? sum / period : null;
    },

    snapshot() {
      return { window: window.slice(), at, count, sum, filled };
    },

    restore(state) {
      window = state.window.slice();
      at = state.at;
      count = state.count;
      sum = state.sum;
      filled = state.filled;
    },
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
export function stddev(values: Values, period: number): (number | null)[] {
  assertPeriod(period);

  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  let squares = 0;
  let filled = 0;

  for (let index = 0; index < values.length; index++) {
    const entering = values[index];
    if (entering !== null) {
      sum += entering;
      squares += entering * entering;
      filled++;
    }

    const leaving = index - period;
    if (leaving >= 0) {
      const value = values[leaving];
      if (value !== null) {
        sum -= value;
        squares -= value * value;
        filled--;
      }
    }

    if (index >= period - 1 && filled === period) {
      const mean = sum / period;
      // Floating-point error can nudge this slightly negative — clamp to 0.
      out[index] = Math.sqrt(Math.max(0, squares / period - mean * mean));
    }
  }

  return out;
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
      if (value === null) {
        if (state === null) {
          seedSum = 0;
          seedCount = 0;
        }
        return null;
      }

      if (state === null) {
        seedSum += value;
        seedCount++;
        if (seedCount === period) {
          state = seedSum / period;
          return state;
        }
        return null;
      }

      state = advance(state, value);
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

/** Windowed maximum — same null rule as sma. Used by Stochastic and Williams %R. */
export function highest(values: Values, period: number): (number | null)[] {
  return extremum(values, period, (incumbent, entering) => incumbent > entering);
}

/** Windowed minimum. `highest`'s counterpart — same rule. */
export function lowest(values: Values, period: number): (number | null)[] {
  return extremum(values, period, (incumbent, entering) => incumbent < entering);
}

/**
 * Pulls the windowed extremum in O(n) with a monotonic deque. When `keep`
 * is true, the existing value stays the extremum candidate over the new
 * one (ties favor the later index).
 */
function extremum(
  values: Values,
  period: number,
  keep: (incumbent: number, entering: number) => boolean,
): (number | null)[] {
  assertPeriod(period);

  const out: (number | null)[] = new Array(values.length).fill(null);
  const deque: number[] = [];
  let filled = 0;

  for (let index = 0; index < values.length; index++) {
    const entering = values[index];
    if (entering !== null) {
      filled++;
      while (
        deque.length > 0 &&
        !keep(values[deque[deque.length - 1]] as number, entering)
      ) {
        deque.pop();
      }
      deque.push(index);
    }

    const leaving = index - period;
    if (leaving >= 0 && values[leaving] !== null) filled--;
    while (deque.length > 0 && deque[0] <= leaving) deque.shift();

    if (index >= period - 1 && filled === period) {
      out[index] = values[deque[0]] as number;
    }
  }

  return out;
}

/** An array from outside — if it's null, this names the factory instead of throwing a bare `TypeError`. */
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
export function requireAttachOptions<T extends { source?: unknown }>(
  options: T,
  name: string,
): T {
  requireOptions(options, name);
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

/**
 * Sibling `vwap`'s anchor is optional (`anchor?.()`), so it's safe, but
 * `pivotPoints`'s is required — omitting it produces a bare
 * `TypeError: anchor is not a function`.
 */
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

function assertPeriod(period: number): void {
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
