import type {
  BaseDataPoint,
  ChartState,
  CrosshairPayload,
  LineStyle,
  Pane,
  Plot,
  PlotDeps,
  Scale,
  XDomainChangePayload,
} from '@finchart/core';
import type { BrowserDeps, ThemeObserverOptions } from '@finchart/dom';
import type { AriaRole, CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlotOptions } from '../hooks/plot-options';
import { usePlot } from '../hooks/use-chart';
import {
  ChartDataProvider,
  ChartProvider,
  type ChartApi,
  type PaneAcquisition,
} from './chart-context';
import {
  createSeriesCollector,
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
   * `resizablePanes`, `shiftVisibleRangeOnNewBar`, `axisDrag`,
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
   * Supplies the view state from outside. Applied every time the
   * reference changes — same as `usePlot.state`.
   *
   * The pane slice finds its own slot **even if the pane attaches
   * later**: a child pane attaches on a second commit, and the container
   * re-applies the slice after the commit where the pane list changed
   * (running after `<ChartPane flex>`), so the restored state wins over
   * the mount default.
   */
  state?: Partial<ChartState>;
  /** Fires when the view state changes — the starting point for URL persistence, undo, and chart sync. */
  onStateChange?: (state: ChartState) => void;
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
  state,
  onStateChange,
  plotRef: exposed,
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
    state,
    onStateChange,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Re-applies the pane slice after the commit where the pane structure
   * changed.
   *
   * A child pane attaches later than the container, and at that point the
   * state prop's reference hasn't changed, so `usePlot`'s apply doesn't
   * re-run — the slice never meets its pane. A parent's effect runs after
   * its children's, so this re-apply lands after `<ChartPane>`'s acquire:
   * **restoring wins over the mount default.** Does nothing when the
   * structure is unchanged.
   *
   * Watches the **count of acquire/release calls**, not the pane list's
   * identity — the first `ChartPane` reuses the existing `mainPane`, so
   * the list doesn't change, and StrictMode's double mount discards and
   * recreates a pane, returning the count right back to where it was.
   */
  const structure = useRef(0);
  const appliedStructure = useRef(-1);
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || structure.current === appliedStructure.current) return;

    appliedStructure.current = structure.current;
    const slices = stateRef.current?.panes;
    if (slices) plot.applyState({ panes: slices });
  });

  /**
   * The `Plot` exists only after mount, so children attach once, at that
   * point.
   *
   * This effect is declared after `usePlot`, so it runs after the `Plot`
   * is built — effects in the same component run in declaration order.
   */
  const [ready, setReady] = useState(false);

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
    setReady(true);

    return () => {
      if (exposed) exposed.current = null;
    };
  }, [exposed, plotRef]);

  useEffect(() => {
    onPlot?.(plotRef.current);
    return () => onPlot?.(null);
  }, [onPlot, plotRef]);

  const mainPaneTaken = useRef(false);
  // The main pane's scale before a `<ChartPane yScale>` replaced it — put
  // back on release, so a keyed swap to a pane without `yScale` returns to
  // what was there. This is a weaker ownership than a pane's series list
  // has: the core *refuses* a second series owner, but it cannot tell a
  // wrapper's `setYScale` from a consumer's, so a swap made while the pane
  // holds the main pane is allowed and then overwritten on release. What
  // comes back is the instance, not its old domain — `setYScale` writes the
  // current range onto it (`replantScale`), falling back to the instance's
  // own when that range does not fit.
  const previousScale = useRef<Scale | null>(null);
  const collectors = useRef(new Map<Pane, SeriesCollector<T>>());

  const api = useMemo<ChartApi<T> | null>(() => {
    const plot = plotRef.current;
    if (!plot || !ready) return null;

    return {
      plot,

      acquirePane(options: PaneAcquisition): Pane {
        structure.current += 1;
        const { yScale, ...pane } = options;
        if (mainPaneTaken.current) {
          return plot.addPane(yScale ? { ...pane, yScale: yScale() } : pane);
        }
        mainPaneTaken.current = true;
        plot.mainPane.applyOptions(pane);
        if (yScale) {
          previousScale.current = plot.mainPane.yScale;
          plot.mainPane.setYScale(yScale());
        }
        return plot.mainPane;
      },

      releasePane(pane: Pane): void {
        structure.current += 1;
        collectors.current.delete(pane);

        if (pane === plot.mainPane) {
          mainPaneTaken.current = false;
          const previous = previousScale.current;
          if (previous) {
            previousScale.current = null;
            plot.mainPane.setYScale(previous);
          }
          return;
        }
        plot.removePane(pane);
      },

      seriesCollector(pane: Pane): SeriesCollector<T> {
        const existing = collectors.current.get(pane);
        if (existing) return existing;

        const created = createSeriesCollector(pane);
        collectors.current.set(pane, created);
        return created;
      },
    };
  }, [plotRef, ready]);

  // A `<ChartSeries>` placed outside `<ChartPane>` has a JSX order too. If
  // a pane took over `mainPane`, it's the same collector, so the order
  // chains into one.
  const mainCollector = api ? api.seriesCollector(api.plot.mainPane) : null;
  mainCollector?.begin();

  useEffect(() => {
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
          <ChartDataProvider value={data}>{children}</ChartDataProvider>
        </ChartProvider>
      ) : null}
    </>
  );
}
