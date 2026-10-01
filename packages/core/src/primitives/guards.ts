/**
 * There are two policies for checking boundary values, and the kind of
 * gate decides which applies.
 *
 * - **Input APIs** (the consumer calls these) → throw `ContractError`.
 *   Swallowing it silently leaves no way to know why nothing drew.
 * - **Parsers** (strings from the outside) → don't throw, return
 *   `undefined`. A broken string isn't an error, it means "there's nothing
 *   to recover here."
 *
 * A value the parser filtered might never reach an input API, but some
 * calls skip the parser entirely, so each one is responsible for its own
 * arguments.
 */

import { ContractError, DataError } from "./errors";
import type { Point } from "./geometry";

/**
 * Is this a finite number? Filters out `NaN` and `±Infinity` —
 * `typeof === "number"` alone isn't enough. `JSON.parse('{"x":1e999}').x` is
 * `Infinity`, so this can arrive from an outside string too.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * For input APIs. Throws `ContractError` if not finite. `label` is the
 * argument name — the message needs to say not just what's wrong but where,
 * so the caller can find it in their own code.
 *
 * The value is rendered safely via `describe()` — the most common bad value
 * at a numeric gate isn't `NaN`, it's a string (`URLSearchParams`, `dataset`,
 * and the like all hand you strings). Printing it raw with `${value}` would
 * show `"800"` as `got 800`, so the consumer never suspects the type.
 */
export function requireFinite(value: number, label: string): number {
  if (!isFiniteNumber(value)) {
    throw new ContractError(`${label} must be a finite number, got ${describe(value)}`);
  }
  return value;
}

/**
 * For input APIs. Throws `ContractError` if not a finite non-negative
 * number.
 *
 * Not "must be positive" — `flex`, `minHeight`, `valuePadding` all give zero
 * a meaning: `flex: 0` is `paneMaximize`'s idiom for collapsing a pane
 * This uses `!(value >= 0)` because `NaN >= 0` is false —
 * `value < 0` would miss `NaN`.
 */
export function requireNonNegative(value: number, label: string): number {
  if (!isFiniteNumber(value) || !(value >= 0)) {
    throw new ContractError(
      `${label} must be a non-negative finite number, got ${describe(value)}`,
    );
  }
  return value;
}

/**
 * For input APIs. Throws `ContractError` if not a finite positive number.
 *
 * Split from `requireNonNegative` because zero doesn't mean the same thing
 * everywhere — a clipping budget of `maxPoints: 0` isn't "no limit," it's
 * "draw nothing," and the series quietly vanishes. This uses `!(value > 0)`
 * because `NaN > 0` is false — `value <= 0` would miss `NaN`.
 */
export function requirePositive(value: number, label: string): number {
  if (!isFiniteNumber(value) || !(value > 0)) {
    throw new ContractError(
      `${label} must be a positive finite number, got ${describe(value)}`,
    );
  }
  return value;
}

/**
 * For input APIs. Is this an interval with both ends finite and
 * `min < max`?
 *
 * Domains and ranges arrive as a pair and go wrong as a pair — checking
 * only one end would let `[5, -Infinity]` pass as "min is finite."
 */
export function requireInterval(
  min: number,
  max: number,
  label: string,
): [number, number] {
  requireFinite(min, `${label} min`);
  requireFinite(max, `${label} max`);
  if (min >= max) {
    throw new ContractError(`${label} min(${min}) must be less than max(${max})`);
  }
  return [min, max];
}

/**
 * For input APIs. Is this a screen range with both ends finite and
 * different from each other?
 *
 * A different gate from `requireInterval` — a screen range's contract
 * allows the reverse direction (start > end), since the y axis carries its
 * flip as `[bottom, top]`. This only rejects equality — a zero-width range
 * turns a division into a division by zero.
 */
export function requireRange(
  start: number,
  end: number,
  label: string,
): [number, number] {
  requireFinite(start, `${label} start`);
  requireFinite(end, `${label} end`);
  if (start === end) {
    throw new ContractError(
      `${label} start(${start}) and end(${end}) must differ`,
    );
  }
  return [start, end];
}

/**
 * For data gates. Throws `DataError` if not an array.
 *
 * A `.d.ts` is advice, not enforcement — a failed `fetch` hands you
 * `undefined`, and `setData(null)` used to throw a raw `TypeError` that
 * leaked an internal variable name. The shape of a server response really
 * does go wrong at runtime, so it's something the consumer can catch.
 */
export function requireDataArray<T>(value: readonly T[], label: string): readonly T[] {
  if (!Array.isArray(value)) {
    throw new DataError(
      `${label} must be an array, got ${describe(value)}`,
    );
  }
  return value;
}

/**
 * For input APIs. An optional boolean — passing nothing is fine, but if
 * something is passed it must be a real boolean.
 *
 * `localStorage`, `getAttribute`, and settings panels always hand you
 * strings — `"false"` is truthy, so it turns on the very thing you meant
 * to turn off.
 */
export function requireOptionalBoolean(
  value: unknown,
  label: string,
): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new ContractError(
      `${label} must be a boolean, got ${describe(value)}`,
    );
  }
}

/**
 * For input APIs. A callback must be a function where it is handed over —
 * accepted as anything else, it fails on whichever later frame, pan or
 * input first calls it, far from the line that made the mistake.
 */
export function requireFunction(value: unknown, label: string): void {
  if (typeof value !== "function") {
    throw new ContractError(`${label} must be a function, got ${describe(value)}`);
  }
}

/**
 * For input APIs. Throws `ContractError` if not an object — options are
 * written by the consumer, so there's nothing to catch, only code to fix.
 * This pairs with `DataError` for data shape.
 */
export function requireObject<T>(value: T, label: string): T {
  if (typeof value !== "object" || value === null) {
    throw new ContractError(`${label} must be an object, got ${describe(value)}`);
  }
  return value;
}

/**
 * For data gates. Throws `DataError` if a point isn't an object.
 *
 * The per-element check doesn't add a new loop — it's called inside the
 * O(n) pass the ordering check already runs. This is where a single `null`
 * element used to blow up with a `TypeError` in `coordinates.getX(point)`.
 */
export function requireDataPoint(value: unknown, index: number, label: string): void {
  if (typeof value !== "object" || value === null) {
    throw new DataError(
      `${label} points must be objects, but index ${index} is ${describe(value)}`,
    );
  }
}

/**
 * The x rule of every data door, as one sentence. A sort check alone
 * can't catch `NaN` (`NaN < previous` is false), and x is the basis for
 * slicing's binary search — one `NaN` in the array makes every comparison
 * false. `label` names the door ("data", "updateLast(point)") so a
 * consumer reading the message in a socket callback knows which call it was.
 */
export function requireFiniteX(x: unknown, index: number, label: string): number {
  if (typeof x !== "number" || !Number.isFinite(x)) {
    throw new DataError(
      `${label} x must be a finite number, but index ${index} is ${describe(x)}`,
    );
  }
  return x;
}

/**
 * For coordinate gates. Throws `ContractError` if the value isn't a point,
 * or its x/y aren't finite.
 *
 * There are several public paths where a headless host synthesizes
 * coordinates — `plot.crosshair`, `click`, `doubleClick`, `contextMenu`,
 * `contestedAt`. None of them pass through the input router, so this
 * gathers the check in one place instead of repeating it at each one.
 */
export function requirePoint(value: unknown, label: string): Point {
  requireObject(value, label);
  const x = Reflect.get(Object(value), "x");
  const y = Reflect.get(Object(value), "y");
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new ContractError(
      `${label} x/y must be finite numbers, got x=${describe(x)} y=${describe(y)}`,
    );
  }
  return { x, y };
}

/**
 * Renders a value safely for an error message — `${value}` throws on a
 * `Symbol` and dumps the entirety of a large array or a circular object.
 */
export function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length ${value.length})`;
  const kind = typeof value;
  if (kind === "object") return "object";
  if (kind === "string") return `string ${JSON.stringify(value)}`;
  if (kind === "symbol" || kind === "function" || kind === "bigint") return kind;
  return String(value);
}

/**
 * For parsers. Returns the value if it's a finite number, otherwise
 * `undefined`.
 *
 * Why `undefined` and not `null`: some schema fields have `null` as a real
 * value (`ChartState.xDomain: Range | null`), so this keeps "couldn't parse
 * it" from getting confused with "it really said `null`."
 */
export function asFinite(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

/**
 * For parsers. Returns the value if it's an integer with
 * `0 <= value < limit`, otherwise `undefined`.
 *
 * Finiteness alone isn't enough for an index — something like
 * `targetIndex: 0.5` produces `panes[0.5] === undefined`, and that
 * `undefined` can then sit quietly where a different type was expected.
 */
export function asIndex(value: unknown, limit: number): number | undefined {
  if (!isFiniteNumber(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value < 0 || value >= limit) return undefined;
  return value;
}

/**
 * A copy with explicit `undefined`s stripped out — making it equivalent to
 * "never passed."
 *
 * A spread merge treats `undefined` as a real value and erases a live
 * setting. A wrapper's optional props arrive in exactly this shape
 * (`{ showGrid: props.showGrid }`), so this filters them out before the
 * merge. Used by both `Plot.applyOptions` and the pane axis config merge.
 */
export function definedOnly<T extends object>(source: T | undefined): Partial<T> {
  const copy: Partial<T> = { ...source };

  for (const key of Object.keys(copy)) {
    if (Reflect.get(copy, key) === undefined) Reflect.deleteProperty(copy, key);
  }

  return copy;
}
