/**
 * A channel with several named events — the multi-event sibling of
 * `emitter` (one value stream an extension attaches to its own API). The
 * chart announces on one of these; **the pairing between a name and its
 * payload never leaves the type.**
 */
import { runAll, throwable } from "./errors";

export interface EventChannel<Events extends object> {
  /** Returns an unsubscribe function. Safe to call twice. */
  on<E extends keyof Events>(
    event: E,
    handler: (payload: Events[E]) => void,
  ): () => void;
  emit<E extends keyof Events>(event: E, payload: Events[E]): void;
  /**
   * Whether anyone is listening. **Check this first when the payload is
   * expensive to build** — a `stateChange` snapshot walks every pane, and
   * `xDomainChange` runs on every pointermove of a drag.
   */
  has(event: keyof Events): boolean;
  /** Drops every handler at once — the chart's last breath cuts notifications before teardown. */
  clear(): void;
}

/**
 * A store that doesn't lose the pairing between event name and payload.
 *
 * A single `Map<EventName, ...>` would make the value type the union of
 * every payload, so the compiler couldn't catch "a crosshair handler where
 * render belongs." Keeping a separate array per name keeps the pairing in
 * the type.
 *
 * It's an array because the same function can be registered twice — then
 * there are two unsubscribe functions, and each removes one. A `Set` would
 * let both point at the same entry, so removing one would remove both.
 */
type ListenerStore<Events extends object> = {
  [E in keyof Events]?: ((payload: Events[E]) => void)[];
};

export function eventChannel<Events extends object>(): EventChannel<Events> {
  let listeners: ListenerStore<Events> = {};

  return {
    on(event, handler) {
      // The store type pairs name with payload, but TS narrows push on an
      // array indexed by a generic key to never. This one line is where that
      // narrowing limitation is contained — the store type already guarantees
      // the pairing is actually correct.
      const handlers = (listeners[event] ??= []) as (typeof handler)[];
      handlers.push(handler);
      let off = false;

      return () => {
        /**
         * **The flag protects both of these at once.** The same function can
         * be registered twice (then there are two unsubscribe functions too
         * → `ListenerStore`), and an unsubscribe function must be safe to
         * call twice. Without the flag these two promises break each other —
         * calling the first unsubscribe twice would have `indexOf` **find the
         * remaining registration instead** and remove both. It only looked
         * safe when each registration used a distinct closure.
         */
        if (off) return;
        off = true;
        const index = handlers.indexOf(handler);
        if (index !== -1) handlers.splice(index, 1);
      };
    },

    /**
     * Iterates over this round's subscriber list **copied first.**
     *
     * If a handler calls its own unsubscribe function, the original array
     * shrinks, and iterating it directly would shift indices and **skip the
     * next subscriber.** That's exactly effect cleanup's shape, so it gets
     * silently swallowed. Anything subscribed mid-iteration isn't called
     * this round either — otherwise a handler could grow the list on itself
     * indefinitely.
     */
    emit(event, payload) {
      const handlers = listeners[event];
      if (!handlers) return;

      /**
       * **If one subscriber throws, the rest are still called.**
       *
       * This is generally an event-bus concern, but here it's a plugin-system
       * one — `crosshair` alone is split between the crosshair, tooltip, and
       * legend, so if the tooltip's format function throws, the crosshair
       * would stop. Someone else's extension must not be able to kill mine.
       *
       * Still, it doesn't **swallow** anything (*"explicit error handling"*)
       * — everyone is called, then the failures are collected and thrown.
       */
      const failures = runAll(handlers.slice(), (handler) => handler(payload));
      if (failures) {
        throw throwable(failures, `"${String(event)}" subscriber threw`);
      }
    },

    has(event) {
      return (listeners[event]?.length ?? 0) > 0;
    },

    clear() {
      listeners = {};
    },
  };
}
