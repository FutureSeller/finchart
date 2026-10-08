import type { BaseDataPoint, Pane, PaneOptions, Plot, Scale } from '@finchart/core';
import { createContext, useContext, useLayoutEffect } from 'react';
import type { SeriesCollector, SeriesPlacement } from './series-collector';

/** The props a `<ChartPane>` gives its pane, defaults filled in. */
export interface PaneProps
  extends Required<Pick<PaneOptions, 'flex' | 'minHeight' | 'valuePadding' | 'autoScale' | 'invert'>> {
  yScale?: () => Scale;
  valueDomain?: readonly [number, number];
}

/**
 * What a `<ChartPane>` declares to its container on each render: where it
 * sits in the JSX, the props it has now, and how to build its pane. Built
 * once per render, so the same render declared twice — StrictMode's replay,
 * a reveal — is recognisably no change.
 */
export interface PaneDeclaration {
  rank: readonly number[];
  props: PaneProps;
  /** Puts the pane on the chart — the main pane when `main`, else a new one — and hands it to the wrapper. */
  build(main: boolean): HeldPane;
}

/** A pane the chart holds for one `<ChartPane>`. */
export interface HeldPane {
  readonly pane: Pane;
  /**
   * Applies a later declaration of the same wrapper: only the props that
   * moved. `yScale` is called on each one but the declaration it was built
   * from; its scale is installed only when its `kind` differs from the pane's.
   */
  update(next: PaneDeclaration): void;
  /** Takes the pane off the chart. The main pane stays, without what this wrapper put on it. */
  release(): void;
}

/**
 * The channel children use to register themselves onto the chart.
 *
 * Each `<ChartPane>` declares its pane; the container builds the panes
 * declared, in JSX order, and takes off the ones whose wrapper is released —
 * unmounted, swapped under a new key, hidden by `<Activity>`.
 */
export interface ChartApi<T extends BaseDataPoint = BaseDataPoint> {
  plot: Plot;
  /**
   * Declares a pane under the wrapper's id, from a layout effect, so a pane
   * arriving is built and placed before paint; a moved prop of a pane
   * already built lands at once. `null`, from that effect's cleanup, says
   * the wrapper's layout effects are down: a Suspense boundary hid it, or it
   * is on its way out. Its pane stays until `releasePane`.
   */
  declarePane(id: string, declaration: PaneDeclaration | null): void;
  /**
   * The wrapper is gone, from a passive cleanup: unmounted, swapped, hidden
   * by `<Activity>`. Its pane comes off at once, in the same flush as its
   * series — unless the whole chart is going, when its teardown takes the
   * pane, or a StrictMode replay of the chart is about to declare it again.
   * A Suspense boundary hiding the wrapper runs no passive cleanup, so its
   * pane stays, and so do the components inside it.
   */
  releasePane(id: string): void;
  /**
   * Brings the panes in line with the declarations. Run by the container
   * after all its children committed; `wake` asks for that run again. The
   * returned cleanup says the chart may be going: until the next settle, a
   * release takes nothing off.
   */
  settle(wake: () => void): () => void;
  /**
   * The owner of that pane's series list. One per pane, so the container
   * holds it.
   *
   * A `<ChartPane>` holding `mainPane` shares its collector with every
   * `<ChartSeries>` outside any pane — that's fine, since neither clears
   * the other's list.
   */
  seriesCollector(pane: Pane): SeriesCollector<T>;
}

// biome-ignore lint/suspicious/noExplicitAny: the context erases the data type
const ChartContext = createContext<ChartApi<any> | null>(null);

// biome-ignore lint/suspicious/noExplicitAny: same as above
const PaneContext = createContext<Pane | null>(null);
const SeriesPlacementContext = createContext<SeriesPlacement | null>(null);

/**
 * The `data` the container received. **Kept separate from the api on purpose.**
 *
 * Putting it on `ChartApi` would mean that object is rebuilt every time the
 * data changes — and a new api is a new chart to the panes declared to it,
 * so every pane would be built again, unregistering every series inside.
 * Data changes often, so it flows separately.
 */
// biome-ignore lint/suspicious/noExplicitAny: same as above
const DataContext = createContext<any[]>([]);

export const ChartProvider = ChartContext.Provider;
export const PaneProvider = PaneContext.Provider;
export const ChartDataProvider = DataContext.Provider;
export const SeriesPlacementProvider = SeriesPlacementContext.Provider;

/**
 * Where this child sits in the JSX of the nearest container or pane.
 *
 * `undefined` outside any container, or when the child rendered without its
 * owner — its own component's state switched it on — so that pass never
 * counted it. It then asks the owner for a fresh pass; a layout effect, so
 * the corrected order commits before a frame is drawn.
 */
export function useJsxRank(id: string): readonly number[] | undefined {
  const placement = useContext(SeriesPlacementContext);
  const rank = placement?.place(id);
  useLayoutEffect(() => {
    if (rank === undefined) placement?.missed();
  }, [rank, placement]);
  return rank;
}
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
