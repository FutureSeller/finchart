import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { legend } from "@finchart/dom";
import {
  attachDonchianChannels,
  attachKeltnerChannels,
} from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Channels — Keltner · Donchian";
export const description =
  "Two channels of the same shape and different math — Keltner (EMA ± ATR×2, a volatility channel) laid over Donchian (window extremes, a breakout channel) so you can compare their character. " +
  "Keltner narrows through the quiet stretches; Donchian steps only when a new high or a new low arrives. Both fills sit at zIndex −1.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 480);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
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

  plot.mainPane.use(
    attachKeltnerChannels({ source: price, colors: { middle: "#0ea5e9", edges: "#0ea5e9" } }),
  );
  plot.mainPane.use(
    attachDonchianChannels({ source: price, colors: { middle: "#f59e0b", edges: "#f59e0b" } }),
  );
  plot.use(legend({}));

  focusRecent(plot, price.read());

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
