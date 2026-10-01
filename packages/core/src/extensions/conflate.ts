import type { BaseDataPoint } from "../data";
import { runAll, throwable } from "../primitives";
import type { SeriesHandle } from "../plot/series-handle";
import { frameScheduler, type SchedulerFactory } from "../render";

/**
 * What the feed needs from a series — `updateLast` to deliver, `attached`
 * to know the registration is still alive. Selected off `SeriesHandle` so
 * the compiler holds the claim that a handle fits as-is.
 */
export type ConflatableHandle<T extends BaseDataPoint> = Pick<
  SeriesHandle<T>,
  "updateLast" | "attached"
>;

export interface ConflatedFeed<T extends BaseDataPoint> {
  /** Takes one tick. O(1), no copy — the cost moves to the flush. */
  push(point: T): void;
  /** Delivers the pending tick now instead of waiting for the schedule. */
  flush(): void;
  /** Flushes what is pending (no tick is dropped), then stops. Safe to call twice. */
  dispose(): void;
}

export interface ConflatedOptions<T extends BaseDataPoint> {
  /**
   * When the pending tick is delivered. Defaults to `frameScheduler()` —
   * once per animation frame, which is the point: the chart repaints once
   * per frame anyway, so ticks between frames only need their latest
   * state. Where there is no rAF (node, SSR) this falls back to immediate
   * delivery — no conflation, same meaning.
   */
  schedule?: SchedulerFactory;
  /**
   * How two same-bar ticks fold into one. Defaults to last-wins, which is
   * right for the common feed shape (each tick carries the whole current
   * bar, already accumulated). A feed that sends partial updates keeps
   * what it needs here — e.g. `high: Math.max(pending.high, incoming.high)`.
   *
   * Building bars from raw trades is aggregation's job, not this one's:
   * `barAggregator` folds trades into a bar, and the bars it makes are what
   * arrives here. Handing raw trades to this instead would merge them
   * last-wins and throw away that frame's high and low.
   */
  merge?: (pending: T, incoming: T) => T;
  /**
   * Where a tick sits on x, for telling a new bar from the same one.
   * Defaults to `point.x`; pass the series' own `getX` when its
   * `coordinates` read x from another field, or every tick would fold into
   * one bar.
   */
  xOf?: (point: T) => number;
}

/**
 * Folds a tick burst down to what a frame can actually show.
 *
 * Rendering already coalesces — fifty `requestRender`s draw one frame. The
 * data side does not: every `updateLast` pays a full-array copy and the
 * seam checks, so fifty ticks between frames pay fifty of them for a
 * picture that only shows the last. This feed holds the latest tick per
 * bar and delivers it once per schedule tick, making the per-frame cost a
 * constant instead of O(ticks × data).
 *
 * Measured (100k points, candles, headless): 50 ticks/frame 16.9 → 3.8
 * ms/frame, 200 ticks/frame 55.8 → 3.8. Below ~10k points at modest tick
 * rates the win is noise — this is a door you walk through when the feed
 * is actually loud, not a default.
 *
 * **A new bar is never conflated over.** When a tick opens a different x,
 * the previous bar's pending state is delivered immediately — its final
 * high/low/close are data, and last-wins across the boundary would lose
 * them. Delivery order always matches bar order.
 *
 * Latency: this feed runs its own clock, separate from the chart's render
 * scheduler. Delivery waits for the feed's frame, and the render that
 * delivery requests waits for the next one — so a tick can reach the
 * screen up to two frames (~33ms) later than the unconflated path. A
 * consumer that cannot spend that passes its own `schedule`; a chart wired
 * with a custom scheduler should pass the same factory here, or the two
 * run on different clocks.
 *
 * ```ts
 * const feed = conflated(handle);
 * socket.on("tick", (t) => feed.push(t));
 * // later: feed.dispose() — or scope.add(() => feed.dispose()), the same
 * // one-liner every extension's disposer rides
 * ```
 */
export function conflated<T extends BaseDataPoint>(
  handle: ConflatableHandle<T>,
  options: ConflatedOptions<T> = {},
): ConflatedFeed<T> {
  const merge = options.merge ?? ((_pending: T, incoming: T) => incoming);
  const xOf = options.xOf ?? ((point: T) => point.x);
  let pending: T | null = null;
  let disposed = false;

  const deliver = (): void => {
    const point = pending;
    pending = null;
    // The registration may have died between push and flush — the same
    // `handle.attached` idiom a socket callback is told to use.
    if (point !== null && handle.attached && !disposed) handle.updateLast(point);
  };

  const scheduler = (options.schedule ?? frameScheduler())(deliver);

  const feed: ConflatedFeed<T> = {
    push(point) {
      if (disposed) return;

      const before = pending;
      if (before !== null && xOf(point) !== xOf(before)) {
        // Bar rollover — the old bar's final state is data, not something
        // to fold away. It goes out now; the new bar starts pending.
        deliver();
      }
      if (disposed) return;
      const next = pending === null ? point : merge(pending, point);
      // Delivery, attachment and merge callbacks can end this feed.
      if (disposed) return;
      pending = next;
      // Deduplicating repeat requests is the scheduler's contract, not ours.
      scheduler.request();
    },

    flush() {
      if (disposed) return;
      scheduler.cancel();
      deliver();
    },

    dispose() {
      if (disposed) return;
      // Close admission before callbacks, while retaining the one tick
      // already accepted. This final delivery may not enqueue another.
      disposed = true;
      const point = pending;
      pending = null;
      const failures = runAll([
        () => scheduler.cancel(),
        () => { if (point !== null && handle.attached) handle.updateLast(point); },
      ], (step) => step());
      if (failures) throw throwable(failures, "disposing conflated feed failed");
    },
  };

  return feed;
}
