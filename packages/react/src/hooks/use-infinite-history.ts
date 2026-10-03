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
import type { Dispatch, SetStateAction } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface HistoryOptions<T extends BaseDataPoint> {
  /** The accessor the series reading `data` uses — `OHLC_COORDINATES` for candles. Judges pages by its rules and reads the first x through it. */
  coordinates?: CoordinateAccessor<T>;
  /** Prefetch when less than this many screens of past is held. Default 1. */
  screensAhead?: number;
}

/** History paged by time: the fetch is asked for the page strictly before an x. */
export interface UseInfiniteHistoryOptions<T extends BaseDataPoint> extends HistoryOptions<T> {
  /** Read when it's called, so an inline function is fine. */
  fetch: HistoryFetch<T>;
}

/** History paged by a token: the fetch is asked with the `next` of the page before. */
export interface UseCursorHistoryOptions<T extends BaseDataPoint, C> extends HistoryOptions<T> {
  /** Read when it's called, so an inline function is fine. */
  fetchPage: HistoryCursorFetch<T, C>;
}

export interface InfiniteHistoryState<T extends BaseDataPoint> {
  /** What is held — the last load, the pages landed before it, and your own edits. Pass it as the series' `data`. */
  readonly data: T[];
  /** The loader's state as React state; `null` while nothing is loading on a chart (no load yet, or no `<InfiniteHistory>` mounted). */
  readonly status: HistoryStatus | null;
  /** Edit what is held — a live bar, a snapshot merge. Pages keep landing on top of it. */
  readonly setData: Dispatch<SetStateAction<T[]>>;
}

export interface XHistory<T extends BaseDataPoint> extends InfiniteHistoryState<T> {
  /** A new load — a symbol or an interval: holds `bars`, and a page still on its way for the last load is dropped. */
  reset(bars: T[]): void;
}

export interface CursorHistory<T extends BaseDataPoint, C> extends InfiniteHistoryState<T> {
  /** A new load: holds `bars`, pages from `next` (`null`: there is nothing older), and drops a page still on its way for the last load. */
  reset(bars: T[], next: C | null): void;
}

/** What `<InfiniteHistory>` reaches through — not part of the returned state's type. */
export interface HistoryLink {
  /** Moves on every `reset`; a new one installs a new loader. */
  readonly epoch: number;
  /** Starts a loader on this chart where the history stands; returns its teardown. */
  install(plot: Plot): () => void;
}

const links = new WeakMap<object, HistoryLink>();

/** The link behind a value `useInfiniteHistory` returned. */
export function historyLink(history: object): HistoryLink {
  const link = links.get(history);
  if (!link) throw new ContractError('<InfiniteHistory history> takes the value useInfiniteHistory returned');
  return link;
}

const nothing = (): void => undefined;

/**
 * Infinite history whose place outlives the chart — the data, the paging
 * token and the end are held here, in the component that owns the data,
 * and `<InfiniteHistory history>` inside the chart pages from there. A
 * chart remounted under a `key` (a renko view, an error boundary's retry)
 * resumes from the first bar held and the token last taken instead of
 * asking for the first page again; a page landing for a load that `reset`
 * replaced is dropped.
 *
 * ```tsx
 * const history = useInfiniteHistory<OHLC, string>({
 *   fetchPage: (cursor) => api.candles(symbol, cursor),
 *   coordinates: OHLC_COORDINATES,
 * });
 * useEffect(() => {
 *   api.candles(symbol).then((page) => history.reset(page.bars, page.next));
 * }, [symbol]);
 *
 * <ChartContainer>
 *   <ChartCandles data={history.data} />
 *   <InfiniteHistory history={history} />
 * </ChartContainer>
 * ```
 *
 * A history keeps the mode it started with — `fetch` (by time) or
 * `fetchPage` (by token).
 */
export function useInfiniteHistory<T extends BaseDataPoint>(options: UseInfiniteHistoryOptions<T>): XHistory<T>;
export function useInfiniteHistory<T extends BaseDataPoint, C extends NonNullable<unknown>>(
  options: UseCursorHistoryOptions<T, C>,
): CursorHistory<T, C>;
export function useInfiniteHistory<T extends BaseDataPoint, C extends NonNullable<unknown>>(
  options: UseInfiniteHistoryOptions<T> | UseCursorHistoryOptions<T, C>,
): InfiniteHistoryState<T> & { reset(bars: T[], next?: C | null): void } {
  const [data, setData] = useState<T[]>([]);
  const [status, setStatus] = useState<HistoryStatus | null>(null);

  const latest = useRef(options);
  latest.current = options;
  // What the chart was handed at the last commit — a loader starts from its first x.
  const held = useRef(data);
  useLayoutEffect(() => {
    held.current = data;
  }, [data]);

  const link = useMemo(() => {
    let epoch = 0;
    let cursor: C | null | undefined;
    /** `done` or `terminated` — a remount doesn't start over what has ended. */
    let ended: HistoryStatus | null = null;

    const fetchBefore = (before: number) => {
      const current = latest.current;
      if ('fetch' in current) return current.fetch(before);
      throw new ContractError('useInfiniteHistory started with fetch — a history keeps its mode');
    };
    const fetchPage = (token: C) => {
      const current = latest.current;
      if ('fetchPage' in current) return current.fetchPage(token);
      throw new ContractError('useInfiniteHistory started with fetchPage — a history keeps its mode');
    };

    return {
      get epoch() {
        return epoch;
      },
      install(plot: Plot): () => void {
        const seed = held.current;
        if (seed.length === 0 || ended !== null) return nothing;
        const { coordinates, screensAhead } = latest.current;
        const from = coordinates ? coordinates.getX(seed[0]) : seed[0].x;
        const mine = epoch;
        // A reset disposes this loader when its render commits; a page
        // landing before that commit — a reset rendered in a transition —
        // is dropped here.
        const sink = (page: T[]) => {
          if (mine === epoch) setData((previous) => [...page, ...previous]);
        };

        let loader: HistoryLoader;
        let place: (() => C | null) | null = null;
        if ('fetchPage' in latest.current) {
          if (cursor === undefined || cursor === null) return nothing;
          const paged = infiniteHistory(plot, sink, fetchPage, { from, cursor, coordinates, screensAhead });
          place = () => paged.cursor();
          loader = paged;
        } else {
          loader = infiniteHistory(plot, sink, fetchBefore, { from, coordinates, screensAhead });
        }

        setStatus(loader.status());
        const off = loader.statusChanges.subscribe((next) => {
          if (mine === epoch) setStatus(next);
        });

        return () => {
          off();
          // A reset since then owns the place — this loader's is stale.
          if (mine === epoch) {
            if (place) cursor = place();
            const last = loader.status();
            if (last === 'done' || last === 'terminated') ended = last;
          }
          loader.dispose();
        };
      },
      reset(bars: T[], next?: C | null): void {
        epoch += 1;
        cursor = next;
        ended = next === null ? 'done' : null;
        setStatus(ended);
        setData(bars);
      },
    };
  }, []);

  return useMemo(() => {
    const history = { data, status, setData, reset: link.reset };
    links.set(history, link);
    return history;
  }, [data, status, link]);
}
