import { ContractError, candleSeries } from "@finchart/core";
import type { OHLC, SeriesHandle } from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { atrPriceStep, renko } from "@finchart/indicators";

const ATR_PERIOD = 14;

const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
  .setSize(900, 480)
  .build(document.getElementById("renko")!);

let bricks: SeriesHandle<OHLC> | null = null;

/**
 * The brick size a symbol's own volatility suggests, or `null` when its
 * tape has none: fewer bars than the ATR's period, or a flat tape whose
 * ATR is 0. A fixed size breaks the other way across symbols — the same
 * 1,000 is a solid wall of bricks on one stock and an empty chart on another.
 */
function brickSizeFor(candles: readonly OHLC[]): number | null {
  if (candles.length < ATR_PERIOD) return null;
  try {
    return atrPriceStep(candles, { period: ATR_PERIOD });
  } catch (error) {
    if (error instanceof ContractError) return null;
    throw error;
  }
}

/**
 * Chosen once, when the symbol loads — not on every tick. A size that moved
 * with each tick would lay every brick again on a new grid, and the chart
 * would redraw from the first brick while you watched.
 */
export function showSymbol(candles: OHLC[]): boolean {
  bricks?.dispose();
  bricks = null;
  const brickSize = brickSizeFor(candles);
  // No step to size bricks with: leave the renko chart empty and say so, or
  // fall back to a size of your own for that symbol.
  if (brickSize === null) return false;
  bricks = plot.mainPane.addSeries({
    series: candleSeries(),
    data: candles,
    derive: (source: readonly OHLC[]) => renko(source, { brickSize }),
  });
  return true;
}

/** Ticks go in as candles; the size chosen at load stays. */
export function onTick(candle: OHLC): void {
  bricks?.updateLast(candle);
}

/** When the renko view goes away: the plot's observers and listeners go with it. */
export function closeRenko(): void {
  bricks?.dispose();
  bricks = null;
  plot.destroy();
}
