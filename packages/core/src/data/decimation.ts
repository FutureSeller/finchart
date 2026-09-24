import { DataError } from "../primitives";
import { defaultCoordinates, isGap } from "./accessors";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DecimationStrategy,
  IndexRange,
} from "./types";

/**
 * The result when there's nothing to reduce. For the full window, returns
 * the source unchanged — this is the fast path tier reduction uses to
 * decide it has stopped shrinking ("same array means no more reduction").
 * For a partial window, a copy is unavoidable, but the window is at or
 * below threshold there, so the copy is small too.
 *
 * `OhlcAggregation` shares this same gate — an internal shared helper, not
 * public surface (`index.ts` doesn't export it).
 */
export function passthrough<T>(data: T[], start: number, end: number): T[] {
  if (start === 0 && end === data.length) return data;
  return data.slice(start, end);
}

/** Keeps every nth point and guarantees the end point — the skeleton the grid and simple strategies share. */
function pickEveryNth<T>(
  data: T[],
  start: number,
  end: number,
  threshold: number,
): T[] {
  const count = end - start;
  if (count <= threshold) return passthrough(data, start, end);

  const step = Math.ceil(count / threshold);
  const decimated: T[] = [];
  for (let i = start; i < end; i += step) {
    decimated.push(data[i]);
  }
  if (decimated[decimated.length - 1] !== data[end - 1]) {
    decimated.push(data[end - 1]);
  }
  return decimated;
}

/**
 * Only the coordinate used to bucket goes through screen place — the point
 * it emits is the original, unchanged. Screen place is usually x, but in a
 * bar-index coordinate space, `screenXScan` recovers it.
 *
 * Opens the pass here. This function is called once per sweep (one `pick`
 * call = one value segment in `preservingHoles`), so the cursor for the
 * pass opened here lives exactly as long as that sweep.
 */
function screenPlaceOf<T extends BaseDataPoint>(
  coordinates: CoordinateAccessor<T>,
  screenXScan?: () => (x: number) => number,
): (point: T) => number {
  const place = screenXScan?.();
  return place
    ? (point) => place(coordinates.getX(point))
    : (point) => coordinates.getX(point);
}

/**
 * Wraps a strategy so it doesn't swallow gaps. All three strategies share
 * this.
 *
 * A point with no value (whitespace) isn't a "value" — it's a signal to
 * break the line. Mixed into a bucket, it either gets wrongly measured as
 * an extreme candidate, or silently dropped, filling in the gap.
 *
 * So this cuts at gap boundaries and decimates each value segment
 * separately, then rejoins them. Inside a cut segment there are no gaps, so
 * strategies never need to know about gaps at all. Consecutive gaps
 * collapse into one.
 *
 * When there are no gaps (the common case), this builds nothing and just
 * passes through.
 */
function preservingHoles<T extends BaseDataPoint>(
  data: T[],
  { start, end }: IndexRange,
  coordinates: CoordinateAccessor<T>,
  threshold: number,
  run: (from: number, to: number, budget: number) => T[],
  gapFree?: boolean,
): T[] {
  /**
   * Don't search for what can't exist. The scan below calls `getY` over
   * the entire window to get one boolean, but for an accessor whose answer
   * is always fixed (like a bar series), there's no need to ask every
   * frame — if `CoordinateAccessor.gapless` declares that fact, the scan
   * itself is skipped entirely.
   */
  if (coordinates.gapless === true || gapFree === true) {
    return run(start, end, threshold);
  }

  let firstHole = -1;
  for (let i = start; i < end; i++) {
    if (isGap(coordinates.getY(data[i]))) {
      firstHole = i;
      break;
    }
  }
  if (firstHole === -1) return run(start, end, threshold);

  /** A value segment (index window), and the position of the gap that broke the line before it. */
  const segments: { hole: number; from: number; to: number }[] = [];
  let from = start;
  let hole = -1;
  let pending = -1;

  for (let i = firstHole; i < end; i++) {
    if (!isGap(coordinates.getY(data[i]))) {
      if (pending !== -1) {
        hole = pending;
        pending = -1;
        from = i;
      }
      continue;
    }

    if (from < i && pending === -1) segments.push({ hole, from, to: i });
    if (pending === -1) {
      pending = i;
      hole = -1;
    }
  }

  if (pending === -1 && from < end) segments.push({ hole, from, to: end });
  // If the window ends on a gap, keep that too — the data really does stop there.
  if (pending !== -1) segments.push({ hole: pending, from: 0, to: 0 });

  /** Subtracts the share the break signals take, then splits the rest proportionally by length. */
  const values = segments.reduce((sum, part) => sum + (part.to - part.from), 0);
  const signals = segments.filter((part) => part.hole !== -1).length;
  const budget = Math.max(segments.length * 2, threshold - signals);

  const out: T[] = [];
  for (const segment of segments) {
    if (segment.hole !== -1) out.push(data[segment.hole]);
    const count = segment.to - segment.from;
    if (count === 0) continue;

    /**
     * Copies without spreading — `out.push(...run(...))` turns the array
     * into an argument list, and once its length passes the engine's
     * argument ceiling (~120k in V8) that throws `RangeError`. The length
     * here can scale with data size rather than threshold (tier-building
     * passes `Math.ceil(n/2)` as the budget).
     */
    const part = run(
      segment.from,
      segment.to,
      Math.max(2, Math.round((budget * count) / values)),
    );
    for (let i = 0; i < part.length; i++) out.push(part[i]);
  }

  return out;
}

/**
 * Only used on a segment with no gaps — `preservingHoles` cuts segments
 * that way for it.
 *
 * If that promise breaks, this stops here instead of producing
 * **silently wrong output** (NaN coordinates, off extremes). The decimation
 * loop runs once per data point, so the check is just a single null
 * comparison.
 */
function valueAt<T extends BaseDataPoint>(
  coordinates: CoordinateAccessor<T>,
  point: T,
): number {
  const y = coordinates.getY(point);
  /**
   * `undefined` is a gap too. Checking only `=== null` would let a point
   * with no key (`{x: 2}`) pass straight through with `undefined` as its
   * value, and M4's `y < minY` / `y > maxY` would both be false, wiping out
   * that column's high and low entirely (the line reconnects).
   */
  if (isGap(y)) {
    throw new DataError("a gap cannot appear inside a value segment (preservingHoles contract)");
  }
  return y;
}

/**
 * Skips at a fixed interval — keeps every nth point without swallowing
 * gaps.
 *
 * Because it picks by index, a gap could just fall out. If it did, the
 * line would reconnect straight across a value that shouldn't be there —
 * so this goes through `preservingHoles` and decimates each segment
 * separately.
 */
export class SimpleDecimation<T extends BaseDataPoint = BaseDataPoint>
  implements DecimationStrategy<T>
{
  /**
   * Takes coordinates. For a point type with no `y` field, improvising
   * `point.y ?? null` on the spot would turn "no such field" into "this is
   * a gap," making every point a gap and letting `preservingHoles` collapse
   * the whole window into one point. If omitted, the default accessor
   * assumes `{x, y}` shape.
   */
  constructor(
    protected readonly coordinates: CoordinateAccessor<T> = defaultCoordinates<T>(),
  ) {}

  decimate(
    data: T[],
    range: IndexRange,
    threshold: number,
    _screenXScan?: () => (x: number) => number,
    gapFree?: boolean,
  ): T[] {
    return preservingHoles(
      data,
      range,
      this.coordinates,
      threshold,
      (from, to, budget) => pickEveryNth(data, from, to, budget),
      gapFree,
    );
  }
}

/**
 * Picks four per pixel column: first, last, min, max.
 *
 * The default strategy. A strategy that keeps only one point per bucket
 * (grid, `LttbDecimation`) always loses one when a bucket has both an up-spike and a
 * down-spike. M4 picks four, so it never loses that — the original paper
 * proves that these four per column produce a line that's **pixel-identical
 * to the original** (Jugel et al., VLDB 2014).
 *
 * So it makes a quarter as many buckets as threshold. In a chart of width
 * w, for one column to be one bucket, threshold has to be 4w — that's why
 * `pointsPerPixel` defaults to 4.
 *
 * Buckets split by **screen place, not index.** A column is a place on
 * screen, not a place in the array. Splitting by index on data clustered to
 * one side crushes the sparse side into a single bucket. Screen place is
 * usually x, but in a bar-index coordinate space, `screenXScan` recovers
 * it.
 */
export class M4Decimation<T extends BaseDataPoint = BaseDataPoint>
  implements DecimationStrategy<T>
{
  /**
   * Defaults to the same `{x, y}` accessor as its siblings — without it,
   * an untyped consumer's `new M4Decimation()` would blow up on the first
   * decimate with a raw `TypeError` leaking an internal name.
   */
  constructor(
    private coordinates: CoordinateAccessor<T> = defaultCoordinates<T>(),
  ) {}

  decimate(
    data: T[],
    range: IndexRange,
    threshold: number,
    screenXScan?: () => (x: number) => number,
    gapFree?: boolean,
  ): T[] {
    return preservingHoles(
      data,
      range,
      this.coordinates,
      threshold,
      (from, to, budget) => this.pick(data, from, to, budget, screenXScan),
      gapFree,
    );
  }

  /** Decimates one gap-free segment. */
  private pick(
    data: T[],
    start: number,
    end: number,
    threshold: number,
    screenXScan?: () => (x: number) => number,
  ): T[] {
    const count = end - start;
    if (count <= threshold) return passthrough(data, start, end);
    // If the budget can't even fill one column, M4 doesn't hold.
    if (threshold < 4) return [data[start], data[end - 1]];

    let placeOf = screenPlaceOf(this.coordinates, screenXScan);

    const buckets = Math.floor(threshold / 4);
    let first = placeOf(data[start]);
    const last = placeOf(data[end - 1]);
    let span = last - first;
    if (span === Number.POSITIVE_INFINITY) {
      // Finite opposite-sign ends can overflow their difference. Halving
      // coordinates preserves the bucket ratio; ordinary spans retain the
      // exact arithmetic below, including its boundary rounding.
      const originalPlace = placeOf;
      placeOf = (point) => originalPlace(point) / 2;
      first /= 2;
      span = last / 2 - first;
    }

    const picked: T[] = [];
    // Data is x-ascending, and screen place is a monotonic function of x
    // (the sort contract + XMapping), so bucket numbers are ascending too. One pass
    // is enough.
    let column = new Column(0, valueAt(this.coordinates, data[start]), start);

    /**
     * Whatever can be decided outside the loop is decided outside the
     * loop — the `span > 0` branch and `buckets - 1` aren't recomputed per
     * point. This is the hottest loop on the render path (runs per point,
     * per series, per frame).
     *
     * `| 0` can stand in for `Math.floor` because the value is never
     * negative — x is ascending and `placeOf` is monotonic, so
     * `place - first >= 0`.
     *
     * The division isn't precomputed as `buckets / span` — that version
     * was faster, but floating-point reassociation shifted points across
     * bucket boundaries and changed the output.
     */
    const spread = span > 0;
    const lastBucket = buckets - 1;

    for (let i = start + 1; i < end; i++) {
      const y = valueAt(this.coordinates, data[i]);
      let bucket = spread
        ? (((placeOf(data[i]) - first) / span) * buckets) | 0
        : 0;
      if (bucket > lastBucket) bucket = lastBucket;

      if (bucket === column.bucket) {
        column.extend(i, y);
        continue;
      }

      column.flushInto(picked, data);
      column = new Column(bucket, y, i);
    }

    column.flushInto(picked, data);
    return picked;
  }
}

/**
 * What one pixel column remembers — the **positions** of both ends and the
 * extremes.
 *
 * Holds indices, not points, and sorts them out at the end. It's common for
 * all four to point at the same point (if a column has just one point, all
 * four are the same one), and emitting it unchanged would draw the same
 * point several times.
 */
class Column {
  private last: number;
  private lowest: number;
  private highest: number;
  private minY: number;
  private maxY: number;

  constructor(
    readonly bucket: number,
    y: number,
    private first: number,
  ) {
    this.last = this.lowest = this.highest = this.first;
    this.minY = this.maxY = y;
  }

  extend(index: number, y: number): void {
    this.last = index;

    if (y < this.minY) {
      this.minY = y;
      this.lowest = index;
    } else if (y > this.maxY) {
      this.maxY = y;
      this.highest = index;
    }
  }

  /**
   * In position order, no duplicates. This is where x-ascending order is
   * preserved.
   *
   * Doesn't sort — the order is already known. Three of the four are fixed
   * by invariant: the constructor sets `last = lowest = highest = first`,
   * and `extend` raises `last` first, so `first <= lowest, highest <= last`.
   * The only unknown is which of `lowest` and `highest` comes first, so one
   * comparison settles it.
   */
  flushInto<T>(out: T[], data: T[]): void {
    const low = this.lowest < this.highest ? this.lowest : this.highest;
    const high = this.lowest < this.highest ? this.highest : this.lowest;

    out.push(data[this.first]);
    if (low > this.first) out.push(data[low]);
    if (high > low) out.push(data[high]);
    if (this.last > high) out.push(data[this.last]);
  }
}

/**
 * Largest-Triangle-Three-Buckets. Picks a representative point by the area
 * of the triangle formed by the previously chosen point, a candidate point,
 * and the next bucket's average.
 *
 * Preserves shape well, but **one point per bucket** means it can lose
 * extremes. Use M4 when spikes matter. This one is for when you want a
 * smooth trend line rendered in fewer points.
 *
 * The triangle is measured **on screen** — since "visible shape" is this
 * strategy's whole purpose, if the screen is a different space than x
 * (bar index), area has to be measured in that space too.
 */
export class LttbDecimation<T extends BaseDataPoint = BaseDataPoint>
  implements DecimationStrategy<T>
{
  /** Defaults to the `{x, y}` accessor — same reason as `M4Decimation`'s header comment. */
  constructor(
    private coordinates: CoordinateAccessor<T> = defaultCoordinates<T>(),
  ) {}

  decimate(
    data: T[],
    range: IndexRange,
    threshold: number,
    screenXScan?: () => (x: number) => number,
    gapFree?: boolean,
  ): T[] {
    return preservingHoles(
      data,
      range,
      this.coordinates,
      threshold,
      (from, to, budget) => this.pick(data, from, to, budget, screenXScan),
      gapFree,
    );
  }

  /** Decimates one gap-free segment. */
  private pick(
    data: T[],
    start: number,
    end: number,
    threshold: number,
    screenXScan?: () => (x: number) => number,
  ): T[] {
    const count = end - start;
    if (count <= threshold) return passthrough(data, start, end);
    if (threshold < 3) return [data[start], data[end - 1]];

    /**
     * Opens two passes — one per consumer. This strategy has two kinds of
     * query: the next bucket's average (one bucket ahead) and scoring the
     * current bucket. Sharing one pass would mean stepping forward, then
     * back, every bucket, and stepping backward past the pass's window
     * kills the sweep. Opened separately, both only move forward, and
     * either pass gives the same answer.
     */
    // Translate before scaling: dividing prices around a large offset first
    // would discard the small, representable differences that define shape.
    const boundsPlaceOf = screenPlaceOf(this.coordinates, screenXScan);
    const firstX = boundsPlaceOf(data[start]);
    const lastX = boundsPlaceOf(data[end - 1]);
    const xSpan = lastX - firstX;
    const xMagnitude = Math.max(Math.abs(firstX), Math.abs(lastX)) || 1;
    const firstY = valueAt(this.coordinates, data[start]);
    let ySpan = 0;
    let yMagnitude = 0;
    for (let i = start; i < end; i++) {
      const value = valueAt(this.coordinates, data[i]);
      ySpan = Math.max(ySpan, Math.abs(value - firstY));
      yMagnitude = Math.max(yMagnitude, Math.abs(value));
    }
    const normalizeX = Number.isFinite(xSpan)
      ? (value: number): number => (value - firstX) / (xSpan || 1)
      : (value: number): number => value / xMagnitude - firstX / xMagnitude;
    const normalizeY = Number.isFinite(ySpan)
      ? (value: number): number => (value - firstY) / (ySpan || 1)
      : (value: number): number => value / yMagnitude - firstY / yMagnitude;
    const rawPlaceOf = screenPlaceOf(this.coordinates, screenXScan);
    const rawAveragePlaceOf = screenPlaceOf(this.coordinates, screenXScan);
    const placeOf = (point: T): number => normalizeX(rawPlaceOf(point));
    const averagePlaceOf = (point: T): number => normalizeX(rawAveragePlaceOf(point));
    const yOf = (point: T): number => normalizeY(valueAt(this.coordinates, point));

    const last = end - 1;
    // The first and last points are always kept, so only the middle is bucketed.
    const bucketSize = (count - 2) / (threshold - 2);
    const sampled: T[] = [data[start]];
    // Carries forward the previously chosen point's place and value — this
    // used to ask the pass to look back (to the previous bucket) per
    // bucket. The scoring loop already measured this value with the same
    // pass, so the answer is the same.
    let previousX = placeOf(data[start]);
    let previousY = yOf(data[start]);

    for (let i = 0; i < threshold - 2; i++) {
      const [avgX, avgY] = this.nextBucketAverage(
        data,
        start,
        end,
        i,
        bucketSize,
        averagePlaceOf,
        yOf,
      );

      const rangeStart = start + Math.floor(i * bucketSize) + 1;
      const rangeEnd = Math.min(start + Math.floor((i + 1) * bucketSize) + 1, last);

      let maxArea = -1;
      let chosen = Math.min(rangeStart, last);
      let chosenX = previousX;
      let chosenY = previousY;

      for (let j = rangeStart; j < rangeEnd; j++) {
        const placeX = placeOf(data[j]);
        const placeY = yOf(data[j]);
        const area = triangleArea(
          previousX,
          previousY,
          placeX,
          placeY,
          avgX,
          avgY,
        );

        if (area > maxArea) {
          maxArea = area;
          chosen = j;
          chosenX = placeX;
          chosenY = placeY;
        }
      }

      sampled.push(data[chosen]);
      previousX = chosenX;
      previousY = chosenY;
    }

    sampled.push(data[last]);
    return sampled;
  }

  /** The next bucket's centroid. If the bucket is empty, falls back to the last point. */
  private nextBucketAverage(
    data: T[],
    start: number,
    end: number,
    bucket: number,
    bucketSize: number,
    placeOf: (point: T) => number,
    yOf: (point: T) => number,
  ): [number, number] {
    const from = start + Math.floor((bucket + 1) * bucketSize) + 1;
    const to = Math.min(start + Math.floor((bucket + 2) * bucketSize) + 1, end);
    const count = to - from;

    if (count <= 0) {
      const tail = data[end - 1];
      return [placeOf(tail), yOf(tail)];
    }

    let sumX = 0;
    let sumY = 0;
    for (let j = from; j < to; j++) {
      sumX += placeOf(data[j]);
      sumY += yOf(data[j]);
    }

    return [sumX / count, sumY / count];
  }
}

function triangleArea(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): number {
  return Math.abs(((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)) / 2);
}
