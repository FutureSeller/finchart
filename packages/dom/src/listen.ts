import type { Scope } from "@finchart/core";

/**
 * The one surface this helper needs from element, document, window and
 * MediaQueryList alike — structural, so the node-environment test fakes
 * pass through the same door as the real DOM.
 */
interface ListenerHost<E> {
  addEventListener(
    type: string,
    listener: (event: E) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: E) => void,
    options?: EventListenerOptions | boolean,
  ): void;
}

/**
 * Attaches a listener and registers its removal in the scope — one call,
 * both halves. This is the only way this package attaches listeners:
 * a raw `addEventListener` puts the removal in someone's memory, and the
 * teardown checklist that memory turns into is exactly what leaked here
 * before. With the removal registered at the attach site, forgetting it
 * is not a thing that can be written.
 */
export function listen<E>(
  scope: Scope,
  target: ListenerHost<E>,
  type: string,
  listener: (event: E) => void,
  options?: AddEventListenerOptions | boolean,
): void {
  target.addEventListener(type, listener, options);
  // `passive` is ignored by removal; `capture` is what has to match, and
  // passing the same options through keeps it matched.
  scope.add(() => target.removeEventListener(type, listener, options));
}
