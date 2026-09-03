import type { BaseDataPoint, CoordinateAccessor } from "../data";
import { defaultCoordinates, scanSeriesData } from "../data";
import { ContractError, DataError } from "../primitives";
import type { PlotEventSource, XCoordinates } from "../plot/capabilities";
import { emitter, type Observable } from "../primitives";
import type { Plot } from "../plot/plot";

/**
 * What the loader needs from the stage — three already-published pieces,
 * so a `Plot` fits as-is: events to hear the view move, pixel conversion
 * to judge "how close to the edge" in a unit that survives both coordinate
 * systems, and one state read so installation doesn't have to wait for a
 * first event.
 */
export type InfiniteHistoryHost = PlotEventSource &
  XCoordinates &
  Pick<Plot, "getState">;

/**
 * Where a landed page goes. A plain function on purpose — a handle
 * consumer passes `(page) => handle.prepend(page)`, a chart with a price
 * and a volume registration fans one page out to both, and a React
 * consumer writes `(page) => setState((prev) => [...page, ...prev])`.
 * There is no liveness flag to implement; the only end of delivery is
 * `dispose()`.
 */
export type HistorySink<T extends BaseDataPoint> = (page: T[]) => void;

/**
 * Produces the page of points strictly before `before`, ascending in x.
 * An empty array means the end of history. Page size is the fetch's own
 * business — the loader only ever says where to start. Against a capped
 * API (Toss and Upbit take `count` up to 200, Binance `limit` up to
 * 1000), just request the cap: one bigger page beats several small ones
 * on every axis — round trips while the screen shows a gap, request
 * quota, and landings (each landing recomputes every derivation).
 */
export type HistoryFetch<T extends BaseDataPoint> = (
  before: number,
) => Promise<T[]> | T[];

/**
 * - `idle` — nothing in flight; gestures can trigger a fetch
 * - `loading` — a page is in flight
 * - `done` — the fetch returned an empty page: history is exhausted
 * - `terminated` — the fetch's shape is permanently wrong (out-of-order
 *   pages); retrying would throw forever, so the loader stopped
 */
export type HistoryStatus = "idle" | "loading" | "done" | "terminated";

export interface InfiniteHistoryOptions<T extends BaseDataPoint = BaseDataPoint> {
  /**
   * The accessor the sink's series uses, so a landed page is judged by the
   * same rule the sink will apply — notably `uniqueX` (a bar per moment).
   * Omitted, the loader checks order only, as line data allows. A page
   * that fails here is a **fetch shape** defect (the loader terminates);
   * without this, the same page would fail inside the sink and read as a
   * delivery failure that retries on every gesture.
   */
  coordinates?: CoordinateAccessor<T>;
  /**
   * The cursor origin: the first x the consumer already holds. Required
   * because every value the loader could guess is wrong for some
   * registration — the plot's data range is a union across all series
   * (a neighbor starting earlier would leave a permanent hole), and a
   * handle's own range is the *drawn* side, which a derivation shortens
   * by its warm-up. The consumer never invents this value: it just
   * received its own first page.
   */
  from: number;
  /**
   * Prefetch when the loaded past to the left of the view is thinner than
   * this many screen widths. Default 1 — the repo's two hand-rolled
   * loaders used 0.3–0.5 against synchronous generators, and with a
   * network round-trip in the way one full screen of runway is what keeps
   * blank space from flashing in during a scroll. Lower it to trade that
   * for fewer requests.
   */
  screensAhead?: number;
}

export interface HistoryLoader {
  /** Current state — a snapshot safe to read at any time. */
  status(): HistoryStatus;
  /** Notifies on every state change. The pair a status bar or `useSyncExternalStore` needs. */
  statusChanges: Observable<HistoryStatus>;
  /** Stops listening; a response landing afterwards is dropped. Safe to call twice. */
  dispose(): void;
}

/** Surfaces an error out-of-band without wedging the loader's own flow. */
const rethrow = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};

/**
 * Loads older data as the view approaches or passes the left edge of what
 * is held — the bookkeeping every infinite-scroll consumer was writing by
 * hand: the cursor, the threshold test, in-flight dedup, and the
 * re-judgment after a landing (a `prepend` doesn't move the domain, so no
 * event ever announces it).
 *
 * The threshold is measured in **pixels**, which makes it coordinate-
 * system-proof: under bar-index x it equals a bar-count test (immune to
 * weekend and session gaps), under continuous x it equals a screen-width
 * test. The cursor is always a real point's x, so the conversion is an
 * interpolation — never the left-of-data extrapolation whose slope shifts
 * when a page lands.
 *
 * Two triggers, deliberately different:
 *
 * - **Gap fill** — the screen shows a stretch with no data (slack < 0).
 *   Fires regardless of gesture and chains page after page until the
 *   screen is covered. At the left wall, pan is clamped and emits no
 *   events at all, so this landing-driven loop is the only way out —
 *   which is why there is no page-count cap: capped, the chart would
 *   stall on a blank screen forever. The screen itself bounds the chain
 *   (zoom limits bound the screen), and an empty page always ends it.
 * - **Prefetch** — runway is short (slack under `screensAhead` screens)
 *   and the user actually moved left. One page per gesture. A `setData`
 *   refit or a fit-all reports zero slack without a leftward move and
 *   must not fire — the user wasn't going to the past.
 *
 * A landed page is the cursor owner's to defend (the sorted-data rulebook
 * itself stays where it lives, in the data layer):
 *
 * - Points at or after `before` are trimmed off quietly — inclusive end
 *   bounds are the norm for exchange REST APIs, and every consumer would
 *   otherwise rediscover the same one-line filter. Left alone, the
 *   boundary bar would slip through prepend's seam check (equal x is legal
 *   for line data; bars declare `uniqueX` and reject it loudly) and silently double.
 * - A non-empty page trimmed to nothing throws, carrying `before` and the
 *   page's last x: a fetch that ignores its cursor must not read as "the
 *   end of history".
 * - An out-of-order page throws and **terminates** the loader: the fetch's
 *   shape is wrong, so a retry is an exception fountain, not a recovery.
 *   (`[...page].reverse()` belongs inside the fetch, like backoff.)
 *
 * A rejected fetch is transient by contrast: loading recovers and the
 * next gesture retries naturally.
 *
 * **Landing cost** — a landing pays for the points held, not the page:
 * a prepend copies the whole array and rebuilds the x index, and a
 * derivation's contract is "the whole input", so each landing recomputes
 * every derivation wholesale. Measured at 100k candles, +500 bars per
 * landing: 1.4ms bare, 37.7ms with four SMA derivations (≈9ms per
 * derivation) — past a 60Hz frame budget on its own. Landings equal
 * pages, so a derivation-heavy chart wants larger, rarer pages.
 *
 * **Changing worlds under the loader is undefined.** Swapping symbols by
 * calling `setData` on the same handle cannot be detected here — dispose
 * first, then wrap again with the new `from`:
 *
 * ```ts
 * const loader = infiniteHistory(plot, (page) => handle.prepend(page),
 *   (before) => api.candlesBefore(before), { from: candles[0].x });
 * // later: loader.dispose() — or scope.add(() => loader.dispose())
 * ```
 */
export function infiniteHistory<T extends BaseDataPoint>(
  host: InfiniteHistoryHost,
  sink: HistorySink<T>,
  fetch: HistoryFetch<T>,
  options: InfiniteHistoryOptions<T>,
): HistoryLoader {
  if (!Number.isFinite(options.from)) {
    throw new ContractError(
      `infiniteHistory: options.from must be a finite data x, got ${options.from}`,
    );
  }
  const coordinates = options.coordinates ?? defaultCoordinates<T>();
  const screensAhead = options.screensAhead ?? 1;
  if (!(Number.isFinite(screensAhead) && screensAhead > 0)) {
    throw new ContractError(
      `infiniteHistory: options.screensAhead must be a positive number, got ${screensAhead}`,
    );
  }

  let frontier = options.from;
  let status: HistoryStatus = "idle";
  let disposed = false;
  let lastStartX: number | null = null;
  let lastView: { startX: number; endX: number } | null = null;

  const changes = emitter<HistoryStatus>();
  const set = (next: HistoryStatus): void => {
    if (status === next) return;
    status = next;
    changes.emit(next);
  };

  const judge = (userWentLeft: boolean): void => {
    // done and terminated are final; loading re-judges when it lands.
    if (disposed || status !== "idle") return;
    const view = lastView;
    if (!view) return;

    const left = host.pixelAtX(view.startX);
    const width = host.pixelAtX(view.endX) - left;
    // A zero or degenerate width means layout hasn't happened — no judgment.
    if (!(width > 0)) return;

    const slack = left - host.pixelAtX(frontier);
    if (slack < 0) {
      pull();
      return;
    }
    if (userWentLeft && slack < screensAhead * width) pull();
  };

  const land = (before: number, page: T[]): void => {
    if (disposed) return;

    // The page's own shape is judged by the same walker every data door
    // runs (one rule set — a hand-written `<` loop here used to let a
    // repeated x through to the sink, where it read as a retryable
    // delivery failure instead of the fetch defect it is).
    try {
      scanSeriesData(page, coordinates, null);
    } catch (error) {
      set("terminated");
      rethrow(
        new DataError(
          `infiniteHistory: the page for before=${before} is not valid series data — ` +
            `${error instanceof Error ? error.message : String(error)}. Fix it inside the fetch`,
        ),
      );
      return;
    }

    if (page.length === 0) {
      set("done");
      return;
    }

    const trimmed = page.filter((point) => point.x < before);
    if (trimmed.length === 0) {
      set("idle");
      rethrow(
        new DataError(
          `infiniteHistory: the fetch ignored its cursor — asked for points before ` +
            `${before} but every point sits at or after it (last x ${page[page.length - 1].x})`,
        ),
      );
      return;
    }

    try {
      sink(trimmed);
    } catch (error) {
      // The cursor stays put — delivery failed, so the next gesture retries the page.
      set("idle");
      rethrow(error);
      return;
    }

    frontier = trimmed[0].x;
    set("idle");
    // A prepend never moves the domain, so no event follows a landing —
    // the loader re-judges here or the gap would never finish filling.
    judge(false);
  };

  const pull = (): void => {
    set("loading");
    const before = frontier;

    let result: Promise<T[]> | T[];
    try {
      result = fetch(before);
    } catch (error) {
      set("idle");
      rethrow(error);
      return;
    }

    Promise.resolve(result).then(
      (page) => land(before, page),
      (error) => {
        if (disposed) return;
        set("idle");
        rethrow(error);
      },
    );
  };

  const off = host.on("xDomainChange", ({ startX, endX }) => {
    const userWentLeft = lastStartX !== null && startX < lastStartX;
    lastStartX = startX;
    lastView = { startX, endX };
    judge(userWentLeft);
  });

  // A restored view can already sit past the data before any event fires.
  const domain = host.getState().xDomain;
  if (domain) {
    lastStartX = domain.min;
    lastView = { startX: domain.min, endX: domain.max };
    judge(false);
  }

  return {
    status: () => status,
    statusChanges: changes,
    dispose() {
      if (disposed) return;
      disposed = true;
      off();
    },
  };
}
