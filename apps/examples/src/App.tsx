import { browserDeps } from "@finchart/dom";
import type { CrosshairPayload, DataView, HistogramPoint, LineDataPoint, OHLC, Plot } from "@finchart/core";
import { OHLCAccessor, barIndexX, histogramSeries, infiniteHistory, timeTicks } from "@finchart/core";
import {
  ChartCandles,
  ChartContainer,
  ChartLine,
  ChartPane,
  ChartSeries,
  Crosshair,
  Legend,
  PriceLine,
  Tooltip,
  Watermark,
  XAxis,
  YAxis,
  useChartPlot,
} from "@finchart/react";
import { drawingTools } from "@finchart/tools";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Bar number → trading day. **Weekends are skipped** — every five bars leave a
 * two-day hole.
 *
 * x has to be spread out like this for the difference between the two
 * coordinate systems to show: a continuous x axis draws the weekends as gaps,
 * while a bar-index axis (`barIndexX`) butts the bars right up against each
 * other.
 */
function tradingDayOf(bar: number): number {
  const week = Math.floor(bar / 5);
  return week * 7 + (bar - week * 5);
}

/**
 * Trading day 0 is 2026-01-05, a Monday. x is the number of days from there.
 *
 * One format covers both coordinate systems — even on a bar-index axis the
 * core recovers the x at each tick position and hands that over, so the format
 * never learns it is sitting on top of an index.
 */
function dateLabel(x: number): string {
  const date = new Date(2026, 0, 5 + Math.round(x));
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Time ticks — they land on calendar boundaries, and a month's first tick is
 * promoted to the month name. x is "days since 2026-01-05" rather than an
 * epoch, so we hand over the conversion pair.
 */
const DAY_MS = 24 * 3600 * 1000;
const EPOCH_BASE = Date.UTC(2026, 0, 5);
const xTimeTicks = timeTicks({
  timeZone: "UTC",
  locale: "en-US",
  epochOf: (days) => EPOCH_BASE + days * DAY_MS,
  xOfEpoch: (at) => (at - EPOCH_BASE) / DAY_MS,
});

/**
 * Lets the crosshair badges speak in the ticks' own terms — x as a date, y to
 * one decimal. It lives outside the component because a changed reference
 * rebuilds the decoration (`Crosshair.format`).
 */
const crosshairFormat = {
  x: dateLabel,
  y: (value: number) => value.toFixed(1),
};

/**
 * The same bar number always produces the same candle. Any past range you
 * fetch lines up with what's already there, which makes it a good stand-in for
 * server pagination.
 */
function candleAt(bar: number): OHLC {
  const base = 100 + Math.sin(bar / 9) * 18 + Math.cos(bar / 3.3) * 7;
  const open = base;
  const close = base + Math.sin(bar * 1.37) * 5;
  const wick = Math.abs(Math.cos(bar * 0.7)) * 4 + 1;

  return {
    x: tradingDayOf(bar),
    open,
    close,
    high: Math.max(open, close) + wick,
    low: Math.min(open, close) - wick,
    volume: Math.round(600 + Math.abs(Math.sin(bar * 0.9)) * 900),
  };
}

const candlesIn = (from: number, to: number): OHLC[] =>
  Array.from({ length: to - from }, (_, i) => candleAt(from + i));

/** x can be a number, a string or a Date, so an accessor turns it into a number. */
const ohlcCoordinates = new OHLCAccessor();

/**
 * A moving average. The first `period` positions have nothing to average, so
 * they are "no value" (`y: null`) — drop them instead and the x values stay
 * put while the points vanish, so the line cuts straight across that stretch.
 * Leave them null and the core breaks the line there.
 *
 * `derive` receives the whole source, not just the visible window, so even at
 * the far-left edge of the screen there is past to look back on and the line
 * doesn't break.
 */
const movingAverage =
  (period: number) =>
  (source: DataView<OHLC>): LineDataPoint[] => {
    let total = 0;

    return source.map((candle, index) => {
      total += candle.close;
      if (index >= period) total -= source[index - period].close;

      return {
        x: ohlcCoordinates.getX(candle),
        y: index < period - 1 ? null : total / period,
      };
    });
  };

/** The difference from `period` bars ago. Its magnitude differs from price, so it needs its own pane. */
const momentum =
  (period: number) =>
  (source: DataView<OHLC>): LineDataPoint[] =>
    source.map((candle, index) => ({
      x: ohlcCoordinates.getX(candle),
      // The first `period` bars have nothing to subtract from.
      y: index < period ? null : candle.close - source[index - period].close,
    }));

/**
 * Volume bars, coloured by whether the candle rose or fell. The direction
 * rides on the data because up-or-down is a fact about the point, not a
 * style (`HistogramPoint.tone`); the colour is the series style's — a
 * green/red pair at 45% so the pane recedes under price. On the series, not
 * in a CSS variable: a variable is chart-wide and would wash an indicator's bars.
 */
const VOLUME_STYLE = { up: "rgba(22, 163, 74, 0.45)", down: "rgba(220, 38, 38, 0.45)" };
const volumeBars = (source: DataView<OHLC>): HistogramPoint[] =>
  source.map((candle) => ({
    x: ohlcCoordinates.getX(candle),
    y: candle.volume ?? null,
    tone: candle.close >= candle.open ? "up" : "down",
  }));

const MA_COLOR = "#f59e0b";
const MOMENTUM_COLOR = "#7c3aed";

const MA_PERIOD = 20;
const MOM_PERIOD = 10;

const PAGE = 40;
const INITIAL_FROM = -60;

/**
 * The page of candles before a data x — what `infiniteHistory` calls. `before`
 * is always an existing bar's x (the loader's cursor is a delivered point), so
 * folding the day number back to a bar index is exact arithmetic; a real
 * consumer would pass the timestamp to its API instead.
 */
function pastPage(before: number): OHLC[] {
  const week = Math.floor(before / 7);
  const end = week * 5 + (before - week * 7); // day → bar, weekends fold away
  return candlesIn(end - PAGE, end);
}
const HEIGHT = 460;

type Mode = "line" | "candle";

/**
 * Imperative setup belongs inside the container (`useChartPlot`). If a parent
 * effect read `plotRef` instead, then on the coordinate-system toggle (a `key`
 * remount) StrictMode double-mounts the new chart while the parent effect —
 * being an update — runs only once, and can end up holding the first instance,
 * the one being thrown away. Drawings quietly disappear and `applyOptions`
 * goes nowhere. Inside, the api only renders once the chart stands and it
 * rides the remount along with it, so it always sees the chart of the moment.
 */
function ChartSetup({
  barIndex,
  drawings,
}: {
  barIndex: boolean;
  drawings: boolean;
}) {
  const plot = useChartPlot();

  /**
   * The continuous coordinate system has no default zoom-out limit — the core
   * doesn't know what one unit of domain means. This demo does: x is a trading
   * day. Without a limit, zooming out in this mode is unbounded, and so is the
   * gap the history loader tries to fill. Bar-index mode is left alone so the
   * mapping's own default (min 0.5) is what you see.
   */
  useEffect(() => {
    if (!barIndex) plot.applyOptions({ minBarSpacing: 0.5 });
  }, [plot, barIndex]);

  /** The drawing-tools demo — shows a separate package standing up without touching the core. */
  useEffect(() => {
    if (!drawings) return;

    const tools = plot.mainPane.use(drawingTools({ plot }));
    tools.add({ type: "horizontal", price: 100 });
    tools.add({
      type: "trend",
      a: { x: -26, price: 92 },
      b: { x: -6, price: 112 },
    });
    tools.add({
      type: "fib",
      a: { x: -55, price: 126 },
      b: { x: -38, price: 96 },
    });

    return () => tools.dispose();
  }, [plot, drawings]);

  return null;
}

/**
 * The infinite scroll, as the React recipe: the sink is a setState prepend
 * (declarative `data` doesn't refit, so the window you're looking at stays
 * put), the fetch is above, and the loader owns the cursor, the pixel
 * threshold, in-flight dedup, and the refit/fit-all guard — everything the
 * 60-line hand-rolled listener that used to live here did by hand, plus the
 * chaining it documented but skipped ("hand over one page and the rest of
 * the gap stays empty until the next gesture").
 *
 * It lives inside the container for the same reason `ChartSetup` does: on
 * the coordinate-system toggle (a `key` remount), `useChartPlot` hands the
 * chart of the moment, and the effect re-winds the loader against it. The
 * seed is read through a ref at wind time — the loader owns the cursor from
 * there, so the effect must not re-run when a landing changes `firstX`.
 */
function ChartHistory({
  firstX,
  onPage,
}: {
  firstX: number;
  onPage: (older: OHLC[]) => void;
}) {
  const plot = useChartPlot();
  const seed = useRef(firstX);
  seed.current = firstX;

  useEffect(() => {
    const loader = infiniteHistory(plot, onPage, pastPage, { from: seed.current });
    return () => loader.dispose();
  }, [plot, onPage]);

  return null;
}

export function App() {
  const [mode, setMode] = useState<Mode>("candle");
  const [showGrid, setShowGrid] = useState(true);
  const [cursor, setCursor] = useState<CrosshairPayload | null>(null);
  const [loaded, setLoaded] = useState(-INITIAL_FROM);
  const [pages, setPages] = useState(0);
  const [indicators, setIndicators] = useState(true);
  const [crosshair, setCrosshair] = useState(true);
  const [barIndex, setBarIndex] = useState(true);
  const [drawings, setDrawings] = useState(true);
  const [volume, setVolume] = useState(true);

  /**
   * The coordinate system is wiring — toggling it stands a new chart up (`key`
   * forces the remount). With `autoSize` on, the chart follows its container
   * and needs no width/height props.
   */
  const deps = useMemo(
    () =>
      browserDeps({
        autoSize: true,
        createXMapping: barIndex ? barIndexX : undefined,
      }),
    [barIndex],
  );

  /**
   * The data is just state — infinite scroll needs no imperative API.
   * Declarative `data` doesn't refit, by rule, so prepending history leaves the
   * window you were looking at exactly where it was.
   */
  const [candles, setCandles] = useState(() => candlesIn(INITIAL_FROM, 0));

  const plotRef = useRef<Plot | null>(null);

  /** Where a landed page goes — the counters are the demo's own readouts. */
  const onPage = useCallback((older: OHLC[]) => {
    setCandles((prev) => [...older, ...prev]);
    setLoaded((n) => n + older.length);
    setPages((n) => n + 1);
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      {/* This page is the only place the React wrapper gets verified by eye — the name says the role */}
      <h1 style={{ fontSize: 20 }}>@finchart — React wrapper</h1>

      {/* The demo gallery — each page proves something different */}
      <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
        <a href="/cases.html">Case gallery</a>
        <b>React wrapper</b>
        <a href="/trading.html">Trading screen (dogfooding)</a>
        <a href="/bench.html">Bench</a>
      </nav>

      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        <button
          type="button"
          onClick={() => setMode(mode === "candle" ? "line" : "candle")}
        >
          Switch to {mode === "candle" ? "line" : "candles"}
        </button>
        <button type="button" onClick={() => plotRef.current?.fitDomains()}>
          Fit all
        </button>
        <label>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
          Grid
        </label>
        <label>
          <input
            type="checkbox"
            checked={indicators}
            onChange={(e) => setIndicators(e.target.checked)}
          />
          Indicators
        </label>
        <label>
          <input
            type="checkbox"
            checked={crosshair}
            onChange={(e) => setCrosshair(e.target.checked)}
          />
          Crosshair
        </label>
        <label>
          <input
            type="checkbox"
            checked={drawings}
            onChange={(e) => setDrawings(e.target.checked)}
          />
          Drawings
        </label>
        <label>
          <input
            type="checkbox"
            checked={volume}
            onChange={(e) => setVolume(e.target.checked)}
          />
          Volume
        </label>
        <label>
          <input
            type="checkbox"
            checked={barIndex}
            onChange={(e) => setBarIndex(e.target.checked)}
          />
          Bar-index x axis (no weekend gaps)
        </label>
      </div>

      {/* Colors come through CSS variables — the canvas resolves them to values at commit time too */}
      <ChartContainer
        key={barIndex ? "bar-index" : "continuous"}
        deps={deps}
        data={candles}
        showGrid={showGrid}
        paneGap={16}
        plotRef={plotRef}
        onCrosshair={setCursor}
        style={
          {
            // No width — autoSize follows the container.
            width: "100%",
            height: HEIGHT,
            "--chart-line": "#2563eb",
            "--chart-point": "#2563eb",
            "--chart-grid": "#e2e8f0",
            "--chart-candle-up": "#16a34a",
            "--chart-candle-down": "#dc2626",
            "--chart-label": "#64748b",
            "--chart-crosshair": "#94a3b8",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            cursor: "grab",
          } as React.CSSProperties
        }
      >
        <ChartSetup barIndex={barIndex} drawings={drawings} />
        <ChartHistory firstX={candles[0].x} onPage={onPage} />
        <XAxis ticks={xTimeTicks} />

        {/* The crosshair is a decoration, so it sits outside the panes — it crosses both */}
        {crosshair && <Crosshair format={crosshairFormat} />}
        {crosshair && <Tooltip formatX={dateLabel} />}
        <Legend />
        <Watermark text="BTC/KRW" />

        <ChartPane flex={3}>
          <YAxis />
          {/* Draw order is JSX order — toggle it off and on and the moving average stays above price */}
          {mode === "candle" ? (
            <ChartCandles name="Price" />
          ) : (
            <ChartLine name="Price" coordinates={ohlcCoordinates} />
          )}
          <PriceLine value={115} label="Target 115" />
          {indicators && (
            <ChartLine
              name="MA(20)"
              style={{ line: { color: MA_COLOR, width: 1.5 }, point: { radius: 0 } }}
              derive={movingAverage(MA_PERIOD)}
              deriveKey={[MA_PERIOD]}
            />
          )}
        </ChartPane>

        {indicators && (
          <ChartPane flex={1} minHeight={60}>
            <YAxis format={(v) => v.toFixed(1)} />
            <ChartLine
              style={{ line: { color: MOMENTUM_COLOR, width: 1.5 }, point: { radius: 0 } }}
              derive={momentum(MOM_PERIOD)}
              deriveKey={[MOM_PERIOD]}
            />
          </ChartPane>
        )}

        {volume && (
          <ChartPane flex={1} minHeight={50}>
            <YAxis format={(v) => `${(v / 1000).toFixed(1)}k`} />
            <ChartSeries
              series={histogramSeries({ style: VOLUME_STYLE })}
              derive={volumeBars}
              deriveKey={[]}
            />
          </ChartPane>
        )}
      </ChartContainer>

      <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.7 }}>
        The <b style={{ color: "#f59e0b" }}>moving average (20)</b> shares an
        axis with price, so it overlays the main pane;{" "}
        <b style={{ color: "#7c3aed" }}>momentum (10)</b> has a different
        magnitude, so it takes a pane of its own.
        <br />
        <b>Drag the divider between panes to change their heights.</b> Drag
        left to load history; use the wheel to zoom.
        <br />
        The data's x is a trading day, weekends removed — turn the{" "}
        <b>bar-index x axis</b> off and the continuous coordinate system opens
        the weekends up as gaps; turn it on and the bars butt together.
        <br />
        {loaded} bars loaded · {pages} follow-up requests
        {cursor?.pane
          ? ` · ${cursor.pane === plotRef.current?.mainPane ? "price" : "momentum"} pane · ${dateLabel(cursor.x)} · ${cursor.value?.toFixed(1)}`
          : " · outside the panes"}
      </p>
    </main>
  );
}
