import { DataError, type BaseDataPoint, type Pane, type SeriesSpec } from '@finchart/core';

/**
 * Collects the list of series one pane will draw, in JSX order. One per
 * pane.
 *
 * `syncSeries` treats array order as draw order, but effects run in mount
 * order, so a series switched on late by a condition always lands at the
 * end. Only the render phase knows the JSX order, so the slot gets
 * decided by a render-local placement pass and applying it to the chart is
 * deferred to after commit (`flush`).
 *
 * The key is holding the slot as a **rank**, not an array position — an
 * array position loses its way back when something mounts and unmounts
 * without a render in between (StrictMode, `Activity`).
 *
 * The id comes from `<ChartSeries>`, freshly made per instance (`useId`)
 * — deciding identity is React reconciliation's job, not this
 * collector's.
 */
export interface SeriesCollector<T extends BaseDataPoint> {
  /**
   * Commit phase. Only confirms membership in the list. The rank is
   * whatever render already assigned, so it lands back in its place.
   *
   * StrictMode attaches, detaches, and reattaches an effect, so something
   * that left through cleanup has to come back without a render.
   */
  keep(spec: SeriesSpec<T>, rank: readonly number[]): void;

  /**
   * Layout phase. Records the slot a committed render assigned. Every layout
   * effect of a commit runs before its first `flush`, so no flush sorts a
   * series against a sibling's rank from the previous pass.
   */
  rank(id: string, rank: readonly number[]): void;

  /** Unmount. A replayed effect carries its captured rank when it reattaches. */
  remove(id: string): void;

  /** After commit. Hands the current list to the pane. Safe to call more than once. */
  flush(): void;
}

export function createSeriesCollector<T extends BaseDataPoint>(
  pane: Pane,
  /**
   * Who hears about data the chart refused (`DataError`), read at the
   * moment of the refusal — `undefined` throws it instead, to the nearest
   * error boundary. The core checks a whole sync before applying any of it,
   * so a refusal leaves the previous data on the chart either way.
   */
  refused: () => ((error: DataError) => void) | undefined = () => undefined,
): SeriesCollector<T> {
  /** What's mounted on the chart. Only a committed effect admits a spec. */
  const specs = new Map<string, SeriesSpec<T>>();
  /** The last list the chart refused as data — not tried again until a spec changes. */
  let refusedList: readonly SeriesSpec<T>[] | null = null;
  /** Which position it was in JSX. The only basis for deciding a slot. */
  const ranks = new Map<string, readonly number[]>();
  /** The order last applied to the chart. The tiebreaker when ranks are equal. */
  let order: string[] = [];

  /** Whether anything has ever been applied to the chart → see `flush` below. */
  let owned = false;

  return {
    keep(spec, rank) {
      ranks.set(spec.id, rank);
      specs.set(spec.id, spec);
    },

    rank(id, rank) {
      ranks.set(id, rank);
    },

    remove(id) {
      specs.delete(id);
      ranks.delete(id);
    },

    flush() {
      // Rebuilds using only the rank. Since `sort` is stable, ties keep
      // the previous order.
      const live = order.filter((id) => specs.has(id));
      // Checked against a `Set` instead of `includes` — with `specs` growing, that would be a linear scan every time.
      const known = new Set(live);
      for (const id of specs.keys()) {
        if (!known.has(id)) live.push(id);
      }
      // Every admitted spec carries a rank — `keep` takes one.
      live.sort((a, b) => compareRank(ranks.get(a) ?? [], ranks.get(b) ?? []));
      order = live;

      const list: SeriesSpec<T>[] = [];
      for (const id of order) {
        const spec = specs.get(id);
        if (spec) list.push(spec);
      }

      // Doesn't clear the pane just because the list starts out empty.
      // `syncSeries` owns the whole list, so a `<ChartContainer>` with no
      // series mounted at all must not swallow whatever was mounted
      // imperatively (`plotRef` → `addSeries`).
      if (list.length === 0 && !owned) return;

      owned = true;
      // One commit flushes more than once (the series' effect, then the
      // pane's or container's). A list already refused, spec for spec, is
      // not tried — or reported — again; the next render builds new specs.
      if (refusedList !== null && sameSpecs(refusedList, list)) return;
      try {
        pane.syncSeries(list);
        refusedList = null;
      } catch (error) {
        const report = refused();
        // Only refused data — a `ContractError` is a mistake in the code
        // and still goes to the boundary.
        if (!(error instanceof DataError) || report === undefined) throw error;
        refusedList = list;
        report(error);
      }
    },
  };
}

/** JSX paths order a pane subtree between the siblings on either side. */
export function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** A render owns its cursor. An abandoned render cannot change another pass. */
export interface SeriesPlacement {
  place(id: string): readonly number[] | undefined;
  commit(): void;
  /**
   * A child rendered on its own after this pass committed — its component's
   * state switched it on — so `place` had no slot for it. Only the owner
   * walking its JSX again knows where it sits, so this asks for that pass.
   */
  missed(): void;
}

export function createSeriesPlacement(
  prefix: readonly number[],
  /** Renders the owner again. Its fresh placement reaches every child through context, in JSX order. */
  rerender: () => void,
): SeriesPlacement {
  const positions = new Map<string, readonly number[]>();
  let committed = false;
  return {
    place(id) {
      const known = positions.get(id);
      if (known || committed) return known;
      const rank = [...prefix, positions.size];
      positions.set(id, rank);
      return rank;
    },
    commit() { committed = true; },
    missed: rerender,
  };
}

/** The same specs, by identity, in the same order. */
function sameSpecs<T extends BaseDataPoint>(a: readonly SeriesSpec<T>[], b: readonly SeriesSpec<T>[]): boolean {
  return a.length === b.length && a.every((spec, at) => spec === b[at]);
}
