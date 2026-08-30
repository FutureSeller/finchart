import { createScope } from "@finchart/core";
import { listen } from "./listen";
/**
 * Calls back when the CSS behind `--chart-*` may have changed, so the
 * consumer can ask for a repaint.
 *
 * **The canvas does not notice a theme swap.** New variable values arrive the
 * moment the cascade changes, but nothing redraws with them — the DOM parts
 * (axis labels, tooltip, legend) follow at once while candles, grid and
 * crosshair stay in the old colors. Theming guide calls that "changing only
 * halfway", and until now the fix was a subscription every consumer wrote by
 * hand. This is that subscription, once.
 *
 * ```ts
 * const stop = observeTheme(container, () => plot.requestRender());
 * ```
 *
 * **Not wired by `browserDeps`, on purpose.** A chart in a page with one fixed
 * palette should not carry a MutationObserver, and a default that causes a
 * static import is a charge levied on every consumer. This is a door:
 * import it when a theme can actually change.
 *
 * It also takes `onChange` directly rather than returning an observer the way
 * `observeElementSize` and `observeDevicePixelRatio` do. Those two are shaped
 * for a `PlotDeps` slot because the stage has to act on what they report; a
 * theme change asks for nothing but a render, so it needs no contract in the
 * core and the consumer holds the subscription.
 *
 * Two things move a variable's value:
 *
 * - **`prefers-color-scheme`** — the OS switching, with no code of ours on the
 *   path at all.
 * - **an attribute on the element or an ancestor** — `class="dark"`,
 *   `data-theme`, an inline `style`. The chain is walked once at subscribe
 *   time; a theme toggled by restructuring the DOM above the chart (rather
 *   than by re-dressing it) is out of reach, and so is a swapped stylesheet.
 *
 * No debounce. A class toggle can produce several mutations, and
 * `requestRender()` already collapses a frame's worth of requests into one —
 * debouncing here would only delay the frame.
 */
export interface ThemeObserverOptions {
  /**
   * Attributes whose change counts as a theme change. The default covers the
   * three conventions in the wild; a design system that marks its theme some
   * other way names it here.
   */
  attributes?: readonly string[];
}

const DEFAULT_ATTRIBUTES = ["class", "style", "data-theme"];

export function observeTheme(
  element: HTMLElement,
  onChange: () => void,
  options: ThemeObserverOptions = {},
): () => void {
  const view = element.ownerDocument?.defaultView;
  if (!view) return () => {};

  const attributeFilter = [...(options.attributes ?? DEFAULT_ATTRIBUTES)];
  const scope = createScope();
  let stopped = false;

  /**
   * Events that arrive after the caller unsubscribed are discarded —
   * `removeEventListener` only blocks what has not been dispatched yet, and
   * anything already queued would ask a destroyed chart to render (the same
   * hazard `observeDevicePixelRatio` guards).
   */
  const fire = (): void => {
    if (!stopped) onChange();
  };

  if (typeof view.matchMedia === "function") {
    const query = view.matchMedia("(prefers-color-scheme: dark)");
    listen(scope, query, "change", fire);
  }

  if (typeof view.MutationObserver === "function") {
    const observer = new view.MutationObserver(fire);
    for (
      let node: HTMLElement | null = element;
      node !== null;
      node = node.parentElement
    ) {
      observer.observe(node, { attributes: true, attributeFilter });
    }
    scope.add(() => observer.disconnect());
  }

  return () => {
    stopped = true;
    scope.dispose();
  };
}
