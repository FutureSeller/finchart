import type { Scale } from "./types";
import { lerp, unlerp } from "./finite-lerp";

/**
 * Where a data point's x lands on screen. This is everything a series
 * knows about x.
 *
 * If series used `Scale` directly, "x is continuous" would be baked into
 * drawing code everywhere, leaving no room for the bar-index coordinate
 * system financial charts want (where weekends and market closures don't
 * open up as gaps).
 *
 * So there's a layer in between. `Scale` only does domain↔pixel
 * underneath it, and this contract decides whether the domain is time or
 * a bar index.
 *
 * Continuous is the default — turning irregular numeric x into a bar
 * index erases the meaning of spacing, so bar index has to be something a
 * chart opts into, not something imposed on it.
 */
export interface XMapping {
  /** Data x → screen px. */
  toPixel(x: number): number;
  /** Screen px → data x. */
  fromPixel(px: number): number;

  /**
   * Data x → scale domain value. Identity when continuous, an index when
   * it's bar-index.
   *
   * Pan/zoom operates in the scale domain (it has to, for bar-index, to
   * move evenly bar by bar), while the data-side world (slicing, events)
   * speaks in x. The index is a monotonic function of x, so an interval
   * maps to an interval.
   */
  toDomain(x: number): number;
  /** Scale domain value → data x. The inverse of `toDomain`. */
  fromDomain(value: number): number;

  /**
   * The bar-spacing limits to use when wiring hasn't set its own (pixels
   * per one domain unit).
   *
   * Only the mapping knows what one domain unit means, so the mapping
   * declares the default too — one unit of a continuous mapping might be
   * ms or might be days, and it would be a disaster for the core to
   * guess. `PlotConfig`'s `min/maxBarSpacing` always wins over this.
   */
  barSpacingDefaults?: { min?: number; max?: number };

  /**
   * The data changed — a chance to re-index. If this is absent there's
   * nothing to count (continuous mapping), and Plot skips collecting x
   * altogether at that point.
   *
   * `sources` is the list of x values per registration (each ascending).
   * Merging them into an index is the mapping's job — Plot only gathers
   * x.
   */
  rebuild?(sources: readonly (readonly number[])[]): void;

  /**
   * Opens one ascending scan pass — returns a function with the same
   * answers as `toDomain`, except that function owns its own cursor.
   *
   * Keeping a single cursor inside the mapping and sharing it across
   * every caller would let a scanning consumer and a point-by-point
   * consumer (drawing, hit testing) trample each other's cursor.
   * `toDomain` stays pure (binary search, no state), and only a consumer
   * that needs scan acceleration opens a pass through this door and gets
   * a cursor that's born and dies with that pass.
   *
   * Absent means the domain equals x (continuous mapping) — same rule as
   * `rebuild`: existence itself is the declaration.
   */
  scanToDomain?(): (x: number) => number;

  /**
   * The screen-space form of `scanToDomain` — one ascending scan pass's
   * `toPixel`. Drawing is this pass's second consumer: a series walks
   * points in ascending x, so it walks with the pass-owned cursor instead
   * of a binary search per point.
   *
   * Same rule as `scanToDomain` — the answer always matches `toPixel`
   * (it just falls back to binary search when it misses), and its
   * absence means `toPixel` is already O(1).
   */
  scanToPixel?(): (x: number) => number;

  /**
   * Scale domain value → screen px. The O(1) arithmetic that places a
   * `place` produced by `toDomain`/`fromDomain` onto a pixel — the back
   * half of `toPixel`.
   *
   * Used when drawing from a place decimation already computed — the
   * front half (`toDomain`), which searches the merged x list per point,
   * drops out entirely. Absent means drawing falls back to `toPixel`.
   */
  domainToPixel?: (value: number) => number;
}

/** How wiring builds a mapping. `Scale` belongs to wiring, so it's received here. */
export type XMappingFactory = (scale: Scale) => XMapping;

/**
 * A place to count which road was taken, when a fast path and a slow path
 * fork.
 *
 * When an optimization is "pick one of two" rather than "make it faster",
 * you can't measure the cost but you can count which path was chosen —
 * unlike timing, that's deterministic and doesn't jitter. Without this, an
 * optimization like that could be deleted and the tests would stay quiet:
 * the answer is the same so correctness tests don't catch it, and the
 * call count is the same so invariant guards don't catch it either.
 *
 * The cost in production is one `undefined` check per call — not per
 * step.
 */
export interface XMappingProbe {
  /**
   * The scan pass's cursor hit a backward step wider than the window and
   * had to search from scratch.
   *
   * A backward step within the window (values mixed within a decimation bucket)
   * is walked; a far forward jump (a decimation stride) is caught up
   * silently by galloping — that's still scanning, so it isn't reported.
   * Since the cursor is owned by the pass, one or two of these at the
   * start of a pass are normal. If it scales with the number of points in
   * the pass, the scan has stopped working.
   */
  onFallback?(): void;

  /**
   * The rebuild fell back to a full walk — how many times the tail fast
   * path (when the same source arrays grew in place, keeping their
   * identity from the last rebuild) missed. The normal value for a new
   * candle is 0; `setData`, prepend, and a configuration change are
   * correctly counted as full every time.
   */
  onFullRebuild?(): void;
}

/**
 * Passes x straight through to the scale. **This is the existing
 * behavior and the default.**
 *
 * The domain is the data's x, so an empty span occupies an empty span on
 * screen too.
 */
export function continuousX(scale: Scale): XMapping {
  return {
    toPixel: (x) => scale.scale(x),
    fromPixel: (px) => scale.invert(px),
    toDomain: (x) => x,
    fromDomain: (value) => value,
    domainToPixel: (value) => scale.scale(value),
  };
}

/**
 * Builds the union of several sorted arrays in a single scan.
 *
 * Each registration is already sorted, so the union of k sorted arrays
 * only costs `N·k` comparisons via a cursor scan, whereas sorting
 * everything again would be `N log N` — and would re-sort the whole thing
 * even for a tail append (one new candle).
 *
 * With a single series there's no scan at all — just a dedupe pass.
 */
function mergeSortedUnique(
  sources: readonly (readonly number[])[],
): number[] {
  const live = sources.filter((source) => source.length > 0);
  if (live.length === 0) return [];

  const out: number[] = [];

  if (live.length === 1) {
    const only = live[0];
    for (let i = 0; i < only.length; i++) {
      if (out.length === 0 || out[out.length - 1] !== only[i]) out.push(only[i]);
    }
    return out;
  }

  const cursors = new Array<number>(live.length).fill(0);
  for (;;) {
    // k is small (the number of series) — a scan is cheaper than a heap
    // here, and branch-predicts better.
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < live.length; i++) {
      const at = cursors[i];
      if (at < live[i].length && live[i][at] < min) min = live[i][at];
    }
    if (min === Number.POSITIVE_INFINITY) break;

    // Push every cursor holding this value forward — this is where
    // duplicates across series get collected.
    for (let i = 0; i < live.length; i++) {
      const source = live[i];
      let at = cursors[i];
      while (at < source.length && source[at] === min) at++;
      cursors[i] = at;
    }

    out.push(min);
  }

  return out;
}

const firstOrNaN = (source: readonly number[]): number =>
  source.length > 0 ? source[0] : Number.NaN;

/**
 * Converts x into a bar index before handing it to the scale. This is the
 * coordinate system financial charts want.
 *
 * A bar is always exactly one slot from its neighbor regardless of the x
 * gap — weekends and market closures don't open up as blank space on
 * screen, and pan/zoom moves evenly bar by bar too.
 *
 * ```ts
 * browserDeps({ createXMapping: barIndexX })
 * ```
 *
 * The origin is the first bar ever seen, and it never moves after that.
 * When `prepend` attaches history, the new bars extend into negative
 * indices — existing bars keep their index, so the window (the domain)
 * you were looking at still fits.
 *
 * An x between bars (say, under the crosshair) is placed by linear
 * interpolation between its neighbors. Outside either end, the edge
 * spacing is carried on.
 */
export function barIndexX(scale: Scale, probe?: XMappingProbe): XMapping {
  /** The union of x across every registration, ascending and deduped. One slot is one bar. */
  let xs: number[] = [];
  /** The index of `xs[0]`. Goes further negative the more `prepend` attaches at the front. */
  let base = 0;
  /** The bar that remembers the origin. Re-indexing keeps this bar's index fixed. */
  let anchor: { x: number; index: number } | null = null;
  /** The source arrays from the last rebuild — the identity key for the tail fast path. */
  let lastSources: readonly (readonly number[])[] | null = null;
  let lastLengths: number[] = [];
  /**
   * Each source's first value at the last rebuild. Identity plus length
   * says a shared array *grew*; only the front value says on which end —
   * without it, a front-grown array whose shifted region repeats the old
   * maximum passes the tail test's shape and the prepended bar dedupes
   * into nothing.
   */
  let lastFirsts: number[] = [];

  /** The first place within `[from, to)` at or past `x` (lower bound). */
  const searchBetween = (x: number, from: number, to: number): number => {
    let low = from;
    let high = to;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (xs[mid] < x) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  /** The first place at or past `x` (lower bound). */
  const searchFrom = (x: number): number => searchBetween(x, 0, xs.length);

  /**
   * The interpolation once the lower bound `at` is already in hand. Both
   * `toDomain` and the scan pass read this same function — only the
   * search (where to start looking) differs, and the arithmetic that
   * produces the answer has to be one piece, so there's no room for a
   * stale pass to disagree with the true value.
   */
  const placeAt = (at: number, x: number): number => {
    const n = xs.length;
    if (at === 0) return base + unlerp(xs[0], xs[1], x);
    if (at === n) {
      return base + (n - 1) - unlerp(xs[n - 1], xs[n - 2], x);
    }
    if (xs[at] === x) return base + at;

    return base + (at - 1) + unlerp(xs[at - 1], xs[at], x);
  };

  /**
   * Pure — no matter who calls this or when, it's one binary search. Scan
   * state moves only into `scanToDomain`'s pass-owned cursor.
   */
  const toDomain = (x: number): number => {
    const n = xs.length;
    // Before any data — there's nothing to count. Identity instead of
    // NaN — there's nothing to draw anyway.
    if (n === 0) return x;
    // One bar alone tells you nothing about spacing. Treat one unit of x
    // as one slot outright.
    if (n === 1) return base + (x - xs[0]);

    return placeAt(searchFrom(x), x);
  };

  /**
   * How many steps forward the cursor walks before giving up. Past this,
   * it falls back to binary search — the limit is set so that even a
   * miss costs no more than the old pure-binary-search path did.
   */
  const SCAN_STEPS = 32;

  /** → `XMapping.scanToDomain`. The cursor belongs to this pass — nothing outside can touch it. */
  const scanToDomain = (): ((x: number) => number) => {
    let cursor = 0;
    /** The step taken by the last query — the first candidate for the next one. Pass-owned, so it dies with the pass. */
    let stride = 0;

    return (x) => {
      const n = xs.length;
      if (n === 0) return x;
      if (n === 1) return base + (x - xs[0]);

      // A rebuild mid-pass may have shrunk the list — clamp the cursor
      // to the length.
      let at = cursor > n ? n : cursor;

      // Stride prediction. A scan pass's forward step tends to be fairly
      // constant — look ahead by last step's width first: if it's right,
      // it costs two comparisons (a cached neighbor); if it's wrong, the
      // walk/gallop below picks it up as usual.
      if (stride > 0) {
        const guess = at + stride;
        if (guess < n && xs[guess] >= x && xs[guess - 1] < x) {
          cursor = guess;
          return placeAt(guess, x);
        }
      }

      if (at > 0 && xs[at - 1] >= x) {
        // Went backward — the amount of reordering inside a decimation bucket
        // is caught by stepping back within the window. Crossing the
        // window means this isn't scanning anymore, so it's reported and
        // searched from scratch.
        for (let step = 0; at > 0 && xs[at - 1] >= x; step++) {
          if (step === SCAN_STEPS) {
            probe?.onFallback?.();
            at = searchFrom(x);
            break;
          }
          at--;
        }
      } else {
        for (let step = 0; at < n && xs[at] < x; step++) {
          if (step === SCAN_STEPS) {
            // A forward jump past the window is still scanning — the
            // stride of a monotonic advance can grow proportionally to
            // the data, so a fixed window can't catch it. Galloping
            // (exponential search) catches up in O(log distance) —
            // always as cheap as or cheaper than a full-range binary
            // search (log n), and it's not worth reporting.
            let width = SCAN_STEPS;
            let high = at + width;
            while (high < n && xs[high] < x) {
              at = high;
              width *= 2;
              high = at + width;
            }
            at = searchBetween(x, at, high < n ? high : n);
            break;
          }
          at++;
        }
      }

      stride = at - cursor;
      cursor = at;
      return placeAt(at, x);
    };
  };

  const fromDomain = (value: number): number => {
    const n = xs.length;
    if (n === 0) return value;
    if (n === 1) return xs[0] + (value - base);

    const t = value - base;
    if (t <= 0) return lerp(xs[0], xs[1], t);
    if (t >= n - 1) return lerp(xs[n - 1], xs[n - 2], -(t - (n - 1)));

    const at = Math.floor(t);
    return lerp(xs[at], xs[at + 1], t - at);
  };

  return {
    toPixel: (x) => scale.scale(toDomain(x)),
    fromPixel: (px) => fromDomain(scale.invert(px)),
    toDomain,
    fromDomain,
    scanToDomain,
    scanToPixel: () => {
      const scan = scanToDomain();
      return (x) => scale.scale(scan(x));
    },
    domainToPixel: (value) => scale.scale(value),

    /**
     * Can't spread below half a pixel per bar (bars would collapse into
     * one pixel with no information left, and for an infinite-history
     * consumer a single zoom-out would turn into a request for infinite
     * past), and can't zoom in past 200px per bar (below that there's
     * nowhere to go but a floating-point floor). This limit only applies
     * to user zoom.
     */
    barSpacingDefaults: { min: 0.5, max: 200 },

    rebuild: (sources) => {
      /**
       * The tail fast path — identity is the notification. An entry's xs
       * cache grows the same array in place when a tail is appended, so
       * "the same array as last time just grew" can be decided by
       * identity + length in O(1).
       *
       * Every path that falls out of the fast path retreats to a full
       * walk (slower, but correct): the source count changed, it's a new
       * array, it shrank, or an appended value is smaller than the
       * current maximum (global order isn't purely a tail append).
       */
      if (lastSources !== null && sources.length === lastSources.length) {
        const heads: number[] = [];
        const tails: number[] = [];
        /** The rightmost old front among head-grown sources — where the merge region ends. */
        let headBound = Number.NEGATIVE_INFINITY;
        let fastPath = true;
        for (let i = 0; i < sources.length && fastPath; i++) {
          const source = sources[i];
          const previousLength = lastLengths[i];
          if (source !== lastSources[i] || source.length < previousLength) {
            fastPath = false;
            break;
          }
          const grown = source.length - previousLength;
          if (grown === 0) {
            // Untouched by length — but the same identity with a moved
            // front means an in-place rewrite. Not this path's business.
            if (previousLength > 0 && source[0] !== lastFirsts[i]) {
              fastPath = false;
            }
            continue;
          }

          /**
           * **Which end grew is decided by the front value, and the head
           * is decided first.** A front-grown array still satisfies the
           * tail test's shape whenever the old maximum repeats into the
           * shifted region — the "new tail" then dedupes into nothing and
           * the prepended bar silently vanishes from the index. Growth
           * from empty stays on the tail side, where the origin gets
           * established. When both readings hold (a duplicate-run front),
           * this path can't tell — the full walk can.
           */
          const frontKept = previousLength === 0 || source[0] === lastFirsts[i];
          const frontShifted =
            previousLength > 0 && source[grown] === lastFirsts[i];
          if (frontKept === frontShifted) {
            fastPath = false;
            break;
          }

          if (frontShifted) {
            if (anchor === null) {
              fastPath = false;
              break;
            }
            // The seam contract upstream caps a landed head at its own
            // source's old front — anything past it is not a landing.
            if (lastFirsts[i] > headBound) headBound = lastFirsts[i];
            for (let at = 0; at < grown; at++) {
              const value = source[at];
              if (value > lastFirsts[i]) {
                fastPath = false;
                break;
              }
              heads.push(value);
            }
            continue;
          }

          for (let at = previousLength; at < source.length; at++) {
            const value = source[at];
            if (xs.length > 0 && value < xs[xs.length - 1]) {
              fastPath = false;
              break;
            }
            tails.push(value);
          }
        }

        if (fastPath) {
          if (heads.length > 0) {
            /**
             * Heads land per handle, so a later source's head can overlap
             * the front an earlier landing just widened — the merge runs
             * against the whole front region up to the rightmost old
             * front (`headBound`), never against `xs[0]` alone. Beyond
             * that region nothing can change: the seam contract upstream
             * caps every landed head at its own source's old front.
            */
            heads.sort((a, b) => a - b);
            const end = searchFrom(headBound);
            // Include the suffix boundary in the shared merge, then remove it
            // from the mutable prefix so an equal x is kept exactly once.
            const boundary = xs[end];
            const merged = mergeSortedUnique([heads, xs.slice(0, end + 1)]).filter(
              (value) => value !== boundary,
            );
            const inserted = merged.length - end;
            if (inserted !== 0 || merged.some((value, at) => xs[at] !== value)) {
              xs = merged.concat(xs.slice(end));
              /**
               * The bars already indexed keep their indices — the same
               * promise the full walk keeps through the anchor, paid here
               * as arithmetic: every existing rank moved right by the
               * inserted count, so the base moves left by it.
               */
              base -= inserted;
            }
          }
          if (tails.length > 0) {
            tails.sort((a, b) => a - b);
            for (const value of tails) {
              if (xs.length === 0 || xs[xs.length - 1] !== value) xs.push(value);
            }
          }
          /**
           * If this grew from an empty list, the origin is established
           * here.
           *
           * Taking only this path with no anchor set yet (registered, but
           * data streams in later) would let the first bar sit on screen
           * with no origin declared. Later, when a `prepend` falls back
           * to a full walk, `anchor` being null would re-index from 0,
           * losing every existing bar's index and jumping the view into
           * the past.
           */
          if (anchor === null && xs.length > 0) {
            anchor = { x: xs[0], index: base };
          }
          for (let i = 0; i < sources.length; i++) {
            lastLengths[i] = sources[i].length;
            lastFirsts[i] = firstOrNaN(sources[i]);
          }
          return;
        }
      }

      probe?.onFullRebuild?.();
      lastSources = sources.slice();
      lastLengths = sources.map((source) => source.length);
      lastFirsts = sources.map(firstOrNaN);
      // Each registration is already sorted — this relies on
      // that fact.
      xs = mergeSortedUnique(sources);

      if (xs.length === 0) {
        // All the data is gone. Drop the origin with it — the next data
        // is a new world.
        base = 0;
        anchor = null;
        return;
      }

      if (anchor) {
        const at = searchFrom(anchor.x);
        if (at < xs.length && xs[at] === anchor.x) {
          // The origin bar is still alive. Keeping its index means
          // existing bars' indices don't change no matter how many bars
          // `prepend` attached at the front.
          base = anchor.index - at;
          return;
        }
        // The origin bar is gone — the whole dataset was swapped out.
        // `setData` refits anyway, so re-establishing the
        // origin here won't make the view jump.
      }

      base = 0;
      anchor = { x: xs[0], index: 0 };
    },
  };
}
