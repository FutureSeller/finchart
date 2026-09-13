import {
  barAggregator,
  candleSeries,
  fixedBars,
  priceFormat,
  sessionStart,
  timeTicks,
} from "@finchart/core";
import type { OHLC, Trade } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { attachVwap, periodAnchor } from "@finchart/indicators";

declare const bars: OHLC[];
declare const trades: Trade[];

// The exchange's zone, said once — the axis, the crosshair badge and the
// tooltip header then read the same clock. Left out, both the zone and the
// locale would be the runtime's: a server and a browser in different places
// would print different labels for the same bar.
const TIME_ZONE = "Asia/Seoul";

const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
  .setSize(900, 480)
  .setAxis({
    x: { ticks: timeTicks({ timeZone: TIME_ZONE, locale: "ko-KR" }) },
    y: { position: "right", format: priceFormat({ compact: true, locale: "ko-KR" }) },
  })
  .build(document.getElementById("chart")!);

const price = plot.mainPane.addSeries({ series: candleSeries(), data: bars, name: "Price" });

// Intraday bars of a fixed width are aligned to the epoch — the minute and
// hour bars of a market that never closes. A daily bar is a session, and a
// session is a calendar day in one zone: that is what sessionStart decides.
const minuteBars = barAggregator({ barStart: fixedBars({ interval: 60_000 }) });
const dailyBars = barAggregator({ barStart: sessionStart({ timeZone: TIME_ZONE }) });

let minute: OHLC | null = null;
let day: OHLC | null = null;
for (const trade of trades) {
  minute = minuteBars.fold(minute, trade);
  day = dailyBars.fold(day, trade);
}

// A VWAP that resets at the session open — the same rule about where a bar
// starts, handed to the indicator as its anchor.
plot.mainPane.use(
  attachVwap({
    source: price,
    anchor: periodAnchor({ barStart: sessionStart({ timeZone: TIME_ZONE }) }),
    name: "Session VWAP",
  }),
);

export { plot, minute, day };
