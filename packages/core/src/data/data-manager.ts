import { ContractError,
  DataError,
  describe,
  requirePositive,
} from "../primitives";
import { isGap } from "./accessors";
import { mergeByX } from "./merge-by-x";
import { lowerBoundBy, upperBoundBy } from "./search";
import type { SeamContext } from "./validate";
import { checkPoint, continuesAfter, scanSeriesData } from "./validate";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataManager,
  DataView,
  DecimationStrategy,
  IndexRange,
  Range,
  Viewport,
  VisiblePlaced,
} from "./types";

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
   * Dev-time full re-validation on `adoptHeadRetainingTail`. Production
   * needs only validate the new head because the retained suffix is this
   * manager's own previously accepted data; this option also catches illegal
   * mutation of that retained data during development and dogfooding.
   */
  verifyAdoptions?: boolean;
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
  /** An x retained across prepends so index-bucket boundaries do not move. */
  private bucketAnchorX: number | null = null;
  private readonly coordinates: CoordinateAccessor<T>;
  private readonly maxPoints: number;
  private readonly pointsPerPixel: number;
  private readonly verifyAdoptions: boolean;
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
    /** The points just outside the window on each side, if any. */
    before: T | undefined;
    after: T | undefined;
    /** `result` with `before` and `after` around it — built only when drawing asks. */
    drawn: T[] | null;
    /** drawn[i]'s screen place — filled in only when requested. */
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
     * The gate every budget passes, whoever set it.
     *
     * `presets.ts` checks the wiring's `maxPoints`/`pointsPerPixel` and a
     * registration's own `DecimationPolicy.pointsPerPixel` with
     * `requirePositive` before it builds a manager; a manager built by any
     * other wiring gets the same check here, so no path reaches the
     * fields below unguarded.
     *
     * Unguarded, `NaN`, `0` and `-1` all end the same way: the per-pixel
     * threshold floors them to a budget of one (`byWidth >= 1` fails for
     * all three), and M4 keeps a single column, collapsing the chart into
     * at most four points. The manager constructor is the one chokepoint
     * all paths share, which is why the check lives here too.
     */
    if (options.maxPoints !== undefined) {
      requirePositive(options.maxPoints, "maxPoints");
    }
    if (options.pointsPerPixel !== undefined) {
      requirePositive(options.pointsPerPixel, "pointsPerPixel");
    }
    this.maxPoints = options.maxPoints ?? Number.POSITIVE_INFINITY;
    this.pointsPerPixel = options.pointsPerPixel ?? 4;
    this.verifyAdoptions = options.verifyAdoptions ?? false;
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

  read(): DataView<T> {
    return this.data;
  }

  /**
   * The check comes before the assignment.
   *
   * In the reverse order, the manager would still be holding the rejected
   * data even after throwing `DataError`, and the next pan would rebuild
   * the y domain from that value — a chart drawing its axis from data it
   * just declared rejected.
   *
   * The array is copied so the caller's later `push` doesn't land here;
   * the points are kept as given. Every point is read from then on
   * (sorting check, binary search, tiers), so a point edited after the
   * handoff is a chart that silently disagrees with its own index — the
   * caller's contract is that a handed-over point isn't edited.
   */
  setData(data: T[]): void {
    const next = [...data];
    this.gapFree = !this.assertSorted(next);
    this.data = next;
    this.reconcileBucketAnchor();
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

    // The seam is the walk's seed — the existing tail plays "the previous
    // point" for the chunk's first one (one rule set, ADR-0032).
    const chunkHasGap = this.assertChunkSorted(
      points,
      this.data.length
        ? { lastX: this.coordinates.getX(this.data[this.data.length - 1]) }
        : undefined,
    );

    this.data = this.data.concat(points);
    // If there's already a gap (i.e., unknown), checking what was appended changes nothing.
    if (this.gapFree) this.gapFree = !chunkHasGap;
    this.afterIncrement();
  }

  prepend(points: T[]): void {
    if (points.length === 0) return;

    const aheadHasGap = this.assertChunkSorted(
      points,
      this.data.length ? { firstX: this.coordinates.getX(this.data[0]) } : undefined,
    );

    this.data = points.concat(this.data);
    if (this.gapFree) this.gapFree = !aheadHasGap;
    this.afterIncrement();
  }

  /**
   * Merges by x — see the `DataManager` contract. The incoming chunk is
   * walked the way `append`'s is, seeded with the held point just before
   * where the chunk begins; that seed is strictly below the chunk's first x
   * by construction (a lower bound), so the seam can only be asked about a
   * gap, never about order. The held array is sorted by every door it came
   * through, so nothing of it is re-checked.
   */
  merge(points: T[]): void {
    if (points.length === 0) return;

    // The first point is read before the chunk is walked, because where
    // the chunk begins decides the seam it is walked against.
    const from = checkPoint(points[0], 0, this.coordinates, "upsert(points)", null, true);
    const start = lowerBoundBy(this.data, from, (point) => this.coordinates.getX(point));
    const chunkHasGap = this.assertChunkSorted(
      points,
      start > 0 ? { lastX: this.coordinates.getX(this.data[start - 1]) } : undefined,
      "upsert(points)",
    );

    this.data = mergeByX(this.data, points, (point) => this.coordinates.getX(point)).points;
    // Conservative: a gap the chunk opened is known, one it closed is not.
    if (this.gapFree) this.gapFree = !chunkHasGap;
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
    // The same per-point body the whole-array walk runs — one rule set,
    // reported at the index of the bar being replaced.
    const x = checkPoint(
      point,
      this.data.length - 1,
      this.coordinates,
      "updateLast(point)",
      null,
      true,
    );
    const previousX =
      this.data.length > 1
        ? this.coordinates.getX(this.data[this.data.length - 2])
        : null;
    // The bar before the last is the tick's seam — `uniqueX` says it may
    // not be landed on (one bar per x); the last one itself is what a
    // tick replaces, so it is never compared.
    if (previousX !== null && !continuesAfter(x, previousX, this.coordinates.uniqueX === true)) {
      throw new DataError(
        x === previousX
          ? `updateLast(point) must hold one point per x, but x=${x} repeats the bar before the last`
          : `replaced last point must keep x >= ${previousX}, got ${describe(x)}`,
      );
    }

    /**
     * Builds a new array — the `Source` contract says "same reference if
     * unchanged," so an in-place mutation would look to consumers like
     * "nothing changed."
     *
     * Copies exactly once — `slice` plus `concat` would be two copies. This
     * is the tick path, so doubling it would hit every websocket update.
     *
     * **That one copy is O(history), and it's the deliberate price of the
     * identity contract.** Measured per tick: 1.3µs at 1k points, 73µs at
     * 100k, 356µs at 500k (plus ~4MB of allocation per tick at 500k).
     * Drawing stays flat with dataset size — this copy is the one cost
     * that doesn't. Inside a few hundred thousand bars it fits the frame
     * budget; past that, the fix is moving change detection off array
     * identity (a revision counter), not shaving this line.
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
    this.reconcileBucketAnchor();
    this.cached = null;
    // Tiers are derived from the original — discarded entirely, same reasoning as `setData`. The option docs already say `tiered` is a loss for real time.
    this.tiers = [this.data];
    this.tierCeiling = Number.POSITIVE_INFINITY;
  }

  private reconcileBucketAnchor(): void {
    if (!this.decimation.indexAnchored) return;
    if (this.data.length === 0) {
      this.bucketAnchorX = null;
      return;
    }
    const anchor = this.bucketAnchorX;
    if (anchor !== null) {
      const at = this.lowerBound(this.data, anchor);
      if (at < this.data.length && this.coordinates.getX(this.data[at]) === anchor) return;
    }
    this.bucketAnchorX = this.coordinates.getX(this.data[0]);
  }

  private bucketOrigin(source: T[]): number | undefined {
    if (!this.decimation.indexAnchored || this.bucketAnchorX === null) return undefined;
    return this.lowerBound(source, this.bucketAnchorX);
  }

  private decimationRange(source: T[], start: number, end: number): IndexRange {
    const originIndex = this.bucketOrigin(source);
    return originIndex === undefined ? { start, end } : { start, end, originIndex };
  }

  /**
   * Every full-chunk rule (shape, readable y, finite x, per-accessor
   * values, gaps, order) lives in `scanSeriesData` — shared with the
   * public `validateSeriesData`, so "validator said null" and "ingestion
   * accepted" cannot drift apart. Throw mode: the first violation throws
   * `DataError`, nothing allocated on the way.
   *
   * The return value is "does this chunk have a gap." For a `gapless`
   * accessor, `getY` isn't read at all.
   */
  private assertChunkSorted(points: readonly T[], seam?: SeamContext, label?: string): boolean {
    return scanSeriesData(points, this.coordinates, null, seam, label);
  }

  /**
   * x-ascending order is a contract. Violate it and you find out here —
   * slicing is a binary search, which needs order, and unsorted data gets
   * drawn wrong regardless. A repeated x is allowed (two points at one
   * moment) unless the accessor declares `uniqueX`.
   *
   * Merged into one with `assertChunkSorted` — these used to be nearly
   * identical copies, and the one real difference (the empty-array gate,
   * checking the last point) actually drifted apart and left a hole in the
   * incremental path.
   */
  /**
   * The landing door — see the `DataManager` contract. The caller supplies
   * only the changed head; the retained body is selected from this manager's
   * own accepted array. That makes narrowed validation a structural fact,
   * not a promise that a fresh re-derived body happens to be safe.
   */
  adoptHeadRetainingTail(head: T[], retainedFrom: number): void {
    if (head.length === 0) {
      throw new ContractError(
        "adoptHeadRetainingTail(head, retainedFrom): head must not be empty",
      );
    }
    if (
      !Number.isInteger(retainedFrom) ||
      retainedFrom < 0 ||
      retainedFrom >= this.data.length
    ) {
      throw new ContractError(
        `adoptHeadRetainingTail(head, retainedFrom): retainedFrom must be within [0, ${this.data.length}), got ${describe(retainedFrom)}`,
      );
    }

    const retained = this.data.length - retainedFrom;
    const adopted = new Array<T>(head.length + retained);
    for (let i = 0; i < head.length; i++) adopted[i] = head[i];
    for (let i = 0; i < retained; i++) adopted[head.length + i] = this.data[retainedFrom + i];

    if (this.verifyAdoptions) {
      this.gapFree = !this.assertSorted(adopted);
    } else {
      // The retained tail is the head's seam — same rule as `prepend`.
      const headHasGap = this.assertChunkSorted(head, {
        firstX: this.coordinates.getX(this.data[retainedFrom]),
      });
      if (this.gapFree) this.gapFree = !headHasGap;
    }
    this.data = adopted;
    this.afterIncrement();
  }

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
  getVisibleData(viewport: Viewport): DataView<T> {
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
    const start = this.lowerBound(tier, viewport.startX);
    const end = this.upperBound(tier, viewport.endX);
    const result = this.decimation.decimate(
      tier,
      this.decimationRange(tier, start, end),
      threshold,
      viewport.screenXScan,
      this.gapFree,
    );

    this.cached = {
      startX: viewport.startX,
      endX: viewport.endX,
      width: viewport.width,
      result,
      before: tier[start - 1],
      after: tier[end],
      drawn: null,
      places: null,
      placesEpoch: 0,
    };

    return result;
  }

  /**
   * What drawing gets: the visible points plus the one neighbour just
   * outside the window on each side. Without them a line stops at the last
   * point inside the view — an empty strip at each plot edge, no line at
   * all around a single visible point — and a candle the edge cuts
   * vanishes. The clip hides what falls outside. The neighbours sit
   * outside the decimated window, so they never stretch its buckets, and
   * `getVisibleData` stays the exact window the y range is built from.
   *
   * Places are computed once at the cache layer — for a frame where the
   * viewport isn't changing (hover, etc.), this removes drawing having to
   * search the merged x list per point. `xEpoch` is what opens up the
   * going-stale-on-rebuild problem — another series's `setData` changing
   * the merged list shifts my places even though my data is unchanged, so
   * unlike the point cache, a stale place is a wrong picture.
   */
  getVisiblePlaced(viewport: Viewport): VisiblePlaced<T> {
    const visible = this.getVisibleData(viewport);
    const cached = this.cached;
    if (cached === null) return { points: visible, places: null };
    if (cached.drawn === null) {
      const { before, after } = cached;
      cached.drawn =
        before === undefined && after === undefined
          ? cached.result
          : (before === undefined ? [] : [before]).concat(
              cached.result,
              after === undefined ? [] : [after],
            );
    }
    const points = cached.drawn;
    const scan = viewport.screenXScan;
    // Doesn't carry places if there's no separate place space (continuous
    // coordinate space) — drawing's `toPixel` is already O(1).
    if (scan === undefined) return { points, places: null };

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
        this.decimationRange(previous, 0, previous.length),
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
