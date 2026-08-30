import {
  DataError,
  describe,
  requireDataPoint,
  requirePositive,
} from "../primitives";
import { isGap } from "./accessors";
import { lowerBoundBy, upperBoundBy } from "./search";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataManager,
  DecimationStrategy,
  Range,
  Viewport,
  VisiblePlaced,
} from "./types";

/**
 * x must be finite.
 *
 * A sort check alone doesn't catch `NaN` — `NaN < previous` is false, so it
 * passes through silently. x is the basis for slicing's binary search and
 * decimation's buckets, so one `NaN` makes every comparison false and the
 * search returns the wrong range.
 *
 * No extra read added, since this is in the same loop — the sort check
 * already calls `getX`.
 *
 * Doesn't check y here — that would be a separate O(n) read, and the gate
 * at `Scale.setDomain` already blocks the dangerous outcome (an infinite
 * tick loop).
 */
function assertFiniteX(x: number, index: number): number {
  if (!Number.isFinite(x)) {
    throw new DataError(
      `data x must be a finite number, but index ${index} is ${describe(x)}`,
    );
  }
  return x;
}

export interface SimpleDataManagerOptions<T extends BaseDataPoint> {
  decimation: DecimationStrategy<T>;
  coordinates: CoordinateAccessor<T>;
  /**
   * A ceiling independent of screen width. **No default** — width decides.
   *
   * A ceiling below the width would mean not even one point per pixel gets
   * drawn, cutting visible information. Only give this when you genuinely
   * need a cap on memory or CPU.
   */
  maxPoints?: number;
  /**
   * Target data points per pixel. Defaults to 4.
   *
   * Since M4 picks four (first, last, min, max) from one pixel column, 4
   * makes one column equal one bucket. A strategy where one point is one
   * bar, like candles, should use 1.
   *
   * Counted in CSS pixels. The core doesn't know what the surface is, so it
   * doesn't look at `devicePixelRatio` — raise this value if you want denser
   * drawing on a high-density screen.
   */
  pointsPerPixel?: number;
  /**
   * Whether to stack tiers halved successively. **Off by default.**
   *
   * Turning it on makes panning while zoomed out cost the budget size
   * instead of the window size. Panning over 1 million bars laid out flat
   * goes from 3.50ms to 0.014ms per frame (1200px, 1px per bar). The cost
   * of building the first tier is paid once, on that first frame.
   *
   * In exchange, this costs two things. Memory can double, and `setData`
   * discards every tier — a chart appending bars in real time would rebuild
   * tiers on every update, which is a net loss. This is meant for **large,
   * static data you view zoomed out for a long time**.
   */
  tiered?: boolean;
}

export class SimpleDataManager<
  T extends BaseDataPoint = BaseDataPoint,
> implements DataManager<T> {
  private data: T[] = [];
  private readonly decimation: DecimationStrategy<T>;
  private readonly coordinates: CoordinateAccessor<T>;
  private readonly maxPoints: number;
  private readonly pointsPerPixel: number;
  /**
   * The previous frame's answer and the question that produced it.
   *
   * Height isn't part of the key — slicing is decided by `startX`/`endX`,
   * and the decimation budget by `width`. If only height changed, the
   * answer is the same, so there's no reason to recompute.
   */
  private cached: {
    startX: number;
    endX: number;
    width: number;
    result: T[];
    /** result[i]'s screen place — filled in only when requested. */
    places: number[] | null;
    /** The `Viewport.xEpoch` at the time places were computed — since this cache goes stale on a rebuild. */
    placesEpoch: number;
  } | null = null;
  private readonly tiered: boolean;
  /** tiers[0] is the original. Each level above halves it. Filled in only when needed. */
  private tiers: T[][] = [[]];
  /**
   * The tier confirmed to shrink no further. Anything above it is **never
   * retried** — a failed tier build is one full decimation pass, and
   * without remembering that, every frame would repeat it. The original
   * changing invalidates this verdict too (`setData`, `afterIncrement`).
   */
  private tierCeiling = Number.POSITIVE_INFINITY;

  constructor(options: SimpleDataManagerOptions<T>) {
    this.decimation = options.decimation;
    this.coordinates = options.coordinates;
    /**
     * This is where the two gates meet.
     *
     * `presets.ts` blocks the wiring's `maxPoints`/`pointsPerPixel` with
     * `requirePositive`, but a per-registration
     * `DecimationPolicy.pointsPerPixel` skips that gate and comes straight
     * here — only one of the two siblings was locked.
     *
     * `pointsPerPixel: NaN` turns off decimation entirely, and `0` or `-1`
     * leaves only 2 points, collapsing the chart into a straight line. The
     * manager constructor is the one chokepoint both paths must pass
     * through, which is why the check lives here.
     */
    if (options.maxPoints !== undefined) {
      requirePositive(options.maxPoints, "maxPoints");
    }
    if (options.pointsPerPixel !== undefined) {
      requirePositive(options.pointsPerPixel, "pointsPerPixel");
    }
    this.maxPoints = options.maxPoints ?? Number.POSITIVE_INFINITY;
    this.pointsPerPixel = options.pointsPerPixel ?? 4;
    this.tiered = options.tiered ?? false;
  }

  /**
   * Is this array guaranteed to have no gaps?
   *
   * Gap presence is a property of the array, not the window, so the
   * viewport cache can't save it, and caching by array identity would mean
   * a fresh reference every tick, forcing an O(n) rescan every tick. So the
   * side that knows about changes maintains this incrementally — `setData`
   * is O(n) but runs once, `append`/`prepend` check only what was added,
   * and `updateLast` checks only one point.
   *
   * False covers "don't know" — the safe default is false, and not knowing
   * falls back to a full scan as before (slower, but always correct).
   */
  private gapFree = true;

  read(): T[] {
    return this.data;
  }

  /**
   * The check comes before the assignment.
   *
   * In the reverse order, the manager would still be holding the rejected
   * data even after throwing `DataError`, and the next pan would rebuild
   * the y domain from that value — a chart drawing its axis from data it
   * just declared rejected.
   */
  setData(data: T[]): void {
    const next = [...data];
    this.gapFree = !this.assertSorted(next);
    this.data = next;
    this.cached = null;
    // Tiers come from the original. If the original changes, all of them are discarded.
    this.tiers = [this.data];
    this.tierCeiling = Number.POSITIVE_INFINITY;
  }

  /**
   * The check drops from O(everything) to O(chunk) — the existing side was
   * already checked coming in, so checking just the seam gives the same
   * guarantee as a full check.
   */
  append(points: T[]): void {
    if (points.length === 0) return;

    const chunkHasGap = this.assertChunkSorted(points);
    const lastX = this.data.length
      ? this.coordinates.getX(this.data[this.data.length - 1])
      : null;
    const firstNewX = this.coordinates.getX(points[0]);
    if (lastX !== null && firstNewX < lastX) {
      throw new DataError(
        `appended data must continue after x=${lastX}, got ${describe(firstNewX)}`,
      );
    }

    this.data = this.data.concat(points);
    // If there's already a gap (i.e., unknown), checking what was appended changes nothing.
    if (this.gapFree) this.gapFree = !chunkHasGap;
    this.afterIncrement();
  }

  prepend(points: T[]): void {
    if (points.length === 0) return;

    const aheadHasGap = this.assertChunkSorted(points);
    const firstX = this.data.length
      ? this.coordinates.getX(this.data[0])
      : null;
    const lastNewX = this.coordinates.getX(points[points.length - 1]);
    if (firstX !== null && lastNewX > firstX) {
      throw new DataError(
        `prepended data must end before x=${firstX}, got ${describe(lastNewX)}`,
      );
    }

    this.data = points.concat(this.data);
    if (this.gapFree) this.gapFree = !aheadHasGap;
    this.afterIncrement();
  }

  replaceLast(point: T): void {
    if (this.data.length === 0) {
      this.append([point]);
      return;
    }

    /**
     * Checks finiteness here too — `replaceLast` (the real-time path)
     * doesn't go through `setData`/`append`/`prepend`'s sort check.
     * `x < previousX` can't catch `NaN` (the comparison is false), and if a
     * `NaN` sits unchecked in `this.data`, the next binary search returns
     * the wrong range — in a global index coordinate space, that even
     * makes another pane's series disappear.
     *
     * The tick branch (same x, i.e. a replacement) goes through the same
     * shape check as `append` — if this were the one branch left out while
     * ticks are 99% of the traffic, and history is `{x, y}` while a
     * websocket streams `{x, close}`, y would keep getting silently
     * recomputed to a phantom value and only throw the moment the bar
     * rolls over — the hardest possible shape of bug to diagnose.
     */
    requireDataPoint(point, this.data.length - 1, "updateLast(point)");
    this.assertReadableValue(point, this.data.length - 1);
    this.coordinates.assertFinite?.(point, this.data.length - 1);
    const x = assertFiniteX(this.coordinates.getX(point), this.data.length - 1);
    const previousX =
      this.data.length > 1
        ? this.coordinates.getX(this.data[this.data.length - 2])
        : null;
    if (previousX !== null && x < previousX) {
      throw new DataError(
        `replaced last point must keep x >= ${previousX}, got ${describe(x)}`,
      );
    }

    /**
     * Builds a new array — the `Source` contract says "same reference if
     * unchanged," so an in-place mutation would look to consumers like
     * "nothing changed."
     *
     * Copies exactly once — `slice` plus `concat` would be two copies. This
     * is the tick path, so doubling it would hit every websocket update.
     */
    const next = this.data.slice();
    next[next.length - 1] = point;
    this.data = next;
    /**
     * Checks only the one point. Doesn't reconsider what came before — the
     * one gap that existed might have just been overwritten with a value,
     * but confirming that would need a full scan, so this stays false
     * (unknown).
     */
    if (this.gapFree && isGap(this.coordinates.getY(point))) {
      this.gapFree = false;
    }
    this.afterIncrement();
  }

  private afterIncrement(): void {
    this.cached = null;
    // Tiers are derived from the original — discarded entirely, same reasoning as `setData`. The option docs already say `tiered` is a loss for real time.
    this.tiers = [this.data];
    this.tierCeiling = Number.POSITIVE_INFINITY;
  }

  /**
   * Catches a mapping mistake from a single first point — O(1). Mapping a
   * wrong field name like `{x, value}` makes the accessor return
   * `undefined`, and not a single line gets drawn while the console stays
   * silent.
   *
   * Checks only the first point, not every point — this error comes from a
   * `.map()`, so it's uniform, and an individual point missing a value is
   * already legal by contract (`null`, whitespace). This is a different
   * axis than checking y's finiteness (the same gate as x) — this is about
   * y being absent (shape), not its value.
   */
  private assertReadableValue(point: T, index: number): void {
    if (this.coordinates.getY(point) === undefined) {
      throw new DataError(
        `could not read a value from a data point — index ${index} has no y. ` +
          "If your field is named differently, e.g. {x, value}, provide a coordinates accessor",
      );
    }
  }

  /**
   * Checks the last point too — on the incremental paths (`append`,
   * `prepend`) the assumption that a `.map()` makes everything uniform can
   * break. Checks for gaps in the same pass — a separate pass would walk
   * the array twice on every derived tick.
   *
   * The return value is "does this chunk have a gap." For a `gapless`
   * accessor, `getY` isn't read at all.
   */
  private assertChunkSorted(points: readonly T[]): boolean {
    const watchGaps = this.coordinates.gapless !== true;
    let sawGap = false;

    requireDataPoint(points[0], 0, "data");
    this.assertReadableValue(points[0], 0);
    if (watchGaps && isGap(this.coordinates.getY(points[0]))) sawGap = true;
    /**
     * Shape before value — if `requireDataPoint` doesn't check the last
     * point first, one `null` at the end of the array blows up inside the
     * accessor as a raw `TypeError`.
     */
    const last = points.length - 1;
    if (last > 0) {
      requireDataPoint(points[last], last, "data");
      this.assertReadableValue(points[last], last);
    }
    this.coordinates.assertFinite?.(points[0], 0);
    let previous = assertFiniteX(this.coordinates.getX(points[0]), 0);
    for (let i = 1; i < points.length; i++) {
      // Shape first — this used to be where a single `null` element blew
      // up as a TypeError inside the accessor. **No extra read, since this is the same loop.**
      requireDataPoint(points[i], i, "data");
      const current = assertFiniteX(this.coordinates.getX(points[i]), i);
      this.coordinates.assertFinite?.(points[i], i);
      if (watchGaps && !sawGap && isGap(this.coordinates.getY(points[i]))) {
        sawGap = true;
      }
      if (current < previous) {
        throw new DataError(
          `data must be sorted by x, but index ${i} (${current}) comes before index ${i - 1} (${previous})`,
        );
      }
      previous = current;
    }

    return sawGap;
  }

  /**
   * x-ascending order is a contract. Violate it and you find out here —
   * slicing is a binary search, which needs order, and unsorted data gets
   * drawn wrong regardless. Repeated x values in a row are allowed (two
   * points at one moment in time is fine).
   *
   * Merged into one with `assertChunkSorted` — these used to be nearly
   * identical copies, and the one real difference (the empty-array gate,
   * checking the last point) actually drifted apart and left a hole in the
   * incremental path.
   */
  private assertSorted(data: readonly T[]): boolean {
    // `=== 0`, not `< 2` — even a single-element array needs its shape and
    // finiteness checked (there's just nothing to sort).
    if (data.length === 0) return false;

    return this.assertChunkSorted(data);
  }

  /**
   * Called every frame. If the viewport and data are unchanged, returns
   * the last result as is.
   *
   * Pan and zoom change the viewport every frame, so the cache doesn't help
   * there. Where it does help is a re-render with an unchanged viewport —
   * moving the crosshair, updating a decoration, a derived series asking
   * about the same range multiple times.
   *
   * Treat the returned array as read-only — the same array keeps going out
   * as long as the cache is alive.
   *
   * `screenXScan` isn't part of the cache key — a bar-index mapping
   * rebuilt by another series's change can leave this cache stale, but the
   * only thing that drifts is decimal points at bucket boundaries, and the
   * next pan or zoom washes it out immediately.
   */
  getVisibleData(viewport: Viewport): T[] {
    if (this.data.length === 0) return [];

    const cached = this.cached;
    if (
      cached !== null &&
      cached.startX === viewport.startX &&
      cached.endX === viewport.endX &&
      cached.width === viewport.width
    ) {
      return cached.result;
    }

    const threshold = this.thresholdFor(viewport);
    const tier = this.tierFor(viewport, threshold);

    // The window is a pair of indices, not a copy — the binary search result passes straight through.
    const result = this.decimation.decimate(
      tier,
      {
        start: this.lowerBound(tier, viewport.startX),
        end: this.upperBound(tier, viewport.endX),
      },
      threshold,
      viewport.screenXScan,
      this.gapFree,
    );

    this.cached = {
      startX: viewport.startX,
      endX: viewport.endX,
      width: viewport.width,
      result,
      places: null,
      placesEpoch: 0,
    };

    return result;
  }

  /**
   * Places are computed once at the cache layer — for a frame where the
   * viewport isn't changing (hover, etc.), this removes drawing having to
   * search the merged x list per point. `xEpoch` is what opens up the
   * going-stale-on-rebuild problem — another series's `setData` changing
   * the merged list shifts my places even though my data is unchanged, so
   * unlike the point cache, a stale place is a wrong picture.
   */
  getVisiblePlaced(viewport: Viewport): VisiblePlaced<T> {
    const points = this.getVisibleData(viewport);
    const cached = this.cached;
    const scan = viewport.screenXScan;
    // Doesn't carry places if there's no cache (empty data) or no separate
    // place space (continuous coordinate space) — drawing's `toPixel` is
    // already O(1).
    if (cached === null || scan === undefined) return { points, places: null };

    /**
     * Doesn't cache without a key. `xEpoch` traveling together with
     * `screenXScan` is a contract, but the type system can't enforce it —
     * if a viewport arrives missing the key, this recomputes every time
     * instead of returning a stale place.
     */
    const epoch = viewport.xEpoch;
    if (cached.places === null || epoch === undefined || cached.placesEpoch !== epoch) {
      const place = scan();
      const places = new Array<number>(points.length);
      for (let i = 0; i < points.length; i++) {
        places[i] = place(this.coordinates.getX(points[i]));
      }
      cached.places = places;
      cached.placesEpoch = epoch ?? 0;
    }
    return { points, places: cached.places };
  }

  /**
   * There's no reason to draw 100k points in 400px — keep only as many as
   * screen width needs, without exceeding the ceiling.
   *
   * The floor used to fail at being a floor when handed `NaN` —
   * `Math.max(1, NaN)` is `NaN`, and that budget passes every comparison,
   * turning off decimation entirely. The comparison is flipped (`>= 1`) so
   * `NaN` falls through to the floor.
   */
  private thresholdFor(viewport: Viewport): number {
    const byWidth = Math.ceil(viewport.width * this.pointsPerPixel);
    if (!(byWidth >= 1)) return 1;
    return Math.min(this.maxPoints, byWidth);
  }

  /** Since it's sorted, both ends are the range. */
  getXRange(): Range | null {
    if (this.data.length === 0) return null;

    return {
      min: this.coordinates.getX(this.data[0]),
      max: this.coordinates.getX(this.data[this.data.length - 1]),
    };
  }

  /**
   * Leaves the per-call closure as is — hoisting it to an instance field
   * was measured, but the real path's total cost is under 1 microsecond
   * per frame, below the resolution of the budget, and the hoisted version
   * was actually slightly slower (polymorphic calls block inlining). Not
   * justified by an isolated benchmark's multiplier alone.
   */
  private lowerBound(source: T[], value: number): number {
    return lowerBoundBy(source, value, (point) => this.coordinates.getX(point));
  }

  private upperBound(source: T[], value: number): number {
    return upperBoundBy(source, value, (point) => this.coordinates.getX(point));
  }

  /**
   * Picks the tier that fits drawing this window. If tiers are off, this
   * is always the original.
   *
   * The rule: go up a level if the next tier can still fill the budget for
   * this window. So the chosen tier always has at least the budget's worth
   * inside the window, and slicing and decimation after this scale with
   * the budget, not the window size.
   *
   * The point count within the window is counted directly on that tier —
   * never estimated from the overall size ratio. On data clustered to one
   * side, the ratio and the real count aren't proportional at all.
   */
  private tierFor(viewport: Viewport, threshold: number): T[] {
    if (!this.tiered || this.data.length === 0) return this.data;

    let level = 0;

    // No reason to build a higher tier if the current one is already near
    // budget. Without this gate, zooming in to look closely would still
    // build a tier on the first frame — one that would never even be used.
    while (this.countInWindow(this.tiers[level], viewport) > threshold * 2) {
      if (this.tierAt(level + 1, viewport.screenXScan) === null) break;
      if (this.countInWindow(this.tiers[level + 1], viewport) < threshold) break;
      level += 1;
    }

    return this.tiers[level];
  }

  /** How many points in this array fall inside the window. */
  private countInWindow(source: T[], { startX, endX }: Viewport): number {
    return this.upperBound(source, endX) - this.lowerBound(source, startX);
  }

  /**
   * Builds tiers on demand. A built tier stays until the next `setData`.
   *
   * Each tier is built from the previous one — rescanning the original
   * every time would defeat the point of stacking tiers. Since each halves
   * the last, even fully stacked they never exceed twice the original.
   *
   * `null` if it can't shrink further, and that verdict is remembered —
   * otherwise the next frame reruns the same full decimation from scratch
   * and throws the result away again. A tier failing to shrink isn't rare
   * (e.g. data with enough gaps that the budget balloons) — left
   * unhandled, that would make `tiered: true` worse than not using it.
   *
   * Why this takes `screenXScan`: tiers bucket in x space while the
   * visible window buckets in screen space, so they can drift apart in a
   * bar-index coordinate space — a point already dropped from a tier can't
   * be recovered later.
   */
  private tierAt(
    level: number,
    screenXScan?: () => (x: number) => number,
  ): T[] | null {
    if (level >= this.tierCeiling) return null;

    for (let i = this.tiers.length; i <= level; i++) {
      const previous = this.tiers[i - 1];
      const halved = this.decimation.decimate(
        previous,
        { start: 0, end: previous.length },
        Math.ceil(previous.length / 2),
        screenXScan,
        // A tier is a reduction that preserves gaps, so if the original has none, neither does the tier.
        this.gapFree,
      );

      if (halved.length >= previous.length) {
        this.tierCeiling = i;
        return null;
      }
      this.tiers[i] = halved;
    }

    return this.tiers[level];
  }
}
