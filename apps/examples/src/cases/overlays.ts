import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { legend } from "@finchart/dom";
import {
  attachBollingerBands,
  attachMovingAverage,
  attachParabolicSar,
  attachSuperTrend,
  attachVwap,
} from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Overlay indicators";
export const description =
  "Indicators that share the price's axis — MA(20) · EMA(50) · Bollinger · VWAP · SAR · SuperTrend all mount onto mainPane. The band fill sits under the candles at zIndex −1, and SuperTrend alternates between two strands, an uptrend support line and a downtrend resistance line (the opposite stretch is null, so the line breaks).";

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

  plot.mainPane.use(attachMovingAverage({ source: price, period: 20, color: "#f59e0b" }));
  plot.mainPane.use(
    attachMovingAverage({ source: price, period: 50, type: "ema", color: "#8b5cf6" }),
  );
  plot.mainPane.use(attachBollingerBands({ source: price, period: 20 }));
  plot.mainPane.use(attachVwap({ source: price, color: "#0ea5e9" }));
  plot.mainPane.use(attachParabolicSar({ source: price, color: "#ef4444" }));
  plot.mainPane.use(attachSuperTrend({ source: price }));

  plot.use(legend({}));

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
