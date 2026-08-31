/**
 * A registration closed into an `Entry` — the bridge between a `Series`
 * (how to draw) and a data manager (what to draw from), with the point
 * type sealed inside. Knows nothing about panes or the stage; the plot
 * layer consumes it.
 */
export { createEntry, requireSeries } from "./entry";
export type { Entry, SeriesId, SeriesRegistration, TypedEntry } from "./entry";
export { seriesSpec } from "./series-spec";
export type { SeriesSpec } from "./series-spec";
