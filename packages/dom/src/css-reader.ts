import type { StyleReader } from "@finchart/core";

/**
 * The browser implementation that reads CSS variables from computed style —
 * `browserDeps` binds the container and feeds the core
 * `() => cssReader(container)`.
 *
 * Reads through the container's own window, so a chart mounted into an
 * iframe or a popup takes that window's styles. No container, or a document
 * with no window (one made by `document.implementation`), gives a reader
 * that returns `""` — every value falls back to its default.
 *
 * Grabs computed style once, at creation time, so one is made per render and
 * shared across series.
 */
export const cssReader = (container: HTMLElement | null): StyleReader => {
  if (!container) return () => "";
  const view = container.ownerDocument.defaultView;
  if (!view) return () => "";

  const computed = view.getComputedStyle(container);
  return (name) => computed.getPropertyValue(name).trim();
};
