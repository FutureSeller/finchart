import { ContractError, describe } from "../primitives";
import { tailDelta, type TailChange } from "./tail-delta";
import type { BaseDataPoint, Source } from "./types";

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
  [K in keyof TIn]: TIn[K] extends Source<infer T> ? T[] : never;
};

export interface ComputationSpec<
  TIn extends readonly Source<BaseDataPoint>[],
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
   * identity for this branch's consumers to reach the same verdict.
   */
  calcLast?: (
    previous: TOut,
    inputs: ReadOf<TIn>,
    changes: readonly TailChange[],
  ) => TOut | null;
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
export function computation<
  const TIn extends readonly Source<BaseDataPoint>[],
  TOut extends Record<string, BaseDataPoint[]>,
>({ inputs, calc, calcLast }: ComputationSpec<TIn, TOut>): Computation<TOut> {
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
  inputs.forEach((input, i) => {
    if (typeof input !== "object" || input === null || typeof input.read !== "function") {
      throw new ContractError(
        `computation input ${i} must be a Source (something with read), got ${describe(input)}`,
      );
    }
  });

  let fed: BaseDataPoint[][] | null = null;
  let result: TOut;

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
    if (calcLast && fed !== null) {
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

    const next = calc(...(values as ReadOf<TIn>));
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
  previous: BaseDataPoint[][],
  next: BaseDataPoint[][],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => value === next[index]);
}
