import type { CandleSeriesStyleOverrides, OHLC } from '@finchart/core';
import { CandleSeries } from '@finchart/core';
import { ChartSeries } from './chart-series';

export interface ChartCandlesProps {
  /** The data this candle draws. Falls back to what's passed down from above when omitted. */
  data?: OHLC[];
  /** Display name — the legend and tooltip refer to it by this. */
  name?: string;
  /**
   * The candles' look, in the imperative lane's override shape — the same
   * `CandleSeriesStyleOverrides` that `candleSeries(style)` takes:
   * `{ up, down, wickWidth, bodyRatio }`. Omitted fields fall back to the
   * CSS variables (`--chart-candle-up`, `--chart-candle-down`, …).
   */
  style?: CandleSeriesStyleOverrides;
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
export function ChartCandles({ data, name, style }: ChartCandlesProps) {
  return <ChartSeries<OHLC> data={data} name={name} series={new CandleSeries(style ?? {})} />;
}
