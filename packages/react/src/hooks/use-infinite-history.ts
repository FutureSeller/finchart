import type {
  BaseDataPoint,
  CoordinateAccessor,
  HistoryCursorFetch,
  HistoryFetch,
  HistoryLoader,
  HistoryStatus,
  Plot,
} from '@finchart/core';
import { ContractError, infiniteHistory } from '@finchart/core';
import type { SetStateAction } from 'react';
import { useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface UseInfiniteHistoryOptions<T extends BaseDataPoint> {
  /** The accessor the series reading `data` uses — `OHLC_COORDINATES` for candles. Judges pages by its rules and reads the first x through it. */
  coordinates?: CoordinateAccessor<T>;
  /** Prefetch when less than this many screens of past is held. Default 1. */
  screensAhead?: number;
}

/**
 * How a load pages back — handed to `reset` with the load's own bars, so the
 * fetch is the one that knows this load (its symbol, its interval) and no
 * other. By time: the fetch is asked for the page strictly before an x. By
 * token: it is asked with `next`, then with each page's own `next`; a `next`
 * of `null` says there is nothing older.
 */
export type HistoryPaging<T extends BaseDataPoint, C> =
  | { readonly fetch: HistoryFetch<T> }
  | { readonly next: C | null; readonly fetchPage: HistoryCursorFetch<T, C> };

/**
 * A load, as `reset` hands it back and `history.load` reads the one on
 * screen — what an edit names to say which bars it's for.
 */
export class HistoryLoad {
  // Nominal through a private member — only `reset` makes one.
  private declare readonly brand: never;
}

/** What `<InfiniteHistory>` reaches through — one per load, so a new one installs a new loader. */
export interface HistoryLink {
  /** Starts a loader on this chart where the load stands; returns its teardown. */
  install(plot: Plot): () => void;
}

export interface InfiniteHistoryState<T extends BaseDataPoint, C = never> {
  /** What is held — the last load, the pages landed before it, and your own edits. Pass it as the series' `data`. */
  readonly data: T[];
  /**
   * The loader's state as React state: `null` while nothing pages (no load,
   * a load without paging, no `<InfiniteHistory>` mounted), `done` or
   * `terminated` once the load's history has ended — mounted or not.
   */
  readonly status: HistoryStatus | null;
  /**
   * Edit what is held — a live bar, a snapshot merge. Pages keep landing on
   * top of it. An edit is for one load's bars and is dropped if React
   * applies it once another load holds them: `load` names it (what `reset`
   * returned — a feed's first tick before the reset commits), and without
   * it the edit is for the load on screen when it's made — so a tick for a
   * symbol being left never lands on the next one's bars.
   */
  readonly setData: (action: SetStateAction<T[]>, load?: HistoryLoad) => void;
  /** The load on screen — what `reset` returned for it; `null` before the first. */
  readonly load: HistoryLoad | null;
  /**
   * A new load — a symbol, an interval: holds `bars` and pages back with
   * `paging` (`null`: nothing to page). A page still on its way for the
   * load before is dropped. What it's handed is the caller's to vouch for:
   * a first page that answers for a symbol already left must not reach it.
   */
  reset(bars: T[], paging: HistoryPaging<T, C> | null): HistoryLoad;
  /** What `<InfiniteHistory>` pages through — wiring, not for calling. A copy of the value carries it along. */
  readonly link: HistoryLink;
}

const nothing = (): void => undefined;

/** One load — its paging, and where it stands. Written by its own loaders only. */
interface Load<T extends BaseDataPoint, C> {
  /** What the caller holds for it. */
  readonly handle: HistoryLoad;
  readonly paging: HistoryPaging<T, C> | null;
  /** The token the next page is asked with; `null` when there is none. */
  cursor: C | null;
  /** `done` or `terminated` — a remount doesn't start over what has ended. */
  ended: HistoryStatus | null;
  /** A loader is paging this load — one cursor has one loader. */
  active: boolean;
}

const NO_LINK: HistoryLink = { install: () => nothing };

/**
 * Infinite history whose place outlives the chart — the data, the load's
 * paging and its token and end are held here, in the component that owns
 * the data, and `<InfiniteHistory history>` inside the chart pages from
 * there. A chart remounted under a `key` (a renko view, an error
 * boundary's retry) resumes from the first bar held and the token last
 * taken instead of asking for the first page again; a page landing for a
 * load `reset` replaced is dropped.
 *
 * ```tsx
 * const history = useInfiniteHistory<OHLC, string>({ coordinates: OHLC_COORDINATES });
 * useEffect(() => {
 *   let current = true;
 *   api.candles(symbol).then((page) => {
 *     if (current) history.reset(page.bars, { next: page.next, fetchPage: (cursor) => api.candles(symbol, cursor) });
 *   });
 *   return () => {
 *     current = false;
 *   };
 * }, [symbol]);
 *
 * <ChartContainer>
 *   <ChartCandles data={history.data} />
 *   <InfiniteHistory history={history} />
 * </ChartContainer>
 * ```
 */
export function useInfiniteHistory<T extends BaseDataPoint, C extends NonNullable<unknown> = never>(
  options: UseInfiniteHistoryOptions<T> = {},
): InfiniteHistoryState<T, C> {
  // The bars and the load they belong to are one state: a reset commits both
  // at once, so nothing ever pairs a load with another load's bars — not an
  // urgent render while the reset waits in a transition.
  const [held, setHeld] = useState<{ data: T[]; load: Load<T, C> | null }>({ data: [], load: null });
  // A status is the load's that reported it; another load's — a loader made
  // stale by a reset, even one its own fetch called — never shows.
  const [reported, setReported] = useState<{ load: Load<T, C> | null; status: HistoryStatus | null }>({
    load: null,
    status: null,
  });

  // Published at commit — a render React throws away must not reach a loader.
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  // The bars as committed, and their load — a loader starts from their first
  // x, and an edit belongs to the load on screen when it's made. Published in
  // the mutation phase, before any component's layout effect: a child that
  // edits from its own layout effect in the commit that brought a load is
  // editing that load.
  const committed = useRef(held);
  useInsertionEffect(() => {
    committed.current = held;
  }, [held]);

  const { load } = held;

  const link = useMemo<HistoryLink>(() => {
    if (load === null) return NO_LINK;
    return {
      install(plot: Plot): () => void {
        const report = (status: HistoryStatus | null) => setReported({ load, status });
        if (load.ended !== null) {
          report(load.ended);
          return nothing;
        }
        if (load.active) {
          throw new ContractError(
            'one <InfiniteHistory> per history at a time — two charts paging one load would ask for the same page twice and prepend it twice',
          );
        }
        const { paging } = load;
        const seed = committed.current.data;
        if (paging === null || seed.length === 0) return nothing;
        const { coordinates, screensAhead } = latest.current;
        const from = coordinates ? coordinates.getX(seed[0]) : seed[0].x;
        // A page lands only on its own load's bars — checked when React runs
        // the update, so one queued before a reset can't ride on top of it.
        const sink = (page: T[]) =>
          setHeld((previous) => (previous.load === load ? { data: [...page, ...previous.data], load } : previous));

        let loader: HistoryLoader;
        let place: (() => C | null) | null = null;
        if ('fetchPage' in paging) {
          if (load.cursor === null) return nothing;
          const paged = infiniteHistory(plot, sink, paging.fetchPage, { from, cursor: load.cursor, coordinates, screensAhead });
          place = () => paged.cursor();
          loader = paged;
        } else {
          loader = infiniteHistory(plot, sink, paging.fetch, { from, coordinates, screensAhead });
        }

        load.active = true;
        report(loader.status());
        const off = loader.statusChanges.subscribe(report);

        return () => {
          load.active = false;
          off();
          if (place) load.cursor = place();
          const last = loader.status();
          if (last === 'done' || last === 'terminated') load.ended = last;
          // An end stays readable; otherwise nothing pages until a remount.
          report(load.ended);
          loader.dispose();
        };
      },
    };
  }, [load]);

  const reset = useMemo(
    () =>
      (bars: T[], paging: HistoryPaging<T, C> | null): HistoryLoad => {
        const cursor = paging !== null && 'fetchPage' in paging ? paging.next : null;
        const ended = paging !== null && 'fetchPage' in paging && paging.next === null ? 'done' : null;
        const handle = new HistoryLoad();
        setHeld({ data: bars, load: { handle, paging, cursor, ended, active: false } });
        return handle;
      },
    [],
  );

  // An edit is for one load's bars — named, or the one on screen when it's
  // made. React replays an edit made while a reset waits in a transition
  // after that reset; checked when it's applied, it can't land on the wrong bars.
  const setData = useMemo(
    () =>
      (action: SetStateAction<T[]>, load?: HistoryLoad): void => {
        const owner = load ?? committed.current.load?.handle ?? null;
        setHeld((previous) =>
          (previous.load?.handle ?? null) === owner
            ? { data: typeof action === 'function' ? action(previous.data) : action, load: previous.load }
            : previous,
        );
      },
    [],
  );

  const status = reported.load !== null && reported.load === load ? reported.status : (load?.ended ?? null);

  const handle = load?.handle ?? null;
  return useMemo(
    () => ({ data: held.data, status, setData, reset, link, load: handle }),
    [held.data, status, setData, reset, link, handle],
  );
}
