import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC, Pane } from "@finchart/core";
import { candleSeries, paneMaximize, priceFormat, timeTicks } from "@finchart/core";
import { legend } from "@finchart/dom";
import { attachAdx, attachCr, attachMacd, attachObv } from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Own-pane indicators — MACD · ADX · OBV · CR";
export const description =
  "Indicators whose magnitudes differ from the price's — each makes its own pane to mount into, and dispose tears the pane down with it. Unlike the oscillators, the axis stays on autoScale. CR is five lines on one pane: the band and four averages drawn back by ceil(p / 2.5 + 1) bars, the averages in one colour and told apart by the window in their labels, with a line at 100 where the two sums balance. The buttons demonstrate pane maximizing — back when the panes were equal, the price pane got squeezed to the same size as an indicator.";

/** Background for the pressed button — the case stands on its own without the shell's CSS. */
function paintPressed(el: HTMLButtonElement, pressed: boolean): void {
  el.style.background = pressed ? "#3b82f6" : "";
  el.style.color = pressed ? "#fff" : "";
}

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Maximize pane");
  toolbar.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px";
  container.append(toolbar);
  const host = chartHost(container, 640);
  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 640)
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

  const macd = plot.use(attachMacd({ source: price }));
  const adx = plot.use(attachAdx({ source: price }));
  const obv = plot.use(attachObv({ source: price }));
  const cr = plot.use(attachCr({ source: price }));
  // The four averages share a colour — the legend on CR's own pane is what tells them apart.
  if (cr.pane) plot.use(legend({ pane: cr.pane }));
  plot.use(legend({}));

  // The maximize API — this is the only core extension involved (it asks for
  // PaneHost & PlotEventSource & InputHost, nothing more). An own-pane
  // indicator hands back the Pane it made through `.pane` — that's what
  // picks the target to maximize here.
  const max = plot.use(paneMaximize());
  const panes: [string, Pane][] = [
    ["Price", plot.mainPane],
    ["MACD", macd.pane!],
    ["ADX", adx.pane!],
    ["OBV", obv.pane!],
    ["CR", cr.pane!],
  ];

  const buttons = new Map<Pane, HTMLButtonElement>();
  for (const [label, pane] of panes) {
    const el = document.createElement("button");
    el.textContent = `Maximize ${label}`;
    el.addEventListener("click", () => max.maximize(pane));
    toolbar.appendChild(el);
    buttons.set(pane, el);
  }

  const refresh = () => {
    for (const [pane, el] of buttons) {
      const pressed = max.maximizedPane === pane;
      el.setAttribute("aria-pressed", String(pressed));
      paintPressed(el, pressed);
    }
  };
  refresh();
  // Dragging a divider can also release the maximize — listen for state
  // changes so the display follows even when it changes
  // outside a button click.
  const unsubscribe = plot.on("stateChange", refresh);

  return Object.assign(
    () => {
      unsubscribe();
      plot.destroy();
      toolbar.remove();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
