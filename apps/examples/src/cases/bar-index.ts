import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { barIndexX, candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Bar-index coordinates";
export const description =
  "The same daily bars (markets closed on weekends) under two coordinate systems — the top one is a continuous time axis, so the weekends open up as gaps; the bottom one is a bar-index axis (barIndexX), so the bars sit flush against each other.";

const DAY = 86_400_000;
const MONDAY = Date.UTC(2026, 0, 5);

/** Daily bars for trading days only — every five bars, two days (the weekend) are missing. */
function weekdayCandles(): OHLC[] {
  return fixtureCandles(90).map((candle, index) => {
    const week = Math.floor(index / 5);
    return { ...candle, x: MONDAY + (week * 7 + (index % 5)) * DAY };
  });
}

export function mount(container: HTMLElement): () => void {
  const hosts = [chartHost(container, 240), chartHost(container, 240)];
  hosts[0].style.marginBottom = "12px";

  const data = weekdayCandles();
  const axis = {
    x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
    y: {
      position: "right",
      format: priceFormat({ compact: true, locale: "en-US" }),
    },
  } as const;

  const continuous = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 240)
    .setAxis(axis)
    .build(hosts[0]);
  continuous.mainPane.addSeries({ series: candleSeries(), data, name: "Continuous time axis" });

  const indexed = PlotBuilder.create<OHLC>(
    browserDeps({ autoSize: true, createXMapping: barIndexX }),
  )
    .setSize(container.clientWidth || 900, 240)
    .setAxis(axis)
    .build(hosts[1]);
  indexed.mainPane.addSeries({ series: candleSeries(), data, name: "Bar index axis" });

  focusRecent(continuous, data);
  focusRecent(indexed, data);

  return Object.assign(
    () => {
      continuous.destroy();
      indexed.destroy();
      for (const host of hosts) host.remove();
    },
    {
      requestRender: () => {
        continuous.requestRender();
        indexed.requestRender();
      },
    },
  );
}
