import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { HistogramPoint, OHLC } from "@finchart/core";
import { candleSeries, crosshair, histogramSeries, priceFormat, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Candles + volume";
export const description =
  "The smallest trading screen — one candle pane, one volume pane, a crosshair. Up/down is not styling; it is a fact of the point (HistogramPoint.tone) — the series style or the theme picks the colour.";

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

  // The volume pane recedes under price: a green/red pair at 45%, the same in
  // both modes, on the series — a CSS variable is chart-wide and would wash
  // an indicator's bars too.
  plot.addPane({ flex: 0.35, minHeight: 60 }).addSeries({
    series: histogramSeries({ style: { up: "rgba(22, 163, 74, 0.45)", down: "rgba(220, 38, 38, 0.45)" } }),
    data: candles.map<HistogramPoint>((candle) => ({
      x: candle.x,
      y: candle.volume ?? null,
      // The bar says which way its candle went; the series style says what colour that is.
      tone: candle.close >= candle.open ? "up" : "down",
    })),
    name: "Volume",
  });

  plot.use(crosshair({ magnet: true }));

  focusRecent(plot, candles);

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
