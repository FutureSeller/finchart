import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { LineDataPoint } from "@finchart/core";
import { areaSeries, markers, priceFormat, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Area — a fill that fades downward";
export const description =
  "--chart-area-bottom alone turns the fill into a vertical gradient running from the top (--chart-area) down — the standard staging for a fintech-app price line. The gradient goes out as a custom command (charts/linear-gradient), so a playback surface that doesn't know the command degrades to a flat top color instead of leaving a hole. The dot on the last value is a markers decoration.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 480);
  // The case mounts its own tokens onto its own chart only — it doesn't touch the app-wide palette.
  host.style.setProperty("--chart-area", "rgba(59, 130, 246, 0.35)");
  host.style.setProperty("--chart-area-bottom", "rgba(59, 130, 246, 0)");

  const closes: LineDataPoint[] = fixtureCandles(240).map((bar) => ({
    x: bar.x,
    y: bar.close,
  }));

  const plot = PlotBuilder.create<LineDataPoint>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  plot.mainPane.addSeries({ series: areaSeries(), data: closes, name: "Close" });

  const last = closes[closes.length - 1];
  plot.mainPane.addDecoration(
    markers([{ x: last.x, price: last.y ?? 0, shape: "circle", color: "#ef4444" }]),
  );

  return () => plot.destroy();
}
