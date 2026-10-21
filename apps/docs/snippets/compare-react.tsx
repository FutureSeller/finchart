import { priceFormat, timeTicks } from "@finchart/core";
import type { LineDataPoint, OHLC, XDomainChangePayload } from "@finchart/core";
import { browserDeps } from "@finchart/dom";
import { ChartContainer, ChartLine, Crosshair, Legend, PriceLine, XAxis, YAxis } from "@finchart/react";
import { useMemo, useState } from "react";

const deps = browserDeps({ autoSize: true });

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

// Built once, outside render: the axes reapply a format or ticks whenever
// they get a new one. priceFormat picks the decimals from the tick step, so a
// zoomed axis still prints distinct labels.
const number = priceFormat({ locale: "en-US" });
export const formatPercent = (value: number, step?: number) => `${value > 0 ? "+" : ""}${number(value, step)}%`;
const TIME_TICKS = timeTicks({ timeZone: "UTC", locale: "en-US" });

interface SymbolBars {
  name: string;
  candles: readonly OHLC[];
}

export function Compare({ a, b }: { a: SymbolBars; b: SymbolBars }) {
  // The window's start lives in state and the base is read off the bars at
  // render, so new bars are measured from the bar on screen too. A start that
  // keeps the same first bar keeps the old state, so React skips the update
  // for a drag inside one bar. The symbols share one bar grid, so the first
  // one's bars pick the base for both.
  const [startX, setStartX] = useState(-Infinity);
  const base = baseX(a.candles, startX) ?? 0;
  const onXDomainChange = (change: XDomainChangePayload) =>
    setStartX((previous) => (baseX(a.candles, previous) === baseX(a.candles, change.startX) ? previous : change.startX));
  const lineA = useMemo(() => percentFrom(a.candles, base), [a.candles, base]);
  const lineB = useMemo(() => percentFrom(b.candles, base), [b.candles, base]);

  return (
    <ChartContainer deps={deps} data={lineA} height={360} onXDomainChange={onXDomainChange}>
      <XAxis ticks={TIME_TICKS} />
      <YAxis position="right" format={formatPercent} />
      <ChartLine name={a.name} style={{ line: { color: "#f59e0b", width: 2 }, point: { color: "#f59e0b" } }} />
      <ChartLine data={lineB} name={b.name} style={{ line: { color: "#6366f1", width: 2 }, point: { color: "#6366f1" } }} />
      <PriceLine value={0} badge={false} />
      <Crosshair magnet />
      <Legend />
    </ChartContainer>
  );
}
