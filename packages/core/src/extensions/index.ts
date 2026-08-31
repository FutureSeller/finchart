/**
 * Built-in extensions **on top of** the chart — mounted by the consumer,
 * not a part of the chart itself.
 *
 * Everything living here consumes only capability interfaces
 * (`plot/capabilities`) and the plugin contract (`plot/plugin`) — the same
 * standing as `@finchart/tools` and `@finchart/indicators`. They live
 * inside core purely because they ship by default, not because of the
 * distribution unit. Grid is the only decoration the chart installs
 * itself, and it's the only one that stays in `plot/` (`plot/grid.ts`).
 *
 * The direction is machine-checked: extensions knows about plot, and plot
 * doesn't know about extensions (`__tests__/module-boundaries.test.ts`).
 */
export { crosshair, crosshairLine, timeCursor } from "./crosshair";
export type { CrosshairLine, CrosshairLineOptions, TimeCursor } from "./crosshair";
export { markers, priceLine, span, watermark } from "./standard";
export type {
  Marker,
  PriceLineOptions,
  SpanOptions,
  WatermarkOptions,
} from "./standard";
export { paneMaximize } from "./pane-maximize";
export type {
  PaneMaximizeApi,
  PaneMaximizeOptions,
} from "./pane-maximize";
export { conflated } from "./conflate";
export type { ConflatableHandle, ConflatedFeed, ConflatedOptions } from "./conflate";
export { infiniteHistory } from "./infinite-history";
export type {
  HistoryFetch,
  HistoryLoader,
  HistorySink,
  HistoryStatus,
  InfiniteHistoryHost,
  InfiniteHistoryOptions,
} from "./infinite-history";
export { syncCrosshair, syncX } from "./sync";
