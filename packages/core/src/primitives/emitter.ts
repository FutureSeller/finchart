/**
 * **The channel extensions use to notify.** Widening `PlotEvents` for every
 * extension would saddle the core with vocabulary that isn't its own, so
 * **notification is an extension's own API to attach** — the core only
 * supplies the shape (`Emitter`/`Observable`).
 *
 * ```ts
 * const tools = plot.mainPane.use(drawingTools({ plot }));
 * const off = tools.changes.subscribe(({ reason }) => {
 *   // load/clear are echoes of calls we made ourselves — saving over them clobbers the original.
 *   if (reason === "load" || reason === "clear") return;
 *   save(tools.serialize());
 * });
 * ```
 *
 * The core fixes the shape to keep one convention everywhere: it returns an
 * unsubscribe function (same as `plot.on`, `addDecoration`, `addSeries`),
 * one throwing subscriber doesn't stop the rest from being called, and no
 * payload gets built when nobody's listening.
 */

import { runAll, throwable } from "./errors";
import { requireFunction } from "./guards";

/** The listen-only side of a value stream. This is the face extensions expose on their API. */
export interface Observable<T> {
  /** Returns an unsubscribe function. Safe to call twice. */
  subscribe(listener: (value: T) => void): () => void;
}

/** Both the listening side and the notifying side. **The notifying face stays inside the extension.** */
export interface Emitter<T> extends Observable<T> {
  emit(value: T): void;
  /**
   * Number of listeners. **Check this first when the payload is expensive
   * to build** — the same judgment call the chart makes before assembling an
   * `xDomainChange` payload.
   */
  readonly size: number;
}

/** `who` names the failing side in the thrown message — "a subscriber" unless the owner says otherwise. */
export function emitter<T>(who = "a subscriber"): Emitter<T> {
  // One record per subscription, so the same function subscribed twice stays two subscriptions.
  const listeners: { listener?: (value: T) => void }[] = [];

  return {
    subscribe(listener) {
      requireFunction(listener, "subscribe(listener)");
      const record: { listener?: (value: T) => void } = { listener };
      listeners.push(record);

      return () => {
        if (!record.listener) return;
        record.listener = undefined;
        listeners.splice(listeners.indexOf(record), 1);
      };
    },

    emit(value) {
      /**
       * **Iterate over a copy of the list.** If a subscriber calls its own
       * unsubscribe function, the original array shrinks; iterating over it
       * directly would shift indices and skip the next subscriber. Anything
       * that subscribes mid-emit isn't called this round, and anything
       * unsubscribed before its turn isn't called either.
       */
      const failures = runAll(listeners.slice(), (record) => record.listener?.(value));
      if (failures) throw throwable(failures, `${who} threw`);
    },

    get size() {
      return listeners.length;
    },
  };
}
