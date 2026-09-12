/**
 * @finchart/dom — the browser shell, layered on @finchart/core the way
 * react-dom sits on react.
 *
 * The core knows nothing about the DOM — it only holds the contracts
 * (`PlotDeps`, `ChartLayers.overlay: unknown`), and the implementations here
 * fill them in: DOM layers, labels, dividers, pointer input, a CSS reader,
 * size observation, and `browserDeps`/`PlotBuilder`, which wire them
 * together. The legend and tooltip live here too — they're extensions that
 * depend on the DOM overlay.
 *
 * Headless and worker consumers don't install this package.
 */
export { browserDeps } from "./browser-deps";
export type { BrowserDeps, BrowserDepsOptions } from "./browser-deps";
export { PlotBuilder } from "./builder";
export { createDomLayers } from "./dom-layers";
export { createDomAxisLabels } from "./dom-labels";
export { createDomDividers } from "./dom-dividers";
export { cssReader } from "./css-reader";
export { observeElementSize } from "./observe-size";
export { observeDevicePixelRatio } from "./observe-resolution";
export type { ShellStyleVarName } from "./style-var-names";
export { observeTheme } from "./observe-theme";
export type { ThemeObserverOptions } from "./observe-theme";
export { PointerInteractions, pointerInteractions } from "./pointer";
export type { PointerInteractionsOptions } from "./pointer";
export { requireOverlayElement } from "./overlay-element";
export { legend } from "./legend";
export type { LegendOptions, LegendPane } from "./legend";
export { tooltip } from "./tooltip";
export type { TooltipOptions } from "./tooltip";
export type { RowFormat } from "./sample-text";
