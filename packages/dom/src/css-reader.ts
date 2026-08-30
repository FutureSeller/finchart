import type { StyleReader } from "@finchart/core";

/**
 * The browser implementation that reads CSS variables from computed style —
 * `browserDeps` binds the container and feeds the core
 * `() => cssReader(container)`.
 *
 * Grabs computed style once, at creation time, so one is made per render and
 * shared across series.
 */
export const cssReader = (container: HTMLElement | null): StyleReader => {
  if (!container || typeof getComputedStyle !== "function") {
    return () => "";
  }

  const computed = getComputedStyle(container);
  return (name) => computed.getPropertyValue(name).trim();
};
