import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { volumeProfile } from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Volume Profile — the distribution of what you can see";
export const description =
  "The volume of the visible x range as horizontal bars per price bucket — pan or zoom and the distribution rebuilds on the spot (the TradingView Visible Range lineage). " +
  "Only the thickest bucket (the POC) has a different color. It's a decoration rather than a series, so it's one addDecoration line, and every bar is a drawShape rect, so it can be asserted headless.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 480);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  const data = fixtureCandles();
  const price = plot.mainPane.addSeries({
    series: candleSeries(),
    data,
    name: "Price",
  });

  const remove = plot.mainPane.addDecoration(
    volumeProfile({ source: price }),
  );

  focusRecent(plot, data);

  return Object.assign(
    () => {
      remove();
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
