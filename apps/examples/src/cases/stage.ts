import type { Plot } from "@finchart/core";

/** Start with readable candles while retaining the full indicator/history data. */
export function focusRecent(plot: Plot, data: readonly { x: number }[]): () => void {
  if (data.length < 2) return () => {};
  let off = () => {};
  const apply = (): boolean => {
    const area = plot.mainPane.area;
    const width = area.right - area.left;
    if (width <= 0) return false;
    off();
    const count = Math.min(data.length, Math.max(2, Math.floor(width / 8)));
    plot.setVisibleRange(data[data.length - count].x, data[data.length - 1].x);
    plot.scrollToRealTime();
    return true;
  };
  // Browser layout is committed on render, not when the plot is constructed.
  off = plot.on("render", apply);
  if (!apply()) plot.requestRender();
  return off;
}

/**
 * A chart host with a height.
 *
 * The chart's layers are absolutely positioned, so **the host cannot make its
 * own height** — a consumer app faces the same demand (trading.html's
 * `#chart { height }`). Forget this one thing in a case and the chart spills
 * over a zero-height box, so a helper nails it down.
 */
export function chartHost(container: HTMLElement, height: number): HTMLDivElement {
  const host = document.createElement("div");
  host.style.height = `${height}px`;
  container.appendChild(host);
  return host;
}
