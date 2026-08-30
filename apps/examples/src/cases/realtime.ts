import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Real-time ticks";
export const description =
  "A tick arrives every 400ms and a bar closes every three ticks — the bar in progress twitches under updateLast (the same x replaces), and the first tick after the close opens a new bar (a larger x appends). The viewport follows (shiftVisibleRangeOnNewBar). Play/pause lets you stop it and hold it against the code — the data is deterministic, so stopping at the same place gives the same picture.";

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.style.cssText = "margin-bottom: 8px";
  container.append(toolbar);
  const host = chartHost(container, 480);

  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);
  plot.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 4 });

  const all = fixtureCandles(600);
  let revealed = 250;
  const price = plot.mainPane.addSeries({
    series: candleSeries(),
    data: all.slice(0, revealed),
    name: "Price",
  });

  let timer: number | undefined;
  const playing = () => timer !== undefined;

  /**
   * Splits one in-progress bar into three ticks — `updateLast`'s contract is
   * the grammar itself: **the same x replaces** (the in-progress bar twitches),
   * **a larger x appends** (the first tick after the close opens a new bar).
   * The values are interpolated deterministically from the script.
   */
  const TICKS_PER_BAR = 3;
  let tick = 0;

  const inProgress = (bar: OHLC, progress: number): OHLC => {
    const close = bar.open + (bar.close - bar.open) * progress;
    return {
      x: bar.x,
      open: bar.open,
      close,
      high: Math.max(bar.open, close, bar.open + (bar.high - bar.open) * progress),
      low: Math.min(bar.open, close, bar.open + (bar.low - bar.open) * progress),
      volume: Math.round((bar.volume ?? 0) * progress),
    };
  };

  const button = document.createElement("button");
  const pause = () => {
    clearInterval(timer);
    timer = undefined;
    button.textContent = "Play";
  };
  const play = () => {
    button.textContent = "Pause";
    timer = window.setInterval(() => {
      const next = all[revealed];
      if (!next) return pause(); // the script has run out

      tick += 1;
      if (tick < TICKS_PER_BAR) {
        price.updateLast(inProgress(next, tick / TICKS_PER_BAR));
        return;
      }
      price.updateLast(next); // settle it at the final value
      revealed += 1;
      tick = 0;
    }, 400);
  };
  button.addEventListener("click", () => (playing() ? pause() : play()));
  toolbar.appendChild(button);
  play();

  return Object.assign(
    () => {
      pause();
      plot.destroy();
      toolbar.remove();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
