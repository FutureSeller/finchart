/**
 * A pane's options — the door they come in through, the defaults that fill
 * them, and the one way they change afterward.
 */
import {
  requireFinite,
  requireNonNegative,
  requireObject,
  requireOptionalBoolean,
} from "../primitives";
import { requireFunction } from "../primitives/guards";
import type { AxisOptions } from "./types";

export interface PaneOptions {
  /** Share of the leftover vertical space this pane takes. Default 1. */
  flex?: number;
  /** Never shrinks below this (px). Default 40. */
  minHeight?: number;
  /** Margin that keeps the value axis off the data. Default 0.1 */
  valuePadding?: number;
  /**
   * The value axis follows the **visible range**. Default true. This is the
   * default behavior for financial charts — zoom from a year of data into
   * the last week, and that week should fill the pane.
   * Turn it off to fit the whole source dataset instead, after which a
   * manually set value domain is no longer overwritten every frame.
   */
  autoScale?: boolean;
  /** This pane's value axis settings. Anything omitted follows the Plot's default. */
  axis?: AxisOptions;
  /**
   * Inverts the value axis — larger values go toward the bottom. The right
   * spot for values where "smaller is better," like the spread on a yield
   * curve.
   */
  invert?: boolean;
}

/**
 * Default pane options — **one set.** `settleOptions` reads this, and
 * react (`<ChartPane>`) buys "removing a prop reverts to the default" off of
 * it — if the wrapper copied the numbers instead, only the wrapper would go
 * stale when these change.
 */
export const PANE_OPTION_DEFAULTS = {
  flex: 1,
  minHeight: 40,
  valuePadding: 0.1,
  autoScale: true,
  invert: false,
} as const;

/**
 * The numeric contract for pane options. **`flex` becomes a denominator in
 * layout** (`flexTotal` in `layout.ts`) — feed it `Infinity` and the pane
 * height becomes `NaN`, which then leaks into the canvas size.
 *
 * **Both** the constructor and `applyOptions` pass through here — if the two
 * spots diverge, only one of them gets fixed. Zero is not blocked: a pane at
 * `flex: 0` takes only its `minHeight` — a consumer collapsing it by hand.
 */
export function checkPaneNumbers(options: PaneOptions): void {
  if (options.flex !== undefined) requireNonNegative(options.flex, "pane flex");
  if (options.minHeight !== undefined) {
    requireNonNegative(options.minHeight, "pane minHeight");
  }
  if (options.valuePadding !== undefined) {
    requireNonNegative(options.valuePadding, "pane valuePadding");
  }
  // A nested spot is still a door — `PaneOptions.axis` takes a whole
  // `AxisOptions`, so `minTickSpacing` arrives here too. A `NaN` tick
  // spacing makes the ticks quietly vanish.
  if (options.axis?.minTickSpacing !== undefined) {
    requireFinite(options.axis.minTickSpacing, "pane axis minTickSpacing");
  }
  checkAxisCallbacks(options.axis, "pane axis");
  // `"false"` from storage or an attribute is truthy.
  requireOptionalBoolean(options.autoScale, "pane autoScale");
  requireOptionalBoolean(options.invert, "pane invert");
}

/**
 * An axis's callbacks are checked where they are given — accepted as
 * anything else, they would fail on every frame instead.
 */
export function checkAxisCallbacks(axis: AxisOptions | undefined, label: string): void {
  if (axis?.format !== undefined) requireFunction(axis.format, `${label} format`);
  if (axis?.ticks !== undefined) {
    requireObject(axis.ticks, `${label} ticks`);
    requireFunction(axis.ticks.ticks, `${label} ticks.ticks`);
  }
}

/**
 * A pane's settled options — every field present, defaults filled in.
 *
 * **Reading is open; writing goes through `applyPaneOptions` alone.** Back
 * when these were assignable fields on the pane, there were two doors and
 * one of them was silent — `pane.flex = 2` went through with no
 * notification and no render. Even the chart itself wrote through that
 * silent door on divider drag and patched in a state notification by hand,
 * which means the rule existed only as convention, not in code.
 */
export interface PaneSettings {
  readonly valuePadding: number;
  readonly autoScale: boolean;
  readonly flex: number;
  readonly minHeight: number;
  readonly axis: AxisOptions;
  readonly invert: boolean;
}

/** The constructor's door — checks the numbers and fills the defaults. */
export function settleOptions(options: PaneOptions): PaneSettings {
  checkPaneNumbers(options);
  return {
    valuePadding: options.valuePadding ?? PANE_OPTION_DEFAULTS.valuePadding,
    autoScale: options.autoScale ?? PANE_OPTION_DEFAULTS.autoScale,
    flex: options.flex ?? PANE_OPTION_DEFAULTS.flex,
    minHeight: options.minHeight ?? PANE_OPTION_DEFAULTS.minHeight,
    axis: { ...options.axis },
    invert: options.invert ?? PANE_OPTION_DEFAULTS.invert,
  };
}

/**
 * The next settings after a patch. Changes only what's given — same rule as
 * `Plot.applyOptions`, omitting means "leave as is."
 *
 * `settings` says whether a field the chart announces through
 * `panesChange` actually moved — the layout (flex, minHeight) or the value
 * axis's mode (autoScale, invert). Checked against the current values, not
 * against what was given, so a patch that repeats the current flex doesn't
 * wake whoever follows the panes. `valuePadding` and `axis` shape how a pane
 * draws, not where it sits or how its axis follows — they stay quiet.
 */
export function applyPaneOptions(
  current: PaneSettings,
  options: PaneOptions,
): { next: PaneSettings; settings: boolean } {
  requireObject(options, "applyOptions(options)");
  checkPaneNumbers(options);

  const settings =
    (options.flex !== undefined && options.flex !== current.flex) ||
    (options.minHeight !== undefined && options.minHeight !== current.minHeight) ||
    (options.autoScale !== undefined && options.autoScale !== current.autoScale) ||
    (options.invert !== undefined && options.invert !== current.invert);

  return {
    next: {
      valuePadding: options.valuePadding ?? current.valuePadding,
      autoScale: options.autoScale ?? current.autoScale,
      flex: options.flex ?? current.flex,
      minHeight: options.minHeight ?? current.minHeight,
      axis: options.axis !== undefined ? { ...current.axis, ...options.axis } : current.axis,
      invert: options.invert ?? current.invert,
    },
    settings,
  };
}
