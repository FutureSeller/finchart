"use client";

import type { HistogramPoint, HistoryStatus, OHLC, Pane, Plot, Source } from "@finchart/core";
import {
  AreaSeries,
  barIndexX,
  candleSeries,
  histogramSeries,
  LineSeries,
  LogScale,
  paneMaximize,
  priceFormat,
  sessionStart,
  OHLCAccessor,
  timeTicks,
} from "@finchart/core";
import {
  atrPriceStep,
  bandSeries,
  bollingerBands,
  macd,
  movingAverage,
  renko,
  rsi,
} from "@finchart/indicators";
import { browserDeps } from "@finchart/dom";
import { drawingTools, type DrawingToolsApi } from "@finchart/tools";
import {
  ChartCandles,
  ChartContainer,
  ChartLine,
  ChartPane,
  ChartSeries,
  Crosshair,
  InfiniteHistory,
  Plugin,
  type PlotOptions,
  PriceLine,
  Tooltip,
  useDataSource,
  useInfiniteHistory,
  usePluginState,
  XAxis,
  YAxis,
} from "@finchart/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type RealtimeTrade, useRealtimeTrades } from "../hooks/use-realtime-trades";
import {
  applyTrade,
  type CandleResponse,
  type Interval,
  marketTimeZone,
  intervalMs,
  mergeSnapshot,
  timeLabel,
  toBars,
} from "../lib/candles";

// Bar-index coordinates: one bar is one slot regardless of the x gap, so
// weekends, holidays and the overnight session never open up as blank space.
// Data keeps its ms x — only the spacing changes; timeTicks and the
// infiniteHistory cursor still speak in data x.
// The dashboard sits in a scrolling page: the wheel zooms only with a
// modifier key held, so scrolling past the chart still scrolls the page.
const DEPS = browserDeps({ autoSize: true, createXMapping: barIndexX, pointer: { wheel: "modifier" } });
const VOLUME = histogramSeries();
// rightOffset is in domain units — under barIndexX that is bar count,
// so this reads as "five bars of room" for every interval.
const LIVE_OPTIONS: PlotOptions = { shiftVisibleRangeOnNewBar: true, rightOffset: 5, preserveLiveRightEdgeOnZoomOut: true };
const VOLUME_FORMAT = priceFormat({ compact: true, locale: "en-US" });
const RSI_FORMAT = priceFormat({ precision: 0, locale: "en-US" });
const MACD_FORMAT = priceFormat({ precision: 2, locale: "en-US" });
/** Past this, a period is a typo — it's held back, not computed. */
const MAX_PERIOD = 1000;
const LOG_SCALE = () => new LogScale();
/** An oscillator reads 0–100 whatever the data does, so its 70/30 guides keep their meaning. */
const RSI_DOMAIN: readonly [number, number] = [0, 100];
const MACD_HISTOGRAM = histogramSeries();
const BOLL_BAND = bandSeries();
const OVERLAY_LINE = { point: { radius: 0 } };

// `tone` states the fact (this bar's candle went up) and leaves the colour
// to the theme — --chart-histogram-up/down in styles.css.
const volumeOf = (bar: OHLC): HistogramPoint => ({
  x: bar.x,
  y: bar.volume ?? null,
  tone: bar.close >= bar.open ? "up" : "down",
});

const OHLC_COORDINATES = new OHLCAccessor();

// One instance per representation — a new `series` on the same <ChartSeries>
// keeps the data and the derivation cache, so switching chart type is
// presentation only.
export type ChartKind = "candle" | "line" | "area";
const PRICE_SERIES: Record<ChartKind, ReturnType<typeof candleSeries> | LineSeries<OHLC> | AreaSeries<OHLC>> = {
  candle: candleSeries(),
  // The factories wire LineDataPoint; OHLC needs the accessor handed in.
  line: new LineSeries<OHLC>({ coordinates: OHLC_COORDINATES, style: { point: { radius: 0 } } }),
  area: new AreaSeries<OHLC>({ coordinates: OHLC_COORDINATES }),
};

export type IndicatorKey = "MA20" | "BOLL" | "RSI" | "MACD";
export const INDICATOR_KEYS: readonly IndicatorKey[] = ["MA20", "BOLL", "RSI", "MACD"];

/** MA and BOLL ride the price pane — one computation node each, read through `input`. */
function Overlays({ source, ma, maPeriod, boll }: { source: Source<OHLC>; ma: boolean; maPeriod: number; boll: boolean }) {
  // The reference is the identity: a period change rebuilds the MA node alone.
  // Built only while it's on — a period is the user's to type, and an MA nobody
  // shows must not cost what that period says.
  const maNode = useMemo(() => (ma ? movingAverage(source, { period: maPeriod }) : null), [ma, source, maPeriod]);
  const bollNode = useMemo(() => bollingerBands(source), [source]);
  return (
    <>
      {boll && (
        <>
          <ChartSeries series={BOLL_BAND} input={bollNode.out.band} name="BOLL" />
          <ChartLine input={bollNode.out.middle} readout={false} style={{ line: { color: "#8b5cf6", width: 1 }, ...OVERLAY_LINE }} />
        </>
      )}
      {maNode && <ChartLine name={`MA${maPeriod}`} input={maNode.out.ma} style={{ line: { color: "#3b82f6", width: 1.5 }, ...OVERLAY_LINE }} />}
    </>
  );
}

/**
 * RSI on its own pane, fixed at 0–100 with its 70/30 guides, and a toolbox
 * of its own. A period change swaps the line only — the pane, its place in
 * the stack, its drawings and its height stay.
 */
function RsiPane({ source, period, onTools }: { source: Source<OHLC>; period: number; onTools: (tools: DrawingToolsApi | null) => void }) {
  const node = useMemo(() => rsi(source, { period }), [source, period]);
  return (
    <ChartPane flex={0.35} minHeight={60} valueDomain={RSI_DOMAIN}>
      {/* 0–100, not a price — the chart-wide price format (won, or cents) doesn't apply. */}
      <YAxis format={RSI_FORMAT} />
      <ChartLine input={node.out.rsi} name={`RSI${period}`} style={{ line: { color: "#f59e0b", width: 1.5 }, ...OVERLAY_LINE }} />
      <PriceLine value={70} />
      <PriceLine value={30} />
      <Plugin install={drawingToolsOn} onApi={onTools} />
    </ChartPane>
  );
}

function MacdPane({ source }: { source: Source<OHLC> }) {
  const node = useMemo(() => macd(source), [source]);
  return (
    <ChartPane flex={0.35} minHeight={60}>
      <YAxis format={MACD_FORMAT} />
      <ChartSeries series={MACD_HISTOGRAM} input={node.out.histogram} name="MACD hist" />
      <ChartLine input={node.out.macd} name="MACD" style={{ line: { color: "#3b82f6", width: 1.5 }, ...OVERLAY_LINE }} />
      <ChartLine input={node.out.signal} name="Signal" style={{ line: { color: "#f97316", width: 1.5 }, ...OVERLAY_LINE }} />
    </ChartPane>
  );
}

const drawingToolsOn = (plot: Plot, pane: Pane) => pane.use(drawingTools({ plot }));

type DrawingLane = "price" | "rsi";
type DrawingSnapshot = { symbol: string; price: string | null; rsi: string | null };
type TimeWindow = { symbol: string; interval: Interval; min: number; max: number };

/** Keep a pane's completed drawings through a chart remount, before its tools are disposed. */
function drawingRecipient(
  store: { current: DrawingSnapshot },
  symbol: string,
  lane: DrawingLane,
  publish: (tools: DrawingToolsApi | null) => void,
): (tools: DrawingToolsApi | null) => void {
  let installed: DrawingToolsApi | null = null;

  return (tools) => {
    if (tools) {
      const saved = store.current.symbol === symbol ? store.current[lane] : null;
      if (saved) tools.load(saved);
      installed = tools;
      publish(tools);
      return;
    }

    // Plugin calls this before dispose. A late cleanup from the old chart
    // must not bring another symbol's lines back.
    if (installed && store.current.symbol === symbol) store.current[lane] = installed.serialize();
    installed = null;
    publish(null);
  };
}
const maximizeOn = (plot: Plot) => plot.use(paneMaximize({ gestures: true }));

export type BrickMode = "fixed" | "atr";

/**
 * Renko throws time away, so it can't share the time chart: its x is an
 * ordinal, and the axis wins the time back from each brick's `closedAt`.
 * It is drawn from the dashboard's bar state — the live bars, not the
 * pages the history loader prepended to the time chart's handle.
 */
/** A fixed brick in the quote currency's own units — 1,000 won, one dollar. */
export function fixedBrick(currency: string): number {
  return currency === "USD" ? 1 : 1000;
}

function RenkoView({ bars, mode, timeZone, currency, interval, formatPrice }: {
  bars: OHLC[];
  mode: BrickMode;
  timeZone: string;
  currency: string;
  interval: Interval;
  formatPrice: (value: number) => string;
}) {
  const fixed = fixedBrick(currency);
  const brickSize = mode === "fixed" ? fixed : bars.length >= 14 ? atrPriceStep(bars, { period: 14 }) : fixed;
  const bricks = useMemo(() => renko(bars, { brickSize }), [bars, brickSize]);
  // Minute bars close within a day — the time is what tells bricks apart.
  const label = useMemo(
    () => new Intl.DateTimeFormat("en-US", interval === "1m"
      ? { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { timeZone, month: "numeric", day: "numeric" }),
    [timeZone, interval],
  );
  const format = useCallback(
    (x: number) => {
      const brick = bricks[Math.round(x)];
      return brick ? label.format(brick.closedAt) : "";
    },
    [bricks, label],
  );
  return (
    <>
      <div className="renko-note">Bricks: {bricks.length.toLocaleString("en-US")} · size: {brickSize.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
      <ChartContainer deps={RENKO_DEPS} data={bricks} style={{ height: 480 }}>
        <XAxis format={format} />
        <YAxis position="right" format={formatPrice} />
        <Crosshair magnet />
        <ChartCandles name="Renko" />
      </ChartContainer>
    </>
  );
}

const RENKO_DEPS = browserDeps({ autoSize: true });

const HISTORY_LABEL: Record<HistoryStatus | "none", string> = {
  none: "No history",
  idle: "History idle",
  loading: "Loading history",
  done: "History complete",
  terminated: "History stopped (invalid data)",
  stopped: "History paused",
};

const subscribeMode = (tools: DrawingToolsApi, onChange: () => void) => tools.modeChanges.subscribe(onChange);
const readMode = (tools: DrawingToolsApi) => tools.mode();

/**
 * A period field that lets you type: the text is yours while you edit, and
 * only a whole number from 2 to MAX_PERIOD reaches the chart. Leaving the
 * field shows the period in effect again.
 */
function PeriodInput({ label, value, onCommit }: { label: string; value: number; onCommit: (period: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="period">
      {label}{" "}
      <input
        type="number"
        min={2}
        max={MAX_PERIOD}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const period = Number(event.target.value);
          if (Number.isInteger(period) && period >= 2 && period <= MAX_PERIOD) onCommit(period);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

export function MarketDashboard() {
  const [symbolInput, setSymbolInput] = useState("005930");
  const [symbol, setSymbol] = useState("005930");
  const [interval, setInterval] = useState<Interval>("1d");
  const [chartKind, setChartKind] = useState<ChartKind>("candle");
  const [indicators, setIndicators] = useState<ReadonlySet<IndicatorKey>>(new Set());
  const [result, setResult] = useState<CandleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyRequests, setHistoryRequests] = useState(0);
  /**
   * The bars and history's place in them: a load's snapshot, the pages
   * before it, every tick folded in, REST reconciliations. Toss pages by its
   * own token (`nextBefore`); a chart remount (the renko view and back)
   * resumes from it, and a page for an earlier load is dropped.
   */
  const history = useInfiniteHistory<OHLC, string>({ coordinates: OHLC_COORDINATES });
  const { data: bars, setData: setBars, reset: resetHistory } = history;
  const historyStatus: HistoryStatus | "none" = history.status ?? "none";
  const plotRef = useRef<Plot | null>(null);
  /** The chart's own element — a toolbar button takes focus, so drawing hands it back for Esc and Delete. */
  const chartElement = useRef<HTMLDivElement | null>(null);
  const draw = (tools: DrawingToolsApi | null, kind: "trend" | "fib") => {
    tools?.begin(kind);
    chartElement.current?.focus();
  };
  const [jumpDate, setJumpDate] = useState("");
  const [log, setLog] = useState(false);
  const [periods, setPeriods] = useState({ ma: 20, rsi: 14 });
  const [renkoMode, setRenkoMode] = useState<BrickMode | null>(null);
  const [priceTools, setPriceTools] = useState<DrawingToolsApi | null>(null);
  const [rsiTools, setRsiTools] = useState<DrawingToolsApi | null>(null);
  // These records outlive the conditional time chart, but a new symbol starts empty.
  const drawings = useRef<DrawingSnapshot>({ symbol, price: null, rsi: null });
  const timeWindow = useRef<TimeWindow | null>(null);
  const restoreFrame = useRef<number | null>(null);
  const mountedSymbol = result?.symbol ?? symbol;
  const liveInterval = result?.interval ?? interval;
  const restoreTimeWindow = useCallback(() => {
    if (!timeWindow.current || restoreFrame.current !== null) return;
    // The first x change means a series has supplied data. Let the rest of
    // this mount's pane/series effects settle before replacing their fit.
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = null;
      const saved = timeWindow.current;
      const plot = plotRef.current;
      if (!saved || !plot) return;
      timeWindow.current = null;
      if (saved.symbol === mountedSymbol && saved.interval === liveInterval) {
        plot.setVisibleRange(saved.min, saved.max);
      }
    });
  }, [mountedSymbol, liveInterval]);
  const onPriceTools = useMemo(
    () => drawingRecipient(drawings, mountedSymbol, "price", setPriceTools),
    [mountedSymbol, result?.interval],
  );
  const onRsiTools = useMemo(
    () => drawingRecipient(drawings, mountedSymbol, "rsi", setRsiTools),
    [mountedSymbol, result?.interval],
  );
  const priceMode = usePluginState(priceTools, subscribeMode, readMode, null);
  const rsiMode = usePluginState(rsiTools, subscribeMode, readMode, null);
  const drawMode = [priceTools && `Price:${priceMode ?? "—"}`, rsiTools && `RSI:${rsiMode ?? "—"}`].filter(Boolean).join(" ") || "—";
  const realtimeSymbol = result?.source === "toss" ? result.symbol : null;
  const onTrade = useCallback(
    (trade: RealtimeTrade) => {
      setBars((current) => applyTrade(current, trade.tick, liveInterval));
    },
    [liveInterval],
  );
  const { latest: realtimeTrade, status: realtime } = useRealtimeTrades(realtimeSymbol, onTrade);
  /** Bumped by every load — a REST refresh answers only for the load it was asked under. */
  const loadGeneration = useRef(0);
  /** Data the chart refused — it keeps drawing its last good bars, and the reason shows here. */
  const [refused, setRefused] = useState<string | null>(null);
  const onRefused = useCallback((error: Error) => setRefused(error.message), []);
  // One stable Source over the live bars — every indicator reads it, history pages included.
  const source = useDataSource(bars);
  const volume = useMemo(() => bars.map(volumeOf), [bars]);

  const load = useCallback(async (
    nextSymbol: string,
    nextInterval: Interval,
    signal: AbortSignal,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ symbol: nextSymbol, interval: nextInterval });
      const response = await fetch(`/api/candles?${query}`, { signal });
      const payload = (await response.json()) as CandleResponse | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Request failed");
      if (signal.aborted) return;
      const loaded = toBars(payload.candles, nextInterval);
      setResult(payload);
      loadGeneration.current += 1;
      setHistoryRequests(0);
      // The fetch comes with the load — it pages this symbol and interval, whatever renders next.
      resetHistory(loaded, {
        next: payload.nextBefore,
        fetchPage: async (before) => {
          setHistoryRequests((count) => count + 1);
          const query = new URLSearchParams({ symbol: payload.symbol, interval: nextInterval, before });
          const response = await fetch(`/api/candles?${query}`);
          const page = (await response.json()) as CandleResponse | { error: string };
          if (!response.ok || "error" in page) {
            throw new Error("error" in page ? page.error : "History request failed");
          }
          return { bars: toBars(page.candles, nextInterval), next: page.nextBefore };
        },
      });
    } catch (cause) {
      if (signal.aborted) return;
      // The previous symbol's bars, price and live feed must not go on under
      // the name that just failed — the load is over, and so is that data.
      loadGeneration.current += 1;
      setResult(null);
      resetHistory([], null);
      setError(cause instanceof Error ? cause.message : "Could not load candles.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [resetHistory]);

  useEffect(() => {
    const controller = new AbortController();
    void load(symbol, interval, controller.signal);
    return () => controller.abort();
  }, [interval, load, symbol]);

  useEffect(() => {
    if (!result || result.source !== "toss") return;
    // A refresh answers for the load it was asked for. One that lands after
    // a symbol or interval switch — the new bars already in place, this
    // effect not yet torn down — would merge the old series into the new.
    const controller = new AbortController();
    const generation = loadGeneration.current;
    const refresh = async () => {
      try {
        const query = new URLSearchParams({ symbol: result.symbol, interval: result.interval });
        const response = await fetch(`/api/candles?${query}`, { signal: controller.signal });
        const payload = (await response.json()) as CandleResponse | { error: string };
        if (controller.signal.aborted || loadGeneration.current !== generation) return;
        if (response.ok && !("error" in payload)) {
          const fresh = toBars(payload.candles, result.interval);
          setBars((current) => mergeSnapshot(current, fresh));
        }
      } catch {
        // The WebSocket remains authoritative between successful REST reconciliations.
      }
    };
    const refreshTimer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearInterval(refreshTimer);
      controller.abort();
    };
  }, [result?.interval, result?.source, result?.symbol, setBars]);

  const currentTrade =
    realtimeTrade && realtimeTrade.symbol === result?.symbol ? realtimeTrade : null;
  const last = bars.at(-1);
  const previous = bars.at(-2);
  const displayedPrice = last?.close;
  const change =
    displayedPrice !== undefined && previous
      ? ((displayedPrice - previous.close) / previous.close) * 100
      : 0;
  const currency = result?.candles[0]?.currency ?? "KRW";
  const timeZone = marketTimeZone(currency);
  const ticks = useMemo(() => timeTicks({ timeZone, locale: "en-US" }), [timeZone]);
  const formatX = useMemo(() => timeLabel(liveInterval, timeZone), [liveInterval, timeZone]);
  // Won has no minor unit on the exchange; dollars quote to the cent.
  const formatPrice = useMemo(
    () => (currency === "USD" ? priceFormat({ precision: 2, locale: "en-US" }) : priceFormat({ precision: 0, locale: "en-US" })),
    [currency],
  );

  /** Shows the 30 bars that start at a date — older than what's loaded, the loader has to fill the gap. */
  function jump(event: FormEvent) {
    event.preventDefault();
    const plot = plotRef.current;
    // A calendar date in the market's zone, as an instant: noon UTC of that
    // date falls on the same date in Seoul and New York, and the session's
    // start snaps it to that day's midnight there (a fixed offset would be an
    // hour off in New York summer time).
    const noon = Date.parse(`${jumpDate}T12:00:00Z`);
    const at = Number.isFinite(noon) ? sessionStart({ timeZone })(noon) : Number.NaN;
    if (!plot || !Number.isFinite(at)) return;
    const span = intervalMs(liveInterval) * 30;
    setHistoryRequests(0);
    plot.setVisibleRange(at, at + span);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = symbolInput.trim().toUpperCase();
    if (next && next !== symbol) {
      drawings.current = { symbol: next, price: null, rsi: null };
      timeWindow.current = null;
      setSymbol(next);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">F</span> finchart · Toss demo</div>
        <a href="https://developers.tossinvest.com/docs" target="_blank" rel="noreferrer">Toss Open API documentation ↗</a>
      </header>

      <section className="hero">
        <p className="eyebrow">NEXT.JS · TOSS SECURITIES OPEN API</p>
        <h1>Market data,<br />interactive charts.</h1>
        <p className="lede">Explore synthetic candles or connect Toss market data through the server.</p>
      </section>

      <section className="terminal">
        <div className="terminal-head">
          <form onSubmit={submit}>
            <label>
              <span>Symbol</span>
              <input value={symbolInput} onChange={(event) => setSymbolInput(event.target.value)} aria-label="Symbol" />
            </label>
            <button type="submit">Load</button>
          </form>
          <div className="controls">
            <div className="intervals" aria-label="Candle interval">
              {(["1d", "1m"] as const).map((value) => (
                <button key={value} className={interval === value ? "active" : ""} onClick={() => {
                  if (value !== interval) timeWindow.current = null;
                  setInterval(value);
                }}>
                  {value === "1d" ? "Daily" : "1 minute"}
                </button>
              ))}
            </div>
            <div className="intervals" aria-label="Chart type">
              {(["candle", "line", "area"] as const).map((value) => (
                <button key={value} className={chartKind === value ? "active" : ""} onClick={() => setChartKind(value)}>
                  {value === "candle" ? "Candles" : value === "line" ? "Line" : "Area"}
                </button>
              ))}
            </div>
            <div className="intervals" role="group" aria-label="Drawing tools">
              <button onClick={() => draw(priceTools, "trend")}>Trend line</button>
              <button onClick={() => draw(priceTools, "fib")}>Fibonacci</button>
              <button disabled={!rsiTools} onClick={() => draw(rsiTools, "trend")}>RSI trend line</button>
              <span className="draw-mode">{drawMode}</span>
            </div>
            <div className="intervals" role="group" aria-label="Renko">
              {(["fixed", "atr"] as const).map((mode) => (
                <button key={mode} className={renkoMode === mode ? "active" : ""} aria-pressed={renkoMode === mode} onClick={() => {
                  if (!renkoMode) {
                    const range = plotRef.current?.getVisibleRange();
                    timeWindow.current = range ? { symbol: mountedSymbol, interval: liveInterval, ...range } : null;
                  }
                  setRenkoMode((current) => (current === mode ? null : mode));
                }}>
                  {mode === "fixed" ? `Renko ${fixedBrick(currency).toLocaleString("en-US")}` : "Renko ATR"}
                </button>
              ))}
            </div>
            <PeriodInput label="MA" value={periods.ma} onCommit={(ma) => setPeriods((current) => ({ ...current, ma }))} />
            <PeriodInput label="RSI" value={periods.rsi} onCommit={(rsi) => setPeriods((current) => ({ ...current, rsi }))} />
            <div className="intervals" role="group" aria-label="View">
              <button className={log ? "active" : ""} aria-pressed={log} onClick={() => setLog((value) => !value)}>Log</button>
            </div>
            <div className="intervals" role="group" aria-label="Indicators">
              {INDICATOR_KEYS.map((key) => (
                <button
                  key={key}
                  className={indicators.has(key) ? "active" : ""}
                  aria-pressed={indicators.has(key)}
                  onClick={() =>
                    setIndicators((current) => {
                      const next = new Set(current);
                      if (!next.delete(key)) next.add(key);
                      return next;
                    })
                  }
                >
                  {key === "MA20" ? `MA${periods.ma}` : key}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="quote-row">
          <div>
            <span className="symbol">{symbol}</span>
            {result && <span className={`source ${result.source}`}>{result.source === "toss" ? "LIVE API" : "DEMO DATA"}</span>}
            {result?.source === "toss" && <span className={`realtime ${realtime}`}>● {realtime}</span>}
            <span className={`history history-${historyStatus}`}>{HISTORY_LABEL[historyStatus]} · requests: {historyRequests}</span>
            {refused && <span className="history history-terminated" title={refused}>Data rejected</span>}
            <form className="jump" onSubmit={jump}>
              <input value={jumpDate} onChange={(event) => setJumpDate(event.target.value)} placeholder="YYYY-MM-DD" aria-label="Jump date" />
              <button type="submit">Jump to date</button>
            </form>
          </div>
          {displayedPrice !== undefined && (
            <div className="price">
              <strong>{new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(displayedPrice)}</strong>
              <span>{currency}</span>
              <em className={change >= 0 ? "up" : "down"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</em>
              {currentTrade && (
                <small>{new Date(currentTrade.tick.timestamp).toLocaleTimeString("en-US")}</small>
              )}
            </div>
          )}
        </div>

        <div className="chart-shell" aria-busy={loading}>
          {error ? <div className="state error">{error}</div> : renkoMode && bars.length > 0 ? (
            <RenkoView bars={bars} mode={renkoMode} timeZone={timeZone} currency={currency} interval={liveInterval} formatPrice={formatPrice} />
          ) : bars.length > 0 ? (
            <ChartContainer
              key={`${result?.symbol}-${result?.interval}`}
              deps={DEPS}
              data={bars}
              options={LIVE_OPTIONS}
              onError={onRefused}
              plotRef={plotRef}
              onXDomainChange={restoreTimeWindow}
              containerRef={chartElement}
              style={{ height: 520 }}
            >
              <XAxis ticks={ticks} format={formatX} />
              <YAxis position="right" format={formatPrice} />
              <Crosshair magnet />
              <Tooltip formatX={formatX} />
              <InfiniteHistory history={history} />
              {/* Outside any <ChartPane>, so the price toolbox lands on mainPane. */}
              <Plugin install={drawingToolsOn} onApi={onPriceTools} />
              <Plugin install={maximizeOn} />

              {/* The first pane is mainPane; the log toggle swaps its scale in place. */}
              <ChartPane flex={3} yScale={log ? LOG_SCALE : undefined}>
                <ChartSeries series={PRICE_SERIES[chartKind]} name={result?.symbol ?? symbol} />
                <Overlays source={source} ma={indicators.has("MA20")} maPeriod={periods.ma} boll={indicators.has("BOLL")} />
              </ChartPane>
              <ChartPane flex={1} minHeight={72}>
                {/* The price format on the outer <YAxis> is the chart-wide default; volume reads short. */}
                <YAxis format={VOLUME_FORMAT} />
                <ChartSeries series={VOLUME} data={volume} name="Volume" />
              </ChartPane>

              {/* Own-pane indicators go last, below volume. */}
              {indicators.has("RSI") && <RsiPane source={source} period={periods.rsi} onTools={onRsiTools} />}
              {indicators.has("MACD") && <MacdPane source={source} />}
            </ChartContainer>
          ) : <div className="state">Loading candles.</div>}
          {loading && bars.length > 0 && <div className="loading">Updating…</div>}
        </div>
      </section>

      <footer>
        <span>Market data only</span><span>Synthetic data by default</span><span>Drawings stay in this page</span>
      </footer>
    </main>
  );
}
