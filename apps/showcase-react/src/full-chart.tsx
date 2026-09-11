/**
 * A chart instance — all four slots are one of these.
 *
 * **The app owns the settings, the chart owns the data**: the timeframe, type
 * and indicator set come down as the `settings` prop (driven by the header
 * controls), while bars, feed and hover live here. When focused, it pushes up a
 * snapshot for the header to read.
 *
 * Every chart turns `shiftVisibleRangeOnNewBar` on — the core's live-target
 * clamp is what stops a sync group from advancing twice.
 */
import type {
  CrosshairPayload,
  OHLC,
  Plot,
  Series,
  XDomainChangePayload,
} from "@finchart/core";
import {
  AreaSeries,
  barSeries,
  candleSeries,
  histogramSeries,
  LineSeries,
  OHLCAccessor,
  paneMaximize,
  type HistogramPoint,
} from "@finchart/core";
import {
  ChartContainer,
  ChartPane,
  ChartSeries,
  Crosshair,
  Legend,
  Tooltip,
  useDataSource,
  usePlugin,
  XAxis,
  YAxis,
} from "@finchart/react";
import type { DrawingToolsApi } from "@finchart/tools";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createFeed } from "./feed";
import { won, wonDetail } from "./format";
import {
  OverlayIndicators,
  OwnedPaneIndicators,
  type IndicatorKey,
} from "./indicators";
import { DrawingToolsHost } from "./rail";
import {
  CROSSHAIR_FORMAT,
  DEPS,
  StageOptions,
  StillWatermark,
  TickPriceLine,
  X_TICKS,
} from "./stage";

export interface ChartSpec {
  symbol: string;
  seed: number;
  anchor: number;
}

/** The symbols. Each is the same world with a different seed and anchor. */
export const SYMBOLS: readonly ChartSpec[] = [
  { symbol: "BTC/KRW", seed: 20260812, anchor: 104_000_000 },
  { symbol: "ETH/KRW", seed: 20211103, anchor: 5_600_000 },
  { symbol: "XRP/KRW", seed: 20180110, anchor: 3_400 },
  { symbol: "SOL/KRW", seed: 20240315, anchor: 260_000 },
  { symbol: "DOGE/KRW", seed: 20210508, anchor: 480 },
  { symbol: "ADA/KRW", seed: 20170929, anchor: 1_150 },
  { symbol: "LINK/KRW", seed: 20190613, anchor: 31_000 },
  { symbol: "AVAX/KRW", seed: 20200922, anchor: 48_000 },
];

/** The default symbol per slot — the first four. */
export const CHART_SLOTS: readonly ChartSpec[] = SYMBOLS.slice(0, 4);

export function specOf(symbol: string): ChartSpec {
  const spec = SYMBOLS.find((entry) => entry.symbol === symbol);
  if (!spec) throw new Error(`Unknown symbol: ${symbol}`);
  return spec;
}

export type ChartType = "candle" | "bar" | "line" | "area";
export const isChartType = (value: string): value is ChartType =>
  value === "candle" || value === "bar" || value === "line" || value === "area";

/** The per-chart settings the header controls drive — app state. */
export interface ChartSettings {
  timeframe: number;
  chartType: ChartType;
  active: ReadonlySet<IndicatorKey>;
}

/** What the focused chart pushes up to the header. */
export interface FocusSnapshot {
  symbol: string;
  last: OHLC | null;
  shown: OHLC | null;
  refClose: number;
  barCount: number;
}

const volumeOf = (bar: OHLC): HistogramPoint => ({
  x: bar.x,
  y: bar.volume ?? null,
  tone: bar.close >= bar.open ? "up" : "down",
});

const PRICE_LINE_STYLE = { dashArray: "2 3" };

function makeSeries(type: ChartType): Series<OHLC> {
  switch (type) {
    case "candle":
      return candleSeries();
    case "bar":
      return barSeries();
    case "line":
      return new LineSeries<OHLC>({ coordinates: new OHLCAccessor() });
    case "area":
      return new AreaSeries<OHLC>({ coordinates: new OHLCAccessor() });
  }
}

/** Double-click maximizes a pane — the header button covers the fit-all reset instead. */
function MaximizeOnDoubleClick() {
  usePlugin((plot) => plot.use(paneMaximize({ gestures: true })), []);
  return null;
}

export function FullChart({
  spec,
  settings,
  focused,
  onFocus,
  onSymbol,
  onPlot,
  onTools,
  onSnapshot,
  onXDomainChange,
}: {
  spec: ChartSpec;
  settings: ChartSettings;
  focused: boolean;
  onFocus: () => void;
  /** When the picker chooses another symbol — the swap (a `key` remount) is App's job. */
  onSymbol: (symbol: string) => void;
  onPlot: (plot: Plot | null) => void;
  onTools: (tools: DrawingToolsApi | null) => void;
  /** Called only while focused — this is what the header paints from. */
  onSnapshot: (snapshot: FocusSnapshot) => void;
  /** Only the return-to-live anchor (slot 0) carries this. */
  onXDomainChange?: (change: XDomainChangePayload) => void;
}) {
  /**
   * Each chart owns its series instances and **only builds the ones it uses** —
   * a cache keeps their identity, so coming back to the same type returns the
   * same object and `swapSeries` doesn't spin for nothing.
   */
  const madeSeries = useRef<Partial<Record<ChartType, Series<OHLC>>>>({});
  const series =
    madeSeries.current[settings.chartType] ??
    (madeSeries.current[settings.chartType] = makeSeries(settings.chartType));
  // The volume pane recedes under price — its own translucent pair on the series (a variable is chart-wide).
  const [volumeSeries] = useState(() => histogramSeries({ style: { up: "rgba(38, 166, 154, 0.5)", down: "rgba(239, 83, 80, 0.5)" } }));

  const [feed] = useState(() =>
    createFeed({ seed: spec.seed, anchor: spec.anchor }),
  );
  const [bars, setBars] = useState<OHLC[]>(() => {
    if (feed.timeframe() !== settings.timeframe)
      feed.setTimeframe(settings.timeframe);
    return feed.bars();
  });
  const [hover, setHover] = useState<OHLC | null>(null);
  const plotRef = useRef<Plot | null>(null);

  const source = useDataSource(bars);
  const volume = useMemo(() => bars.map(volumeOf), [bars]);
  const last = bars.length > 0 ? bars[bars.length - 1] : null;

  const barsRef = useRef(bars);
  barsRef.current = bars;

  // --- Live — the bar in progress flows through the declarative `data` prop ---
  useEffect(() => {
    return feed.play((current) => {
      setBars((prev) => {
        const tail = prev[prev.length - 1];
        if (tail && tail.x === current.x) return prev.slice(0, -1).concat(current);
        return prev.concat(current);
      });
    });
  }, [feed]);

  /**
   * Switching timeframe — swap the bars, and refit **after the new bars have
   * committed**.
   *
   * Refit over the old bars and the bar-index window (an index range) stays
   * pinned while only the data changes, so an 865-bar window becomes a nine-day
   * window at 15m — which is why the refit is deferred to the next effect. It
   * holds the value currently mounted by name, so no separate flag is needed to
   * recognize the first run.
   */
  const shownTimeframe = useRef(settings.timeframe);
  const pendingFit = useRef(false);
  useEffect(() => {
    if (shownTimeframe.current === settings.timeframe) return;
    shownTimeframe.current = settings.timeframe;
    feed.setTimeframe(settings.timeframe);
    pendingFit.current = true;
    setBars(feed.bars());
  }, [feed, settings.timeframe]);

  useEffect(() => {
    if (!pendingFit.current) return;
    pendingFit.current = false;
    plotRef.current?.fitDomains();
  }, [bars]);

  // --- The hovered bar — the header reads it while focused ---
  //
  // The core hands over the position (`probe`'s `index`): search by hand and
  // the rule diverges from the core's "nearest point", so **the tooltip and the
  // header name different bars.**
  const onCrosshair = useCallback((payload: CrosshairPayload | null) => {
    const data = barsRef.current;
    // `null` is the cursor leaving — the header lets go of the hovered bar.
    const [sample] = payload?.pane?.probe(payload.x) ?? [];
    setHover(sample ? (data[sample.index] ?? null) : null);
  }, []);

  // --- The snapshot — only the focused chart speaks to the header ---
  useEffect(() => {
    if (!focused) return;
    onSnapshot({
      symbol: spec.symbol,
      last,
      shown: hover ?? last,
      refClose: feed.referenceClose(),
      barCount: bars.length,
    });
  }, [focused, onSnapshot, spec.symbol, last, hover, feed, bars.length]);

  return (
    <div
      className="chart-cell"
      data-focused={focused}
      tabIndex={0}
      onPointerDownCapture={onFocus}
      onFocus={onFocus}
    >
      <select
        className="chart-symbol"
        aria-label="Symbol"
        value={spec.symbol}
        onChange={(event) => onSymbol(event.target.value)}
      >
        {SYMBOLS.map((entry) => (
          <option key={entry.symbol} value={entry.symbol}>
            {entry.symbol}
          </option>
        ))}
      </select>
      <ChartContainer
        deps={DEPS}
        data={bars}
        // The accessibility guidance from the Plot contract, in the flesh — it says what the chart is.
        role="img"
        ariaLabel={`${spec.symbol} chart`}
        paneGap={12}
        plotRef={plotRef}
        onPlot={onPlot}
        onCrosshair={onCrosshair}
        onXDomainChange={onXDomainChange}
        style={{ width: "100%", height: "100%" }}
      >
        <StageOptions />
        {/* `format` is the default wording for badges and the ghost cursor — the axis owns the wording */}
        <XAxis ticks={X_TICKS} format={CROSSHAIR_FORMAT.x} />
        <YAxis position="right" format={won} />

        <Crosshair magnet format={CROSSHAIR_FORMAT} />
        <Tooltip formatX={CROSSHAIR_FORMAT.x} formatValue={wonDetail} />
        <Legend formatValue={wonDetail} />
        <StillWatermark text={spec.symbol} />
        <MaximizeOnDoubleClick />
        <DrawingToolsHost symbol={spec.symbol} onReady={onTools} />

        {/* The first pane is mainPane — price and the overlay indicators share it */}
        <ChartPane>
          <ChartSeries series={series} name="Price" />
          <OverlayIndicators active={settings.active} source={source} />
          {last ? (
            <TickPriceLine
              value={last.close}
              format={wonDetail}
              style={PRICE_LINE_STYLE}
            />
          ) : null}
        </ChartPane>

        <ChartPane flex={0.22} minHeight={48}>
          <ChartSeries series={volumeSeries} data={volume} name="Volume" />
        </ChartPane>

        {/* Own-pane indicators go last — they mustn't disturb the leading pane indexes */}
        <OwnedPaneIndicators active={settings.active} source={source} />
      </ChartContainer>
    </div>
  );
}
