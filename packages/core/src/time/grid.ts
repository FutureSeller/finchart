import type { Zone } from "./zone";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Where a grid's points go as they are found. Each answers whether to go
 * on — a consumer that has all it can draw stops the walk rather than
 * being handed the rest.
 */
export interface GridVisitor {
  /** A reading the grid stands on, as the instant it names. */
  point(at: number): boolean;
  /**
   * The instant the clock landed on after skipping a stretch of readings
   * that held one the grid stands on. A landing may name the same instant
   * as the point that follows it: the clock landed exactly on a grid
   * reading.
   */
  landing(at: number): boolean;
}

/**
 * **A grid of readings, laid one run of the clock at a time, as instants.**
 * The grid's phase is a reading — that day's midnight, that week's Monday —
 * because on the wall-clock axis a day is always a day and no reading has
 * to be resolved into an instant to be counted. Inside a run the clock
 * keeps a fixed distance from time, so a whole run's worth of points is
 * arithmetic: no reading is asked about, and the ones outside `[first,
 * last]` are never counted rather than counted and dropped.
 *
 * **Only what advances is named.** Where the clock moved forward it skipped
 * readings, and a skipped reading is on no run, so no point is named for
 * it — the stretch is told once, as a landing. Where it moved back it
 * repeated readings, and the run boundary already gives those to their
 * first turn, so a repeated reading is named once too — the second turn is
 * simply not part of any run.
 *
 * **The readings a clock skipped are worth one point between them, not one
 * each.** They name no instant of their own, so the honest answer for the
 * whole stretch is the moment the clock landed on — the run's own first
 * reading, less its distance from time — and only where the stretch held a
 * reading the grid stands on. It is told apart from a grid point, because
 * whoever draws it may not want it standing where a real one would.
 *
 * Instants come in non-decreasing order, each grid reading once; a landing
 * may share its instant with the grid point that follows it. `first` and
 * `last` are brought in to whole milliseconds, a clock being asked about
 * whole milliseconds and no finer — a fraction left on an edge is lost by
 * the grid arithmetic anyway, and a small enough one stops existing. The
 * runs are asked for a day either side: a run's readings reach past the
 * instants by the clock's distance from time, and no clock stands a day
 * off.
 */
export function readingGrid(
  zone: Zone,
  anchor: number,
  step: number,
  first: number,
  last: number,
  visit: GridVisitor,
): void {
  first = Math.ceil(first);
  last = Math.floor(last);
  if (last < first) return;
  // Null until a run has been seen: the first one follows nothing, and
  // reading it as following a skipped stretch would invent a point where
  // the scan happened to start.
  let skippedFrom: number | null = null;
  for (const run of zone.runs(first - DAY, last + DAY)) {
    const from = Math.max(run.from, first + run.offset);
    const to = Math.min(run.to - 1, last + run.offset);
    const k0 = Math.ceil((from - anchor) / step);
    const k1 = Math.floor((to - anchor) / step);

    if (
      skippedFrom !== null &&
      run.from > skippedFrom &&
      firstOnGrid(skippedFrom, anchor, step) < run.from
    ) {
      const landed = run.from - run.offset;
      if (landed >= first && landed <= last && !visit.landing(landed)) return;
    }
    skippedFrom = run.to;

    for (let k = k0; k <= k1; k++) {
      if (!visit.point(anchor + k * step - run.offset)) return;
    }
  }
}

/** The first reading at or after `from` that the grid stands on. */
function firstOnGrid(from: number, anchor: number, step: number): number {
  return anchor + Math.ceil((from - anchor) / step) * step;
}

/**
 * The reading of midnight on the day an instant falls in that zone. Down
 * to the containing millisecond first, because a clock read through `Date`
 * truncates toward zero rather than down, and an instant just before the
 * epoch belongs to the day that ended there.
 */
export function dayStartOf(zone: Zone, instant: number): number {
  const parts = zone.parts(Math.floor(instant));
  return zone.localOf({ ...parts, hour: 0, minute: 0, second: 0 });
}

/**
 * Monday midnight of the week a midnight reading falls in. Counted, not
 * read through `Date`: the wall-clock axis reaches past what a `Date` can
 * encode, and asking one there answers `NaN`. The epoch was a Thursday, so
 * a whole day count of 0 is day 3 of a week beginning on Monday, and
 * `Math.floor` carries that back through negative days where a remainder
 * would not.
 */
export function weekStartOf(midnight: number): number {
  const days = Math.floor(midnight / DAY);
  return midnight - ((((days + 3) % 7) + 7) % 7) * DAY;
}
