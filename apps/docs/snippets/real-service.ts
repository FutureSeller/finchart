import {
  OHLCAccessor,
  candleSeries,
  conflated,
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

// A loud feed: every `updateLast` copies the array, so fifty ticks between
// two frames pay fifty copies for a picture that shows only the last. A
// conflated feed coalesces the repeated updates to the same bar until the
// next frame — a tick that opens a new bar delivers the previous one at
// once; the screen then follows the socket by two scheduling steps (the
// feed's frame, then the render's), and without requestAnimationFrame
// delivery is immediate.
const priceFeed = conflated(price);
const volumeFeed = conflated(volume);
// The x of the last tick accepted — the feed may still be holding it, and
// `price.read()` does not know about a bar that has not been delivered yet.
let accepted: number | undefined;

export function onTick(bar: OHLC): void {
  // The tick door's pre-check — the same rules updateLast runs, as a value
  // instead of a DataError inside the socket callback. The baseline is the
  // later of the bar you hold and the bar the feed is holding: judged
  // against the held tail alone, a tick behind a pending bar would pass here
  // and fail inside the feed's delivery.
  const held = price.read().at(-1)?.x;
  const lastX =
    held === undefined ? accepted : accepted === undefined ? held : Math.max(held, accepted);
  const issues = validateSeriesPoint(bar, accessor, { lastX });
  if (issues) {
    console.warn(issues[0].message);
    return;
  }
  accepted = bar.x;
  priceFeed.push(bar);
  volumeFeed.push({ x: bar.x, y: bar.volume ?? null });
}

/**
 * A REST gap-fill after a reconnect often hands the boundary bar back
 * (inclusive end bounds). Bars declare one point per x, so append would
 * reject it — drop what you already hold first, the same filter
 * `infiniteHistory` applies to its own pages.
 */
export function onGapFill(page: OHLC[]): void {
  // Deliver what the feeds are holding before reading the tail — a pending
  // tick delivered after the page would land behind it.
  priceFeed.flush();
  volumeFeed.flush();
  const lastX = price.read().at(-1)?.x;
  const fresh = lastX === undefined ? page : page.filter((bar) => bar.x > lastX);
  price.append(fresh);
  // Every pane that rides the same bars lands the same page.
  volume.append(fresh.map((bar) => ({ x: bar.x, y: bar.volume ?? null })));
  // The held tail is the baseline again — the flush delivered the pending bar.
  accepted = price.read().at(-1)?.x;
}

/** On teardown: a dispose flushes what is pending, then stops. */
export function disconnect(): void {
  priceFeed.dispose();
  volumeFeed.dispose();
}

export { plot };
