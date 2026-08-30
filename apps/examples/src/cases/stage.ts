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
