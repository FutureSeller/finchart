import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { sessionShading, shadingRenderer } from "../session-shading";
import { FIXTURE_BASE, fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

const HOUR = 60 * 60_000;

export const title = "Session shading — a custom draw command with a fallback";
export const description =
  "A decoration paints a gradient band over the after-hours stretch through a drawing command the core does not know (examples/gradient-band) — the renderer that does is injected with browserDeps({ createRenderer }); the headless model records the command whole, fallback included, and a playback renderer that does not know the name draws that flat fallback. Two approximations, on purpose: the hours are read in UTC from the axis ticks, and each band runs from a tick for one tick spacing, so its edges move with the zoom. It shows how a decoration recovers time from the ticks and how a fallback travels with a command; it is not a market-session calendar.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 480);

  // The shared fixture starts at 09:00 UTC in one-minute bars; 960 of them
  // reach past midnight, so the 20–24 UTC band has bars under it.
  const bars: OHLC[] = fixtureCandles(960);

  const plot = PlotBuilder.create<OHLC>(
    browserDeps({
      autoSize: true,
      // The renderer that knows the band's command — zero core changes.
      createRenderer: shadingRenderer,
    }),
  )
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  plot.mainPane.addSeries({ series: candleSeries(), data: bars, name: "Price" });
  plot.addDecoration(sessionShading({ fromHour: 20, toHour: 24 }));
  // Open on the evening so the band is in view without scrolling.
  plot.setVisibleRange(FIXTURE_BASE + 10 * HOUR, FIXTURE_BASE + 15.5 * HOUR);

  return () => plot.destroy();
}
