import { RenderError } from "@finchart/core";

/**
 * Narrows the overlay handed in by the wiring down to an element.
 *
 * The core's `ChartLayers.overlay` is `unknown` — the core doesn't know
 * what it is and just passes it along. So DOM consumers (labels, dividers,
 * legend, tooltip) check it at the door.
 *
 * The check is structural, not `instanceof` — `instanceof` comes back
 * false for both a fake element in node tests and a real element from an
 * iframe (a different realm). Only the two members consumers actually use
 * are checked; this isn't a validator, it's an early tripwire for wiring
 * mistakes.
 */
export function isElementLike(value: unknown): value is HTMLElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "appendChild" in value &&
    "ownerDocument" in value
  );
}

/** Narrows the type, or throws a wiring error naming the consumer. */
export function requireOverlayElement(
  overlay: unknown,
  message: string,
): HTMLElement {
  if (isElementLike(overlay)) return overlay;
  throw new RenderError(message);
}
