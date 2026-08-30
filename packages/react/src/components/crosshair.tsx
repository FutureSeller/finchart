import type { ConfigurablePluginApi, CrosshairLineOptions } from '@finchart/core';
import { crosshair } from '@finchart/core';
import { useEffect, useRef } from 'react';
import { useChartApi } from './chart-context';

/**
 * The core's options are the props, directly — copying them by hand would
 * let this quietly go stale as the core grows (`magnet` actually did). The
 * core is the source of truth for field docs.
 */
export type CrosshairProps = CrosshairLineOptions;

/**
 * A crosshair that follows the cursor.
 *
 * ```tsx
 * <Crosshair />
 * ```
 *
 * **A decoration, not a series.** It belongs to the chart and doesn't
 * touch any value axis, so placing it inside or outside a pane makes no
 * difference — it crosses both panes.
 *
 * To receive the cursor position as a value, use `<ChartContainer
 * onCrosshair>`. That's independent of this decoration, so you can turn
 * the crosshair off and still get the value.
 *
 * **Inline objects like `format` are fine to pass** — when the reference
 * changes, only the options get re-applied. This used to rebuild the
 * whole decoration.
 */
export function Crosshair(props: CrosshairProps) {
  const { vertical, horizontal, style, badges, magnet, format, ...rest } = props;
  // Compilation breaks here when the core adds an option — carry the new field into the two effects below.
  const unwired: Record<string, never> = rest;
  void unwired;

  const { plot } = useChartApi('Crosshair');
  const installed = useRef<ConfigurablePluginApi<CrosshairLineOptions> | null>(
    null,
  );

  /**
   * **Installed once per chart.** When a prop changes, only the options
   * get re-applied below.
   *
   * It used to tear down and reinstall even when a single format function
   * changed — in the common case of passing an inline object, that was
   * every render, and each time a dead plugin piled up on the chart.
   */
  useEffect(() => {
    const cursor = plot.use(
      crosshair({ vertical, horizontal, style, badges, magnet, format }),
    );
    installed.current = cursor;

    return () => {
      installed.current = null;
      cursor.dispose();
    };
    // The values at install time are used only as the initial options — the effect below takes over from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot]);

  useEffect(() => {
    installed.current?.applyOptions({
      vertical,
      horizontal,
      style,
      badges,
      magnet,
      format,
    });
  }, [vertical, horizontal, style, badges, magnet, format]);

  return null;
}
