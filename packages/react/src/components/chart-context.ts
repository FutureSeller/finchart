import type { BaseDataPoint, Pane, PaneOptions, Plot } from '@finchart/core';
import { createContext, useContext } from 'react';
import type { SeriesCollector } from './series-collector';

/**
 * The channel children use to register themselves onto the chart.
 *
 * Children go through `acquirePane` instead of creating a pane directly
 * because of `mainPane`. A `Plot` always has a `mainPane`, so if the first
 * `<ChartPane>` didn't just use it, an empty pane would sit at the top
 * taking up space for nothing.
 */
export interface ChartApi<T extends BaseDataPoint = BaseDataPoint> {
  plot: Plot;
  acquirePane(options: PaneOptions): Pane;
  releasePane(pane: Pane): void;
  /**
   * The owner of that pane's series list. One per pane, so the container
   * holds it.
   *
   * If `<ChartPane>` takes over `mainPane`, it ends up sharing the same
   * collector as a `<ChartSeries>` outside any pane — that's fine, since
   * it's the same collector and neither clears the other's list.
   */
  seriesCollector(pane: Pane): SeriesCollector<T>;
}

// biome-ignore lint/suspicious/noExplicitAny: the context erases the data type
const ChartContext = createContext<ChartApi<any> | null>(null);

// biome-ignore lint/suspicious/noExplicitAny: same as above
const PaneContext = createContext<Pane | null>(null);

/**
 * The `data` the container received. **Kept separate from the api on purpose.**
 *
 * Putting it on `ChartApi` would mean that object is rebuilt every time the
 * data changes, and `<ChartPane>`'s effect depends on `[api]` — so it would
 * re-acquire the pane, unregistering every series inside along with it.
 * Data changes often, so it flows separately.
 */
// biome-ignore lint/suspicious/noExplicitAny: same as above
const DataContext = createContext<any[]>([]);

export const ChartProvider = ChartContext.Provider;
export const PaneProvider = PaneContext.Provider;
export const ChartDataProvider = DataContext.Provider;
/** Exposed because `<YAxis>` has to tell on its own whether it's inside a pane or not. */
export const PaneContextValue = PaneContext;

export function useChartApi<T extends BaseDataPoint = BaseDataPoint>(
  who: string,
): ChartApi<T> {
  const api = useContext(ChartContext);
  if (!api) throw new Error(`<${who}> must be inside <ChartContainer>`);

  return api;
}

/**
 * The current container's chart. The channel for **imperative configuration
 * done from inside, not outside.**
 *
 * Reading `plotRef` from a parent's effect breaks under a `key` remount —
 * under StrictMode's double mount, the parent effect grabs the first
 * instance, the one about to be discarded, and any tool install or
 * `applyOptions` call goes nowhere. Inside the container is different:
 * children only render once the api is in place, and if they remount they
 * remount together with it, so they always see the current chart.
 *
 * ```tsx
 * function Setup() {
 *   const plot = useChartPlot();
 *   useEffect(() => {
 *     const tools = plot.mainPane.use(drawingTools({ plot }));
 *     return () => tools.dispose();
 *   }, [plot]);
 *   return null;
 * }
 * ```
 *
 * `plotRef` is still the right tool for event handlers (something like a
 * button's `fitDomains()`) — by the time the user clicks, the chart has
 * already settled.
 */
export function useChartPlot(): Plot {
  return useChartApi('useChartPlot').plot;
}

/** The data the container handed down. Series put it into their own registration. */
export function useChartData<T extends BaseDataPoint = BaseDataPoint>(): T[] {
  return useContext(DataContext);
}

/**
 * The collector for the pane this belongs to. Inside a pane, that pane;
 * outside one, `mainPane` — either way a series has somewhere to go.
 */
export function useSeriesCollector<T extends BaseDataPoint = BaseDataPoint>(
  who: string,
): SeriesCollector<T> {
  const api = useChartApi<T>(who);
  const pane = useContext(PaneContext) ?? api.plot.mainPane;
  return api.seriesCollector(pane);
}

