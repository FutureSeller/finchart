import {
  OHLCAccessor,
  candleSeries,
  histogramSeries,
  priceFormat,
  timeTicks,
  validateSeriesPoint,
} from "@finchart/core";
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
  // A bar without volume is a gap in the volume pane — not a bar of 0.
  data: bars.map((bar) => ({ x: bar.x, y: bar.volume ?? null })),
  name: "Volume",
});

const accessor = new OHLCAccessor();

export function onTick(bar: OHLC): void {
  // The tick door's pre-check — the same rules updateLast runs, as a value
  // instead of a DataError inside the socket callback. `lastX` is the bar
  // you already hold (your own buffer, or `price.read().at(-1)?.x`).
  const lastX = price.read().at(-1)?.x;
  const issues = validateSeriesPoint(bar, accessor, { lastX });
  if (issues) {
    console.warn(issues[0].message);
    return;
  }
  price.updateLast(bar);
  volume.updateLast({ x: bar.x, y: bar.volume ?? null });
}

/**
 * A REST gap-fill after a reconnect often hands the boundary bar back
 * (inclusive end bounds). Bars declare one point per x, so append would
 * reject it — drop what you already hold first, the same filter
 * `infiniteHistory` applies to its own pages.
 */
export function onGapFill(page: OHLC[]): void {
  const lastX = price.read().at(-1)?.x;
  const fresh = lastX === undefined ? page : page.filter((bar) => bar.x > lastX);
  price.append(fresh);
  // Every pane that rides the same bars lands the same page.
  volume.append(fresh.map((bar) => ({ x: bar.x, y: bar.volume ?? null })));
}

export { plot };
