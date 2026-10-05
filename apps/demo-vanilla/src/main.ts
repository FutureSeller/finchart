/**
 * The demo — a **focus model** over four chart slots.
 *
 * There is no primary/comparison split: every slot is a full chart instance
 * (`chart-instance.ts` — its own symbol, timeframe, type, indicators, drawings
 * and feed), and the header controls, price readout, rail and actions all
 * reflect and drive the **focused** chart. Linking x is separate wiring
 * (`syncX`); it speaks in data x, so charts keep the same time window even when
 * their settings differ. Zero lines changed in the library is this app's
 * contract.
 *
 * This file is slots, focus and wiring; for the rest the file names are the
 * table of contents — `data` (the tape) · `feed` (playback) · `chart-instance`
 * (assembly) · `format` · `header` · `rail` (the drawing rail) · `actions`
 * (share, PNG, theme) · `live-return` (the ⏩ button).
 */
import "./style.css";
import { syncCrosshair, syncX } from "@finchart/core";
import { installActions } from "./actions";
import {
  CHART_SLOTS,
  makeChart,
  specOf,
  INDICATOR_KEYS,
  type IndicatorKey,
  type ChartInstance,
  type ChartType,
} from "./chart-instance";
import { installHeader } from "./header";
import { installLiveReturn } from "./live-return";
import { installRail } from "./rail";

const chartsEl = document.getElementById("charts")!;
const stageEl = document.getElementById("stage")!;

// --- Slots and focus ---

const charts: (ChartInstance | null)[] = CHART_SLOTS.map(() => null);
/** The symbol each slot is showing right now — the picker changes it. */
const slotSymbols: string[] = CHART_SLOTS.map((spec) => spec.symbol);
let focusIndex = 0;
let layout = 1;
let releaseSync: (() => void) | null = null;
let releaseCursorSync: (() => void) | null = null;
let releaseHeaderSub: (() => void) | null = null;
let releaseBarCloseSub: (() => void) | undefined;

const focused = (): ChartInstance => {
  const chart = charts[focusIndex] ?? charts[0];
  if (!chart) throw new Error("slot 0 is always alive");
  return chart;
};

const liveCharts = (): ChartInstance[] =>
  charts.filter((chart): chart is ChartInstance => chart !== null);

const header = installHeader();
const rail = installRail(focused, stageEl);

/** Moving focus — the header, rail and controls reflect the new chart. */
function setFocus(slot: number): void {
  const chart = charts[slot];
  if (!chart) return;
  focusIndex = slot;

  for (const [i, entry] of charts.entries()) {
    entry?.host.setAttribute("data-focused", String(i === slot));
  }

  releaseHeaderSub?.();
  releaseBarCloseSub?.();
  const repaint = () => header.paint(chart);
  releaseHeaderSub = chart.subscribe(repaint);
  // A closed bar means the count went up — only the status bar is rewritten.
  releaseBarCloseSub = chart.onBarClose(() => header.refreshStatus(chart));
  repaint();
  header.refreshStatus(chart);
  rail.retarget(chart);
  repaintControls();
}

/** The wiring is rebuilt whole whenever the list changes — a strand lives exactly as long as the list. */
function rewireSync(): void {
  releaseSync?.();
  releaseSync = null;
  releaseCursorSync?.();
  releaseCursorSync = null;

  const [hub, second, ...rest] = liveCharts().map((chart) => chart.plot);
  if (hub && second) {
    releaseSync = syncX(hub, second, ...rest);
    releaseCursorSync = syncCrosshair(hub, second, ...rest); // the cursor's time, too
  }
}

function setLayout(total: number): void {
  layout = total;

  for (let slot = 1; slot < CHART_SLOTS.length; slot++) {
    const shouldLive = slot < total;
    const chart = charts[slot];
    if (chart && !shouldLive) {
      chart.destroy();
      charts[slot] = null;
    } else if (!chart && shouldLive) {
      charts[slot] = makeChart(
        specOf(slotSymbols[slot]),
        chartsEl,
        () => setFocus(slot),
        (symbol) => setSymbol(slot, symbol),
      );
    }
  }

  chartsEl.dataset.layout = String(total);
  rewireSync();

  // A new cell inherits the anchor's window, and the last noise from a departing cell is painted over.
  const anchor = charts[0];
  const window = anchor?.plot.getVisibleRange();
  if (anchor && window) anchor.plot.setVisibleRange(window.min, window.max);

  if (focusIndex >= total) setFocus(0);
  else repaintControls();
}

/**
 * Swapping the symbol is a remount that preserves the settings. The new
 * instance opens that symbol's tape and drawings, while the timeframe, type and
 * indicators are inherited from the old one.
 */
function setSymbol(slot: number, symbol: string): void {
  const old = charts[slot];
  if (!old || old.spec.symbol === symbol) return;

  const keep = {
    timeframe: old.timeframe(),
    chartType: old.chartType(),
    indicators: old.indicators(),
  };
  old.destroy();

  slotSymbols[slot] = symbol;
  const next = makeChart(
    specOf(symbol),
    chartsEl,
    () => setFocus(slot),
    (chosen) => setSymbol(slot, chosen),
  );
  // A cell's position is DOM order — put the replaced cell back where it was, in slot order.
  const after = charts.slice(slot + 1).find((chart) => chart !== null);
  if (after) chartsEl.insertBefore(next.host, after.host);
  charts[slot] = next;

  if (keep.timeframe !== next.timeframe()) next.setTimeframe(keep.timeframe);
  if (keep.chartType !== next.chartType()) next.setChartType(keep.chartType);
  for (const key of keep.indicators) next.toggleIndicator(key);

  rewireSync();
  const anchor = charts[0];
  const window = anchor?.plot.getVisibleRange();
  if (anchor && window) anchor.plot.setVisibleRange(window.min, window.max);

  if (focusIndex === slot) setFocus(slot);
  else repaintControls();
}

// --- Slot 0 — always alive ---

charts[0] = makeChart(
  CHART_SLOTS[0],
  chartsEl,
  () => setFocus(0),
  (symbol) => setSymbol(0, symbol),
);

// --- Header controls — they reflect and drive the focused chart ---

const typeButtons = new Map<ChartType, HTMLButtonElement>();
const timeframeButtons = new Map<number, HTMLButtonElement>();
// **Narrowed to `IndicatorKey`** — leave it wide and `active.has()` below
// doesn't typecheck, which would call for an `as never`. Only `INDICATOR_KEYS`
// ever fills it, so the source is already narrow.
const indicatorButtons = new Map<IndicatorKey, HTMLButtonElement>();
const layoutButtons = new Map<number, HTMLButtonElement>();

function repaintControls(): void {
  const chart = focused();
  for (const [type, el] of typeButtons) {
    el.setAttribute("aria-pressed", String(chart.chartType() === type));
  }
  for (const [n, el] of timeframeButtons) {
    el.setAttribute("aria-pressed", String(chart.timeframe() === n));
  }
  const active = chart.indicators();
  for (const [key, el] of indicatorButtons) {
    el.setAttribute("aria-pressed", String(active.has(key)));
  }
  for (const [n, el] of layoutButtons) {
    el.setAttribute("aria-pressed", String(layout === n));
  }
}

function groupButton(
  groupEl: HTMLElement,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = label;
  el.addEventListener("click", () => {
    onClick();
    repaintControls();
  });
  groupEl.appendChild(el);
  return el;
}

const chartTypesEl = document.getElementById("chart-types")!;
for (const [type, label] of [
  ["candle", "Candles"],
  ["bar", "Bars"],
  ["line", "Line"],
  ["area", "Area"],
] as const) {
  typeButtons.set(
    type,
    groupButton(chartTypesEl, label, () => focused().setChartType(type)),
  );
}

const timeframesEl = document.getElementById("timeframes")!;
for (const n of [1, 5, 15, 60]) {
  timeframeButtons.set(
    n,
    groupButton(timeframesEl, n < 60 ? `${n}m` : `${n / 60}h`, () => {
      focused().setTimeframe(n);
      header.refreshStatus(focused());
    }),
  );
}

const indicatorsEl = document.getElementById("indicators")!;
for (const key of INDICATOR_KEYS) {
  indicatorButtons.set(
    key,
    groupButton(indicatorsEl, key, () => focused().toggleIndicator(key)),
  );
}

const layoutsEl = document.getElementById("layouts")!;
for (const n of [1, 2, 4]) {
  layoutButtons.set(
    n,
    groupButton(layoutsEl, String(n), () => setLayout(n)),
  );
}

installActions(focused, () => {
  for (const chart of liveCharts()) chart.plot.requestRender();
});
installLiveReturn(charts[0].plot, stageEl);

// Number keys 1–4 move focus — click-only focus is an accessibility hole.
window.addEventListener("keydown", (event) => {
  const slot = Number(event.key) - 1;
  if (Number.isInteger(slot) && slot >= 0 && slot < layout && charts[slot]) {
    setFocus(slot);
  }
});

setFocus(0);
