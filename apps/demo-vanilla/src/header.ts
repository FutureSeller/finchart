/** The header and the status bar — they paint the focused chart's snapshot. */
import type { ChartInstance } from "./chart-instance";
import { wonDetail, wonExact } from "./format";

export interface Header {
  /** Paints the focused chart's current state wholesale — shared by ticks, hovers and focus changes. */
  paint(chart: ChartInstance): void;
  refreshStatus(chart: ChartInstance): void;
  /** Shows a two-second message in the status line — where an action (share, say) gives feedback. */
  flashStatus(message: string): void;
}

export function installHeader(): Header {
  const symbolEl = document.getElementById("symbol")!;
  const priceEl = document.getElementById("price")!;
  const changeEl = document.getElementById("change")!;
  const ohlcEl = document.getElementById("ohlc")!;
  const statusEl = document.getElementById("status")!;

  function paint(chart: ChartInstance): void {
    symbolEl.textContent = chart.spec.symbol;

    const last = chart.lastBar();
    if (!last) return;

    const ref = chart.referenceClose();
    const diff = last.close - ref;
    const pct = (diff / ref) * 100;
    const cls = diff >= 0 ? "up" : "down";

    priceEl.textContent = wonExact.format(Math.round(last.close));
    priceEl.className = cls;
    changeEl.textContent = `${diff >= 0 ? "+" : ""}${wonDetail(diff)} (${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
    changeEl.className = cls;

    const bar = chart.hoverBar() ?? last;
    const barCls = bar.close >= bar.open ? "up" : "down";
    ohlcEl.innerHTML =
      `O <b class="${barCls}">${wonDetail(bar.open)}</b> H <b class="${barCls}">${wonDetail(bar.high)}</b> ` +
      `L <b class="${barCls}">${wonDetail(bar.low)}</b> C <b class="${barCls}">${wonDetail(bar.close)}</b>`;
  }

  function refreshStatus(chart: ChartInstance): void {
    statusEl.textContent = `${chart.spec.symbol} · ${chart.timeframe()}m · ${chart.barCount().toLocaleString("en")} bars · UTC`;
  }

  function flashStatus(message: string): void {
    const keep = statusEl.textContent;
    statusEl.textContent = message;
    setTimeout(() => {
      if (statusEl.textContent === message) statusEl.textContent = keep;
    }, 2000);
  }

  return { paint, refreshStatus, flashStatus };
}
