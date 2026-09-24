import type { BaseDataPoint, Computation, HistogramPoint, LineDataPoint, Source } from "@finchart/core";
import { ContractError, computation } from "@finchart/core";
import { committable } from "./kernels";
import { toneOf } from "./tone";

/**
 * What an indicator has to say to become a node with a real increment:
 * its folds, how to checkpoint them, and one step. The builder owns the
 * rest — and there is exactly one builder, so "the full path and the tail
 * path stand on the same fold" is a fact about this file, not a
 * discipline every factory keeps by hand.
 */
export interface FoldSpec<T extends BaseDataPoint, F, S, K extends string, TK extends K = never> {
  /** The output branches — fixed up front, so an empty input still names them. */
  keys: readonly K[];
  /**
   * The branches drawn as histogram bars that carry their direction: the
   * builder writes `tone` on their points (`toneOf`, against the branch's
   * own previous value), and only on theirs — a marker row that shares the
   * node stays a plain `{ x, y }`. A toned branch remembers one bar back,
   * so its `headLookback` carries `+ 1`.
   */
  toneKeys?: readonly TK[];
  /** Fresh folds (plus whatever scalar state the step needs). */
  make(): F;
  /** A resume checkpoint. Each kernel's own `snapshot` does the copying. */
  snapshot(folds: F): S;
  restore(folds: F, state: S): void;
  /**
   * One bar in, one value per branch out. null is the warmup or a gap.
   *
   * The numeric contract, in one place. Line data is finite or null, and
   * "a reading exists when the arithmetic stays in the double range" —
   * not "every mathematically finite result is found":
   * - every kernel fold's `step` takes a non-committable input as null
   *   (`observation`), so no fold's state is fed an Infinity, a NaN or the
   *   largest double — including a saturated value one formula hands to
   *   its signal window;
   * - what a fold *computes* — a sum, a mean, a deviation, a fit, a seed, a
   *   recursion step, a running total — it keeps as state, or hands on, only
   *   when finite and short of the largest double (`committable`): a window
   *   sum that overflowed is null, a recursion seed that overflowed
   *   restarts, a recursion step or a fit that left the range is null. An
   *   observation a fold merely *carries* (`lagFold`, an extremum,
   *   `linregFold` at n ≤ 2, where the fit is the newest value) passes as
   *   observed — committable by the door above;
   * - the builder emits null for a step value that is not finite or that
   *   saturates at the largest double (`reading`);
   * - rounding is part of the reading, gradual underflow included: a result
   *   that rounds to a subnormal or to 0 is what double arithmetic gives for
   *   those operands, and no door tells a rounded 0 from an exact one — the
   *   doors are for what leaves the range (an Infinity, a NaN, the largest
   *   double), which would break the finite-or-null line contract and, in a
   *   recursion, poison every later bar; a rounded 0 does neither;
   * - a formula's own undefined cases are decided on the inputs, before any
   *   arithmetic, and are null: no previous close (VR's up, down or flat
   *   classification), no previous bar (EMV), a zero previous close (PVT's
   *   percent change), a window with no down volume and no flat volume
   *   (VR's denominator), a zero range or a zero volume (EMV's box ratio,
   *   `volume / range` in the canonical formulation, has no value at
   *   either). A running sum is not undefined before its first
   *   contribution — PVT's first bar reads its starting point, 0, by the
   *   same token that OBV's does. These are definitions, part of
   *   what each factory's JSDoc states, not doors on a computed result;
   * - an intermediate that overflows is no reading, except where the formula
   *   itself defines a rescaling for it (VR's ratio is scale-invariant and
   *   rescales an overflowed side); no other order of operations is tried
   *   on its behalf at run time. Within the range a reading is what double
   *   arithmetic gives, in the order the factory's own JSDoc states for that
   *   formula — an order chosen once, for its numerical behaviour, and
   *   documented where it differs from the canonical source (VR multiplies
   *   by 100 before dividing; EMV takes the extremes' moves before halving)
   *   — with no claim of exactness beyond that (a window sum of
   *   `[1e20, 1, −1e20]` reads 0). The doors sit at
   *   what is kept, handed on, or named above; an intermediate inside one
   *   expression (a partial sum that passes through the largest double and
   *   comes back, an operand that is exactly the largest double) is not a
   *   door — it is arithmetic, and its result is judged where it lands.
   *   Candle fields themselves are finite by the core's data gate.
   * The same door means a NaN from a coding error becomes a gap rather than
   * a downstream `DataError`; the tests hold each formula to hand
   * calculations and canonical oracles for exactly that reason.
   */
  step(folds: F, point: T): Record<K, number | null>;
  /**
   * How far back a landing corrects — the chained sum of the folds'
   * memories: `period − 1` for a window, `decayHorizon` for a recursion,
   * `lag` (not `lag − 1`) for a lag.
   *
   * Omit it when no constant is true: a running sum whose memory is the
   * whole history, or a recursion fed a nullable input, whose memory is
   * measured in valid inputs rather than bars (once seeded, a null pauses
   * the recursion and keeps its state; while seeding, a null restarts the
   * seed). Without a door a landing recomputes everything — always right,
   * never cheap — which is what `obv` and `vwap` already do. Leave the key
   * out rather than writing `headLookback: undefined`: the README matrix is
   * derived from the source text and reads the key's presence.
   */
  headLookback?: number;
}

/** The plain branches as lines, the toned ones as histogram points — each branch one shape. */
export type FoldOutput<K extends string, TK extends K> = Record<Exclude<K, TK>, LineDataPoint[]> &
  Record<TK, HistogramPoint[]>;

/**
 * Builds a computed node whose tick is an increment: `calc` folds the whole
 * input and leaves two checkpoints (just before the last step, for a
 * replace; at the end, for a new bar), `calcLast` restores one and folds
 * only the tail, reusing the front of the previous arrays so downstream
 * reads a tail change. A replace deeper than the last bar falls back to
 * the full path. The checkpoints are taken by `calc` — after a declared
 * landing the node runs `calc` once more before trusting them again
 * (that rule lives in core, not here).
 */
export function foldNode<T extends BaseDataPoint, F, S, K extends string, TK extends K = never>(
  source: Source<T>,
  spec: FoldSpec<T, F, S, K, TK>,
): Computation<FoldOutput<K, TK>> {
  const toneKeys: readonly TK[] = spec.toneKeys ?? [];
  const toned = new Set<string>(toneKeys);
  const plainKeys = spec.keys.filter((key): key is Exclude<K, TK> => !toned.has(key));
  const tailFolds = spec.make();
  let beforeLast: S | null = null;
  let atEnd: S | null = null;

  return computation({
    inputs: [source],

    calc: (data) => {
      const folds = spec.make();
      let nextBeforeLast: S | null = null;
      const lines = record(plainKeys, () => new Array<LineDataPoint>(data.length));
      const bars = record(toneKeys, () => new Array<HistogramPoint>(data.length));
      for (let i = 0; i < data.length; i++) {
        if (i === data.length - 1) nextBeforeLast = spec.snapshot(folds);
        const values = spec.step(folds, data[i]);
        for (const key of plainKeys) lines[key][i] = { x: data[i].x, y: reading(values[key]) };
        for (const key of toneKeys) {
          const y = reading(values[key]);
          bars[key][i] = { x: data[i].x, y, tone: toneOf(i > 0 ? bars[key][i - 1].y : undefined, y) };
        }
      }
      const nextAtEnd = spec.snapshot(folds);
      const output = { ...lines, ...bars };
      beforeLast = nextBeforeLast;
      atEnd = nextAtEnd;
      return output;
    },

    calcLast: (previous, [data], [change]) => {
      if (change.kind === "none") return previous;
      // The checkpoints cover one step back — a deeper replace recomputes.
      if (change.kind === "replace" && change.count !== 1) return null;
      const resume = change.kind === "replace" ? beforeLast : atEnd;
      if (resume === null) return null;

      spec.restore(tailFolds, resume);
      const count = change.count;
      // The kept prefix ends where the tail starts — for an append that is
      // all of `previous`, for a one-bar replace all but its last point.
      const from = data.length - count;
      const previousLines: Record<Exclude<K, TK>, LineDataPoint[]> = previous;
      const previousBars: Record<TK, HistogramPoint[]> = previous;
      const lineTails = record(plainKeys, () => new Array<LineDataPoint>(count));
      const barTails = record(toneKeys, () => new Array<HistogramPoint>(count));
      let nextBeforeLast = beforeLast;
      for (let i = from; i < data.length; i++) {
        if (i === data.length - 1) nextBeforeLast = spec.snapshot(tailFolds);
        const values = spec.step(tailFolds, data[i]);
        for (const key of plainKeys) lineTails[key][i - from] = { x: data[i].x, y: reading(values[key]) };
        for (const key of toneKeys) {
          const y = reading(values[key]);
          // The tail's first bar looks back into the kept prefix — the
          // folds were restored, but the previous value is data, not state.
          const back = i === from ? previousBars[key][from - 1] : barTails[key][i - from - 1];
          barTails[key][i - from] = { x: data[i].x, y, tone: toneOf(back?.y, y) };
        }
      }
      const nextAtEnd = spec.snapshot(tailFolds);

      const output = {
        ...record(plainKeys, (key) => previousLines[key].slice(0, from).concat(lineTails[key])),
        ...record(toneKeys, (key) => previousBars[key].slice(0, from).concat(barTails[key])),
      };
      // Publish only after every step and output branch succeeded.
      beforeLast = nextBeforeLast;
      atEnd = nextAtEnd;
      return output;
    },

    headLookback: spec.headLookback,
  });
}

/** A step's value as line data: committable, or null — Infinity, NaN and a saturated value are no reading. */
function reading(value: number | null): number | null {
  return value === null || committable(value) ? value : null;
}

/** A record over a known key list — built key by key, then checked whole. */
function record<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
  const partial: Partial<Record<K, V>> = {};
  for (const key of keys) partial[key] = value(key);
  if (!complete(partial, keys)) {
    throw new ContractError("foldNode: a branch went missing while building the output");
  }
  return partial;
}

function complete<K extends string, V>(
  partial: Partial<Record<K, V>>,
  keys: readonly K[],
): partial is Record<K, V> {
  return keys.every((key) => key in partial);
}
