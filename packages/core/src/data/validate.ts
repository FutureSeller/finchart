import { DataError, describe } from "../primitives";
import { defaultCoordinates, isGap } from "./accessors";
import type { BaseDataPoint, CoordinateAccessor, LineDataPoint } from "./types";

export type SeriesDataIssueCode =
  | "not-an-array"
  | "not-an-object"
  | "unreadable-y"
  | "non-finite-x"
  | "non-finite-value"
  | "unsorted-x"
  | "duplicate-x";

/**
 * What the consumer already holds at the seam — the x of the tail a chunk
 * has to continue after (`lastX`), or of the head it has to end before
 * (`firstX`). Facts, not rules: the rule is the door's — `validateSeriesData`
 * answers `append`/`prepend`, `validateSeriesPoint` answers `updateLast`.
 */
export interface SeamContext {
  /** The tail you hold, as the accessor reads it (`getX` — `point.x` for every built-in accessor). */
  lastX?: number;
  /** The head you hold, as the accessor reads it. */
  firstX?: number;
}

/**
 * The seam comparators — one sentence each, read by every door that joins
 * new data to existing data (the manager's three seams, the tick router,
 * and the pre-check doors), so the validator and ingestion cannot answer
 * differently. `uniqueX` is the accessor's declaration that one x holds
 * one point; without it a repeated x at the seam is legal.
 */
export function continuesAfter(x: number, tailX: number, uniqueX: boolean): boolean {
  return uniqueX ? x > tailX : x >= tailX;
}

export function endsBefore(x: number, headX: number, uniqueX: boolean): boolean {
  return uniqueX ? x < headX : x <= headX;
}

/**
 * The runtime twin of `SeriesDataIssueCode` — the `Record` forces every
 * union member to be listed, and a test holds the guide's table to this
 * list (a code documented nowhere, or documented but gone, goes red).
 */
const ISSUE_CODES = [
  "not-an-array",
  "not-an-object",
  "unreadable-y",
  "non-finite-x",
  "non-finite-value",
  "unsorted-x",
  "duplicate-x",
] as const satisfies readonly SeriesDataIssueCode[];
/** A union member missing from the list above breaks the compile here. */
type IssueCodesAreComplete<T extends never> = T;
export type IssueCodeListIsComplete = IssueCodesAreComplete<
  Exclude<SeriesDataIssueCode, (typeof ISSUE_CODES)[number]>
>;
export const SERIES_DATA_ISSUE_CODES: readonly SeriesDataIssueCode[] = ISSUE_CODES;

/**
 * One rule the data broke, as a value — the door for showing a bad payload
 * to a user instead of catching an exception. `index` is the offending
 * point; `-1` means the payload as a whole (not an array).
 */
export interface SeriesDataIssue {
  code: SeriesDataIssueCode;
  index: number;
  message: string;
}

/**
 * The one walker every series-data rule lives in. Two doors share it:
 * `SimpleDataManager`'s ingestion (throw mode) and `validateSeriesData`
 * (collect mode) — the rules cannot drift apart because there is only one
 * copy to drift.
 *
 * `report === null` is throw mode: the first violation throws `DataError`
 * and nothing is allocated on the way there — this is the ingestion path a
 * derived tick rides, so the per-point work must stay what it always was
 * (shape, finite x, per-accessor values, gap watch, order). With a
 * `report`, every violation is handed over and the walk continues; a point
 * whose shape is broken is skipped past the reads that would blow up on it.
 *
 * Returns whether the chunk holds a gap — the manager's incremental
 * gap-tracking needs it from the same pass; a separate pass would walk the
 * array twice on every derived tick.
 *
 * The y-readability rule checks only the first and last point: that
 * mistake comes from a `.map()`, so it is uniform, while an individual
 * point without a value is legal whitespace by contract.
 */
export function scanSeriesData<T extends BaseDataPoint>(
  points: readonly T[],
  coordinates: CoordinateAccessor<T>,
  report: ((issue: SeriesDataIssue) => void) | null,
  seam?: SeamContext,
): boolean {
  const watchGaps = coordinates.gapless !== true;
  const uniqueX = coordinates.uniqueX === true;
  let sawGap = false;
  const last = points.length - 1;
  // The existing tail seeds "the previous point" — the seam is checked by
  // the same comparison as the order inside the chunk, at the chunk's own
  // index 0. The seed walks on, so a wholly overlapping ascending chunk is
  // one issue, exactly what `append` sees.
  let previousX: number | null = seam?.lastX ?? null;
  let previousIndex = -1;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];

    // The per-point rules — the same body the tick path runs on one point.
    const x = checkPoint(point, i, coordinates, "data", report, i === 0 || i === last);
    // A broken shape (collect mode) skips the reads that would blow up on it.
    if (x === null) continue;
    const finiteX = Number.isFinite(x);

    if (watchGaps && !sawGap) {
      if (report === null) {
        if (isGap(coordinates.getY(point))) sawGap = true;
      } else {
        try {
          if (isGap(coordinates.getY(point))) sawGap = true;
        } catch (error) {
          report({
            code: "unreadable-y",
            index: i,
            message: `data: the accessor could not read a value from index ${i} — ${messageOf(error)}`,
          });
          continue;
        }
      }
    }

    /**
     * Order compares only against the last *readable* x — in collect mode
     * a point with a broken x already has its own issue, and measuring the
     * next point against garbage would manufacture a second phantom one.
     * A repeated x is allowed (two points at one moment) unless the
     * accessor declares `uniqueX` — then it is its own code, because the
     * fix is different (dedupe, not sort).
     */
    if (finiteX) {
      if (previousX !== null && !continuesAfter(x, previousX, uniqueX)) {
        const repeated = x === previousX;
        fail(
          report,
          repeated ? "duplicate-x" : "unsorted-x",
          i,
          previousIndex === -1
            ? repeated
              ? `data must hold one point per x, but index ${i} repeats the existing tail x=${previousX}`
              : `data must continue after the existing tail x=${previousX}, but index ${i} is ${x}`
            : repeated
              ? `data must hold one point per x, but index ${i} repeats index ${previousIndex} (${x})`
              : `data must be sorted by x, but index ${i} (${x}) comes before index ${previousIndex} (${previousX})`,
        );
      }
      previousX = x;
      previousIndex = i;
    }
  }

  // The other seam — a chunk landing in front has to end before the head.
  // It is the chunk's **last point** that lands on the head, so the
  // comparison runs only when that point was readable: an unreadable
  // last point already has its own issue, and measuring an earlier point
  // against the head would be a phantom (and out of index order).
  if (
    seam?.firstX !== undefined &&
    last >= 0 &&
    previousIndex === last &&
    previousX !== null &&
    !endsBefore(previousX, seam.firstX, uniqueX)
  ) {
    const repeated = previousX === seam.firstX;
    fail(
      report,
      repeated ? "duplicate-x" : "unsorted-x",
      previousIndex,
      repeated
        ? `data must hold one point per x, but index ${previousIndex} repeats the existing head x=${seam.firstX}`
        : `data must end before the existing head x=${seam.firstX}, but index ${previousIndex} is ${previousX}`,
    );
  }

  return sawGap;
}

/**
 * The rules one point has to satisfy, in the order they are checked:
 * shape → readable y (edge points only — the `.map()` mistake is uniform,
 * and a lone point is its own edge) → finite x → the accessor's own
 * values. **One body for two doors**: the whole-array walk calls it per
 * point, and `replaceLast` — the tick path — calls it once on the bar it
 * replaces. A second copy used to live on the tick path and could drift.
 *
 * Returns the point's x so the caller can carry on with the rules that
 * need a neighbour (gaps, order) — a scalar, so the tick path allocates
 * nothing. In collect mode a broken shape returns `null` (nothing on it
 * can be read); throw mode never returns for one — it threw. `label`
 * names the door ("data", "updateLast(point)") in every message — the
 * accessor's `assertFinite` receives it too.
 *
 * The accessor's `assertFinite` is called as a method on purpose — a
 * hoisted `.call` was measured 55% slower here (it breaks the inline
 * cache on the ingestion path).
 */
export function checkPoint<T extends BaseDataPoint>(
  point: T,
  index: number,
  coordinates: CoordinateAccessor<T>,
  label: string,
  report: null,
  edge: boolean,
): number;
export function checkPoint<T extends BaseDataPoint>(
  point: T,
  index: number,
  coordinates: CoordinateAccessor<T>,
  label: string,
  report: (issue: SeriesDataIssue) => void,
  edge: boolean,
): number | null;
export function checkPoint<T extends BaseDataPoint>(
  point: T,
  index: number,
  coordinates: CoordinateAccessor<T>,
  label: string,
  report: ((issue: SeriesDataIssue) => void) | null,
  edge: boolean,
): number | null;
export function checkPoint<T extends BaseDataPoint>(
  point: T,
  index: number,
  coordinates: CoordinateAccessor<T>,
  label: string,
  report: ((issue: SeriesDataIssue) => void) | null,
  edge: boolean,
): number | null {
  // Shape before any read — one null element used to blow up inside the
  // accessor as a raw TypeError.
  if (typeof point !== "object" || point === null) {
    fail(
      report,
      "not-an-object",
      index,
      `${label} points must be objects, but index ${index} is ${describe(point)}`,
    );
    return null;
  }

  // Collect mode never throws — an accessor that blows up on a point (a
  // `getX: p => p.time.valueOf()` meeting `time: null`) is reported as the
  // fact it is: this point can't be read. Throw mode reads straight; the
  // ingestion path carries no try/catch, and a throwing accessor there is
  // the consumer's own TypeError, exactly as before.
  if (edge) {
    let y: number | null | undefined;
    if (report === null) {
      y = coordinates.getY(point);
    } else {
      try {
        y = coordinates.getY(point);
      } catch (error) {
        report({
          code: "unreadable-y",
          index,
          message: `${label}: the accessor could not read a value from index ${index} — ${messageOf(error)}`,
        });
        return null;
      }
    }
    if (y === undefined) {
      fail(
        report,
        "unreadable-y",
        index,
        `${label}: could not read a value from a data point — index ${index} has no y. ` +
          "If your field is named differently, e.g. {x, value}, provide a coordinates accessor",
      );
    }
  }

  // A sort check alone doesn't catch `NaN` — `NaN < previous` is false, so
  // it passes through silently. x is the basis for slicing's binary search
  // and decimation's buckets, so one `NaN` makes every comparison false
  // and the search returns the wrong range.
  let x: number;
  if (report === null) {
    x = coordinates.getX(point);
  } else {
    try {
      x = coordinates.getX(point);
    } catch (error) {
      report({
        code: "non-finite-x",
        index,
        message: `${label}: the accessor could not read x from index ${index} — ${messageOf(error)}`,
      });
      return null;
    }
  }
  if (!Number.isFinite(x)) {
    fail(
      report,
      "non-finite-x",
      index,
      `${label} x must be a finite number, but index ${index} is ${describe(x)}`,
    );
  }

  // The accessor's own contract throws; only collect mode converts, so the
  // ingestion path carries no try/catch.
  if (coordinates.assertFinite) {
    if (report === null) {
      coordinates.assertFinite?.(point, index, label);
    } else {
      try {
        coordinates.assertFinite?.(point, index, label);
      } catch (error) {
        report({
          code: "non-finite-value",
          index,
          message: messageOf(error),
        });
      }
    }
  }

  return x;
}

/** What a thrown accessor said — a consumer's own error, quoted, never rethrown in collect mode. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : describe(error);
}

/** Throw mode throws; collect mode hands over. The message is built only on the failing branch. */
function fail(
  report: ((issue: SeriesDataIssue) => void) | null,
  code: SeriesDataIssueCode,
  index: number,
  message: string,
): void {
  if (report === null) throw new DataError(message);
  report({ code, index, message });
}

/**
 * Checks untrusted series data before it goes in, and reports what is
 * wrong **as a value** — codes, indices, messages — instead of making the
 * consumer fish a thrown `DataError` out of a `catch (e: unknown)`.
 *
 * `null` means exactly one thing: `setData(data)` with the same accessor
 * will not throw a `DataError`. The rules are not a copy — ingestion and
 * this door walk the same `scanSeriesData`.
 *
 * Never throws. A payload that is not an array is itself reported
 * (`not-an-array`, index −1) — a fetch result of unknown shape is the very
 * thing this exists to check. Issues come back ascending by index.
 *
 * ```ts
 * const issues = validateSeriesData(payload, new OHLCAccessor());
 * if (issues) return showError(issues);
 * handle.setData(payload);
 * ```
 */
export function validateSeriesData(
  data: readonly LineDataPoint[],
  coordinates?: undefined,
  seam?: SeamContext,
): SeriesDataIssue[] | null;
export function validateSeriesData<T extends BaseDataPoint>(
  data: readonly T[],
  coordinates: CoordinateAccessor<T>,
  seam?: SeamContext,
): SeriesDataIssue[] | null;
export function validateSeriesData<T extends BaseDataPoint>(
  data: readonly T[],
  coordinates?: CoordinateAccessor<T>,
  seam?: SeamContext,
): SeriesDataIssue[] | null {
  if (!Array.isArray(data)) {
    return [
      {
        code: "not-an-array",
        index: -1,
        message: `series data must be an array, got ${describe(data)}`,
      },
    ];
  }

  const issues: SeriesDataIssue[] = [];
  scanSeriesData(
    data,
    coordinates ?? defaultCoordinates<T>(),
    (issue) => issues.push(issue),
    seam,
  );
  return issues.length === 0 ? null : issues;
}

/**
 * The tick door's pre-check — one point, the same rules `updateLast` runs
 * on the way in (`checkPoint`, then the router's own rule: the same x
 * replaces the bar, an earlier x is the past). `null` means exactly one
 * thing: `handle.updateLast(point)` on an identity registration whose tail
 * is at `lastX` will not throw a `DataError`. Never throws.
 *
 * Every door orders in one space — the x the accessor reads (`getX`):
 * the tick router of an identity registration, the manager's own check
 * and this door all compare that value, so `lastX` is the tail's x as the
 * accessor reads it (for every built-in accessor, `point.x`).
 *
 * ```ts
 * socket.on("tick", (tick) => {
 *   const issues = validateSeriesPoint(tick, accessor, { lastX });
 *   if (issues) return report(issues);
 *   handle.updateLast(tick);
 * });
 * ```
 */
export function validateSeriesPoint(
  point: LineDataPoint,
  coordinates?: undefined,
  seam?: Pick<SeamContext, "lastX">,
): SeriesDataIssue[] | null;
export function validateSeriesPoint<T extends BaseDataPoint>(
  point: T,
  coordinates: CoordinateAccessor<T>,
  seam?: Pick<SeamContext, "lastX">,
): SeriesDataIssue[] | null;
export function validateSeriesPoint<T extends BaseDataPoint>(
  point: T,
  coordinates?: CoordinateAccessor<T>,
  seam?: Pick<SeamContext, "lastX">,
): SeriesDataIssue[] | null {
  const issues: SeriesDataIssue[] = [];
  const x = checkPoint(
    point,
    0,
    coordinates ?? defaultCoordinates<T>(),
    "updateLast(point)",
    (issue) => issues.push(issue),
    true,
  );
  const lastX = seam?.lastX;
  if (
    x !== null &&
    Number.isFinite(x) &&
    lastX !== undefined &&
    !continuesAfter(x, lastX, false)
  ) {
    issues.push({
      code: "unsorted-x",
      index: 0,
      message: `updateLast(point) must keep x >= ${lastX}, but index 0 is ${x} — fix the past with setData`,
    });
  }
  return issues.length === 0 ? null : issues;
}
