/**
 * A chart instance — all four slots are one of these.
 *
 * The assembly (chart, series, panes, plugins, drawings, feed playback) lives
 * here. `main` creates and removes slots and connects the header controls to
 * the **focused instance**. Settings (timeframe, type, indicators) go through
 * instance methods — the coupling between a control and a chart is cut at this
 * boundary.
 */
import type { OHLC, Plot, PluginApi, Series, SeriesHandle } from "@finchart/core";
import {
  AreaSeries,
  LineSeries,
  OHLCAccessor,
  barIndexX,
  barSeries,
  candleSeries,
  crosshair,
  paneMaximize,
  priceLine,
  sessionStart,
  timeTicks,
  type HistogramPoint,
  watermark,
} from "@finchart/core";
import { histogramSeries } from "@finchart/core";
import { browserDeps, legend, PlotBuilder, tooltip } from "@finchart/dom";
import {
  attachBollingerBands,
  attachMacd,
  attachMovingAverage,
  attachRsi,
  attachVwap,
  periodAnchor,
} from "@finchart/indicators";
import { drawingTools, type DrawingToolsApi } from "@finchart/tools";
import { createFeed } from "./feed";
import { timeLabel, won, wonDetail } from "./format";

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

export type IndicatorKey = "MA20" | "BOLL" | "RSI" | "MACD" | "VWAP";
export const INDICATOR_KEYS: readonly IndicatorKey[] = [
  "MA20",
  "BOLL",
  "RSI",
  "MACD",
  "VWAP",
];

const volumeOf = (bar: OHLC): HistogramPoint => ({
  x: bar.x,
  y: bar.volume ?? null,
  tone: bar.close >= bar.open ? "up" : "down",
});

export interface ChartInstance {
  readonly spec: ChartSpec;
  readonly plot: Plot;
  readonly tools: DrawingToolsApi;
  readonly host: HTMLElement;
  /**
   * **The element keys actually reach** — the one passed to `build()`.
   *
   * It is not `host` (the cell). `@finchart/dom` hangs the key listeners and
   * `tabindex` on **the element `build()` received** (`pointer.ts`), and that
   * is a **child** of the cell. Keys only bubble upward, so focusing the cell
   * means they **never** reach the listeners.
   *
   * Turning a tool on from a toolbar or rail button moves focus to that
   * button, so the app has to hand focus back to this element for Esc and
   * Delete to stay alive.
   */
  readonly keyboardHost: HTMLElement;

  timeframe(): number;
  setTimeframe(next: number): void;
  chartType(): ChartType;
  setChartType(next: ChartType): void;
  indicators(): ReadonlySet<IndicatorKey>;
  toggleIndicator(key: IndicatorKey): void;

  /** What the header paints from — `main` reads it when this chart has focus. */
  lastBar(): OHLC | null;
  hoverBar(): OHLC | null;
  barCount(): number;
  referenceClose(): number;
  /** On every tick and crosshair move — the focused chart's subscriber (the header) listens. */
  subscribe(listener: () => void): () => void;

  /**
   * **Only when a bar closes** — this is when the status bar's bar count goes
   * up.
   *
   * It is kept apart from `subscribe` because the rates differ. That one
   * follows the crosshair and fires dozens of times a second, while the status
   * bar changes once a minute. Merge them into one channel and the header
   * rewrites `textContent` on every hover, painting over whatever message
   * `flashStatus` had put up.
   *
   * Without this signal the vanilla status bar's bar count was **frozen at
   * load time** — the feed kept announcing `minuteClosed` (`feed.ts`) with
   * nobody listening, and `refreshStatus` was only called on a focus change or
   * a timeframe button. The React demo reads `snapshot.barCount` and
   * updates every tick, so **the same screen looked different in the two
   * apps.**
   */
  onBarClose(listener: () => void): () => void;

  destroy(): void;
}

/** Builds the cell DOM (caption + host), attaches it to `#charts`, and stands the instance up. */
export function makeChart(
  spec: ChartSpec,
  chartsEl: HTMLElement,
  onFocus: () => void,
  /** When the picker chooses another symbol — the swap (a remount) is `main`'s job. */
  onSymbol: (symbol: string) => void,
): ChartInstance {
  const host = document.createElement("div");
  host.className = "chart-cell";
  const picker = document.createElement("select");
  picker.className = "chart-symbol";
  picker.setAttribute("aria-label", "Symbol");
  for (const entry of SYMBOLS) {
    const option = document.createElement("option");
    option.value = entry.symbol;
    option.textContent = entry.symbol;
    picker.appendChild(option);
  }
  picker.value = spec.symbol;
  picker.addEventListener("change", () => onSymbol(picker.value));
  const chartHost = document.createElement("div");
  chartHost.className = "chart-host";
  host.append(picker, chartHost);
  chartsEl.appendChild(host);
  // An observe-only capture — it doesn't fight the chart's own gestures.
  host.addEventListener("pointerdown", onFocus, { capture: true });
  // Reachable by keyboard too — Tab onto a cell and that chart takes focus.
  host.tabIndex = 0;
  host.addEventListener("focus", onFocus);

  const feed = createFeed({ seed: spec.seed, anchor: spec.anchor });

  const plot: Plot = PlotBuilder.create<OHLC>(
    browserDeps({
      autoSize: true,
      createXMapping: barIndexX,
      pointer: { kineticScroll: true },
    }),
  )
    .setSize(chartHost.clientWidth || 600, chartHost.clientHeight || 400)
    .setAxis({
      // `format` is the default wording for badges and the ghost cursor, not
      // the ticks — the axis has to own the wording for syncCrosshair's badges
      // to speak in time.
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }), format: timeLabel },
      y: { position: "right", format: won },
    })
    .build(chartHost);

  // Every chart may follow — the core's live-target clamp stops a sync group
  // from advancing twice.
  plot.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 5 });

  const chartTypes: Record<ChartType, Series<OHLC>> = {
    candle: candleSeries(),
    bar: barSeries(),
    line: new LineSeries<OHLC>({ coordinates: new OHLCAccessor() }),
    area: new AreaSeries<OHLC>({ coordinates: new OHLCAccessor() }),
  };
  let currentType: ChartType = "candle";

  const price: SeriesHandle<OHLC> = plot.mainPane.addSeries({
    series: chartTypes.candle,
    data: feed.bars(),
    name: "Price",
  });
  const volumePane = plot.addPane({ flex: 0.22, minHeight: 48 });
  const volume: SeriesHandle<HistogramPoint> = volumePane.addSeries({
    // The volume pane recedes under price — its own translucent pair on the series (a variable is chart-wide).
    series: histogramSeries({ style: { up: "rgba(38, 166, 154, 0.5)", down: "rgba(239, 83, 80, 0.5)" } }),
    data: feed.bars().map(volumeOf),
    name: "Volume",
  });

  plot.addDecoration(watermark({ text: spec.symbol }));
  plot.use(crosshair({ magnet: true, format: { x: timeLabel, y: wonDetail } }));
  plot.use(tooltip({ formatX: timeLabel, formatValue: wonDetail }));
  plot.use(legend({ formatValue: wonDetail }));
  plot.use(paneMaximize({ gestures: true }));

  const tools: DrawingToolsApi = plot.mainPane.use(drawingTools({ plot }));

  // --- Drawings belong to the symbol — a localStorage round trip ---
  // Retain the shared persistence key so renaming the demo preserves saved drawings.
  const drawingsKey = `charts-showcase-drawings:${spec.symbol}`;
  const savedDrawings = localStorage.getItem(drawingsKey);
  if (savedDrawings && !tools.load(savedDrawings)) {
    // A saved copy we can't read is quarantined — the first edit must not overwrite somebody's original.
    localStorage.setItem(`${drawingsKey}:broken`, savedDrawings);
    localStorage.removeItem(drawingsKey);
  }
  const saveDrawings = () =>
    localStorage.setItem(drawingsKey, tools.serialize());
  let saveTimer: number | undefined;
  tools.changes.subscribe(({ reason }) => {
    // `load` and `clear` are echoes — turning them back into a save overwrites the original.
    if (reason === "load" || reason === "clear") return;
    if (reason !== "move") {
      saveDrawings();
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDrawings, 200);
  });
  window.addEventListener("beforeunload", saveDrawings);

  // --- The last-price line — it follows the ticks ---
  let removePriceLine: (() => void) | null = null;
  const movePriceLine = (value: number): void => {
    removePriceLine?.();
    removePriceLine = plot.mainPane.addDecoration(
      priceLine({ value, format: wonDetail, style: { dashArray: "2 3" } }),
    );
  };

  // --- What the header paints from, and its subscriptions ---
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const barClosed = new Set<() => void>();
  let hover: OHLC | null = null;

  // The core hands over the position (`probe`'s `index`) — search by hand and
  // the rule diverges from the core's "nearest point", so the tooltip and the
  // header name different bars.
  plot.on("crosshair", (payload) => {
    // `null` is the cursor leaving — the header lets go of the hovered bar
    // then, or it would keep showing a value from before the pointer left.
    const [sample] = payload?.pane?.probe(payload.x) ?? [];
    hover = sample ? (price.read()[sample.index] ?? null) : null;
    notify();
  });

  // --- Live — the bar in progress ---
  const stopFeed = feed.play((current, minuteClosed) => {
    price.updateLast(current);
    volume.updateLast(volumeOf(current));
    movePriceLine(current.close);
    notify();
    // A bar closed — the count went up, so the status bar is stale.
    if (minuteClosed) for (const listener of barClosed) listener();
  });

  const first = price.read().at(-1);
  if (first) movePriceLine(first.close);

  // --- Indicator toggles — the instance mounts them on its own chart ---
  const installed = new Map<IndicatorKey, PluginApi>();
  const indicatorOf: Record<IndicatorKey, () => PluginApi> = {
    MA20: () =>
      plot.mainPane.use(
        attachMovingAverage({ source: price, period: 20, color: "#f59e0b" }),
      ),
    BOLL: () => plot.mainPane.use(attachBollingerBands({ source: price, period: 20 })),
    RSI: () => plot.use(attachRsi({ source: price })),
    MACD: () => plot.use(attachMacd({ source: price })),
    VWAP: () =>
      plot.mainPane.use(
        attachVwap({
          source: price,
          color: "#0ea5e9",
          // Where a session begins is the consumer's knowledge — this tape starts a new day at UTC midnight.
          anchor: periodAnchor({ barStart: sessionStart({ timeZone: "UTC" }) }),
        }),
      ),
  };

  return {
    spec,
    plot,
    tools,
    host,
    keyboardHost: chartHost,

    timeframe: () => feed.timeframe(),
    setTimeframe(next) {
      feed.setTimeframe(next);
      // With the imperative `setData`, the new bars and the refit are one
      // call — there is no window in which a bar-index range can be pinned
      // over stale data (that trap belongs to the declarative path).
      price.setData(feed.bars());
      volume.setData(feed.bars().map(volumeOf));
      notify();
    },

    chartType: () => currentType,
    setChartType(next) {
      currentType = next;
      price.swapSeries(chartTypes[next]);
    },

    indicators: () => new Set(installed.keys()),
    toggleIndicator(key) {
      const active = installed.get(key);
      if (active) {
        active.dispose();
        installed.delete(key);
        return;
      }
      installed.set(key, indicatorOf[key]());
    },

    lastBar: () => price.read().at(-1) ?? null,
    hoverBar: () => hover,
    barCount: () => price.read().length,
    referenceClose: () => feed.referenceClose(),
    onBarClose(listener) {
      barClosed.add(listener);
      return () => barClosed.delete(listener);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      stopFeed();
      clearTimeout(saveTimer);
      saveDrawings();
      window.removeEventListener("beforeunload", saveDrawings);
      plot.destroy();
      host.remove();
    },
  };
}
