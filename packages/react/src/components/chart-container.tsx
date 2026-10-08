import type {
  BaseDataPoint,
  DataError,
  CrosshairPayload,
  LineStyle,
  Pane,
  Plot,
  PlotDeps,
  XDomainChangePayload,
} from '@finchart/core';
import type { BrowserDeps, ThemeObserverOptions } from '@finchart/dom';
import type { AriaRole, CSSProperties, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PlotOptions } from '../hooks/plot-options';
import { usePlot } from '../hooks/use-chart';
import {
  ChartDataProvider,
  ChartProvider,
  SeriesPlacementProvider,
  type ChartApi,
  type HeldPane,
  type PaneDeclaration,
} from './chart-context';
import {
  compareRank,
  createSeriesCollector,
  createSeriesPlacement,
  type SeriesCollector,
} from './series-collector';

/**
 * A slot to hold the chart — **just one writable `current`.**
 *
 * **Doesn't use React's ref types.** What `RefObject<T>` means differs by
 * version — React 19's is `{ current: T }` (writable), 18's is `{
 * readonly current: T | null }`. Writing it structurally erases the
 * difference: both the `MutableRefObject` that 18's `useRef<Plot |
 * null>(null)` returns and 19's `RefObject` satisfy this shape.
 */
export type { PlotOptions } from '../hooks/plot-options';

export interface PlotHandleRef {
  current: Plot | null;
}

/** Holds the element the chart is built on → `ChartContainerProps.containerRef`. */
export interface ContainerHandleRef {
  current: HTMLDivElement | null;
}

export interface ChartContainerProps<T extends BaseDataPoint> {
  /**
   * A finished wiring, or the recipe `browserDeps()` returns — the
   * container fills the div this sets up.
   *
   * **Required** — giving it a default would mean this package statically
   * imports `browserDeps`, and even consumers who wired things leanly
   * would carry the browser shell (+6.5KB gzip, measured).
   */
  deps: PlotDeps | BrowserDeps;
  data: T[];
  /**
   * Falls back to the container deciding when omitted — turn on
   * `autoSize: true` in `deps` and the core's `ResizeObserver` follows
   * along. Given explicitly, that wins instead.
   */
  width?: number;
  height?: number;
  showGrid?: boolean;
  gridStyle?: Partial<LineStyle>;
  /** Gap between panes (px). The divider sits here. */
  paneGap?: number;
  /**
   * The plot options that have no prop of their own — `padding`,
   * `resizablePanes`, `shiftVisibleRangeOnNewBar`,
   * `preserveLiveRightEdgeOnZoomOut`, `axisDrag`,
   * `rightOffset`, `minBarSpacing`, `maxBarSpacing`. A key that is missing
   * reverts to what the plot was built with; `minBarSpacing`/`maxBarSpacing`
   * go back to the x mapping's own default. Applied before the first
   * series registers, so `rightOffset` shapes the first fit whatever the
   * JSX order. `axis` is `<XAxis>`/`<YAxis>`'s, `style.grid` is `gridStyle`,
   * `showGrid` and `paneGap` are props — one door per value.
   */
  options?: PlotOptions;
  /**
   * Redraw when the theme moves — `prefers-color-scheme`, or a `class` /
   * `data-theme` / `style` change on the container or an ancestor it had
   * at mount; an `attributes` list replaces that default. Off by default:
   * a fixed palette should not hold a MutationObserver it never needs. A
   * theme applied by restructuring the DOM above the chart, or a swapped
   * stylesheet, is out of reach — call `plot.requestRender()` yourself then.
   */
  followTheme?: boolean | ThemeObserverOptions;
  onCrosshair?: (crosshair: CrosshairPayload | null) => void;
  /**
   * Fires when the visible x range changes. Infinite scroll listens for
   * this.
   *
   * Safer than subscribing directly through `plotRef` — even if the chart
   * remounts (swapping the wiring via `key`), the subscription follows
   * the new plot.
   */
  onXDomainChange?: (change: XDomainChangePayload) => void;
  /**
   * Data the chart refused — out of order, not finite — reported instead of
   * thrown. The chart keeps drawing the data it had (a sync is checked whole
   * before any of it applies), and the next good `data` lands as usual, so a
   * live screen survives one bad tick. Only `DataError`: a `ContractError`
   * is a mistake in the code and still goes to the nearest error boundary.
   *
   * Left out, refused data throws to the nearest error boundary — the
   * default never hides a bug.
   */
  onError?: (error: DataError) => void;
  /**
   * For when you need the imperative API — things like `fitDomains` or
   * `pan`.
   *
   * **A channel meant for use inside event handlers.** Use `onPlot` when
   * you need to *react* to the chart appearing and disappearing — a ref
   * can't wake an effect, so under a `key` remount, the parent's effect
   * sees a stale value.
   */
  plotRef?: PlotHandleRef;
  /**
   * The element the chart is built on — the one that takes focus and the
   * keyboard. A toolbar button takes focus when clicked, so the keys that
   * follow (Esc to cancel a drawing, Delete) only reach the chart once
   * focus comes back: `containerRef.current?.focus()` after `tools.begin()`.
   * `null` until mounted and after unmount; never set on the server.
   */
  containerRef?: ContainerHandleRef;
  /**
   * The door for lifting the chart into **state** — wiring **between**
   * containers requires this. Since `plotRef` can't wake an effect,
   * wiring that has to react to the chart appearing and disappearing
   * (something like `<SyncX>`) builds its state through this callback
   * instead. Called with the plot once the chart is up, and with `null`
   * once it's torn down.
   *
   * **The reference must be stable** (a `useState` setter or
   * `useCallback`) — give it a new function every render and
   * `null`/the plot swap back and forth on every render.
   */
  onPlot?: (plot: Plot | null) => void;
  className?: string;
  style?: CSSProperties;
  /**
   * **Four narrow doors for accessibility and identification.** A canvas
   * has no name and no role, so say what the chart is with `role="img"` +
   * `aria-label`, and pull it out of the tab order with `tabIndex={-1}` —
   * all four are **props of the container element.** There's no blanket
   * rest-spread: that would blur which props go to the container as part
   * of the contract.
   */
  id?: string;
  role?: AriaRole;
  /** `aria-label` — **what** the chart draws. E.g., "AAPL daily candles, Jan–Jun". */
  ariaLabel?: string;
  tabIndex?: number;
  /** `<ChartPane>`·`<ChartSeries>`·`<XAxis>`·`<YAxis>` */
  children?: ReactNode;
}

/**
 * Creates the chart and opens the channel children register through.
 *
 * Doesn't take series as a prop — what to draw is up to the children. A
 * child doesn't render DOM; it registers itself in an effect and
 * unregisters in cleanup.
 */
export function ChartContainer<T extends BaseDataPoint>({
  deps,
  data,
  width,
  height,
  showGrid = true,
  gridStyle,
  paneGap,
  options,
  followTheme,
  onCrosshair,
  onXDomainChange,
  onError,
  plotRef: exposed,
  containerRef: exposedContainer,
  onPlot,
  className,
  style,
  id,
  role,
  ariaLabel,
  tabIndex,
  children,
}: ChartContainerProps<T>) {
  const { containerRef, plotRef } = usePlot<T>({
    deps,
    width,
    height,
    showGrid,
    gridStyle,
    paneGap,
    options,
    followTheme,
    onCrosshair,
    onXDomainChange,
  });

  /**
   * The `Plot` exists only after mount, so children attach at that point —
   * and again whenever an effect replay (React's `<Activity>` hiding and
   * showing the tree) builds a new one: the children unmount with the old
   * chart and mount against the new, never staying bound to a destroyed one.
   *
   * This effect is declared after `usePlot`, so it runs after the `Plot`
   * is built — effects in the same component run in declaration order.
   */
  const [plot, setPlot] = useState<Plot | null>(null);

  /**
   * **Doesn't put `plotRef` and `onPlot` in the same effect.**
   *
   * Keeping them together means that whenever `onPlot` is an unstable
   * reference (a common inline arrow function), it's new every render, so
   * every commit tears down and reruns — and that teardown also sets
   * `exposed.current = null`. React runs passive unmounts across the
   * whole tree before any mounts, and within that, children run before
   * their parent, so the order ends up:
   *
   *   child cleanup → `onPlot(null)`, `exposed.current = null` → **child
   *   effect (`plotRef.current` is `null`)** → parent restores it
   *
   * Child code like `useEffect(() => { plotRef.current?.fitDomains() })`
   * silently does nothing on every update. Splitting the two removes the
   * coupling: the ref is planted once per mount, and the callback only
   * fires when its own reference changes.
   */
  useEffect(() => {
    if (exposed) exposed.current = plotRef.current;
    setPlot(plotRef.current);

    return () => {
      if (exposed) exposed.current = null;
      setPlot(null);
    };
  }, [exposed, plotRef]);

  // Its own effect for the same reason as the plot ref above: planted once
  // per mount (and per ref object), not torn down by an unstable `onPlot`.
  // Declared before `onPlot`, so the element is in place when the callback
  // announces the chart, and already cleared when it announces `null` on
  // unmount (a changed `onPlot` alone re-announces without touching this).
  useEffect(() => {
    if (!exposedContainer) return;
    exposedContainer.current = containerRef.current;
    return () => {
      exposedContainer.current = null;
    };
  }, [exposedContainer, containerRef]);

  useEffect(() => {
    onPlot?.(plotRef.current);
    return () => onPlot?.(null);
  }, [onPlot, plotRef]);

  // Read at the moment of a refusal, so a new handler each render is fine.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const api = useMemo<ChartApi<T> | null>(() => {
    if (!plot) return null;
    const collectors = new WeakMap<Pane, SeriesCollector<T>>();
    /** What the `<ChartPane>`s declared last, by wrapper id, until each is released. */
    const declared = new Map<string, PaneDeclaration>();
    /** The panes the chart holds for them. */
    const held = new Map<string, HeldPane>();
    /** Wrappers whose layout effects are down — hidden by Suspense, or on their way out. */
    const down = new Set<string>();
    /** The held ids in the order last compared — the cue to restack is that changing. */
    let order: string[] = [];
    /** A pane arrived, came back or moved in the JSX since the last settle — nothing else needs one. */
    let unsettled = false;
    /** This settle already waited once for the main pane's holder to be released. */
    let waited = false;
    let wake = () => {};
    /**
     * Between `<Settle>`'s layout setup and its cleanup. Closed while the
     * whole chart is going (unmounted, a new `key`) or hidden — that cleanup
     * runs before any passive one — so a release then takes nothing off: the
     * chart's own teardown takes the panes, unannounced. A deletion inside a
     * hidden chart commits with its reveal, after this has opened again.
     */
    let open = false;

    const reconcile = (): void => {
      // Only saves work: a settle with nothing arrived, back or moved changes nothing.
      if (!unsettled) return;

      let mainHolder: string | undefined;
      for (const [id, { pane }] of held) if (pane === plot.mainPane) mainHolder = id;
      const ranked = [...declared].sort(([, a], [, b]) => compareRank(a.rank, b.rank));
      // A keyed swap takes the main pane's wrapper down and brings its
      // successor in the same commit, and only the old wrapper's passive
      // cleanup tells that from a Suspense boundary hiding it. Settle again
      // once instead: an update asked for here renders before paint, after
      // this commit's passive effects, so the successor takes the main pane.
      if (!waited && mainHolder !== undefined && down.has(mainHolder) && ranked.some(([id]) => !held.has(id))) {
        waited = true;
        wake();
        return;
      }
      waited = false;
      unsettled = false;

      for (const [id, next] of ranked) {
        if (held.has(id)) continue;
        // The first to arrive while the main pane is free takes it — an
        // empty main pane would otherwise sit on top taking space for nothing.
        const hold = next.build(mainHolder === undefined);
        if (hold.pane === plot.mainPane) mainHolder = id;
        held.set(id, hold);
      }

      // Restacked only when a declared pane's place among the declared panes
      // moved — one arrived, or keyed panes swapped — so a `setPaneOrder` the
      // user made holds until then. A pane going moves no other past
      // another: the rest close up in the order last compared. A wrapper
      // that is down — on its way out, or hidden by Suspense — keeps the rank
      // it last declared while its siblings were ranked afresh around it, so
      // it takes no part in the comparison.
      const settled = (id: string): boolean => held.has(id) && !down.has(id);
      const survivors = order.filter(settled);
      const now = ranked.map(([id]) => id).filter((id) => !down.has(id));
      const unmoved = now.length === survivors.length && now.every((id, at) => survivors[at] === id);
      order = keepDownInPlace(now, order, (id) => down.has(id));
      if (unmoved) return;
      // Stacked by `order`, not by declared ranks: a wrapper that is down
      // still carries the rank it last declared, while `order` keeps it where
      // it stood among its siblings. The chart and the next comparison then
      // agree on where every pane is.
      const ranks = new Map<Pane, readonly number[]>();
      order.forEach((id, at) => {
        const hold = held.get(id);
        if (hold) ranks.set(hold.pane, [at]);
      });
      // An unclaimed main pane goes to the top; a pane added outside the JSX
      // (through `plotRef`) keeps its place below the declared ones.
      const rankOf = (pane: Pane): readonly number[] =>
        ranks.get(pane) ?? (pane === plot.mainPane ? [-1] : [Number.POSITIVE_INFINITY]);
      plot.setPaneOrder([...plot.panes].sort((a, b) => compareRank(rankOf(a), rankOf(b))));
    };

    return {
      plot,

      declarePane(id, declaration) {
        if (!declaration) {
          down.add(id);
          return;
        }
        // Back from being down — a Suspense reveal, a StrictMode replay: it
        // was held in place while its siblings may have moved around it, so
        // its place is compared afresh even when its own rank is unchanged.
        const back = down.delete(id);
        const last = declared.get(id);
        declared.set(id, declaration);
        // A moved prop concerns this pane alone, so it lands now, with no
        // settle: a data tick re-renders every pane, and waking the
        // container for each would cost every tick a second commit.
        held.get(id)?.update(declaration);
        // Only a pane arriving, coming back or moving in the JSX changes the
        // set or its order. The same rank again — a tick — is no reason.
        if (!back && last && compareRank(last.rank, declaration.rank) === 0) return;
        unsettled = true;
        wake();
      },

      releasePane(id) {
        // Gone for good: no longer down, so nothing waits on it as a
        // keyed swap's departing holder and the set doesn't grow per wrapper.
        down.delete(id);
        if (!declared.delete(id)) return;
        // Off at once, so the pane goes in the same flush as its series.
        const hold = open ? held.get(id) : undefined;
        if (hold) {
          held.delete(id);
          hold.release();
          // Out of the order too: built again — StrictMode replaying the
          // wrapper's effects — it is a pane arriving, to be placed. Nothing
          // else needs settling: a pane going moves no other.
          order = order.filter((other) => other !== id);
        }
      },

      settle(next) {
        wake = next;
        open = true;
        reconcile();
        return () => {
          open = false;
        };
      },

      seriesCollector(pane: Pane): SeriesCollector<T> {
        let collector = collectors.get(pane);
        if (!collector) {
          collector = createSeriesCollector<T>(pane, () => onErrorRef.current);
          collectors.set(pane, collector);
        }
        return collector;
      },
    };
  }, [plot]);

  // A `<ChartSeries>` placed outside `<ChartPane>` has a JSX order too. If
  // a pane took over `mainPane`, it's the same collector, so the order
  // chains into one.
  const mainCollector = api ? api.seriesCollector(api.plot.mainPane) : null;
  const [, rerender] = useReducer((round: number) => round + 1, 0);
  const placement = createSeriesPlacement([], rerender);

  useEffect(() => {
    placement.commit();
    mainCollector?.flush();
  });

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        style={{ width, height, ...style }}
        id={id}
        role={role}
        aria-label={ariaLabel}
        tabIndex={tabIndex}
      />
      {api ? (
        <ChartProvider value={api}>
          {/* The series owns the data — the container just passes it down */}
          <SeriesPlacementProvider value={placement}>
            <ChartDataProvider value={data}>{children}</ChartDataProvider>
          </SeriesPlacementProvider>
          <Settle api={api} />
        </ChartProvider>
      ) : null}
    </>
  );
}

/**
 * Brings the chart's panes in line with what the `<ChartPane>`s declare.
 *
 * Rendered after the children, so when the container renders, this layout
 * effect runs after every pane's and sees the whole commit. A pane that
 * declares in a commit the container sat out wakes it instead: an update
 * asked for from a layout effect is rendered before the browser paints, on
 * React 18 as on 19, whatever the priority of the update that got there —
 * a pane arriving is never drawn empty or out of place. Only this renders
 * again. A pane released from a passive cleanup is taken off there and
 * then, with its series, and needs no settle: a pane going moves no other.
 *
 * Inside the chart's tree on purpose: unmounted with the chart, it settles
 * nothing on the way out, so the chart's own teardown takes the panes,
 * unannounced. A component of its own also keeps layout effects off the
 * server: it renders only once there is a chart.
 */
function Settle({ api }: { api: ChartApi }) {
  const [, wake] = useReducer((round: number) => round + 1, 0);
  // The cleanup closes the chart to immediate releases until the next settle.
  useLayoutEffect(() => api.settle(wake));
  return null;
}

/**
 * The order to compare against next time: `now`, with each wrapper that is
 * down put back right after the one it followed in `last`. Its declared rank
 * is stale while its siblings are ranked afresh, so placing it by rank would
 * read, once it shows again, as a pane passing another.
 */
function keepDownInPlace(now: readonly string[], last: readonly string[], isDown: (id: string) => boolean): string[] {
  const merged = [...now];
  let at = 0;
  for (const id of last) {
    if (isDown(id)) {
      merged.splice(at, 0, id);
      at += 1;
      continue;
    }
    const found = merged.indexOf(id);
    if (found >= 0) at = found + 1;
  }
  return merged;
}
