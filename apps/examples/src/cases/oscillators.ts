import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { legend } from "@finchart/dom";
import {
  attachCci,
  attachRsi,
  attachStochastic,
  attachWilliamsR,
} from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Oscillators — RSI · Stochastic · CCI · %R";
export const description =
  "Wiring oscillators into their own panes — the definition decides the axis: RSI and Stochastic are pinned to 0–100, Williams %R to −100–0, and only the unbounded CCI is on autoScale with ±100 reference lines. The reference lines (70/30 · 80/20 · ±100 · −20/−80) show up with each pane.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 720);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 720)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  const price = plot.mainPane.addSeries({
    series: candleSeries(),
    data: fixtureCandles(),
    name: "Price",
  });

  plot.use(attachRsi({ source: price }));
  plot.use(attachStochastic({ source: price }));
  plot.use(attachCci({ source: price }));
  plot.use(attachWilliamsR({ source: price }));
  plot.use(legend({}));

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
