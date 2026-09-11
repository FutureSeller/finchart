import type { BaseDataPoint } from '@finchart/core';
import type { ReactNode } from 'react';
import { ChartDataProvider } from './chart-context';

export interface ChartDataProps<T extends BaseDataPoint> {
  /** The data the series inside this draw. */
  value: T[];
  children?: ReactNode;
}

/**
 * Gives the series inside it different data.
 *
 * `<ChartContainer data>` is the default for the whole chart. Drawing BTC
 * and ETH together needs somewhere for the second series' data to go —
 * since the registration owns its data, the core can already do this, and
 * this component opens the same path in the declarative lane.
 *
 * ```tsx
 * <ChartContainer deps={deps} data={btc}>
 *   <ChartCandles />              // the container's data
 *   <ChartData value={eth}>
 *     <ChartLine style={{ line: { color: "#888" } }} />  // this data
 *   </ChartData>
 * </ChartContainer>
 * ```
 *
 * When only one series differs, `<ChartLine data={eth} />` is shorter.
 * Reach for this component when several need to see the same thing — a
 * set of indicators running over one source, say.
 *
 * **Doesn't re-fit.** Same rule as declarative data everywhere — mounting
 * ETH later shouldn't jump the window that was showing BTC to their union.
 */
export function ChartData<T extends BaseDataPoint>({
  value,
  children,
}: ChartDataProps<T>) {
  return <ChartDataProvider value={value}>{children}</ChartDataProvider>;
}
