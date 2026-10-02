/**
 * A channel with several named events — the multi-event sibling of
 * `emitter` (one value stream an extension attaches to its own API). The
 * chart announces on one of these; **the pairing between a name and its
 * payload never leaves the type.**
 */
import { runAll, throwable } from "./errors";
import { requireFunction } from "./guards";

export interface EventChannel<Events extends object> {
  /** Returns an unsubscribe function. Safe to call twice. */
  on<E extends keyof Events>(
    event: E,
    handler: (payload: Events[E]) => void,
  ): () => void;
  emit<E extends keyof Events>(event: E, payload: Events[E]): void;
  /**
   * Whether anyone is listening. **Check this first when the payload is
   * expensive to build** — `xDomainChange` walks every series for its data
   * range, and runs on every pointermove of a drag.
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
 * Each registration is its own record, so the same function registered twice
 * is two records with two unsubscribe functions, and removing one leaves the
 * other. A record whose `handler` is gone has been removed — an emit already
 * under way checks that before each call.
 */
type Registration<T> = { handler?: (payload: T) => void };
type ListenerStore<Events extends object> = {
  [E in keyof Events]?: Registration<Events[E]>[];
};

export function eventChannel<Events extends object>(): EventChannel<Events> {
  let listeners: ListenerStore<Events> = {};

  return {
    on(event, handler) {
      requireFunction(handler, `on("${String(event)}", handler)`);
      // The store type pairs name with payload, but TS narrows push on an
      // array indexed by a generic key to never. This one line is where that
      // narrowing limitation is contained — the store type already guarantees
      // the pairing is actually correct.
      const registrations = (listeners[event] ??= []) as Registration<Parameters<typeof handler>[0]>[];
      const registration: Registration<Parameters<typeof handler>[0]> = { handler };
      registrations.push(registration);

      return () => {
        // Safe to call twice: the second call finds the record already removed.
        if (!registration.handler) return;
        registration.handler = undefined;
        registrations.splice(registrations.indexOf(registration), 1);
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
     * indefinitely. A handler removed mid-iteration — by an earlier handler,
     * or by `clear()` when an earlier handler destroys the chart — is not
     * called: it was removed before its turn came.
     */
    emit(event, payload) {
      const registrations = listeners[event];
      if (!registrations) return;

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
      const failures = runAll(registrations.slice(), (registration) => registration.handler?.(payload));
      if (failures) {
        throw throwable(failures, `"${String(event)}" subscriber threw`);
      }
    },

    has(event) {
      return (listeners[event]?.length ?? 0) > 0;
    },

    clear() {
      for (const registrations of Object.values<Registration<never>[] | undefined>(listeners)) {
        for (const registration of registrations ?? []) registration.handler = undefined;
      }
      listeners = {};
    },
  };
}
