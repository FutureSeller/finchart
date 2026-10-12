import type { SizeObserver } from "@finchart/core";

/**
 * The browser implementation that tracks the container's size with
 * `ResizeObserver` — the element is pre-bound by `browserDeps`'s
 * `autoSize`: `observeSize: observeElementSize(container)`.
 *
 * It also reports the current size synchronously, before it returns. The
 * first `ResizeObserver` callback arrives after the first frame is drawn,
 * so a chart waiting for it would draw that frame at the size it was built
 * with, and the fit would only land on the frame after. Reading the size
 * lays the page out then, once per chart — with the chart's canvas already
 * in it at that size, so a page scrollbar that canvas causes narrows the
 * size read, and the observer's callback corrects it once the scrollbar is
 * gone. The report can be zero (or, from rounding, slightly negative) where
 * `ResizeObserver` would report an empty box.
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

    // Before observing: a throwing callback then leaves nothing attached.
    // The client box less padding is the content box `ResizeObserver` reports,
    // to within a pixel — `clientWidth` is a whole number, and the observer's
    // first callback corrects any difference. An element that isn't rendered
    // measures 0 and has nothing to report.
    if (element.clientWidth) {
      const style = view.getComputedStyle(element);
      const px = Number.parseFloat;
      onResize(
        Math.round(
          element.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
        ),
        Math.round(
          element.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
        ),
      );
    }

    const observer = new view.ResizeObserver((entries) => {
      // If it changed multiple times in one frame, only the last one matters.
      const { contentRect } = entries[entries.length - 1];
      onResize(Math.round(contentRect.width), Math.round(contentRect.height));
    });

    observer.observe(element);
    return () => observer.disconnect();
  };
