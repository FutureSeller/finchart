/**
 * @finchart/react public API — **only what's listed here is public.**
 *
 * `components/index.ts` and `hooks/index.ts` are an internal convenience
 * layer (tests import through those paths), and this file explicitly
 * re-lists them. Adding or removing anything here is a deliberate diff.
 * `__tests__/public-api.test.ts` bans `export *` from creeping back into
 * any of the five package barrels.
 *
 * There are four concepts — **container** (the chart) · **pane** (a
 * grouping sharing a value axis) · **series** (the drawing) ·
 * **attachment** (what mounts on top). The three hooks are only for the
 * places those four don't cover.
 */

// ---- container, data, pane ----
export { ChartContainer } from "./components/chart-container";
export type {
  ChartContainerProps,
  PlotHandleRef,
  PlotOptions,
} from "./components/chart-container";
export { ChartData } from "./components/chart-data";
export type { ChartDataProps } from "./components/chart-data";
export { ChartPane } from "./components/chart-pane";
export type { ChartPaneProps } from "./components/chart-pane";

// ---- series ----
export { ChartSeries } from "./components/chart-series";
export type { ChartSeriesProps } from "./components/chart-series";
export { ChartLine } from "./components/chart-line";
export type { ChartLineProps } from "./components/chart-line";
export { ChartCandles } from "./components/chart-candles";
export type { ChartCandlesProps } from "./components/chart-candles";

// ---- attachments ----
export { Crosshair } from "./components/crosshair";
export type { CrosshairProps } from "./components/crosshair";
export { Legend, Tooltip } from "./components/tooltip";
export type { LegendProps, TooltipProps } from "./components/tooltip";
export { Markers, PriceLine, Span, Watermark } from "./components/decorations";
export type {
  MarkersProps,
  PriceLineProps,
  SpanProps,
  WatermarkProps,
} from "./components/decorations";

// ---- axes ----
export { XAxis, YAxis } from "./components/axes";
export type { XAxisProps, YAxisProps } from "./components/axes";

// ---- linking charts together ----
export { SyncCrosshair, SyncX } from "./components/sync-x";
export type { SyncXProps } from "./components/sync-x";

// ---- where to reach into the chart ----
export { useChartPlot } from "./components/chart-context";
export type { ChartApi } from "./components/chart-context";
export type { SeriesCollector } from "./components/series-collector";

// ---- the three hooks ----
export { usePlot } from "./hooks/use-chart";
export type { UsePlotOptions } from "./hooks/use-chart";
export { usePlugin } from "./hooks/use-plugin";
export { usePluginState } from "./hooks/use-plugin-state";
export { useDataSource } from "./hooks/use-data-source";
