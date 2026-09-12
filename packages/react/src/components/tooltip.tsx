import type { ConfigurablePluginApi } from '@finchart/core';
import type { LegendOptions, RowFormat, TooltipOptions } from '@finchart/dom';
import { legend, tooltip } from '@finchart/dom';
import { useEffect, useRef } from 'react';
import { useChartApi } from './chart-context';

export interface TooltipProps {
  /** The x format for the header. Leave it out and the header speaks the axis's clock — `axis.x.format`, else the tick strategy's (`timeTicks` knows its zone), else the rounded number. */
  formatX?: (x: number) => string;
  /** Value format for each row. Defaults to two decimals. */
  formatValue?: (value: number) => string;
  /** The format for a row a series describes for itself (a candle's O/H/L/C/V), with `{ label, sample }` — so `V` can read as a volume. Absent, such rows read through `formatValue`. */
  formatRow?: RowFormat;
}

/**
 * Follows the cursor and shows the series values at that x.
 *
 * ```tsx
 * <Tooltip formatX={dateLabel} />
 * ```
 *
 * Each row's name and color come from the series component's `name` and
 * `color` props. **Doesn't rebuild when the format function's reference
 * changes** — just re-applies the options.
 */
export function Tooltip({ formatX, formatValue, formatRow }: TooltipProps) {
  const { plot } = useChartApi('Tooltip');
  const installed = useRef<ConfigurablePluginApi<TooltipOptions> | null>(null);

  useEffect(() => {
    const api = plot.use(tooltip({ formatX, formatValue, formatRow }));
    installed.current = api;

    return () => {
      installed.current = null;
      api.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);

  useEffect(() => {
    installed.current?.applyOptions({ formatX, formatValue, formatRow });
  }, [formatX, formatValue, formatRow]);

  return null;
}

export interface LegendProps {
  /** Value format. Defaults to two decimals. */
  formatValue?: (value: number) => string;
  /** The format for a row a series describes for itself (a candle's O/H/L/C/V), with `{ label, sample }`. Absent, such rows read through `formatValue`. */
  formatRow?: RowFormat;
}

/**
 * Shows each series' name, color, and value at the top-left of
 * `mainPane`. The value tracks the cursor, or the last value when there's
 * no cursor. Only series that were given a `name` show up.
 */
export function Legend({ formatValue, formatRow }: LegendProps) {
  const { plot } = useChartApi('Legend');
  const installed = useRef<ConfigurablePluginApi<Omit<LegendOptions, 'pane'>> | null>(null);

  useEffect(() => {
    const api = plot.use(legend({ formatValue, formatRow }));
    installed.current = api;

    return () => {
      installed.current = null;
      api.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);

  useEffect(() => {
    installed.current?.applyOptions({ formatValue, formatRow });
  }, [formatValue, formatRow]);

  return null;
}
