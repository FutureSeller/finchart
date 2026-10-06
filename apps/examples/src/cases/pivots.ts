import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { legend } from "@finchart/dom";
import { attachPivotPoints } from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Pivot Points — the period is the consumer's knowledge";
export const description =
  "The previous period's high, low, and close draw this period's pivot (P) with its resistances (R) and supports (S) — the consumer states where a period ends through the anchor predicate (the core has no notion of a session; the same contract as VWAP). " +
  "This demo takes the top of every hour as the boundary over one-minute bars, which is what a predicate of your own is for. For the ordinary case — a session that is a calendar day somewhere — `periodAnchor({ barStart: sessionStart({ timeZone }) })` is the one to reach for. " +
  "The hole at a period's first bar is what breaks the horizontal segments apart.";

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
    attachPivotPoints({
      source: price,
      // What the time axis means is knowledge held here, by the consumer — the
      // top of the hour starts a new period. x is a number down at the type
      // level, so it's counted as it is, with no conversion.
      anchor: (candle) => candle.x % 3_600_000 === 0,
      depth: 2,
    }),
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
