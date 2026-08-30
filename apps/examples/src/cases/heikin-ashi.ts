import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { heikinAshi } from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Heikin-Ashi — the proof of derived series";
export const description =
  "Source candles (top) and candles smoothed by heikinAshi (derive, bottom) over the same x — not a new series type but candleSeries() + derive. The proof is that the lower bars have cleaner bodies and shorter wicks than the ones above.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 640);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 640)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  const candles = fixtureCandles();

  plot.mainPane.addSeries({ series: candleSeries(), data: candles, name: "Source" });

  // derive receives the registration's whole data — heikinAshi takes the source
  // OHLC as it is, walks it statefully, and puts out OHLC of the same length
  // (docs/plot-contract.md, "derived series").
  plot.addPane({ flex: 1, minHeight: 200 }).addSeries({
    series: candleSeries(),
    data: candles,
    derive: heikinAshi,
    name: "Heikin-Ashi",
  });

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
