import type { ConfigurablePluginApi } from '@finchart/core';
import type { LegendOptions, TooltipOptions } from '@finchart/dom';
import { legend, tooltip } from '@finchart/dom';
import { useEffect, useRef } from 'react';
import { useChartApi } from './chart-context';

export interface TooltipProps {
  /** The x format for the header. Give it the same one used for the axis's `format` and they'll speak the same way. */
  formatX?: (x: number) => string;
  /** Value format for each row. Defaults to two decimals. */
  formatValue?: (value: number) => string;
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
export function Tooltip({ formatX, formatValue }: TooltipProps) {
  const { plot } = useChartApi('Tooltip');
  const installed = useRef<ConfigurablePluginApi<TooltipOptions> | null>(null);

  useEffect(() => {
    const api = plot.use(tooltip({ formatX, formatValue }));
    installed.current = api;

    return () => {
      installed.current = null;
      api.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);

  useEffect(() => {
    installed.current?.applyOptions({ formatX, formatValue });
  }, [formatX, formatValue]);

  return null;
}

export interface LegendProps {
  /** Value format. Defaults to two decimals. */
  formatValue?: (value: number) => string;
}

/**
 * Shows each series' name, color, and value at the top-left of
 * `mainPane`. The value tracks the cursor, or the last value when there's
 * no cursor. Only series that were given a `name` show up.
 */
export function Legend({ formatValue }: LegendProps) {
  const { plot } = useChartApi('Legend');
  const installed = useRef<ConfigurablePluginApi<Omit<LegendOptions, 'pane'>> | null>(null);

  useEffect(() => {
    const api = plot.use(legend({ formatValue }));
    installed.current = api;

    return () => {
      installed.current = null;
      api.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);

  useEffect(() => {
    installed.current?.applyOptions({ formatValue });
  }, [formatValue]);

  return null;
}
