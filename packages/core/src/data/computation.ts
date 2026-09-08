import { ContractError, describe } from "../primitives";
import { headDelta, type HeadChange } from "./head-delta";
import { tailDelta, type TailChange } from "./tail-delta";
import type { BaseDataPoint, DataView, Source } from "./types";

/**
 * A computation that runs once and produces several branches. MACD isn't
 * one line but three (macd, signal, histogram) — computing each series
 * separately would run the same EMA three times. Here it runs once and
 * hands out the branches.
 */
export interface Computation<TOut extends Record<string, BaseDataPoint[]>> {
  /**
   * The branches. Each one becomes a registration's `input` as is.
   *
   * ```ts
   * lower.addSeries({ series: lineSeries(), input: macd.out.signal });
   * ```
   */
  readonly out: { [K in keyof TOut]: Source<TOut[K][number]> };
}

/** A tuple turning input sources into their point arrays. `calc` receives them in this order. */
type ReadOf<TIn extends readonly Source<BaseDataPoint>[]> = {
  [K in keyof TIn]: TIn[K] extends Source<infer T> ? DataView<T> : never;
};

export interface ComputationSpec<
  TIn extends readonly Source<any>[],
  TOut extends Record<string, BaseDataPoint[]>,
> {
  /**
   * What this runs on. An array — some indicators watch price and volume
   * together, and an element can be a series handle or another
   * computation's branch (which is why an indicator built on an indicator
   * comes for free).
   */
  inputs: TIn;

  /**
   * Produces the points to draw for each branch. Receives the whole input,
   * not just the visible range — an indicator that looks backward, like a
   * moving average, needs that so it doesn't cut off at the left edge of
   * the screen. Must emit the same keys even when the input is empty —
   * branch names are fixed on the first computation, and a key absent then
   * can never be referenced later.
   */
  calc: (...inputs: ReadOf<TIn>) => TOut;

  /**
   * The tail increment. Without it, this is a full recompute. Only called
   * when every input's change is tail-only (`changes[i]` is input i's
   * shape). Returning `null` falls back to a full computation — the escape
   * hatch for a shape the checkpoint can't handle (multiple replacements,
   * etc.).
   *
   * Build the output array by reusing the front of the previous array
   * (`slice`/`concat`) — unchanged point objects need to keep their
   * identity for this branch's consumers to reach the same verdict. A
   * kernel without a cheap resume point can still hand them that: a full
   * recompute that keeps the unchanged objects,
   * `(previous, inputs) => reuseUnchanged(previous, calc(...inputs))`.
   */
  calcLast?: (
    previous: TOut,
    inputs: ReadOf<TIn>,
    changes: readonly TailChange[],
  ) => TOut | null;

  /**
   * The head increment — a history page landing on this node's inputs.
   * Only called when every input's change reads as a prepend (or
   * nothing); `null` falls back to a full computation, and that fallback
   * is also the door's own safety valve — a kernel that can't vouch for
   * its resume point (a recursion whose seed moved) answers null instead
   * of guessing.
   *
   * Build each branch by computing the new head (plus whatever old head
   * positions the landing corrects) and **reusing the previous array's
   * tail beyond that** (`slice`/`concat`) — the reused identities are how
   * this branch's consumers classify the landing in turn. Unlike the
   * declared door, this one does not call `calc`, so the node leaves your
   * `calcLast` checkpoints alone — if your `calcFirst` touches them, it
   * owns keeping them true.
   */
  calcFirst?: (
    previous: TOut,
    inputs: ReadOf<TIn>,
    changes: readonly ({ kind: "none" } | HeadChange)[],
  ) => TOut | null;

  /**
   * The declarative head door — for the common case, where `calc` emits
   * one output per input position, left to right. Declare how far back a
   * landing corrects (a window's warmup, a recursion's decay horizon) and
   * the node lands pages by itself: it re-runs `calc` on the prefix
   * (`count + headLookback` positions — a landing's resume point is the
   * beginning of time, so no checkpoint is needed) and reuses each
   * branch's tail as is.
   *
   * That prefix run is a real call to your `calc`: a resume checkpoint it
   * keeps for `calcLast` now describes the prefix's end, not the array's.
   * The node knows this — the first tick after a declared landing is a
   * full computation, and `calcLast` is used again only after that.
   *
   * The 1:1 assumption is checked at runtime, per branch, per landing —
   * a branch whose prefix output isn't position-aligned makes the door
   * decline and the full path answer, which is always correct. A door
   * that needs a different head shape writes `calcFirst` instead; the two
   * are one way each, so declaring both is refused.
   */
  headLookback?: number | (() => number);
}

/**
 * Builds a computed node. A free function that doesn't know about
 * `Plot` — both input and output are values, so there's nothing to
 * register with the chart. An extension is something you import and
 * attach, not something that grows the core API.
 *
 * ```ts
 * const price = pane.addSeries({ series: candleSeries(), data: candles });
 * const macd  = computation({
 *   inputs: [price],
 *   calc: (candles) => ({ macd, signal, histogram }),
 * });
 *
 * lower.addSeries({ series: lineSeries(), input: macd.out.signal });
 * lower.addSeries({ series: lineSeries(), input: macd.out.histogram });
 * ```
 *
 * Pull-based — reading a branch returns the last result unchanged if the
 * input is unchanged. So no matter how many branches there are, one data
 * change means one computation, and a branch nobody draws just sits there
 * with its value computed and unused.
 */
/**
 * Hands back the previous output object wherever the new one is the same
 * plain record — the explicit way for a full recompute to meet
 * `calcLast`'s identity requirement:
 *
 * ```ts
 * calcLast: (previous, inputs) => reuseUnchanged(previous, calc(...inputs)),
 * ```
 *
 * Downstream, a change's shape is read from point identity (`tailDelta`):
 * with every position a fresh object, a one-bar tick reads as a full
 * change and every consumer re-validates and copies its whole array.
 *
 * Why a call, not something the node does on its own: the points are
 * compared as **plain data records** — plain objects whose own
 * enumerable string keys are their whole state, with `===` values (`NaN`
 * never matches; 0 and -0 are told apart). That is a fact about the
 * `{ x, y }` literal your calc built; it is not something a node can
 * assume about arbitrary output — a value behind a getter, a symbol key,
 * a cache keyed by the object itself would all be missed — so a node
 * without `calcLast` keeps every new object. Anything not a plain object
 * (a class instance, a Proxy, a non-object entry) is not judged and stays
 * the new object.
 *
 * Pure: neither argument is touched. A branch with nothing to reuse is
 * returned as is; otherwise a copy carries the reused objects (frozen in,
 * frozen out). The walk costs about 5× the `map` that produced the
 * points — measured ~70 ns per point: 14 ms for 100k × 2 branches, 1.4 ms
 * for 10k × 2 — against the full path it prevents, which re-validates and
 * re-maps every point per consumer.
 */
export function reuseUnchanged<TOut extends Record<string, BaseDataPoint[]>>(
  previous: TOut,
  next: TOut,
): TOut {
  // Not records — nothing to judge; hand `next` on for the data door to name.
  if (typeof previous !== "object" || previous === null) return next;
  if (typeof next !== "object" || next === null) return next;
  let out: TOut | null = null;
  for (const key in next) {
    const before = previous[key];
    const after = next[key];
    if (!Array.isArray(before) || !Array.isArray(after)) continue;
    const reused = reuseBranch(before, after);
    if (reused === null) continue;
    if (out === null) out = { ...next };
    // `Reflect.set`: `out[key]` is `TOut[K]`, and a copy of it is only
    // known to be `BaseDataPoint[]` — the same array type, but not the
    // same name — so the write goes through the reflective door instead
    // of an assertion.
    Reflect.set(out, key, Object.isFrozen(after) ? Object.freeze(reused) : reused);
  }
  return out ?? next;
}

/** A copy of `after` carrying the reused objects, or null when there is nothing to reuse. */
function reuseBranch(
  before: readonly BaseDataPoint[],
  after: readonly BaseDataPoint[],
): BaseDataPoint[] | null {
  const shared = Math.min(before.length, after.length);
  let copy: BaseDataPoint[] | null = null;
  for (let i = 0; i < shared; i++) {
    const mine = before[i];
    const theirs = after[i];
    if (mine === theirs || !samePoint(mine, theirs)) continue;
    if (copy === null) copy = after.slice();
    copy[i] = mine;
  }
  return copy;
}

/**
 * Equal as plain data: both plain objects, the same own enumerable string
 * keys, and `===` values. `for…in` over a plain object walks exactly its
 * own enumerable keys without allocating a key array.
 */
function samePoint(a: unknown, b: unknown): boolean {
  if (!isPlain(a) || !isPlain(b)) return false;
  for (const key in a) {
    if (!Object.hasOwn(b, key)) return false;
    const mine = Reflect.get(a, key);
    const theirs = Reflect.get(b, key);
    // `===` says 0 and -0 are equal; a formatter can tell them apart.
    if (mine !== theirs || (mine === 0 && !Object.is(mine, theirs))) return false;
  }
  for (const key in b) {
    if (!Object.hasOwn(a, key)) return false;
  }
  return true;
}

function isPlain(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function computation<
  const TIn extends readonly Source<any>[],
  TOut extends Record<string, BaseDataPoint[]>,
>({ inputs, calc, calcLast, calcFirst, headLookback }: ComputationSpec<TIn, TOut>): Computation<TOut> {
  // Validation lives in one place here — validating separately per
  // indicator factory would leak bad input as an error with an exposed
  // internal name like "Cannot read properties of null (reading 'read')",
  // and duplicate the same check once per indicator.
  //
  // `ContractError`, not `DataError`. `inputs` isn't a value from a server —
  // it's wiring the consumer wrote, so this is "you called it wrong," a
  // contract violation.
  if (!Array.isArray(inputs)) {
    throw new ContractError(
      `computation(inputs) must be an array, got ${describe(inputs)}`,
    );
  }
  if (calcFirst !== undefined && headLookback !== undefined) {
    throw new ContractError(
      "computation: declare calcFirst or headLookback, not both — one door per direction",
    );
  }
  inputs.forEach((input, i) => {
    if (typeof input !== "object" || input === null || typeof input.read !== "function") {
      throw new ContractError(
        `computation input ${i} must be a Source (something with read), got ${describe(input)}`,
      );
    }
  });

  let fed: DataView<BaseDataPoint>[] | null = null;
  let result: TOut;
  /**
   * The declared head door re-runs `calc` on a prefix. A `calc` that keeps
   * a resume checkpoint for `calcLast` — every fold-based increment does —
   * then holds the prefix's end, not the array's, and a tick resuming from
   * it would corrupt the tail for good (and every tick after, since the
   * next checkpoint is taken from the corrupted state). So after a
   * declared landing the tail gate stays closed until `calc` has run over
   * the whole input once more. A rule the node enforces, not one a
   * factory has to remember.
   */
  let tailResumeStale = false;

  /**
   * `headLookback`'s interpreter. Declines (null → full path) whenever
   * the declaration's assumptions don't hold on this landing: inputs that
   * landed different counts can't be sliced in step, and a branch whose
   * prefix output isn't 1:1 with positions has a head of the wrong
   * length. Declining is always correct — it just costs the full route.
   */
  const declaredDoor = (
    previous: TOut,
    values: ReadOf<TIn>,
    changes: readonly ({ kind: "none" } | HeadChange)[],
  ): TOut | null => {
    let count = -1;
    for (const change of changes) {
      if (change.kind !== "prepend") return null;
      if (count === -1) count = change.count;
      else if (change.count !== count) return null;
    }
    if (count <= 0) return null;

    const look = typeof headLookback === "function" ? headLookback() : headLookback;
    if (look === undefined || !Number.isInteger(look) || look < 0) return null;

    const upto = count + look;
    const expected = Math.min(upto, values[0]?.length ?? 0);
    if (expected < count) return null;
    // Every sliced prefix must be the same length — with inputs of
    // unequal history there is no single position axis to be 1:1 with.
    for (const value of values) {
      if (Math.min(upto, value.length) !== expected) return null;
    }
    const sliced = values.map((value) => value.slice(0, expected));
    const heads = calc(...(sliced as ReadOf<TIn>));

    const next = {} as TOut;
    for (const key of Object.keys(previous) as (keyof TOut)[]) {
      const tail = previous[key];
      const head = heads[key];
      /**
       * 1:1 is enforced, not inferred: exactly one output per prefix
       * position, no more and no less. Inferring the corrected zone from
       * whatever length came back would let a non-position-aligned calc
       * stitch a corrupted hybrid into the node whenever its length
       * happened to land in range — the same self-fulfilling-contract
       * trap the declared lookback exists to close.
       */
      if (!Array.isArray(head) || !Array.isArray(tail)) return null;
      if (head.length !== expected) return null;
      const corrected = expected - count;
      if (corrected > tail.length) return null;
      next[key] = head.concat(tail.slice(corrected)) as TOut[keyof TOut];
    }
    return next;
  };

  const run = (): TOut => {
    const values = inputs.map((input) => input.read());

    // Checks only the **identity** of the input arrays. A content comparison would be O(n), which eats into the frame budget.
    if (fed !== null && sameInputs(fed, values)) return result;

    // `fed` (the input cache key) only advances after the computation
    // succeeds — advancing it first would mean that if `calc` throws once,
    // the cache key updates to the new input while the answer stays the
    // old one, so the next frame's `sameInputs` comes back true and the
    // stale result is returned forever. Throwing with `fed` unchanged means
    // the next frame tries again — failure gets retried, only success gets
    // remembered.
    //
    // Tail gate first — only if every input is either unchanged or a tail
    // change; if even one is a full change (`tailDelta` returns null), this
    // is a full computation. The same commit-order rule applies to
    // `calcLast`.
    if (calcLast && fed !== null && !tailResumeStale) {
      const previous = fed;
      // Bails out the moment even one input can't be classified (null) —
      // narrowing as it collects, rather than filtering afterward, is what
      // makes this `TailChange[]` without a type assertion.
      const changes: TailChange[] = [];
      let tailOnly = true;
      for (let i = 0; i < values.length; i++) {
        const change: TailChange | null =
          values[i] === previous[i]
            ? { kind: "none" }
            : tailDelta(previous[i], values[i]);
        if (change === null) {
          tailOnly = false;
          break;
        }
        changes.push(change);
      }
      if (tailOnly) {
        const next = calcLast(result, values as ReadOf<TIn>, changes);
        if (next !== null) {
          fed = values;
          result = next;
          return result;
        }
      }
    }

    // The head gate mirrors the tail gate — including the commit-order
    // rule: `fed` only advances after the computation succeeds.
    const landPage = calcFirst ?? (headLookback !== undefined ? declaredDoor : null);
    if (landPage && fed !== null) {
      const previous = fed;
      const changes: ({ kind: "none" } | HeadChange)[] = [];
      let headOnly = true;
      for (let i = 0; i < values.length; i++) {
        const change: { kind: "none" } | HeadChange | null =
          values[i] === previous[i]
            ? { kind: "none" }
            : headDelta(previous[i], values[i]);
        if (change === null) {
          headOnly = false;
          break;
        }
        changes.push(change);
      }
      if (headOnly) {
        const next = landPage(result, values as ReadOf<TIn>, changes);
        if (next !== null) {
          if (landPage === declaredDoor) tailResumeStale = true;
          fed = values;
          result = next;
          return result;
        }
      }
    }

    const next = calc(...(values as ReadOf<TIn>));
    tailResumeStale = false;
    fed = values;
    result = next;
    return result;
  };

  /**
   * Branch names get fixed right here — you only know what comes out by
   * running it once. It's fine if the input is still empty; whatever keys
   * come out then are the contract.
   */
  const first = run();
  const out = {} as { [K in keyof TOut]: Source<TOut[K][number]> };

  for (const key of Object.keys(first) as (keyof TOut)[]) {
    out[key] = {
      read: () => run()[key] as TOut[keyof TOut][number][],
    } as Source<TOut[keyof TOut][number]>;
  }

  return { out };
}

function sameInputs(
  previous: readonly DataView<BaseDataPoint>[],
  next: readonly DataView<BaseDataPoint>[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => value === next[index]);
}
