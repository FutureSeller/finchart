import type { Padding, PlotOptionsPatch, ResolvedPlotConfig } from '@finchart/core';

/**
 * The plot options that have no prop of their own. `axis` belongs to
 * `<XAxis>`/`<YAxis>`, `style.grid` to `gridStyle`, and `showGrid` and
 * `paneGap` are props — one door per value, because two doors to the same
 * value erase each other (the value axis once had two, and whichever effect
 * ran last won).
 *
 * A key that is missing reverts to what the plot was built with. The list
 * is a `Pick`, named twice — here and in `pickPlotOptions` — on purpose: an
 * option the core adds later is not in this door until the wrapper has
 * decided how it reverts, rather than admitted by the type and dropped at
 * runtime. And a variable typed as the wider `PlotOptionsPatch` still
 * assigns to a `Pick`, so the keys are picked by name before anything
 * reaches the plot.
 */
export type PlotOptions = Pick<
  PlotOptionsPatch,
  | 'padding'
  | 'resizablePanes'
  | 'shiftVisibleRangeOnNewBar'
  | 'axisDrag'
  | 'rightOffset'
  | 'minBarSpacing'
  | 'maxBarSpacing'
>;

/** What the plot was built with, for the keys `options` may name. Read once, right after `build`. */
export interface PlotOptionsBaseline {
  padding: Padding;
  resizablePanes: boolean;
  shiftVisibleRangeOnNewBar: boolean;
  axisDrag: boolean;
  rightOffset: number;
}

export function baselineOf(config: ResolvedPlotConfig): PlotOptionsBaseline {
  return {
    padding: { ...config.padding },
    resizablePanes: config.resizablePanes,
    shiftVisibleRangeOnNewBar: config.shiftVisibleRangeOnNewBar,
    axisDrag: config.axisDrag,
    rightOffset: config.rightOffset,
  };
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * The patch the plot gets: every key named, a missing one carrying its built
 * value — every padding side too, since core merges padding per side and a
 * side set once would otherwise survive its key's removal — and the two
 * bar-spacing keys carrying `null`, which is how the core says "clear the
 * override" for the pair whose default is the x mapping's, not a number the
 * chart owns.
 */
export function pickPlotOptions(
  baseline: PlotOptionsBaseline,
  options: PlotOptions | undefined,
): PlotOptionsPatch {
  const padding = { ...baseline.padding };
  for (const side of SIDES) {
    const given = options?.padding?.[side];
    if (given !== undefined) padding[side] = given;
  }
  return {
    padding,
    resizablePanes: options?.resizablePanes ?? baseline.resizablePanes,
    shiftVisibleRangeOnNewBar: options?.shiftVisibleRangeOnNewBar ?? baseline.shiftVisibleRangeOnNewBar,
    axisDrag: options?.axisDrag ?? baseline.axisDrag,
    rightOffset: options?.rightOffset ?? baseline.rightOffset,
    minBarSpacing: options?.minBarSpacing ?? null,
    maxBarSpacing: options?.maxBarSpacing ?? null,
  };
}
