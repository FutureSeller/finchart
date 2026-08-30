import type { OHLC } from '@finchart/core';
import { CandleSeries } from '@finchart/core';
import { ChartSeries } from './chart-series';

export interface ChartCandlesProps {
  /** The data this candle draws. Falls back to what's passed down from above when omitted. */
  data?: OHLC[];
  /** Display name — the legend and tooltip refer to it by this. */
  name?: string;
  /** When the close is higher than the open. Falls back to the CSS variable (`--chart-candle-up`) when omitted. */
  up?: string;
  /** When the close is lower than the open. Falls back to the CSS variable (`--chart-candle-down`) when omitted. */
  down?: string;
  /** Wick width (px). */
  wickWidth?: number;
  /** The fraction of the slot width the body takes up (0–1). */
  bodyRatio?: number;
}

/**
 * Draws OHLC as candles.
 *
 * ```tsx
 * <ChartCandles />
 * ```
 *
 * There's no `derive` here since the data is already OHLC — to compute
 * something from the source and draw that, reach for `<ChartLine
 * derive={...}>` or `<ChartSeries>`.
 */
export function ChartCandles({
  data,
  name,
  up,
  down,
  wickWidth,
  bodyRatio,
}: ChartCandlesProps) {
  return (
    <ChartSeries<OHLC>
      data={data}
      name={name}
      series={
        new CandleSeries({
          ...(up !== undefined && { up }),
          ...(down !== undefined && { down }),
          ...(wickWidth !== undefined && { wickWidth }),
          ...(bodyRatio !== undefined && { bodyRatio }),
        })
      }
    />
  );
}
