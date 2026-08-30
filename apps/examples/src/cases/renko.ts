import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat } from "@finchart/core";
import { renko } from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Renko — throw out time, keep price";
export const description =
  "One brick each time price moves by brickSize — a brick's x is an ordinal, not a time (that is Renko's definition). " +
  "Same direction moves one step, a reversal moves two (the one-brick gap rule). The result is OHLC-shaped, so candleSeries draws it as-is, and " +
  "the x-axis labels win the brick's closedAt (the time it completed) back as presentation — presentation belongs to the axis, and the consumer wires the axis.";

export function mount(container: HTMLElement): () => void {
  const host = chartHost(container, 480);

  const bricks = renko(fixtureCandles(), { brickSize: 400 });
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      // Win the ordinal x back as a completion time — the standard way to label a Renko axis.
      x: {
        format: (x) => {
          const brick = bricks[Math.round(x)];
          return brick ? timeLabel.format(brick.closedAt) : "";
        },
      },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  plot.mainPane.addSeries({
    series: candleSeries(),
    data: bricks,
    name: `Renko(400)`,
  });

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
