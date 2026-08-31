/**
 * The config's doors — taking one in, checking its numbers, and changing it.
 *
 * Nothing here knows the chart exists. That's the point: the "explicit
 * `undefined` means not given" rule and the numeric guards used to be
 * checkable only by standing up a whole chart and reading the plot area.
 */
import {
  ContractError,
  definedOnly,
  requireFinite,
  requireNonNegative,
} from "../primitives";
import type { PlotConfig, PlotOptionsPatch } from "./types";

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
 * **Only finiteness is checked.** Rejecting negatives has no basis yet —
 * that would break something that currently works, so it waits for a real
 * consumer to force the call.
 */
export function checkPlotNumbers(options: PlotOptionsPatch): void {
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
  if (minBarSpacing !== undefined) {
    requireFinite(minBarSpacing, "minBarSpacing");
  }
  if (maxBarSpacing !== undefined) {
    requireFinite(maxBarSpacing, "maxBarSpacing");
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
export function copyConfig(config: PlotConfig): PlotConfig {
  const { padding, axis, style } = config;
  const copy: PlotConfig = { ...config, padding: { ...padding } };

  if (axis) {
    copy.axis = {};
    if (axis.x) copy.axis.x = { ...axis.x };
    if (axis.y) copy.axis.y = { ...axis.y };
  }
  if (style) {
    copy.style = style.grid ? { grid: { ...style.grid } } : {};
  }

  return copy;
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
 * the default" (`axes.tsx`), and that's the only way to clear it.
 *
 * `style` is replaced wholesale → `PlotOptionsPatch.style`.
 */
export function mergeOptions(
  current: PlotConfig,
  patch: PlotOptionsPatch,
): PlotConfig {
  const { padding, axis, style, ...flat } = patch;

  return {
    ...current,
    ...definedOnly(flat),
    padding: { ...current.padding, ...definedOnly(padding) },
    axis: {
      x: { ...current.axis?.x, ...axis?.x },
      y: { ...current.axis?.y, ...axis?.y },
    },
    style: style ? { grid: style.grid } : current.style,
  };
}
