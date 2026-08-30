import { candleSeries, histogramSeries, priceFormat, timeTicks } from "@finchart/core";
import type { OHLC } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { attachMovingAverage } from "@finchart/indicators";

declare const bars: OHLC[];

const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
  .setSize(900, 480)
  .setAxis({
    x: { ticks: timeTicks() },
    y: { position: "right", format: priceFormat({ compact: true }) },
  })
  .build(document.getElementById("chart")!);

const price = plot.mainPane.addSeries({
  series: candleSeries(),
  data: bars,
  name: "Price",
});

plot.mainPane.use(attachMovingAverage({ source: price, period: 20 }));

const volumePane = plot.addPane({ flex: 0.25, minHeight: 48 });
const volume = volumePane.addSeries({
  series: histogramSeries(),
  data: bars.map((bar) => ({ x: bar.x, y: bar.volume ?? 0 })),
  name: "Volume",
});

export function onTick(bar: OHLC): void {
  price.updateLast(bar);
  volume.updateLast({ x: bar.x, y: bar.volume ?? 0 });
}

export { plot };
