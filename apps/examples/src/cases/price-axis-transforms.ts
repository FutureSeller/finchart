import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC, Plot } from "@finchart/core";
import { candleSeries, priceFormat, timeTicks } from "@finchart/core";
import { atrPriceStep, attachMovingAverage, kagi, kagiSeries, lineBreak, pointAndFigure, pointAndFigureSeries, renko } from "@finchart/indicators";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Price-axis transforms — Renko, Line Break, Kagi, Point & Figure";
export const description =
  "Four charts that throw time away and keep price, all derived from the candles on top. Each is registered with derive, so a tick goes in as a candle and the transform is re-derived; " +
  "the Renko chart takes the same ticks the candles do (play/pause), and a moving average sits on its bricks as it would on candles. " +
  "Their x is an ordinal, not a time — the axis format wins the closing time back from closedAt. One price step sizes the three that take one — brick, reversal, box — atrPriceStep, the tape's own ATR; Line Break counts lines instead.";

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.style.cssText = "margin-bottom: 8px";
  container.append(toolbar);

  const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
  const all = fixtureCandles(600);
  let revealed = 300;
  const step = atrPriceStep(all.slice(0, revealed), { period: 14 });

  const plots: Plot[] = [];
  const panel = (height: number, ordinal: boolean): Plot & { label: HTMLDivElement } => {
    const label = document.createElement("div");
    label.style.cssText = "font: 12px/1.4 system-ui; opacity: 0.7; margin: 6px 0 2px";
    container.append(label);
    const host = chartHost(container, height);
    const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
      .setSize(container.clientWidth || 900, height)
      .setAxis({
        x: ordinal ? {} : { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
        y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
      })
      .build(host);
    plots.push(plot);
    return Object.assign(plot, { label });
  };

  // The x-axis format of an ordinal chart: the accepted array's `closedAt` is the closing time of the block at x.
  const timeAxis = (plot: Plot, read: () => readonly unknown[]): void => {
    plot.applyOptions({
      axis: {
        x: {
          format: (x: number) => {
            const blocks = read();
            const block = x >= 0 && x <= blocks.length - 1 ? blocks[Math.round(x)] : undefined;
            return typeof block === "object" && block !== null && "closedAt" in block && typeof block.closedAt === "number"
              ? timeLabel.format(block.closedAt)
              : "";
          },
        },
      },
    });
  };

  // 1. The source: candles on a time axis, ticking.
  const candles = panel(260, false);
  candles.label.textContent = "Candles — the source, on a time axis (ticking)";
  candles.applyOptions({ shiftVisibleRangeOnNewBar: true, rightOffset: 4 });
  const price = candles.mainPane.addSeries({ series: candleSeries(), data: all.slice(0, revealed), name: "Price" });

  // 2. Renko — derived from the same ticks, with a moving average on the bricks.
  const renkoPlot = panel(260, true);
  renkoPlot.label.textContent = `Renko(${step.toFixed(0)}) — derived from the ticks above; MA(5) on the bricks`;
  const bricks = renkoPlot.mainPane.addSeries({
    series: candleSeries(),
    data: all.slice(0, revealed),
    derive: (source: readonly OHLC[]) => renko(source, { brickSize: step }),
    name: `Renko(${step.toFixed(0)})`,
  });
  renkoPlot.mainPane.use(attachMovingAverage({ source: bricks, period: 5, name: "MA on bricks" }));
  timeAxis(renkoPlot, () => bricks.read());

  // 3. Line Break — three-line break, static.
  const lbPlot = panel(220, true);
  lbPlot.label.textContent = "Line Break(3)";
  const lines = lbPlot.mainPane.addSeries({ series: candleSeries(), data: all.slice(0, revealed), derive: (source: readonly OHLC[]) => lineBreak(source, { lines: 3 }), name: "Line Break(3)" });
  timeAxis(lbPlot, () => lines.read());

  // 4. Kagi — yang thick, yin thin, static.
  const kagiPlot = panel(220, true);
  kagiPlot.label.textContent = `Kagi(${step.toFixed(0)}) — thick yang, thin yin`;
  const points = kagiPlot.mainPane.addSeries({ series: kagiSeries(), data: all.slice(0, revealed), derive: (source: readonly OHLC[]) => kagi(source, { reversal: step }), name: `Kagi(${step.toFixed(0)})` });
  timeAxis(kagiPlot, () => points.read());

  // 5. Point & Figure — X's and O's on the step's grid, three-box reversal, static.
  const pnfPlot = panel(260, true);
  pnfPlot.label.textContent = `Point & Figure(${step.toFixed(0)} × 3)`;
  const columns = pnfPlot.mainPane.addSeries({
    series: pointAndFigureSeries({ boxSize: step }),
    data: all.slice(0, revealed),
    derive: (source: readonly OHLC[]) => pointAndFigure(source, { boxSize: step }),
    name: `P&F(${step.toFixed(0)} × 3)`,
  });
  timeAxis(pnfPlot, () => columns.read());

  // Ticks — the realtime case's grammar: the same x replaces (the bar in progress), a larger x appends.
  const TICKS_PER_BAR = 3;
  let tick = 0;
  let timer: number | undefined;
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
  const feed = (candle: OHLC): void => {
    price.updateLast(candle);
    bricks.updateLast(candle); // the derived registration re-derives the bricks from the accepted candles
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
      if (!next) return pause();
      tick += 1;
      if (tick < TICKS_PER_BAR) return feed(inProgress(next, tick / TICKS_PER_BAR));
      feed(next);
      revealed += 1;
      tick = 0;
    }, 400);
  };
  button.addEventListener("click", () => (timer === undefined ? play() : pause()));
  toolbar.appendChild(button);
  play();

  return Object.assign(
    () => {
      pause();
      for (const plot of plots) plot.destroy();
      container.replaceChildren();
    },
    { requestRender: () => plots.forEach((plot) => plot.requestRender()) },
  );
}
