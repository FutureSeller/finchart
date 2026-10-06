import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC, Plot } from "@finchart/core";
import { candleSeries, priceFormat, syncX, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Two synchronized charts — syncX";
export const description =
  "Drag either chart, or wheel to zoom it — the x axis (what you're looking at) moves on both. syncX(a, b) is a 30-line helper that mirrors xDomainChange between the two: assembly, not a core contract.";

function buildChart(
  parent: HTMLElement,
  name: string,
  seed: number,
  height: number,
): { plot: Plot; wrapper: HTMLElement } {
  const wrapper = document.createElement("div");
  parent.append(wrapper);

  const label = document.createElement("div");
  label.textContent = name;
  label.style.cssText = "font-size: 13px; color: #64748b; margin-bottom: 4px";
  wrapper.append(label);

  const host = chartHost(wrapper, height);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(wrapper.clientWidth || 900, height)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  const price = plot.mainPane.addSeries({
    series: candleSeries(),
    data: fixtureCandles(300, seed),
    name,
  });

  focusRecent(plot, price.read());

  return { plot, wrapper };
}

export function mount(container: HTMLElement): () => void {
  const a = buildChart(container, "BTC/KRW", 7, 240);
  const b = buildChart(container, "ETH/KRW", 13, 240);

  const unsync = syncX(a.plot, b.plot);

  return Object.assign(
    () => {
      unsync();
      a.plot.destroy();
      b.plot.destroy();
      a.wrapper.remove();
      b.wrapper.remove();
    },
    {
      requestRender: () => {
        a.plot.requestRender();
        b.plot.requestRender();
      },
    },
  );
}
