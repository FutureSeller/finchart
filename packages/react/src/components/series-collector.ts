import type { BaseDataPoint, Pane, SeriesSpec } from '@finchart/core';

/**
 * Collects the list of series one pane will draw, in JSX order. One per
 * pane.
 *
 * `syncSeries` treats array order as draw order, but effects run in mount
 * order, so a series switched on late by a condition always lands at the
 * end. Only the render phase knows the JSX order, so the slot gets
 * decided during render (`place`) and applying it to the chart is
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
  /** Render phase. Signals that the pane is starting to rebuild its children. */
  begin(): void;

  /**
   * Render phase. Gets a rank for this pass.
   *
   * If the pane didn't render (a series that re-rendered on its own), the
   * rank stays put and only the content is swapped — otherwise it would
   * jump to the front on its own.
   */
  place(spec: SeriesSpec<T>): void;

  /**
   * Commit phase. Only confirms membership in the list. The rank is
   * whatever render already assigned, so it lands back in its place.
   *
   * StrictMode attaches, detaches, and reattaches an effect, so something
   * that left through cleanup has to come back without a render.
   */
  keep(spec: SeriesSpec<T>): void;

  /** Unmount. Doesn't clear the rank right away — it might come back without a render. If it never does, the next `begin()` cleans it up. */
  remove(id: string): void;

  /** After commit. Hands the current list to the pane. Safe to call more than once. */
  flush(): void;
}

export function createSeriesCollector<T extends BaseDataPoint>(
  pane: Pane,
): SeriesCollector<T> {
  /** What's mounted on the chart. **Only what an effect has admitted lives here** → see `place`. */
  const specs = new Map<string, SeriesSpec<T>>();
  /** Which position it was in JSX. The only basis for deciding a slot. */
  const ranks = new Map<string, number>();
  /** The order last applied to the chart. The tiebreaker when ranks are equal. */
  let order: string[] = [];

  /** Whether we're in the render phase. */
  let placing = false;
  /** The rank handed out during this render. */
  let next = 0;
  /** Whether anything has ever been applied to the chart → see `flush` below. */
  let owned = false;
  /** The largest rank assigned in `ranks` so far. `rankOf` uses it to pick the next slot. */
  let maxRank = -1;

  const setRank = (id: string, value: number): void => {
    ranks.set(id, value);
    if (value > maxRank) maxRank = value;
  };

  /** Sends anything render didn't assign a slot to, to the back. */
  const rankOf = (id: string): number => {
    const known = ranks.get(id);
    if (known !== undefined) return known;

    const assigned = maxRank + 1;
    setRank(id, assigned);
    return assigned;
  };

  return {
    begin() {
      // If something above (`<ChartContainer>`) already opened it, carry that rank forward.
      if (placing) return;

      /**
       * Cleans up whatever dropped out in the last cycle and hasn't come
       * back.
       *
       * `remove` doesn't clear the rank — because a StrictMode
       * double-mount that reattaches without a render needs to find its
       * own slot again. That return (`keep`) always finishes before the
       * next `begin()`, so if it's not in `specs` here, it really hasn't
       * come back. Leave it uncleared and, on a screen where the series
       * keep changing — a watchlist, say — `ranks` would keep growing for
       * the whole session.
       */
      for (const id of ranks.keys()) {
        if (!specs.has(id)) ranks.delete(id);
      }

      placing = true;
      next = 0;
    },

    /**
     * Only decides the slot. **Admitting it into the list is the
     * effect's job.**
     *
     * **Rendering doesn't guarantee a commit.** A child inside `<Activity
     * mode="hidden">` renders but its effect doesn't run — admitting it
     * into the list during the render phase would put a series that was
     * never mounted onto the chart. Effects only run on the path that
     * survives, so that's used as the witness of identity.
     *
     * Something already alive only gets its content updated — a
     * re-render where only the style changed is that case.
     */
    place(spec) {
      if (specs.has(spec.id)) specs.set(spec.id, spec);
      if (placing) setRank(spec.id, next++);
    },

    keep(spec) {
      specs.set(spec.id, spec);
      rankOf(spec.id);
    },

    remove(id) {
      specs.delete(id);
      // The rank isn't cleared here — the next `begin()` filters out only what never came back.
    },

    flush() {
      placing = false;

      // Rebuilds using only the rank, while keeping the previous order.
      // Since `sort` is stable, entries with the same rank (ones that
      // didn't take part in this render) keep their place.
      const live = order.filter((id) => specs.has(id));
      // Checked against a `Set` instead of `includes` — with `specs` growing, that would be a linear scan every time.
      const known = new Set(live);
      for (const id of specs.keys()) {
        if (!known.has(id)) live.push(id);
      }
      live.sort((a, b) => rankOf(a) - rankOf(b));
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
      pane.syncSeries(list);
    },
  };
}
