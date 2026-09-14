import type { CandleSeriesStyleOverrides, OHLC } from '@finchart/core';
import { CandleSeries } from '@finchart/core';
import { ChartSeries } from './chart-series';

export interface ChartCandlesProps {
  /** The data this candle draws. Falls back to what's passed down from above when omitted. */
  data?: OHLC[];
  /** Display name — the legend and tooltip refer to it by this. */
  name?: string;
  /**
   * `false` for a series drawn for the eye rather than read out (a band
   * fill, a marker row) — the tooltip and legend leave it out. Like `name`,
   * fixed at registration: change the React `key` to change it.
   */
  readout?: boolean;
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
export function ChartCandles({ data, name, readout, style }: ChartCandlesProps) {
  return <ChartSeries<OHLC> data={data} name={name} readout={readout} series={new CandleSeries(style ?? {})} />;
}
