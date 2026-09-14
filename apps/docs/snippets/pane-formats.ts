import { candleSeries, histogramSeries, priceFormat } from "@finchart/core";
import type { HistogramPoint, OHLC } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { attachRsi } from "@finchart/indicators";

declare const bars: OHLC[];
declare const currency: "KRW" | "USD";

// A price's decimals belong to its currency — a won has none, a dollar has
// cents. Set on the chart, this is every pane's default.
const PRICE_DECIMALS = { KRW: 0, USD: 2 };

const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
  .setSize(900, 600)
  .setAxis({ y: { position: "right", format: priceFormat({ precision: PRICE_DECIMALS[currency], locale: "ko-KR" }) } })
  .build(document.getElementById("chart")!);

const price = plot.mainPane.addSeries({ series: candleSeries(), data: bars, name: "Price" });

// A pane's own format wins over the chart's, on its axis, its crosshair
// badge, its price lines, and the tooltip and legend rows it reads out.
// Volume is a count, not a price: shortened, never in cents.
const volume = plot.addPane({ flex: 0.35, axis: { format: priceFormat({ compact: true, locale: "ko-KR" }) } });
volume.addSeries({
  series: histogramSeries(),
  data: bars.map<HistogramPoint>((bar) => ({ x: bar.x, y: bar.volume ?? null })),
  name: "Volume",
});

// RSI reads 0–100 in whole numbers whatever the currency. The pane it made
// is set the same way, after the fact.
const rsi = plot.use(attachRsi({ source: price }));
rsi.pane?.applyOptions({ axis: { format: priceFormat({ precision: 0 }) } });

// Switching currency changes the chart's default; the volume and RSI panes
// keep their own. Only the fields given change — the axis stays on the right.
export function showCurrency(next: "KRW" | "USD"): void {
  plot.applyOptions({ axis: { y: { format: priceFormat({ precision: PRICE_DECIMALS[next], locale: "ko-KR" }) } } });
}

export { plot };
