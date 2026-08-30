/**
 * Explicit wiring, the real thing — explicit-wiring.md embeds this file as it
 * is, and `pnpm --filter charts-docs type-check` keeps it compiling.
 *
 * There is one difference from the preset (browserDeps): **only what you
 * import here ends up in the bundle.** The pointer interactions, the dividers,
 * and the gradient painter aren't imported, so the bundler has no way to
 * include them — a runtime flag is a door for behavior, not for bytes; the
 * absence of a reference is the real door.
 */
import {
  candleSeries,
  createCanvasRenderer,
  createCanvasTextMeasurer,
  createPlotDeps,
  frameScheduler,
} from "@finchart/core";
import {
  createDomAxisLabels,
  createDomLayers,
  cssReader,
  PlotBuilder,
} from "@finchart/dom";

const deps = (container: HTMLElement) =>
  createPlotDeps({
    createLayers: (width, height) => createDomLayers(container, width, height),
    createRenderer: createCanvasRenderer,
    createStyleReader: () => cssReader(container),
    createTextMeasurer: createCanvasTextMeasurer,
    createAxisLabels: createDomAxisLabels,
    createScheduler: frameScheduler(),
    // Import interactions the moment you need them — they pay off from the
    // moment they're attached:
    // interactions: pointerInteractions(container),
    // Once you start splitting panes: createDividers: createDomDividers,
  });

const plot = PlotBuilder.create(deps, candleSeries())
  .addDataPoints([
    { x: 0, open: 100, high: 108, low: 98, close: 106 },
    { x: 1, open: 106, high: 112, low: 104, close: 109 },
    { x: 2, open: 109, high: 111, low: 101, close: 103 },
  ])
  .setSize(800, 400)
  .build(document.getElementById("chart")!);

export { plot };
