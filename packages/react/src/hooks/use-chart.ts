import { useEffect, useRef } from 'react';
import type {
  BaseDataPoint,
  ChartState,
  CrosshairPayload,
  LineStyle,
  Plot,
  PlotDeps,
  Series,
  SeriesHandle,
  XDomainChangePayload,
} from '@finchart/core';
import type { BrowserDeps } from '@finchart/dom';
import { PlotBuilder } from '@finchart/dom';

export interface UsePlotOptions<T extends BaseDataPoint> {
  /**
   * A finished wiring, or the recipe `browserDeps()` returns.
   *
   * **Required.** Giving it a default would mean this file statically
   * imports `browserDeps`, and then even consumers who wired things
   * explicitly would carry the entire browser shell (+21.6KB raw /
   * +6.5KB gzip) — a violation of the principle that leaving something out
   * of the wiring keeps it out of the bundle.
   */
  deps: PlotDeps | BrowserDeps;
  /** Omit it to decide what to draw later — that's how `<ChartContainer>` uses this. */
  series?: Series<T>;
  /**
   * The data that series draws. **Paired with `series`.**
   *
   * `<ChartContainer>` doesn't set this here — it passes it down to
   * children, since each series draws different data.
   */
  data?: T[];
  width?: number;
  height?: number;
  showGrid?: boolean;
  gridStyle?: Partial<LineStyle>;
  /** Gap between panes (px). The divider sits here. */
  paneGap?: number;
  /**
   * Fires while the pointer moves over the chart — during a mouse pan too,
   * and during a drag a drawing tool owns if the tool moves the crosshair
   * itself; not during a touch pan or a pinch — and **with `null` when it
   * leaves**, once (a drag released outside counts as leaving then): clear
   * the hover state you keep from it there, or a live chart shows a value
   * that is no longer under anything. Comes with which pane it's over and
   * that pane's value.
   */
  onCrosshair?: (crosshair: CrosshairPayload | null) => void;
  /**
   * Fires when the visible x range changes. Infinite scroll listens for
   * this.
   *
   * Don't subscribe directly with `plotRef.current.on(...)` — under
   * StrictMode's double mount, the outer effect stays attached to the
   * first, destroyed plot. This prop is safe because it re-attaches
   * together with the plot-creation effect.
   */
  onXDomainChange?: (change: XDomainChangePayload) => void;
  /**
   * Supplies the view state (`ChartState`) from outside. **Applied every
   * time the reference changes** (`applyState`) — left unset, it's owned
   * internally.
   *
   * This is a directive, not a transfer of ownership: the core is a mirror
   * plus feedback (moving the source of truth for state would put 60fps pan
   * a frame behind). The controlled shape comes from pairing this prop with
   * `onStateChange` — to reject an internal mutation, return the unchanged
   * state as a **new reference** from `onStateChange`.
   */
  state?: Partial<ChartState>;
  /**
   * Fires when the view state changes (pan, zoom, divider drag, pane
   * options). URL persistence, undo, and chart sync all start here.
   *
   * Fires on every pointermove while dragging, so if persisting is
   * expensive, debounce on the receiving end.
   */
  onStateChange?: (state: ChartState) => void;
}

/** The initial size when neither a size prop nor `autoSize` is given. */
const FALLBACK_SIZE = { width: 800, height: 600 };

/**
 * Attaches the core `Plot` to a container and fits it to React's lifecycle
 * (principle: React Wrapper).
 *
 * Creates the `Plot` once, on mount. Every change after that flows through
 * the imperative API — recreating it would swap the canvas out, dropping
 * the pan position and any overlay annotations.
 *
 * **A low-level escape hatch.** This is the hook `<ChartContainer>` uses
 * internally, and the `<ChartContainer>`/`<ChartSeries>` combination is
 * enough for most apps. The only reason to reach for it directly is
 * swapping a single series through an imperative handle (`SeriesHandle`).
 */
export function usePlot<T extends BaseDataPoint>({
  deps,
  series,
  data,
  width,
  height,
  showGrid = true,
  gridStyle,
  paneGap,
  onCrosshair,
  onXDomainChange,
  state,
  onStateChange,
}: UsePlotOptions<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<Plot | null>(null);
  /** The registration this hook mounted. The channel for swapping data. */
  const handleRef = useRef<SeriesHandle<T> | null>(null);

  // The initial values, used only at creation. Later changes are each
  // applied by the effects below.
  const initial = useRef({ deps, width, height, showGrid, gridStyle });
  /** What's already been applied to the chart. Keeps the effect right after mount from redoing the same work. */
  const applied = useRef({ series, data });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const start = initial.current;
    const builder = PlotBuilder.create<T>(start.deps)
      .setSize(start.width ?? FALLBACK_SIZE.width, start.height ?? FALLBACK_SIZE.height)
      .setShowGrid(start.showGrid);

    if (start.gridStyle) builder.setGridStyle(start.gridStyle);

    const plot = builder.build(container);
    plotRef.current = plot;

    /**
     * The series is mounted here rather than in the builder — **because a
     * handle is needed.** The builder path is for a chart that's set up
     * once and left alone, so it doesn't hand back a handle.
     */
    const registration = applied.current;
    if (registration.series) {
      handleRef.current = plot.mainPane.addSeries({
        series: registration.series,
        data: registration.data,
      });
    }

    return () => {
      plot.destroy();
      plotRef.current = null;
      handleRef.current = null;
    };
  }, []);

  // Doesn't re-subscribe even when the callback changes every render.
  const crosshairRef = useRef(onCrosshair);
  crosshairRef.current = onCrosshair;

  useEffect(() => {
    return plotRef.current?.on('crosshair', (crosshair) =>
      crosshairRef.current?.(crosshair),
    );
  }, []);

  const xDomainRef = useRef(onXDomainChange);
  xDomainRef.current = onXDomainChange;

  useEffect(() => {
    return plotRef.current?.on('xDomainChange', (change) =>
      xDomainRef.current?.(change),
    );
  }, []);

  const stateChangeRef = useRef(onStateChange);
  stateChangeRef.current = onStateChange;

  useEffect(() => {
    return plotRef.current?.on('stateChange', (next) =>
      stateChangeRef.current?.(next),
    );
  }, []);

  /**
   * Applies the state prop. **Once on mount, and again every time the
   * reference changes.**
   *
   * The point is living in the same component as the plot-creation effect
   * — even across a remount or StrictMode's double mount, the new plot
   * gets the same state back. Re-applying the same state is a no-op (the
   * core doesn't notify when the value is unchanged), so the
   * apply → notify → persist → apply loop stops after one lap.
   */
  useEffect(() => {
    if (state) plotRef.current?.applyState(state);
  }, [state]);

  /**
   * Pushes size in only when it's given as a prop.
   *
   * Pushing a default unconditionally would undo, right after mount,
   * whatever the core's `autoSize` had just fit to the container's size.
   * **Size can't have two owners** — the prop owns it when given, the
   * container owns it otherwise.
   */
  useEffect(() => {
    if (width === undefined && height === undefined) return;
    plotRef.current?.setViewport({ width, height });
  }, [width, height]);

  useEffect(() => {
    plotRef.current?.applyOptions({ showGrid });
  }, [showGrid]);

  useEffect(() => {
    // Removing the prop reverts to the default. The core's neutral value is
    // 0 (`?? 0`) — leaving `undefined` ignored would make a gap that was
    // once set impossible to revert declaratively.
    plotRef.current?.applyOptions({ paneGap: paneGap ?? 0 });
  }, [paneGap]);

  /**
   * **Removing a prop reverts to the default — the rule for every option
   * prop.** The core's vocabulary treats `undefined` as "not given," so
   * reverting is the wrapper's job, done with an explicit value — on the
   * pane side, `PANE_OPTION_DEFAULTS` is the one set of defaults for that.
   * `data`, `series`, `width`, and `height` are outside this rule — they're
   * imperative statements and measurements, not options.
   * `prop-removal.test.tsx` checks it.
   */
  useEffect(() => {
    plotRef.current?.applyOptions({ style: { grid: gridStyle ?? {} } });
  }, [gridStyle]);

  /**
   * Swaps the data. **This is the imperative path, so it re-fits both
   * axes**.
   *
   * The declarative path (`<ChartContainer data>`) rides in through the
   * spec and doesn't re-fit — infinite scroll is the path that hands in a
   * new array.
   */
  useEffect(() => {
    if (applied.current.data === data) return;
    applied.current.data = data;

    handleRef.current?.setData(data ?? []);
  }, [data]);

  /** Swaps only the presentation. The data belongs to the registration, so it's handed over together with the new one. */
  useEffect(() => {
    if (applied.current.series === series) return;
    applied.current.series = series;
    if (!series) return;

    handleRef.current =
      plotRef.current?.setSeries({ series, data: applied.current.data }) ?? null;
  }, [series]);

  return { containerRef, plotRef };
}

