import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { HistogramPoint, OHLC } from "@finchart/core";
import { candleSeries, crosshair, histogramSeries, priceFormat, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Candles + volume";
export const description =
  "The smallest trading screen — one candle pane, one volume pane, a crosshair. Up/down color is not styling; it is a fact of the point (HistogramPoint.color).";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 480);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  const candles = fixtureCandles();
  plot.mainPane.addSeries({ series: candleSeries(), data: candles, name: "Price" });

  plot.addPane({ flex: 0.35, minHeight: 60 }).addSeries({
    series: histogramSeries(),
    data: candles.map<HistogramPoint>((candle) => ({
      x: candle.x,
      y: candle.volume ?? null,
      color:
        candle.close >= candle.open
          ? "rgba(22, 163, 74, 0.45)"
          : "rgba(220, 38, 38, 0.45)",
    })),
    name: "Volume",
  });

  plot.use(crosshair({ magnet: true }));

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
