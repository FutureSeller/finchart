import type { BaseDataPoint, CoordinateAccessor } from "../data";
import { scanSeriesData } from "../data";
import { ContractError, DataError } from "../primitives";
import type { PlotEventSource, XCoordinates } from "../plot/capabilities";
import { emitter, type Observable } from "../primitives";
import type { Plot } from "../plot/plot";
import type { SeriesHandle } from "../plot/series-handle";

/**
 * What the loader needs from the stage — already-published pieces, so a
 * `Plot` fits as-is: events to hear the view move, pixel conversion to
 * judge "how close to the edge" in a unit that survives both coordinate
 * systems, one state read so installation doesn't have to wait for a
 * first event, and the half bar a fit leaves before the first point.
 */
export type InfiniteHistoryHost = PlotEventSource &
  XCoordinates &
  Pick<Plot, "getVisibleRange" | "getDataRange" | "leadingMargin">;

/**
 * Where a landed page goes, when it is a function — a chart with a price
 * and a volume registration fans one page out to both, and a React
 * consumer writes `(page) => setState((prev) => [...page, ...prev])`. A
 * function has no liveness to read: the loader's end is `dispose()`, which
 * is the consumer's to call when what the function writes into goes away.
 */
export type HistorySink<T extends BaseDataPoint> = (page: T[]) => void;

/**
 * Where a landed page goes, when it is a series handle. The loader reads
 * `attached` before each fetch and before each delivery: a handle disposed
 * meanwhile (a symbol switch, a StrictMode replay) stops the loader —
 * `status()` reads `"stopped"` — instead of throwing out of the landing.
 * Those are the only times it looks: an idle or finished loader stays
 * subscribed to the host until `dispose()`, which teardown still calls.
 * `prepend` is looked up once, when the loader is made, and called on the
 * handle.
 */
export type HistoryHandle<T extends BaseDataPoint> = Pick<SeriesHandle<T>, "prepend" | "attached">;

/**
 * Produces the page of points strictly before `before`, ascending in x —
 * the x mode, for an API that pages by time.
 * A native promise is observed through `Promise.prototype.then` itself, so
 * an own `then` on it is never read; a promise whose `constructor` cannot be
 * read is out of reach for any observer — the loader recovers (the failure
 * is reported and the next gesture retries), but that promise's own
 * rejection goes unobserved.
 * An empty array means the end of history. Page size is the fetch's own
 * business — the loader only ever says where to start. Against a capped
 * API (Toss and Upbit take `count` up to 200, Binance `limit` up to
 * 1000), just request the cap: one bigger page beats several small ones
 * on every axis — round trips while the screen shows a gap, request
 * quota, and landings (each landing costs every derivation its head
 * door where one takes it, or a whole recompute otherwise).
 */
export type HistoryFetch<T extends BaseDataPoint> = (
  before: number,
) => Promise<T[]> | T[];

/**
 * One page in cursor mode: the points, ascending in x, and the token that
 * asks for the page before them — `null` when there is none.
 */
export interface HistoryPage<T extends BaseDataPoint, C> {
  bars: T[];
  next: C | null;
}

/**
 * Produces the page a token names — the cursor mode, for an API that pages
 * by an opaque token (a `nextBefore`, a page key) instead of a time. The
 * loader never looks inside the token and never compares two: it hands
 * back the `next` of the last page it took. Promise handling is the x
 * mode's (`HistoryFetch`).
 */
export type HistoryCursorFetch<T extends BaseDataPoint, C> = (
  cursor: C,
) => Promise<HistoryPage<T, C>> | HistoryPage<T, C>;

/**
 * - `idle` — nothing in flight; gestures can trigger a fetch
 * - `loading` — a page is in flight
 * - `done` — history is exhausted: in x mode the fetch returned an empty
 *   page; in cursor mode a page said `next: null` and its points, if any,
 *   were delivered
 * - `terminated` — the fetch's shape is permanently wrong (a page that is
 *   not valid series data: out of order, a repeated x on bars, a broken
 *   point; in cursor mode also a page that isn't `{ bars, next }`, or nine
 *   pages in a row that kept no older point); retrying would throw forever,
 *   so the loader stopped
 * - `stopped` — the loader was disposed, or the handle it delivers to was;
 *   nothing more is fetched and a page landing afterwards is dropped
 *
 * `done`, `terminated` and `stopped` are final. Disposing a loader that is
 * already `done` or `terminated` keeps that reason.
 */
export type HistoryStatus = "idle" | "loading" | "done" | "terminated" | "stopped";

/** What both modes take. */
export interface HistoryOptionsBase<T extends BaseDataPoint = BaseDataPoint> {
  /**
   * The accessor the sink's series uses, so a landed page is judged by the
   * same rule the sink will apply — notably `uniqueX` (a bar per moment).
   * Omitted, the loader checks order only, as line data allows. A page
   * that fails here is a **fetch shape** defect (the loader terminates);
   * without this, the same page would fail inside the sink and read as a
   * delivery failure that retries on every gesture. The cursor — `from`,
   * `before`, the trim, the next frontier — lives in the same space: the
   * x the accessor reads (`getX`), which is the x the chart orders by. For
   * every built-in accessor that is `point.x`. Omitted, the loader checks
   * x order only — it does not know the point's shape, so it asks nothing
   * of its values.
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

/** The x mode's options — a page is asked for by the x it must end before. */
export interface InfiniteHistoryOptions<T extends BaseDataPoint = BaseDataPoint>
  extends HistoryOptionsBase<T> {
  /**
   * Not in this mode. Typed out so options held in a variable can't carry a
   * cursor past an x fetch — at runtime a cursor switches to cursor mode.
   */
  cursor?: never;
}

/**
 * The cursor mode's options. `from` is still the first x held — trimming
 * and gap judgment stay in the chart's x — and `cursor` is the token for
 * the page before it, the `next` that came with the page already held.
 */
export interface InfiniteHistoryCursorOptions<T extends BaseDataPoint, C>
  extends HistoryOptionsBase<T> {
  cursor: C;
}

/**
 * How many pages in a row may keep no older point before a cursor loader
 * gives up. An empty page with a `next` is not the end in this mode (a
 * provider can skip a closed session), so it doesn't stop the chain — but
 * a fetch that hands back the same stretch forever would chain requests
 * forever, and this is the bound on that: on no progress, not on pages.
 */
const MAX_EMPTY_CURSOR_PAGES = 8;

export interface HistoryLoader {
  /** Current state — a snapshot safe to read at any time. */
  status(): HistoryStatus;
  /**
   * Notifies on every state change, with the state as it is at delivery —
   * the pair a status bar or `useSyncExternalStore` needs. When a change is
   * made from inside another listener, a listener can hear the same state
   * twice in a row; it never hears a state that is no longer current.
   */
  statusChanges: Observable<HistoryStatus>;
  /** Stops listening and reads `"stopped"` (unless already `done` or `terminated`); a response landing afterwards is dropped. Safe to call twice. */
  dispose(): void;
}

/**
 * What `infiniteHistory` returns — a loader that also says where it stands,
 * for a consumer that starts another one later from the same place (a chart
 * remounted under a React key). `C` is the cursor mode's token type; an
 * x-mode loader is a `CursorHistoryLoader<never>`.
 */
export interface CursorHistoryLoader<C> extends HistoryLoader {
  /**
   * The token the next fetch would be asked with — moved by every page
   * taken, an empty one included, which never reaches the sink. `null` once
   * a page said there is none (`done`), and always in x mode, where the
   * first x held is the place.
   */
  cursor(): C | null;
}

/** The handle's own `prepend`, bound to it — read once when the loader is made, and applied without reading anything off it again. */
function boundPrepend<T extends BaseDataPoint>(handle: HistoryHandle<T>): HistorySink<T> {
  const prepend = handle.prepend;
  return (page) => void Reflect.apply(prepend, handle, [page]);
}

const nativeThen = Promise.prototype.then;

/**
 * Observes a fetch result — both outcomes — without reading anything off a
 * native promise the consumer handed back (an own `then` on it is consumer
 * code, and skipping it must not skip observing the rejection). Anything
 * else is taken up through a promise of our own, where a throwing `then`
 * becomes an ordinary rejection.
 */
function observe<V>(
  result: Promise<V> | V,
  fulfilled: (value: V) => void,
  rejected: (error: unknown) => void,
): void {
  if (typeof result === "object" && result !== null) {
    // A promise of any realm: the intrinsic checks the internal slot, not the
    // prototype, and throws before attaching anything if the receiver is not
    // one (or is one whose `constructor` cannot be read).
    try {
      Reflect.apply(nativeThen, result, [fulfilled, rejected]);
      return;
    } catch {
      // Not observable directly — take it up through a promise of our own below.
    }
  }
  Reflect.apply(nativeThen, new Promise<V>((resolve) => resolve(result)), [fulfilled, rejected]);
}

/** Surfaces an error out-of-band without wedging the loader's own flow. */
const rethrow = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};

/**
 * What the loader can judge about a page on its own: x order, and nothing
 * about the values — a bar, a line point, anything with an x. The `{x, y}`
 * default accessor would demand a `y` the page may not have.
 */
function orderOnly<T extends BaseDataPoint>(): CoordinateAccessor<T> {
  return { getX: (point) => point.x, getY: () => null, gapless: true };
}

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
 * - **Gap fill** — the screen shows a stretch with no data (more blank
 *   than the half bar a fit leaves before the first point).
 *   Fires regardless of gesture and chains page after page until the
 *   screen is covered. At the left wall, pan is clamped and emits no
 *   events at all, so this landing-driven loop is the only way out —
 *   which is why pages that make progress are never capped: capped, the
 *   chart would stall on a blank screen forever. The screen itself bounds
 *   the chain (zoom limits bound the screen). In x mode an empty page ends
 *   it; in cursor mode an empty page with a `next` moves the token and
 *   chains on, so only a run of pages that keep no older point is capped
 *   (nine in a row terminate).
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
 * - In x mode, a non-empty page trimmed to nothing throws, carrying
 *   `before` and the page's last x: a fetch that ignores its cursor must
 *   not read as "the end of history". In cursor mode a token names a page,
 *   not a time, so such a page is no progress — the token moves on, and
 *   only a run of them terminates.
 * - An out-of-order page throws and **terminates** the loader: the fetch's
 *   shape is wrong, so a retry is an exception fountain, not a recovery.
 *   (`[...page].reverse()` belongs inside the fetch, like backoff.)
 *
 * A rejected fetch is transient by contrast: loading recovers and the
 * next gesture retries naturally.
 *
 * **Landing cost** — a landing pays for the points held, not the page:
 * a prepend copies the whole array and shifts any populated cached x
 * values by the page. A derivation pays by its door. With a head door
 * (`deriveFirst`), the built-in manager, prior output and a non-empty
 * page, the door's `head` returns outputs for the page plus up to its
 * declared lookback of old ones; when some old output outlives that
 * lookback the result is spliced over the retained tail — same objects,
 * normally only the head and the seam validated — and when the lookback
 * covers all of it the head goes through `setData` and full validation.
 * Without a head door the whole input is re-derived and fully validated.
 * Measured at 100k candles, +500 bars per landing, at a 500-bar window:
 * 0.40ms bare, 3.90ms with four SMA derivations through their head doors
 * — under the 8ms hitch line. Landings equal pages, so a chart whose
 * derivations re-derive wholesale still wants larger, rarer pages.
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
  sink: HistorySink<T> | HistoryHandle<T>,
  fetch: HistoryFetch<T>,
  options: InfiniteHistoryOptions<T>,
): CursorHistoryLoader<never>;
/**
 * Cursor mode: `fetch` is asked with `options.cursor`, then with each taken
 * page's `next`. The loader trims and judges by x as in x mode. A page that
 * keeps older bars moves the token only once they're delivered — a sink
 * that throws leaves the same token for the retry; a page that keeps none
 * moves it with no delivery. `next: null` ends the history after that
 * page is delivered; an empty page with a `next` moves the token and keeps
 * filling a gap. A page that isn't `{ bars, next }` terminates.
 */
export function infiniteHistory<T extends BaseDataPoint, C extends NonNullable<unknown>>(
  host: InfiniteHistoryHost,
  sink: HistorySink<T> | HistoryHandle<T>,
  fetch: HistoryCursorFetch<T, C>,
  options: InfiniteHistoryCursorOptions<T, C>,
): CursorHistoryLoader<C>;
export function infiniteHistory<T extends BaseDataPoint, C extends NonNullable<unknown>>(
  host: InfiniteHistoryHost,
  sink: HistorySink<T> | HistoryHandle<T>,
  fetch: HistoryFetch<T> | HistoryCursorFetch<T, C>,
  options: InfiniteHistoryOptions<T> | InfiniteHistoryCursorOptions<T, C>,
): CursorHistoryLoader<unknown> {
  // The token is opaque — held as it came and handed back as it came.
  let cursor: unknown = options.cursor;
  const cursorMode = cursor !== undefined;
  if (cursor === null) {
    throw new ContractError(
      "infiniteHistory: options.cursor is null — null is a page's way of saying there is no older page, so there is nothing to load",
    );
  }
  if (!Number.isFinite(options.from)) {
    throw new ContractError(
      `infiniteHistory: options.from must be a finite data x, got ${options.from}`,
    );
  }
  const coordinates = options.coordinates ?? orderOnly<T>();
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
  /** Cursor mode: pages in a row that kept no older point. */
  let emptyPages = 0;

  const changes = emitter<HistoryStatus>();
  /**
   * Status listeners are consumer code, and a listener that throws must not
   * wedge the loader part-way through a transition — its error goes out of
   * band and the loader carries on with what it was doing.
   */
  const set = (next: HistoryStatus): void => {
    if (status === next) return;
    status = next;
    try {
      changes.emit(next);
    } catch (error) {
      rethrow(error);
    }
  };
  const statusChanges: Observable<HistoryStatus> = {
    subscribe(listener) {
      // Every transition reaches every listener, carrying the state as it is
      // at delivery: a listener before this one may already have moved it
      // on, and the value that was emitted would then be stale. Nothing is
      // suppressed — a listener that invalidates a snapshot must hear it.
      return changes.subscribe(() => listener(status));
    },
  };

  // A handle's `prepend` is read once, here — a method looked up at each
  // landing would be consumer code running after the last liveness check.
  const deliver: HistorySink<T> = typeof sink === "function" ? sink : boundPrepend(sink);

  let off: (() => void) | null = null;
  /** A page was handed over and the chart doesn't hold it yet — the next frame re-judges. */
  let awaitingLanding = false;
  /**
   * The end of the loader. The flag and the unsubscribe come first, before
   * any listener hears about it — a listener may call back into the loader.
   */
  const stop = (): void => {
    if (disposed) return;
    disposed = true;
    const release = off;
    off = null;
    try {
      release?.();
    } catch (error) {
      rethrow(error);
    }
    if (status === "idle" || status === "loading") set("stopped");
  };

  /**
   * Whether delivery still has somewhere to go. A handle that cannot even
   * say (its `attached` reading throws) is treated as gone: the loader
   * stops and the error goes out of band like every other.
   */
  const alive = (): boolean => {
    if (typeof sink === "function") return true;
    let attached: boolean;
    try {
      attached = sink.attached;
    } catch (error) {
      stop();
      rethrow(error);
      return false;
    }
    // The reading is consumer code — it may have disposed the loader.
    if (attached && !disposed) return true;
    stop();
    return false;
  };

  /**
   * After a failed step (a sink, a fetch, a rejection), the loader goes back
   * to `idle` so the next gesture retries — but only while there is still
   * somewhere to deliver. The failure ran consumer code, which may have
   * ended the loader or detached the handle; then it stops instead.
   */
  const recover = (): void => {
    if (disposed || !alive()) return;
    set("idle");
  };

  const judge = (userWentLeft: boolean): void => {
    // done, terminated and stopped are final; loading re-judges when it lands.
    if (disposed || status !== "idle") return;
    const view = lastView;
    if (!view) return;

    // **A page counts once it reaches the chart.** The sink may land it
    // later (a React state update commits after the sink returns) or never
    // (a chart that refused it). Until the chart holds the frontier, the
    // gap on screen is the chart's, not the loader's — pulling again would
    // pile up pages nobody draws. Wait, and look again on the next frame.
    const held = host.getDataRange();
    if (held === null || held.min > frontier) {
      awaitingLanding = true;
      return;
    }

    const left = host.pixelAtX(view.startX);
    const width = host.pixelAtX(view.endX) - left;
    // A zero or degenerate width means layout hasn't happened — no judgment.
    if (!(width > 0)) return;

    // A gap is blank beyond the half bar a fit leaves before the first
    // point; under half a pixel of it is not blank anyone can see.
    if (host.pixelAtX(frontier - host.leadingMargin()) - left > 0.5) {
      pull();
      return;
    }
    const slack = left - host.pixelAtX(frontier);
    if (userWentLeft && slack < screensAhead * width) pull();
  };

  /** The fetch's shape is wrong — a retry would throw forever, so the loader stops. */
  const terminate = (before: number, error: unknown): void => {
    // A read that disposed the loader, or detached the handle, and then
    // threw: the loader has stopped, and that stays the reason.
    if (disposed || !alive()) {
      rethrow(error);
      return;
    }
    set("terminated");
    rethrow(
      new DataError(
        `infiniteHistory: the page for before=${before} is not valid series data — ` +
          `${error instanceof Error ? error.message : String(error)}. Fix it inside the fetch`,
      ),
    );
  };

  /**
   * Cursor mode: a page that kept no older point. Not the end while there is
   * a `next` — the token moves and a gap keeps filling — but a run of them
   * is a fetch going nowhere.
   */
  const noProgress = (before: number, next: unknown): void => {
    // Reading the page ran consumer code — `next`, the accessor — which may
    // have ended the loader or the handle it delivers to.
    if (disposed || !alive()) return;
    if (next === null) {
      set("done");
      return;
    }
    emptyPages += 1;
    if (emptyPages > MAX_EMPTY_CURSOR_PAGES) {
      set("terminated");
      rethrow(
        new DataError(
          `infiniteHistory: ${emptyPages} consecutive pages retained no older bars before ${before} — ` +
            "the fetch keeps answering without going back in time. Fix it inside the fetch",
        ),
      );
      return;
    }
    cursor = next;
    set("idle");
    judge(false);
  };

  const land = (before: number, page: unknown): void => {
    if (disposed || !alive()) return;

    // A fetch is typed to return a page, but `() => response.json()` hands
    // back whatever the server sent — that is a fetch shape defect, not a
    // transient one. The points are copied once, here: after this block the
    // landing reads its own copy, never the consumer's object again (an
    // array proxy's reads are consumer code), and cursor mode reads `bars`
    // and `next` off the page exactly once each.
    let rows: T[];
    let next: unknown = null;
    try {
      let bars: unknown = page;
      if (cursorMode) {
        if (typeof page !== "object" || page === null || Array.isArray(page)) {
          throw new TypeError(
            `the page is ${page === null ? "null" : Array.isArray(page) ? "an array" : typeof page}, not { bars, next }`,
          );
        }
        bars = Reflect.get(page, "bars");
        next = Reflect.get(page, "next");
        if (next === undefined) {
          throw new TypeError("the page has no next — null says there is no older page");
        }
      }
      if (!Array.isArray(bars)) {
        const what = cursorMode ? "the page's bars are" : "the page is";
        throw new TypeError(`${what} ${bars === null ? "null" : typeof bars}, not an array`);
      }
      // An index loop into our own array, not `slice` — `slice` builds its
      // result through the page's `constructor[Symbol.species]`.
      const length = bars.length;
      rows = [];
      for (let i = 0; i < length; i++) rows.push(bars[i]);
    } catch (error) {
      terminate(before, error);
      return;
    }
    // The reads above are consumer code (an array proxy, a getter).
    if (disposed || !alive()) return;

    if (rows.length === 0) {
      if (cursorMode) noProgress(before, next);
      else set("done");
      return;
    }

    // Trim first, judge what lands. An inclusive REST bound hands back the
    // boundary bar (and a provider may repeat it); those points are
    // discarded by contract, so a defect among them is not the fetch's
    // shape being wrong. A point the cursor can't even read is.
    // The x values this landing keeps — the new frontier and what the
    // diagnostics report — are captured here. The accessor is consumer code:
    // the shape check below reads it again, but nothing reads it after
    // delivery, so nothing it does then can change what gets committed.
    const trimmed: T[] = [];
    let firstX = before;
    let lastX = before;
    try {
      for (const point of rows) {
        lastX = coordinates.getX(point);
        if (lastX >= before) continue;
        if (trimmed.length === 0) firstX = lastX;
        trimmed.push(point);
      }
    } catch (error) {
      terminate(before, error);
      return;
    }
    // The accessor may have disposed the loader, or detached the handle.
    if (disposed || !alive()) return;
    if (trimmed.length === 0 && cursorMode) {
      // A token names a page, not a time — a page that only repeats what is
      // held is no progress, not a fetch ignoring its cursor.
      noProgress(before, next);
      return;
    }
    if (trimmed.length === 0) {
      set("idle");
      rethrow(
        new DataError(
          `infiniteHistory: the fetch ignored its cursor — asked for points before ` +
            `${before} but every point sits at or after it (last x ${lastX})`,
        ),
      );
      return;
    }

    // The retained page's own shape is judged by the same walker every
    // data door runs (one rule set — a hand-written `<` loop here used to
    // let a repeated x through to the sink, where it read as a retryable
    // delivery failure instead of the fetch defect it is).
    try {
      scanSeriesData(trimmed, coordinates, null);
    } catch (error) {
      terminate(before, error);
      return;
    }
    // The checks ran consumer code — the loader, or the handle it delivers
    // to, may be gone by now.
    if (disposed || !alive()) return;

    try {
      deliver(trimmed);
    } catch (error) {
      // The cursor stays put — delivery failed, so the next gesture retries
      // the page. Unless the sink ended the loader or the handle on its way out.
      recover();
      rethrow(error);
      return;
    }
    // The sink may have disposed the loader, or detached the handle — then
    // nothing is committed.
    if (disposed || !alive()) return;

    frontier = firstX;
    if (cursorMode) {
      emptyPages = 0;
      // The last page is delivered before the end is declared.
      if (next === null) {
        set("done");
        return;
      }
      cursor = next;
    }
    set("idle");
    // A prepend never moves the domain, so no event follows a landing —
    // the loader re-judges here or the gap would never finish filling.
    judge(false);
  };

  const pull = (): void => {
    if (!alive()) return;
    // The liveness reading is consumer code: it may have moved the view and
    // started this very request already (or ended the loader). One request
    // at a time.
    if (status !== "idle") return;
    set("loading");
    // A loading listener may have disposed the loader, or the handle.
    if (disposed || !alive()) return;
    const before = frontier;

    let result: unknown;
    try {
      // Either mode's fetch, called with no receiver — asked by the x the
      // page must end before, or by the token.
      result = Reflect.apply(fetch, undefined, [cursorMode ? cursor : before]);
    } catch (error) {
      recover();
      rethrow(error);
      return;
    }

    /**
     * A failure anywhere between here and the end of the landing reads as
     * what it is — a failed request (the next gesture retries) — never as a
     * loader stuck in `loading`. Taking up the result runs consumer code too
     * (a thenable's `then`), and the landing runs the sink and the accessor.
     */
    const failed = (error: unknown): void => {
      if (status === "loading") recover();
      rethrow(error);
    };
    // Attached even when the fetch disposed the loader — a rejection is
    // still consumed, never left unhandled.
    try {
      observe(
        result,
        (page) => {
          try {
            land(before, page);
          } catch (error) {
            failed(error);
          }
        },
        (error) => {
          if (disposed) return;
          failed(error);
        },
      );
    } catch (error) {
      failed(error);
    }
  };

  const releaseView = host.on("xDomainChange", ({ startX, endX }) => {
    const userWentLeft = lastStartX !== null && startX < lastStartX;
    lastStartX = startX;
    lastView = { startX, endX };
    // The judgment reads the host (pixels) and may start a fetch — a failure
    // there is reported out of band, never thrown into the host's event loop,
    // where an eager host calling back inside `on` would lose the unsubscribe.
    try {
      judge(userWentLeft);
    } catch (error) {
      rethrow(error);
    }
  });
  // A landing makes no x event (a prepend never moves the domain); the frame
  // that draws it is where a loader waiting for its page looks again.
  const releaseFrame = host.on("render", () => {
    if (!awaitingLanding) return;
    awaitingLanding = false;
    try {
      judge(false);
    } catch (error) {
      rethrow(error);
    }
  });
  const release = (): void => {
    try {
      releaseView();
    } finally {
      releaseFrame();
    }
  };
  // A host that reported the view while subscribing may already have
  // stopped the loader — the subscription it handed back is still ours to end.
  if (disposed) {
    try {
      release();
    } catch (error) {
      rethrow(error);
    }
  } else {
    off = release;
  }

  // A view set before the loader mounted can already sit past the data
  // before any event fires.
  try {
    const domain = host.getVisibleRange();
    if (domain) {
      lastStartX = domain.min;
      lastView = { startX: domain.min, endX: domain.max };
      judge(false);
    }
  } catch (error) {
    // Installation failed — nothing is handed back, so nothing may stay subscribed.
    stop();
    throw error;
  }

  return {
    status: () => status,
    statusChanges,
    dispose: stop,
    cursor: () => (cursorMode && status !== "done" ? cursor : null),
  };
}
