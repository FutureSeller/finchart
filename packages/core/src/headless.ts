/**
 * @finchart/core/headless — the small, platform-free lane for workers,
 * tests, and server rendering. Browser assembly stays in `@finchart/dom`.
 */
export { createPlotModel } from "./plot";
export {
  areaSeries,
  barSeries,
  baselineSeries,
  candleSeries,
  histogramSeries,
  lineSeries,
  stepLineSeries,
} from "./series";
export type {
  BaseDataPoint,
  DataView,
  LineDataPoint,
  OHLC,
  Range,
} from "./data";
export type { Series } from "./series";
export type {
  ChartState,
  PaneApi as Pane,
  PaneOptions,
  PlotModel,
  PlotModelDepsOptions,
  PlotModelOptions,
  SeriesHandle,
} from "./plot";
export type { SeriesRegistration } from "./registration";
