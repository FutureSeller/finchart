import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { legend } from "@finchart/dom";
import {
  attachCci,
  attachMfi,
  attachRsi,
  attachStochasticRsi,
  attachWilliamsR,
} from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Oscillators — RSI · MFI · Stochastic RSI · CCI · %R";
export const description =
  "Wiring oscillators into panes — the definition decides the axis: RSI, MFI and Stochastic RSI share one 0–100 pane (the first makes it, the others borrow it, so one axis and one set of reference lines serve all three), Williams %R is pinned to −100–0 in its own pane, and only the unbounded CCI is on autoScale with ±100 reference lines. Each own pane carries its own legend.";

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

  // Three 0–100 oscillators, one pane: the first owns it, the rest borrow it.
  const rsi = plot.use(attachRsi({ source: price }));
  if (rsi.pane) {
    plot.use(attachMfi({ source: price, pane: rsi.pane }));
    plot.use(attachStochasticRsi({ source: price, pane: rsi.pane }));
    plot.use(legend({ pane: rsi.pane }));
  }
  const cci = plot.use(attachCci({ source: price }));
  if (cci.pane) plot.use(legend({ pane: cci.pane }));
  const williams = plot.use(attachWilliamsR({ source: price }));
  if (williams.pane) plot.use(legend({ pane: williams.pane }));
  plot.use(legend({}));

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
