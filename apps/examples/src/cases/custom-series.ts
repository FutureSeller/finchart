import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { DrawTarget, OHLC, Series } from "@finchart/core";
import { OHLCAccessor, candleSeries, isGap, priceFormat, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Custom series — volume dots";
export const description =
  "A Series is two methods: valueExtent (how much of the y axis it takes) and draw (what it draws). This amber dot series is a presentation the core knows nothing about, and it puts a volume-sized circle on the close — built without touching the library. The bigger the volume, the bigger the circle.";

/** Rough upper bound on fixtureCandles' volume — used only to normalize the radius. */
const MAX_VOLUME = 500;
const DOT_COLOR = "rgba(217, 119, 6, 0.55)"; // amber-600 — a color that doesn't collide with the candles' green/red

/**
 * The real thing behind the contract the README sells ("a Series is two
 * methods") — the core has no idea this series exists. `valueExtent` says how
 * much of the y axis it needs, and `draw` puts that out as commands.
 */
const volumeDots: Series<OHLC> = {
  // Bars, not {x, y} — the data gate reads the point through this.
  coordinates: new OHLCAccessor(),
  valueExtent(data) {
    if (data.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const point of data) {
      if (point.close < min) min = point.close;
      if (point.close > max) max = point.close;
    }
    return { min, max };
  },
  draw(target: DrawTarget, { data, x, yScale }) {
    for (const point of data) {
      // A bar without volume is a gap — no dot, not a minimum-size one.
      if (isGap(point.volume)) continue;
      const radius = 3 + (point.volume / MAX_VOLUME) * 13;
      target.drawShape({
        shape: "circle",
        cx: x.toPixel(point.x),
        cy: yScale.scale(point.close),
        r: radius,
        fill: DOT_COLOR,
      });
    }
  },
};

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 420);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 420)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  // Fewer bars — the dots are wider than a bar, so packed tight they cover each other.
  const data = fixtureCandles(80);
  plot.mainPane.addSeries({ series: candleSeries(), data, name: "Price" });
  plot.mainPane.addSeries({ series: volumeDots, data, name: "Volume (dots)" });

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
