import { PlotBuilder, browserDeps, legend } from "@finchart/dom";
import type { LineDataPoint, OHLC, Plot, SeriesHandle } from "@finchart/core";
import { crosshair, lineSeries, priceFormat, priceLine, timeTicks } from "@finchart/core";
import { fixtureCandles } from "./fixture";
import { chartHost, focusRecent } from "./stage";

export const title = "Comparing symbols — percent change on one pane";
export const description =
  "Two symbols on one pane, each as its close's percent change from the first bar on screen. Drag or zoom and the base moves with the window, so both lines pass through 0% at the first bar on screen. " +
  "There is no percent scale mode: the lines are ordinary line series the app recomputes, and the axis format adds the % sign.";

/**
 * The x of the first bar at or after `startX` — the base a window starting
 * there measures from. Past the last bar, the last one; with no bars, null.
 */
export function baseX(candles: readonly OHLC[], startX: number): number | null {
  return baseBar(candles, startX)?.x ?? null;
}

/** Each close as its percent change from the close of the bar `baseX` picks for `fromX`. */
export function percentFrom(candles: readonly OHLC[], fromX: number): LineDataPoint[] {
  const base = baseBar(candles, fromX);
  if (base === undefined) return [];
  return candles.map((candle) => ({ x: candle.x, y: (candle.close / base.close - 1) * 100 }));
}

// A binary search, since bars are sorted by x and a drag asks on every move.
function baseBar(candles: readonly OHLC[], startX: number): OHLC | undefined {
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].x >= startX) high = middle;
    else low = middle + 1;
  }
  return candles[low];
}

/** A symbol's bars and the line that draws them as percent change. */
export interface ComparedSymbol {
  candles: readonly OHLC[];
  line: SeriesHandle<LineDataPoint>;
}

/**
 * Keeps every line measured from the window's first bar, read off the first
 * symbol: the symbols share one bar grid, so one base x lines them all up.
 * Returns the unsubscribe.
 */
export function followWindow(plot: Plot, symbols: readonly ComparedSymbol[]): () => void {
  let base: number | null = null;
  return plot.on("xDomainChange", ({ startX }) => {
    const next = baseX(symbols[0]?.candles ?? [], startX);
    // A drag that stays inside one bar would otherwise replace every line on each event.
    if (next === null || next === base) return;
    base = next;
    // refit: false keeps the window the user just dragged to.
    for (const { candles, line } of symbols) line.setData(percentFrom(candles, next), { refit: false });
  });
}

// priceFormat picks the decimals from the tick step, so a zoomed axis still
// prints distinct labels.
const number = priceFormat({ locale: "en-US" });
export const formatPercent = (value: number, step?: number) => `${value > 0 ? "+" : ""}${number(value, step)}%`;

export function mount(container: HTMLElement): () => void {
  const height = 360;
  const host = chartHost(container, height);
  const plot = PlotBuilder.create<LineDataPoint>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, height)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: formatPercent },
    })
    .build(host);

  // Symbols that trade on different days need their bars matched by x
  // first, or each line would measure from a different day.
  const symbols = [
    { name: "BTC/KRW", candles: fixtureCandles(300, 7), color: "#f59e0b" },
    { name: "ETH/KRW", candles: fixtureCandles(300, 13), color: "#6366f1" },
  ].map(({ name, candles, color }) => ({
    candles,
    line: plot.mainPane.addSeries({
      series: lineSeries({ line: { color, width: 2 }, point: { color } }),
      data: percentFrom(candles, candles[0].x),
      name,
      // The legend's swatch: a registration without a color shows none.
      color,
    }),
  }));
  plot.mainPane.addDecoration(priceLine({ value: 0, badge: false }));
  plot.use(crosshair({ magnet: true }));
  plot.use(legend({}));

  // Subscribed before focusRecent sets the opening window, so that window is measured too.
  const offWindow = followWindow(plot, symbols);
  const offFocus = focusRecent(plot, symbols[0].candles);

  return Object.assign(
    () => {
      offFocus();
      offWindow();
      plot.destroy();
      container.replaceChildren();
    },
    { requestRender: () => plot.requestRender() },
  );
}
