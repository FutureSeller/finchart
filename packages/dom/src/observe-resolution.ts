import type { ResolutionObserver } from "@finchart/core";

/**
 * The browser implementation that reports `devicePixelRatio` changes — the
 * element is pre-bound by `browserDeps`:
 * `observeResolution: observeDevicePixelRatio(container)`.
 *
 * Browsers don't announce a resolution change — not even `resize` fires.
 * Instead, building a media query pinned to the current ratio gets one
 * `change` event the moment that condition breaks. A fired query is tied
 * to the old ratio and can't be reused, so a resubscribe loop rebuilds the
 * query at the new ratio every time.
 *
 * The element is taken for the same reason as `observeElementSize` — a
 * chart inside an iframe needs to watch its own document's window. In an
 * environment without `matchMedia` (SSR, some of jsdom), this does nothing
 * and doesn't throw — there's just nothing to observe, not a broken state.
 */
export const observeDevicePixelRatio =
  (element: HTMLElement): ResolutionObserver =>
  (onChange) => {
    const view = element.ownerDocument?.defaultView;
    if (typeof view?.matchMedia !== "function") return () => {};

    let query: MediaQueryList | null = null;
    let stopped = false;

    const listen = (): void => {
      if (stopped) return;

      /**
       * The ratio is written as the exact decimal — rounding it would make
       * a query that no longer matches the real value (e.g.
       * `1.7999999523162842`), so it would never fire. At worst this falls
       * back to not tracking the change; it never loops.
       */
      query = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
      query.addEventListener("change", fire, { once: true });
    };

    const fire = (): void => {
      /**
       * Events that arrive after detach are discarded — `removeEventListener`
       * only blocks ones not yet dispatched; anything already queued still
       * arrives after removal and would ask a destroyed chart to render.
       */
      if (stopped) return;

      /**
       * Re-listens before notifying — `onChange` can trigger a synchronous
       * render, and by that moment `devicePixelRatio` already holds the
       * new value. Reversing the order would leave the window unobserved
       * during the notification and miss a ratio that changes again right
       * away.
       */
      listen();
      onChange();
    };

    listen();

    return () => {
      stopped = true;
      query?.removeEventListener("change", fire);
      query = null;
    };
  };
