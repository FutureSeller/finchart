/**
 * Live preview for the Getting Started tutorial — the exact same three
 * candles as `apps/docs/snippets/getting-started.ts`, so what the reader
 * sees here is what running that code actually produces.
 */
import { candleSeries } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { chartHost } from "./stage";

export const title = "Getting Started preview";
export const description = "The exact chart the 60-second tutorial code produces.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 300);
  const width = container.clientWidth || 800;
  const plot = PlotBuilder.create(browserDeps(), candleSeries())
    .addDataPoints([
      { x: 0, open: 100, high: 108, low: 98, close: 106 },
      { x: 1, open: 106, high: 112, low: 104, close: 109 },
      { x: 2, open: 109, high: 111, low: 101, close: 103 },
    ])
    .setSize(width, 300)
    .build(host);

  // Continuous x has no default zoom limit (unlike bar-index, which
  // defaults to 0.5–200 px/bar) — with only 3 points on a wide screen,
  // leaving it unbounded lets you zoom in absurdly far or out to near-nothing.
  const domain = plot.getState().xDomain;
  if (domain) {
    const pxPerUnit = width / (domain.max - domain.min);
    plot.applyOptions({
      maxBarSpacing: pxPerUnit, // can't zoom in past the initial fit
      minBarSpacing: pxPerUnit / 2, // can zoom out to 2x the initial span
    });
  }

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
