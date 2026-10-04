/**
 * Dogfooding — a typical trading screen built with nothing but the core's
 * imperative API.
 *
 * The goal is collecting friction, not demoing: live ticks, switching symbol
 * and timeframe, a dark theme, indicator toggles (@finchart/indicators),
 * persisted drawings (@finchart/tools + localStorage), a screenshot. One
 * screen crosses nearly the whole surface of the library.
 */
import { browserDeps, PlotBuilder } from "@finchart/dom";
import "./theme.css";
import { BELOW_SERIES, barIndexX, candleSeries, crosshair, priceFormat, priceLine, sessionStart, timeTicks, type OHLC, type Plot, type PluginApi, type SeriesHandle, watermark } from "@finchart/core";
import { dataTable, legend, tooltip } from "@finchart/dom";
import {
  attachBollingerBands,
  attachIchimoku,
  attachMacd,
  attachMovingAverage,
  attachRsi,
  attachVwap,
  periodAnchor,
} from "@finchart/indicators";
import { drawingTools, type DrawingToolsApi } from "@finchart/tools";
import { sessionShading, shadingRenderer } from "./session-shading";

const MINUTE = 60_000;
const BASE = Date.UTC(2026, 7, 7, 9, 0); // 2026-08-07 09:00 UTC

// --- Fake quotes — a random walk of 1-minute bars, seeded per symbol ---

const SYMBOLS = ["BTC/KRW", "ETH/KRW", "SOL/KRW"] as const;
type Symbol = (typeof SYMBOLS)[number];

const SEED: Record<Symbol, { base: number; wave: number }> = {
  "BTC/KRW": { base: 104_500_000, wave: 900_000 },
  "ETH/KRW": { base: 5_400_000, wave: 60_000 },
  "SOL/KRW": { base: 240_000, wave: 4_000 },
};

function candleAt(symbol: Symbol, minute: number): OHLC {
  const { base, wave } = SEED[symbol];
  const drift =
    Math.sin(minute / 37) * 2.1 + Math.cos(minute / 11) * 0.8 + Math.sin(minute / 271) * 3;
  const open = base + drift * wave;
  const close = open + Math.sin(minute * 1.7) * wave * 0.4;
  const spread = Math.abs(Math.cos(minute * 0.9)) * wave * 0.3 + wave * 0.05;

  return {
    x: BASE + minute * MINUTE,
    open,
    close,
    high: Math.max(open, close) + spread,
    low: Math.min(open, close) - spread,
    volume: Math.round(50 + Math.abs(Math.sin(minute * 0.7)) * 250),
  };
}

const HISTORY = 60 * 24 * 2; // two days of 1-minute bars

function minutesOf(symbol: Symbol, upTo: number): OHLC[] {
  return Array.from({ length: upTo }, (_, i) => candleAt(symbol, i));
}

/** 1-minute bars → n-minute bars. The material for switching timeframe. */
function aggregate(minutes: OHLC[], n: number): OHLC[] {
  if (n === 1) return minutes;

  const out: OHLC[] = [];
  for (let i = 0; i < minutes.length; i += n) {
    const bucket = minutes.slice(i, i + n);
    out.push({
      x: bucket[0].x,
      open: bucket[0].open,
      close: bucket[bucket.length - 1].close,
      high: Math.max(...bucket.map((c) => c.high)),
      low: Math.min(...bucket.map((c) => c.low)),
      volume: bucket.reduce((sum, c) => sum + (c.volume ?? 0), 0),
    });
  }
  return out;
}

// --- The stage ---

const chartHost = document.getElementById("chart")!;
const toolbar = document.getElementById("toolbar")!;
const status = document.getElementById("status")!;

const won = priceFormat({ compact: true, locale: "en-US" });
/**
 * The same format, but handed a tick spacing — `priceFormat` uses the spacing
 * to widen the significant digits. The axis passes its own spacing in; badges
 * and tooltips are ours to pass. Skip it and the last-price badge collapses to
 * "100M" — 102M and 109M print the same characters, which defeats the whole
 * reason a price line shows a value.
 */
const wonDetail = (value: number) => won(value, 10_000);
const timeLabel = (x: number) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(x);

const plot: Plot = PlotBuilder.create<OHLC>(
  browserDeps({
    autoSize: true,
    createXMapping: barIndexX,
    // A renderer that knows the extension's drawing primitive — zero core changes (see session-shading.ts)
    createRenderer: shadingRenderer,
  }),
)
  .setSize(chartHost.clientWidth || 900, 520)
  .setAxis({
    x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
    y: { position: "right", format: won },
  })
  .build(chartHost);

plot.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 5 });

// After-hours as a gradient band — a picture `fill: string` can't describe.
plot.addDecoration(sessionShading({ fromHour: 0, toHour: 8 }), {
  zIndex: BELOW_SERIES,
});

plot.use(crosshair({ magnet: true, format: { x: timeLabel, y: won } }));
// A candle describes its own rows (O/H/L/C/V); the volume is not a price, so it gets its own notation.
const volume = new Intl.NumberFormat("en-US", { notation: "compact" });
const formatRow = (value: number, row: { label: string }) => (row.label === "V" ? volume.format(value) : won(value));
plot.use(tooltip({ formatX: timeLabel, formatValue: won, formatRow }));
plot.use(legend({ formatValue: won, formatRow }));

// --- State: symbol, timeframe, data ---

let symbol: Symbol = "BTC/KRW";
let timeframe = 5;
let clock = HISTORY; // the next minute

let minutes = minutesOf(symbol, clock);
const price: SeriesHandle<OHLC> = plot.mainPane.addSeries({
  series: candleSeries(),
  data: aggregate(minutes, timeframe),
  name: "Price",
});
plot.use(dataTable({
  target: document.getElementById("chart-data")!,
  caption: () => `${symbol} ${timeframe}-minute candles`,
  rows: () => price.read(),
  columns: [
    { heading: "Time (UTC)", text: (bar) => timeLabel(bar.x) },
    { heading: "Open", text: (bar) => won(bar.open) },
    { heading: "High", text: (bar) => won(bar.high) },
    { heading: "Low", text: (bar) => won(bar.low) },
    { heading: "Close", text: (bar) => won(bar.close) },
    { heading: "Volume", text: (bar) => volume.format(bar.volume ?? 0) },
  ],
}));

// Friction note: a watermark is a decoration, so it goes through
// addDecoration, not use — and it comes off through the returned function, not
// dispose. The vocabulary forks in two.
let removeMark = plot.addDecoration(watermark({ text: symbol }));

/**
 * The last-price line — it follows the ticks. `priceLine` is a static
 * decoration that takes its value once, so following the last price means the
 * consumer takes it off and puts it back on every tick. lightweight-charts
 * doesn't need this wiring, since `lastValueVisible` is on by default — and
 * yet this code is cheap: addDecoration and its removal both notify
 * `{ data: false }`, so neither goes near an x rebuild.
 */
let removePriceLine: (() => void) | null = null;
function movePriceLine(value: number): void {
  removePriceLine?.();
  removePriceLine = plot.mainPane.addDecoration(
    priceLine({ value, format: wonDetail, style: { dashArray: "2 3" } }),
  );
}

// It has to be there on the first paint too — otherwise there's no line until the first tick.
movePriceLine(price.read()[price.read().length - 1].close);

function switchSymbol(next: Symbol): void {
  saveDrawings();
  symbol = next;
  chartHost.setAttribute("aria-label", `${symbol} ${timeframe}-minute candlestick chart`);
  minutes = minutesOf(symbol, clock);
  const bars = aggregate(minutes, timeframe);
  price.setData(bars);
  // A new symbol means a whole different price range — an old line is somebody else's price.
  movePriceLine(bars[bars.length - 1].close);
  // The watermark's text is an option, so changing it means reinstalling it.
  removeMark();
  removeMark = plot.addDecoration(watermark({ text: symbol }));
  loadDrawings();
  refreshStatus();
}

function switchTimeframe(next: number): void {
  timeframe = next;
  chartHost.setAttribute("aria-label", `${symbol} ${timeframe}-minute candlestick chart`);
  const bars = aggregate(minutes, timeframe);
  price.setData(bars);
  movePriceLine(bars[bars.length - 1].close);
  refreshStatus();
}

// --- Live ticks — replace the bar in progress; a closed bar opens a new one ---

setInterval(() => {
  const tick = candleAt(symbol, clock);
  const bucketStart = Math.floor(clock / timeframe) * timeframe;
  const bars = aggregate(minutes.slice(bucketStart), timeframe);

  minutes = [...minutes, tick];
  const merged = aggregate(minutes.slice(bucketStart), timeframe);
  const last = merged[merged.length - 1];
  price.updateLast(last);
  movePriceLine(last.close);
  if (merged.length > bars.length) {
    // A new bucket opened — settle the previous one once more at its final value.
  }
  clock += 1;
  refreshStatus();
}, 400);

// --- Indicator toggles (@finchart/indicators) ---

const installed = new Map<string, PluginApi>();

function toggleIndicator(name: string, make: () => PluginApi): boolean {
  const active = installed.get(name);
  if (active) {
    active.dispose();
    installed.delete(name);
    return false;
  }
  installed.set(name, make());
  return true;
}

// --- Drawings (@finchart/tools) — localStorage per symbol ---

const tools: DrawingToolsApi = plot.mainPane.use(drawingTools({ plot }));

function storageKey(): string {
  return `charts-dogfood-drawings:${symbol}`;
}
function saveDrawings(): void {
  localStorage.setItem(storageKey(), tools.serialize());
}
/**
 * Read first. Swap the order and whatever you drew disappears the moment you
 * leave a symbol and come back. `clear()` emits `changes` even when the list is
 * already empty, and that subscriber calls `saveDrawings()` right away. Clear
 * first and you get: clear() → changes → the new symbol's saved copy is
 * overwritten with an empty one → getItem() reads that empty copy → load ends
 * with zero drawings.
 *
 * `load` already replaces the list, so `clear` is only needed when there is no
 * saved copy at all.
 */
function loadDrawings(): void {
  const saved = localStorage.getItem(storageKey());
  if (saved && tools.load(saved)) return;
  if (saved) {
    /**
     * A saved copy we can't read is quarantined, not deleted. It used to be
     * that the notification from the `clear()` below rode the subscriber back
     * into `saveDrawings()`, so merely switching symbols overwrote the
     * unreadable original with an empty one. Move the bytes to another key and
     * a later version can still recover them.
     */
    localStorage.setItem(`${storageKey()}:broken`, saved);
    localStorage.removeItem(storageKey());
  }
  tools.clear();
}
loadDrawings();

/**
 * Save whenever the drawings change — a drag arrives here too. It used to save
 * only on a button press, so anything you dragged into place was gone on
 * reload. A move fires on every pointermove, so that one case is debounced.
 */
let saveTimer: number | undefined;
tools.changes.subscribe(({ reason }) => {
  // `load` and `clear` are echoes of calls we made ourselves — turning them
  // back into a save overwrites the original (a plain read would rewrite it in
  // normalized form, and the clear after a failure would erase it).
  if (reason === "load" || reason === "clear") return;
  if (reason !== "move") {
    saveDrawings();
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveDrawings, 200);
});
// The window can close with a debounced save still pending.
window.addEventListener("beforeunload", saveDrawings);

// --- Toolbar ---

function button(label: string, onClick: (self: HTMLButtonElement) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = label;
  el.addEventListener("click", () => onClick(el));
  toolbar.appendChild(el);
  return el;
}

const symbolSelect = document.createElement("select");
for (const name of SYMBOLS) {
  const option = document.createElement("option");
  option.value = option.textContent = name;
  symbolSelect.appendChild(option);
}
symbolSelect.addEventListener("change", () => switchSymbol(symbolSelect.value as Symbol));
toolbar.appendChild(symbolSelect);

const timeframeSelect = document.createElement("select");
for (const n of [1, 5, 15, 60]) {
  const option = document.createElement("option");
  option.value = String(n);
  option.textContent = `${n}m`;
  if (n === timeframe) option.selected = true;
  timeframeSelect.appendChild(option);
}
timeframeSelect.addEventListener("change", () =>
  switchTimeframe(Number(timeframeSelect.value)),
);
toolbar.appendChild(timeframeSelect);

button("MA20", (self) => {
  self.setAttribute(
    "aria-pressed",
    String(
      toggleIndicator("ma", () =>
        plot.mainPane.use(attachMovingAverage({ source: price, period: 20, color: "#f59e0b" })),
      ),
    ),
  );
});
button("BOLL", (self) => {
  self.setAttribute(
    "aria-pressed",
    String(
      toggleIndicator("boll", () =>
        plot.mainPane.use(attachBollingerBands({ source: price, period: 20 })),
      ),
    ),
  );
});
button("MACD", (self) => {
  self.setAttribute(
    "aria-pressed",
    String(
      toggleIndicator("macd", () => plot.use(attachMacd({ source: price }))),
    ),
  );
});
button("RSI", (self) => {
  self.setAttribute(
    "aria-pressed",
    String(
      toggleIndicator("rsi", () => plot.use(attachRsi({ source: price }))),
    ),
  );
});
button("Ichimoku", (self) => {
  self.setAttribute(
    "aria-pressed",
    String(
      toggleIndicator("ichimoku", () =>
        plot.mainPane.use(attachIchimoku({ source: price })),
      ),
    ),
  );
});
button("VWAP", (self) => {
  self.setAttribute(
    "aria-pressed",
    String(
      toggleIndicator("vwap", () =>
        // Where a session begins is the consumer's knowledge — on this screen a bar starts a new day at UTC midnight.
        plot.mainPane.use(
          attachVwap({
            source: price,
            color: "#0ea5e9",
            anchor: periodAnchor({ barStart: sessionStart({ timeZone: "UTC" }) }),
          }),
        ),
      ),
    ),
  );
});

// Drawing buttons — press one and the next click (or two) draws. Press the
// same button again to cancel. `modeChanges` reports the automatic release on
// completion and on Esc.
const drawButtons = new Map<string, HTMLButtonElement>();
for (const [label, kind] of [
  ["Horizontal", "horizontal"],
  ["Trend line", "trend"],
  ["Fibonacci", "fib"],
] as const) {
  drawButtons.set(
    kind,
    button(label, () => {
      if (tools.mode() === kind) tools.cancel();
      else tools.begin(kind);
      /**
       * Hand focus back to the chart — this button just took it. The key
       * listeners and tabindex hang on the element `build()` received, so
       * without handing it back every Esc and Delete the README sells is dead
       * — and turning a tool on, changing your mind, and pressing Esc is the
       * single most common way anyone cancels.
       */
      chartHost.focus();
    }),
  );
}
tools.modeChanges.subscribe(({ mode }) => {
  for (const [kind, el] of drawButtons) {
    el.setAttribute("aria-pressed", String(mode === kind));
  }
  chartHost.style.cursor = mode ? "crosshair" : "";
});

button("Dark", (self) => {
  const dark = document.body.classList.toggle("dark");
  self.setAttribute("aria-pressed", String(dark));
  plot.requestRender(); // colors are CSS variables, read every frame — redrawing is the whole change.
});

button("PNG", () => {
  const link = document.createElement("a");
  link.download = `${symbol.replace("/", "-")}.png`;
  link.href = plot.takeScreenshot();
  link.click();
});

button("Fit all", () => plot.fitDomains());

function refreshStatus(): void {
  const last = price.read().at(-1);
  status.textContent = last
    ? `${symbol} · ${timeframe}m · ${price.read().length} bars · last ${won(last.close)}`
    : "";
}
refreshStatus();
