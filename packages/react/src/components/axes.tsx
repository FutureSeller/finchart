import type { XAxisOptions, YAxisOptions } from '@finchart/core';
import { useContext, useEffect } from 'react';
import { PaneContextValue, useChartApi } from './chart-context';

/**
 * The core's axis options are the props, directly — copying them by hand
 * would let this quietly go stale as the core grows. The core is the
 * source of truth for field docs.
 */
export type XAxisProps = XAxisOptions;
export type YAxisProps = YAxisOptions;

/**
 * The horizontal axis. Shared by every pane, so there's only ever one.
 * Tick labels sit below the bottom-most pane.
 */
export function XAxis(props: XAxisProps) {
  const { showLabels, format, minTickSpacing, ticks, size, ...rest } = props;
  // Compilation breaks here when the core adds an option — carry the new field into the effect below.
  const unwired: Record<string, never> = rest;
  void unwired;

  const { plot } = useChartApi('XAxis');

  const apply = (x: XAxisOptions) => plot.applyOptions({ axis: { ...plot.getOptions().axis, x } });
  useEffect(() => {
    apply({ showLabels, format, minTickSpacing, ticks, size });
  }, [plot, showLabels, format, minTickSpacing, ticks, size]);
  // Unmounting is removing every prop — an explicit undefined reverts each
  // field to its default. Kept apart from the effect above so a prop change
  // applies once instead of reverting first.
  useEffect(
    () => () =>
      apply({ showLabels: undefined, format: undefined, minTickSpacing: undefined, ticks: undefined, size: undefined }),
    [plot],
  );

  return null;
}

/**
 * The value axis. Inside a `<ChartPane>`, it belongs to that pane; outside
 * one, it's the default for every pane.
 *
 * Every pane has its own scale, so one setting never spans several panes —
 * a `<YAxis>` placed inside a pane overrides the outer default.
 *
 * **Placement (`position`, `size`) is chart-wide** (see the core's
 * `YAxisOptions`) — ignored inside a pane. Give it to the `<YAxis>`
 * outside a pane if you want the axis on the right.
 */
export function YAxis(props: YAxisProps) {
  const { showLabels, format, minTickSpacing, ticks, size, position, ...rest } =
    props;
  // Compilation breaks here when the core adds an option — carry the new field into the effect below.
  const unwired: Record<string, never> = rest;
  void unwired;

  const { plot } = useChartApi('YAxis');
  const pane = useContext(PaneContextValue);

  const apply = (y: YAxisOptions) =>
    pane
      ? pane.applyOptions({ axis: { showLabels: y.showLabels, format: y.format, minTickSpacing: y.minTickSpacing, ticks: y.ticks } })
      : plot.applyOptions({ axis: { ...plot.getOptions().axis, y } });
  useEffect(() => {
    apply({ showLabels, format, minTickSpacing, ticks, size, position });
  }, [plot, pane, showLabels, format, minTickSpacing, ticks, size, position]);
  // Unmounting is removing every prop — an explicit undefined reverts each
  // field, so a pane that outlives its YAxis (a keyed swap keeps the main
  // pane) doesn't keep its format. Apart from the effect above, so a prop
  // change applies once instead of reverting first.
  useEffect(
    () => () =>
      apply({ showLabels: undefined, format: undefined, minTickSpacing: undefined, ticks: undefined, size: undefined, position: undefined }),
    [plot, pane],
  );

  return null;
}
