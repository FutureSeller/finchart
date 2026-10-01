import type { PlotDeps, PlotDepsOptions } from "@finchart/core";
import type { PointerInteractionsOptions } from "./pointer";
import {
  createCanvasRenderer,
  createCanvasTextMeasurer,
  createPlotDeps,
  frameScheduler,
  LINEAR_GRADIENT,
  paintLinearGradient,
} from "@finchart/core";
import { createDomAxisLabels } from "./dom-labels";
import { createDomDividers } from "./dom-dividers";
import { createDomLayers } from "./dom-layers";
import { cssReader } from "./css-reader";
import { observeDevicePixelRatio } from "./observe-resolution";
import { observeElementSize } from "./observe-size";
import { pointerInteractions } from "./pointer";

/** What `browserDeps` returns — feed it a container and you get the wiring. */
export type BrowserDeps = (container: HTMLElement) => PlotDeps;

export interface BrowserDepsOptions extends PlotDepsOptions {
  /**
   * Toggles and fine-tuning for pointer input (pan, zoom, kineticScroll…).
   * `false` means no input at all. Defaults turn everything on at its
   * default value.
   */
  pointer?: PointerInteractionsOptions | false;
  /**
   * Follows the container's size. Off by default.
   *
   * Turn it on and `size` becomes just the initial size — the container
   * decides afterward, so it needs a size of its own from CSS (a height,
   * at least: an empty block is 0 px tall, and a zero size is ignored).
   * To change how it's observed, pass `observeSize` directly.
   */
  autoSize?: boolean;
}

/**
 * The full wiring you'd commonly use in a browser.
 *
 * ```ts
 * PlotBuilder.create(browserDeps(), candleSeries()).build(el)
 * ```
 *
 * `build(el)` feeds in the container — every DOM-attached collaborator
 * (layers, CSS reader, pointer, size observation) gets bound to el right
 * here, which is why the core contract (`PlotDeps`) has no element type at
 * all.
 *
 * Brings in canvas, DOM labels, DOM dividers, pointer input, the frame
 * scheduler, and the CSS reader. Convenience costs bytes — for a sparkline
 * that needs neither axes nor input, use `createPlotDeps({ createLayers })`
 * and add only what you need.
 */
export function browserDeps(options: BrowserDepsOptions = {}): BrowserDeps {
  const { pointer, autoSize, ...rest } = options;

  return (container) =>
    createPlotDeps({
      interactions:
        pointer === false ? undefined : pointerInteractions(container, pointer),
      createAxisLabels: createDomAxisLabels,
      createDividers: createDomDividers,
      createScheduler: frameScheduler(),
      observeSize: autoSize ? observeElementSize(container) : undefined,
      /**
       * On by default, unlike `autoSize` — following resolution changes
       * never hurts (coordinates stay in CSS pixels regardless), while not
       * following them leaves the chart blurry after the monitor changes.
       * To turn it off, pass `observeResolution: undefined` explicitly.
       */
      observeResolution: observeDevicePixelRatio(container),
      ...rest,
      createLayers:
        rest.createLayers ??
        ((width, height) => createDomLayers(container, width, height)),
      // Built-in painters are the preset's batteries — the renderer knows
      // nothing about painters, and they're loaded here. A consumer wiring
      // things by hand gets the fallback (a flat-color downgrade) unless
      // they add the same painters to their own renderer.
      createRenderer:
        rest.createRenderer ??
        ((surface) =>
          createCanvasRenderer(surface, {
            painters: { [LINEAR_GRADIENT]: paintLinearGradient },
          })),
      createStyleReader: rest.createStyleReader ?? (() => cssReader(container)),
      createTextMeasurer:
        rest.createTextMeasurer ?? createCanvasTextMeasurer,
    });
}
