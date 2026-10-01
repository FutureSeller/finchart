/**
 * The config's doors — taking one in, checking its numbers, and changing it.
 *
 * Nothing here knows the chart exists. That's the point: the "explicit
 * `undefined` means not given" rule and the numeric guards used to be
 * checkable only by standing up a whole chart and reading the plot area.
 */
import { MIN_TICK_SPACING } from "../axis";
import {
  ContractError,
  definedOnly,
  requireFinite,
  requireNonNegative,
} from "../primitives";
import { checkAxisCallbacks } from "./pane-options";
import { DEFAULT_PADDING } from "./style";
import type {
  PlotConfig,
  PlotOptionsPatch,
  ResolvedPlotConfig,
  ResolvedXAxisOptions,
  ResolvedYAxisOptions,
  XAxisOptions,
  YAxisOptions,
} from "./types";

export interface ViewportDimensions {
  width: number;
  height: number;
}

/**
 * The door for the chart's size (zero trust).
 *
 * `setViewport` guards with `requireNonNegative`, but **the constructor
 * didn't.** The conformance table's (`boundary-values.test.ts`)
 * `GUARDED.Plot` **declared** that *"the constructor becomes dimensions and
 * a domain,"* which made that omission false on its own terms.
 *
 * Why this spot stings more under zero trust: **`width` comes out of layout
 * arithmetic.** A container width minus a sidebar going negative mid-transition
 * isn't a programmer mistake, it's an ordinary frame. And `@finchart/react`
 * sends dimensions through **the constructor at mount, `setViewport`
 * afterward** (`use-chart.ts`), so with only one of the two guarded, **the
 * same value behaves differently depending on when it arrives.**
 *
 * **Negative is rejected; zero is not** — the note inside the function says
 * why zero has to stay legal. `setViewport` ignores degenerate dimensions (it
 * skips the render), but there the values come from `ResizeObserver`, whereas
 * here the consumer is standing a chart up for the first time.
 */
export function checkViewportSize(size: ViewportDimensions): void {
  if (typeof size !== "object" || size === null) {
    throw new ContractError(
      `size must be a { width, height } object, got ${size === null ? "null" : typeof size}`,
    );
  }
  /**
   * **Zero is not rejected.**
   *
   * An earlier version of this guard wrote it as `requirePositive`, then
   * reverted that. `setViewport` uses `requireNonNegative` and accepts 0; if
   * only the constructor threw, **"the same value behaves differently depending on
   * when it arrives"** — the very reason this door was opened — would still
   * hold, and one side would get worse: with `<Chart width={measured}>`, the
   * first paint, a `display: none` tab, or an unresolved flex all leave
   * `measured === 0`, and then **mounting dies with a ContractError.**
   * Yesterday an empty chart drew and recovered on the next resize.
   *
   * The same rule that governs `zoomSpeed` applies here unchanged —
   * *"a guard on a value with no meaning is free whenever you add it, a
   * guard on a value that has meaning is only free before release."*
   * `width: 0` has a meaning today: **"layout hasn't happened yet."**
   * Negative has no meaning, so it stays rejected.
   */
  requireNonNegative(size.width, "size width");
  requireNonNegative(size.height, "size height");
}

/**
 * The numeric door for the chart's options, closed the rest of the way after
 * `checkPaneNumbers` guarded only the pane side.
 *
 * That left **only one of the two sibling option objects covered**, and the
 * conformance table marked `Plot` as covered — true for `setViewport` but
 * false for `applyOptions`. The exact same shape as the sibling-field accident caught
 * in `state.ts` recurred here, inside the machinery meant to catch it.
 *
 * The amplifier each field is wired to:
 *
 * - `padding`, `paneGap` — **amplifies.** These are terms in layout
 *   arithmetic, so `NaN` propagates all the way to canvas dimensions.
 * - `rightOffset` — **delays.** It sits in config until the next refit
 *   (`fitDomains`, or first data), becomes a domain, and blows up there with
 *   `ContractError: domain max ...`. Since the error comes from the scale,
 *   **the consumer has no way to know a settings-panel slider is what killed
 *   data loading.**
 * - `minBarSpacing`, `maxBarSpacing` — **delays.** `x-viewport.ts` writes
 *   `minBarSpacing ? …`, so `NaN` is swallowed as falsy and **silently
 *   becomes "no limit."** Worse for not throwing — the consumer never learns
 *   why the zoom limit they set isn't taking effect.
 *
 * Negatives are rejected too. This guard once exempted them ("that would
 * break something that currently works"), but the premise was false — a
 * negative minBarSpacing flips the span clamp's sign in `x-viewport.ts`
 * and **silently locks zoom-out at the current width**, the opposite
 * direction of the NaN failure and just as quiet. Zero stays legal: it is
 * the documented "no limit in that direction". And the **pair** is a door
 * of its own — a floor above the ceiling (both positive, min > max) can't
 * be satisfied by any spacing, so zooming would dead-end either way.
 */
/**
 * Which door the numbers come through. `null` on a bar-spacing key clears
 * an override — that is a patch's word, and only a patch's: the constructor
 * has nothing to clear, so there `null` is a wrong shape and is refused
 * before `resolveConfig` could copy it into a config that promises
 * number-or-absent.
 */
export type PlotNumbersDoor = "patch" | "construct";

export function checkPlotNumbers(
  options: PlotOptionsPatch,
  door: PlotNumbersDoor = "patch",
): void {
  const { padding, paneGap, rightOffset, minBarSpacing, maxBarSpacing, axis } =
    options;

  if (padding) {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const value = padding[side];
      if (value !== undefined) requireFinite(value, `padding ${side}`);
    }
  }
  // A negative gap has no meaning and is harmful — `distributeHeights` hands
  // out vertical space that doesn't exist, so panes overlap (measured: 800×600,
  // 2 panes, `paneGap: -200` produces a 200px overlap), and the boundary line
  // and drag handle land somewhere that's the edge of neither pane. Rejecting
  // a meaningless negative here is the same line drawn for `flex`,
  // `minHeight`, and `valuePadding`.
  if (paneGap !== undefined) requireNonNegative(paneGap, "paneGap");
  if (rightOffset !== undefined) requireFinite(rightOffset, "rightOffset");
  // `null` is "clear the override", so there is no number to check — but
  // only null and undefined skip the guard; a string or a boolean still has
  // to fail it, the way it did before null was allowed. The ordering check
  // likewise only has something to say when both are values.
  if (door === "construct" && (minBarSpacing === null || maxBarSpacing === null)) {
    throw new ContractError(
      "minBarSpacing/maxBarSpacing: null clears an override through applyOptions — leave the key out of the constructor's config instead",
    );
  }
  const min = minBarSpacing ?? undefined;
  const max = maxBarSpacing ?? undefined;
  if (min !== undefined) requireNonNegative(min, "minBarSpacing");
  if (max !== undefined) requireNonNegative(max, "maxBarSpacing");
  if (
    min !== undefined &&
    max !== undefined &&
    min > 0 &&
    max > 0 &&
    min > max
  ) {
    throw new ContractError(
      `minBarSpacing(${min}) must not exceed maxBarSpacing(${max})`,
    );
  }

  /**
   * **A nested spot is a door too.**
   *
   * That guard only checked the flat five — because the review reported
   * five symptoms, **not because the type happens to have five numeric
   * fields.** `axis.y.size` sits in the config and becomes axis width
   * during layout, which is exactly "delayed," and at `Infinity` the data
   * area gets squeezed to zero width, so **commands drop to zero** — no
   * throw, the chart just goes permanently blank. The path there is one
   * documented prop: `<YAxis size={n} />` in `@finchart/react` (`axes.tsx`).
   *
   * `style.grid.width` is **deliberately not checked** — canvas ignores
   * `lineWidth` on the shape it's drawing a metaphor for, by spec, so there's
   * no amplifier. That judgment is recorded, with its reason, in
   * `boundary-values.test.ts`'s `EXEMPT_DOORS`, and any new numeric field not
   * listed there is caught by the test.
   */
  for (const [side, options] of [
    ["x", axis?.x],
    ["y", axis?.y],
  ] as const) {
    if (!options) continue;
    if (options.size !== undefined) {
      requireFinite(options.size, `axis ${side} size`);
    }
    if (options.minTickSpacing !== undefined) {
      requireFinite(options.minTickSpacing, `axis ${side} minTickSpacing`);
    }
    checkAxisCallbacks(options, `axis ${side}`);
  }
}

/**
 * A config with no object shared with its source. Used at both doors that
 * cross the ownership line — taking one in (constructor) and handing one
 * out (`getOptions`) — so neither side can reach the chart's internals
 * through a nested object it still holds. There are only three nested
 * spots (padding, axis, style), so they're copied by hand — structured
 * cloning (`structuredClone`) throws on fields holding functions, like
 * `format` and `ticks`.
 */
export function copyConfig(config: ResolvedPlotConfig): ResolvedPlotConfig {
  const { axis, style } = config;

  return {
    ...config,
    padding: { ...config.padding },
    axis: { x: { ...axis.x }, y: { ...axis.y } },
    style: style.grid ? { grid: { ...style.grid } } : {},
  };
}

/**
 * The one table every static default comes from. A default that lived at
 * its read site got copied (`paneGap ?? 0` three times over) and drifted
 * (the tick-spacing constants re-typed as bare literals elsewhere) — with
 * both doors resolving against this table, a second copy of a default has
 * no place to live. `minBarSpacing`/`maxBarSpacing` are absent on purpose
 * — see `ResolvedPlotConfig`.
 */
export const PLOT_CONFIG_DEFAULTS: ResolvedPlotConfig = {
  padding: DEFAULT_PADDING,
  showGrid: true,
  paneGap: 0,
  shiftVisibleRangeOnNewBar: false,
  resizablePanes: true,
  axisDrag: true,
  rightOffset: 0,
  axis: {
    x: { showLabels: true, minTickSpacing: MIN_TICK_SPACING.horizontal },
    y: {
      showLabels: true,
      minTickSpacing: MIN_TICK_SPACING.vertical,
      position: "left",
    },
  },
  style: {},
};

function resolveAxisX(given: XAxisOptions | undefined): ResolvedXAxisOptions {
  const defaults = PLOT_CONFIG_DEFAULTS.axis.x;
  return {
    ...given,
    showLabels: given?.showLabels ?? defaults.showLabels,
    minTickSpacing: given?.minTickSpacing ?? defaults.minTickSpacing,
  };
}

function resolveAxisY(given: YAxisOptions | undefined): ResolvedYAxisOptions {
  const defaults = PLOT_CONFIG_DEFAULTS.axis.y;
  return {
    ...given,
    showLabels: given?.showLabels ?? defaults.showLabels,
    minTickSpacing: given?.minTickSpacing ?? defaults.minTickSpacing,
    position: given?.position ?? defaults.position,
  };
}

/**
 * The constructor's half of resolution: ownership (nothing shared with the
 * caller — fresh nested objects throughout) and every static default
 * filled, in one pass. An explicit `undefined` means "not given" here too;
 * at this door there is nothing to revert, so it lands on the default
 * either way.
 */
export function resolveConfig(config: PlotConfig): ResolvedPlotConfig {
  const defaults = PLOT_CONFIG_DEFAULTS;
  const { padding, axis, style, ...flat } = config;

  return {
    showGrid: defaults.showGrid,
    paneGap: defaults.paneGap,
    shiftVisibleRangeOnNewBar: defaults.shiftVisibleRangeOnNewBar,
    resizablePanes: defaults.resizablePanes,
    axisDrag: defaults.axisDrag,
    rightOffset: defaults.rightOffset,
    ...definedOnly(flat),
    padding: { ...defaults.padding, ...definedOnly(padding) },
    axis: { x: resolveAxisX(axis?.x), y: resolveAxisY(axis?.y) },
    style: style?.grid ? { grid: { ...style.grid } } : {},
  };
}

/**
 * The next config after a patch. **Only the fields given change** — which
 * fields swap as a unit is documented on `PlotOptionsPatch`.
 *
 * **An explicit `undefined` means "not given"** for the flat fields and
 * for `padding`. A spread treats `undefined` as a value too, erasing a
 * config that was actually set — and this door's consumers call it exactly
 * that way: a wrapper's optional prop arrives as `undefined` when not
 * given. Measured: `applyOptions({ showGrid: props.showGrid })` with no
 * prop made `showGrid` `undefined`, and `gridDecoration`'s `if (!show)
 * return` turned the grid off **permanently.** `shiftVisibleRangeOnNewBar:
 * undefined` silently killed following real-time, and `paneGap: undefined`
 * slid past `?? 0` and silently killed a gap the user set.
 * `checkPlotNumbers` sits entirely behind `!== undefined` checks, so none
 * of this is caught there.
 *
 * `padding` amplifies fastest: `applyOptions({padding:{left:props.x}})`
 * with no prop made `plotAreaOf` produce `left: undefined`, and `sliceAxes`
 * propagated `NaN`, throwing `ContractError: range start must be a finite
 * number, got NaN` **inside that very call.**
 *
 * `axis` is **deliberately excluded.** There, an explicit `undefined` has
 * meaning — `<XAxis />` passing along a prop it wasn't given *is* "revert to
 * the default" (`axes.tsx`), and that's the only way to clear it. And since
 * the door resolves what it hands back, a cleared field that has a default
 * comes out as that default's value, not as a hole for a read site to fill.
 *
 * `style` is replaced wholesale → `PlotOptionsPatch.style`.
 */
export function mergeOptions(
  current: ResolvedPlotConfig,
  patch: PlotOptionsPatch,
): ResolvedPlotConfig {
  // The two spacing fields come out before the spread: they are the only
  // ones that can be `null`, and `definedOnly` drops undefined alone — spread
  // through, `null` would land in the resolved config and show up in
  // `getOptions()`. They are settled below, key by key.
  const { padding, axis, style, minBarSpacing, maxBarSpacing, ...flat } = patch;

  const next: ResolvedPlotConfig = {
    ...current,
    ...definedOnly(flat),
    padding: { ...current.padding, ...definedOnly(padding) },
    axis: {
      x: resolveAxisX({ ...current.axis.x, ...axis?.x }),
      y: resolveAxisY({ ...current.axis.y, ...axis?.y }),
    },
    style: style ? { grid: style.grid && { ...style.grid } } : current.style,
  };
  settleSpacing(next, "minBarSpacing", minBarSpacing);
  settleSpacing(next, "maxBarSpacing", maxBarSpacing);
  return next;
}

/**
 * `null` clears — the key is removed so the x mapping's own default is read
 * again (`x-viewport.ts` reads it with `??`); a number is the new standing
 * value; `undefined` was not given and changes nothing. The resolved config
 * stays number-or-absent, which is what everything downstream reads.
 */
function settleSpacing(
  config: ResolvedPlotConfig,
  key: "minBarSpacing" | "maxBarSpacing",
  value: number | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    delete config[key];
    return;
  }
  config[key] = value;
}
