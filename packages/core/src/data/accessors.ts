import type {
  BaseDataPoint,
  CoordinateAccessor,
  LineDataPoint,
  OHLC,
} from "./types";
import { DataError, describe } from "../primitives";

/**
 * Is this value a gap — a spot with nothing to draw?
 *
 * `null` being a gap is a contract the README teaches with its warmup
 * example. `undefined` counts too: a `close` missing from one exchange row
 * that arrives as `undefined`, and a consumer who deliberately wrote
 * `null`, mean the same thing on screen.
 *
 * `getY` doesn't fold this to `?? null` because `assertReadableValue` needs
 * `getY(point) === undefined` to point a consumer with a wrong field name
 * toward the fix — if the accessor swallowed `undefined`, that guidance
 * would never fire, and the consumer would just see a blank chart with no
 * explanation.
 */
export function isGap(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined;
}


export class LineDataAccessor implements CoordinateAccessor<LineDataPoint> {
  getX(point: LineDataPoint): number {
    return point.x;
  }

  /**
   * `null` is a gap; any other non-finite value is a rejection. `y: null`
   * meaning whitespace is a contract the README teaches, so that stays, but
   * `y: "102"` or `NaN` is a wrong value, not a gap.
   *
   * Doesn't throw on `undefined` here — `assertReadableValue` catches that
   * and gives a better message that also teaches the way out.
   */
  assertFinite(point: LineDataPoint, index: number): void {
    assertFiniteValue(point.y, index);
  }

  /** `null` passes straight through — having no value is data too. */
  getY(point: LineDataPoint): number | null {
    return point.y;
  }
}

export class OHLCAccessor implements CoordinateAccessor<OHLC> {
  getX(point: OHLC): number {
    return point.x;
  }

  getY(point: OHLC): number {
    return point.close;
  }

  /**
   * A bar can never produce a gap — `getY` returns `close`, and
   * `assertFinite` already guarantees all four are finite at the data gate.
   * `close: null` is a rejection at this accessor, not a gap.
   */
  readonly gapless = true;

  /**
   * One bar per x. A repeated x on bars is never "two points at one
   * moment" — it is the same candle handed over twice (an inclusive REST
   * boundary after a reconnect), and it would draw twice and answer
   * `probe` with either one. Loud at every door (`duplicate-x`).
   */
  readonly uniqueX = true;

  /** One bar's data value span — low to high. A candidate for snapping. */
  getYRange(point: OHLC): { min: number; max: number } {
    return { min: point.low, max: point.high };
  }

  /**
   * Checks all four. `getY` only reads `close` and `valueExtent` only
   * reads `low`/`high`, so `open` passes through no gate at all and leaks
   * through without this check.
   *
   * `null` is a rejection, not a gap — a bar is a bundle of four, and if
   * one is missing there's nothing left to draw. A missing bar is already
   * expressed as "don't include the point," so giving `null` a meaning
   * here would make it mean "price zero." **Volume is the one field with
   * the other rule**: a bar without volume is still a bar, so `null` (and
   * absence) is a gap there — only a value that is present and not a
   * finite number is rejected. `OHLC_GAP_FIELDS` names that group for the
   * same machine check.
   *
   * Lays out the four fields by hand — the machine, not a runtime check,
   * guards against a leak. Four hand-laid lines are more than twice as
   * fast as a loop over the array (the indirection cost of iterator
   * allocation plus a dynamic lookup per point). This spot is also on the
   * tick path: a derived registration's `updateLast` runs a full `setData`
   * every frame.
   *
   * Readability is bought with a test instead of a runtime check —
   * `ohlc-fields.test.ts` confirms every field in `OHLC_FIELDS` is actually
   * rejected, so if a fifth field appears and this isn't updated, that test
   * goes red.
   */
  assertFinite(point: OHLC, index: number): void {
    if (!Number.isFinite(point.open)) reject("open", point.open, index);
    if (!Number.isFinite(point.high)) reject("high", point.high, index);
    if (!Number.isFinite(point.low)) reject("low", point.low, index);
    if (!Number.isFinite(point.close)) reject("close", point.close, index);
    // Present but not a number — a feed's `"1234"` used to slip through and
    // concatenate in the aggregate; a gap (null/absent) is fine.
    if (!isGap(point.volume) && !Number.isFinite(point.volume)) {
      reject("volume", point.volume, index);
    }
  }
}

/**
 * Is this one value a gap or finite — the rule for a point with a single
 * value (line, histogram, derived). Uses `isGap` instead of hand-rolling
 * `=== null || === undefined` again.
 */
function assertFiniteValue(y: number | null | undefined, index: number): void {
  if (isGap(y) || Number.isFinite(y)) return;
  throw new DataError(
    `data y must be a finite number or null (gap), but index ${index} is ${describe(y)}`,
  );
}

/** Builds the message in one place — four branches writing their own would drift apart. */
function reject(field: string, value: unknown, index: number): never {
  throw new DataError(
    `data ${field} must be a finite number, but index ${index} is ${describe(value)}`,
  );
}

/**
 * The four values a bar must have. A test iterates this, not the runtime —
 * `assertFinite` lays the four out by hand, and `ohlc-fields.test.ts`
 * confirms every field in this array is actually rejected, `null` and
 * absence included.
 */
export const OHLC_FIELDS: readonly ["open", "high", "low", "close"] = [
  "open",
  "high",
  "low",
  "close",
];

/**
 * The values a bar may leave out — the other rule: `null` and absence are
 * a gap, only a present non-number is rejected. Kept as its own list so
 * the same test holds both rules and neither field can slip out of the
 * machine's sight.
 */
export const OHLC_GAP_FIELDS: readonly ["volume"] = ["volume"];

/**
 * Reads x and y as they are.
 *
 * A point that `derive` produces has a type that varies per registration,
 * so it can't require a dedicated accessor. Without a coordinate accessor
 * given separately, the default assumption is `{ x, y }` shape.
 *
 * Doesn't use `?? null` — that would make "this point type has no `y`" the
 * same value as "this point is whitespace," so `assertReadableValue`'s
 * field-name guidance would never fire and every point would become a gap.
 * `undefined` has to pass through unchanged for the data gate to give
 * accurate guidance.
 *
 * Also checks finiteness — sibling accessors `LineDataAccessor` and
 * `HistogramAccessor` reject `y: NaN` via `assertFinite`, and without that
 * here, one `NaN` from a derived registration would reach an
 * `M4Decimation` column and wipe out that whole column's high and low.
 */
export function defaultCoordinates<
  T extends BaseDataPoint,
>(): CoordinateAccessor<T> {
  return {
    getX: (point) => point.x,
    getY: readY,
    assertFinite: (point, index) => assertFiniteValue(readY(point), index),
  };
}

/**
 * Reads a `{x, y}`-shaped value **as is** — if absent, `undefined` passes
 * straight through.
 *
 * The parameter being `BaseDataPoint & { y?: … }` instead of `T` is what
 * removes the need for a type assertion. `CoordinateAccessor.getY` uses
 * method syntax, so its parameter is bivariant and this fits without one —
 * no `as` pretending the point is some other type.
 */
function readY(point: BaseDataPoint & { y?: number | null }): number | null | undefined {
  return point.y;
}
