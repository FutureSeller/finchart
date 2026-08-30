import { DataError, describe } from "../primitives";
import { defaultCoordinates, isGap } from "./accessors";
import type { BaseDataPoint, CoordinateAccessor, LineDataPoint } from "./types";

export type SeriesDataIssueCode =
  | "not-an-array"
  | "not-an-object"
  | "unreadable-y"
  | "non-finite-x"
  | "non-finite-value"
  | "unsorted-x";

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
): boolean {
  const watchGaps = coordinates.gapless !== true;
  const throwing = report === null;
  let sawGap = false;
  const last = points.length - 1;
  let previousX: number | null = null;
  let previousIndex = -1;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];

    // Shape before any read — one null element used to blow up inside the
    // accessor as a raw TypeError.
    if (typeof point !== "object" || point === null) {
      fail(
        report,
        "not-an-object",
        i,
        `data points must be objects, but index ${i} is ${describe(point)}`,
      );
      continue;
    }

    if ((i === 0 || i === last) && coordinates.getY(point) === undefined) {
      fail(
        report,
        "unreadable-y",
        i,
        `could not read a value from a data point — index ${i} has no y. ` +
          "If your field is named differently, e.g. {x, value}, provide a coordinates accessor",
      );
    }

    /**
     * A sort check alone doesn't catch `NaN` — `NaN < previous` is false,
     * so it passes through silently. x is the basis for slicing's binary
     * search and decimation's buckets, so one `NaN` makes every comparison
     * false and the search returns the wrong range.
     */
    const x = coordinates.getX(point);
    const finiteX = Number.isFinite(x);
    if (!finiteX) {
      fail(
        report,
        "non-finite-x",
        i,
        `data x must be a finite number, but index ${i} is ${describe(x)}`,
      );
    }

    // The accessor's own contract throws; only collect mode converts, so
    // the ingestion path carries no try/catch. Called as a method on
    // purpose — a hoisted `.call` was measured 55% slower here (it breaks
    // the inline cache on the ingestion path).
    if (coordinates.assertFinite) {
      if (throwing) {
        coordinates.assertFinite?.(point, i);
      } else {
        try {
          coordinates.assertFinite?.(point, i);
        } catch (error) {
          report?.({
            code: "non-finite-value",
            index: i,
            message: error instanceof Error ? error.message : describe(error),
          });
        }
      }
    }

    if (watchGaps && !sawGap && isGap(coordinates.getY(point))) {
      sawGap = true;
    }

    /**
     * Order compares only against the last *readable* x — in collect mode
     * a point with a broken x already has its own issue, and measuring the
     * next point against garbage would manufacture a second phantom one.
     * Repeated x values in a row are allowed (two points at one moment).
     */
    if (finiteX) {
      if (previousX !== null && x < previousX) {
        fail(
          report,
          "unsorted-x",
          i,
          `data must be sorted by x, but index ${i} (${x}) comes before index ${previousIndex} (${previousX})`,
        );
      }
      previousX = x;
      previousIndex = i;
    }
  }

  return sawGap;
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
): SeriesDataIssue[] | null;
export function validateSeriesData<T extends BaseDataPoint>(
  data: readonly T[],
  coordinates: CoordinateAccessor<T>,
): SeriesDataIssue[] | null;
export function validateSeriesData<T extends BaseDataPoint>(
  data: readonly T[],
  coordinates?: CoordinateAccessor<T>,
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
  scanSeriesData(data, coordinates ?? defaultCoordinates<T>(), (issue) =>
    issues.push(issue),
  );
  return issues.length === 0 ? null : issues;
}
