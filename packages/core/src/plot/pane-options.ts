/**
 * A pane's options — the door they come in through, the defaults that fill
 * them, and the one way they change afterward.
 */
import {
  ContractError,
  requireFinite,
  requireNonNegative,
  requireObject,
  requireOptionalBoolean,
} from "../primitives";
import { requireFunction } from "../primitives/guards";
import type { AxisOptions } from "./types";

export interface PaneOptions {
  /**
   * Stable identity for persisted view state. Give dynamically assembled
   * panes a semantic key (`"rsi"`, `"volume"`); it is written to
   * `ChartState` and cannot be changed after the pane has claimed it.
   */
  stateKey?: string;
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
   * curve. This is state (`PaneState.invert`).
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
 * spots diverge, only one of them gets fixed. Zero is not blocked: `flex: 0`
 * is the idiom `paneMaximize` uses to collapse a pane.
 */
export function checkPaneNumbers(options: PaneOptions): void {
  if (
    options.stateKey !== undefined &&
    (typeof options.stateKey !== "string" || options.stateKey.trim().length === 0)
  ) {
    throw new ContractError("pane stateKey must be a non-empty string");
  }
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
  readonly stateKey: string | null;
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
    stateKey: options.stateKey ?? null,
  };
}

/**
 * The next settings after a patch. Changes only what's given — same rule as
 * `Plot.applyOptions`, omitting means "leave as is."
 *
 * `state` says whether a **state field** (`PaneState`: flex, autoScale,
 * invert, stateKey) actually moved — checked against the current values,
 * not against what was given, so a patch that repeats the current flex
 * doesn't wake whatever mirrors the chart's state.
 *
 * A `stateKey` can be claimed once. Changing it afterward would make an
 * already-persisted snapshot point at a different pane, so that's refused —
 * a new identity is a new pane. `assertStateKeyAvailable` is the chart's
 * uniqueness check, asked before the claim lands.
 */
export function applyPaneOptions(
  current: PaneSettings,
  options: PaneOptions,
  assertStateKeyAvailable?: (key: string) => void,
): { next: PaneSettings; state: boolean } {
  requireObject(options, "applyOptions(options)");
  checkPaneNumbers(options);

  const state =
    (options.flex !== undefined && options.flex !== current.flex) ||
    (options.autoScale !== undefined && options.autoScale !== current.autoScale) ||
    (options.invert !== undefined && options.invert !== current.invert) ||
    (options.stateKey !== undefined && options.stateKey !== current.stateKey);

  let stateKey = current.stateKey;
  if (options.stateKey !== undefined && options.stateKey !== current.stateKey) {
    if (current.stateKey !== null) {
      throw new ContractError(
        `pane stateKey is already "${current.stateKey}" and cannot be changed; create a new pane for a new identity`,
      );
    }
    assertStateKeyAvailable?.(options.stateKey);
    stateKey = options.stateKey;
  }

  return {
    next: {
      valuePadding: options.valuePadding ?? current.valuePadding,
      autoScale: options.autoScale ?? current.autoScale,
      flex: options.flex ?? current.flex,
      minHeight: options.minHeight ?? current.minHeight,
      axis: options.axis !== undefined ? { ...current.axis, ...options.axis } : current.axis,
      invert: options.invert ?? current.invert,
      stateKey,
    },
    state,
  };
}
