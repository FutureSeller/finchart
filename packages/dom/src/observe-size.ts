import type { SizeObserver } from "@finchart/core";

/**
 * The browser implementation that tracks the container's size with
 * `ResizeObserver` — the element is pre-bound by `browserDeps`'s
 * `autoSize`: `observeSize: observeElementSize(container)`.
 *
 * In an environment without `ResizeObserver`, this does nothing and
 * doesn't throw — browser wiring running under SSR is a normal path too;
 * there's just nothing to observe, not a broken state.
 */
export const observeElementSize =
  (element: HTMLElement): SizeObserver =>
  (onResize) => {
    const view = element.ownerDocument?.defaultView;
    if (!view?.ResizeObserver) return () => {};

    const observer = new view.ResizeObserver((entries) => {
      // If it changed multiple times in one frame, only the last one matters.
      const { contentRect } = entries[entries.length - 1];
      onResize(Math.round(contentRect.width), Math.round(contentRect.height));
    });

    observer.observe(element);
    return () => observer.disconnect();
  };
