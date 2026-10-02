import { AXIS_LABEL_OFFSET, Axis, type Tick } from "../axis";
import { definedOnly, type PlotArea } from "../primitives";
import type { Scale, XMapping } from "../scale";
import type { TextSize } from "../render";
import {
  distributeHeights,
  FALLBACK_X_AXIS_HEIGHT,
  FALLBACK_Y_AXIS_WIDTH,
  sliceAreas,
  sliceAxes,
  type AxisSlices,
  type PaneBox,
} from "./layout";
import type { Pane } from "./pane";
import type {
  AxisOptions,
  ResolvedPlotConfig,
  ResolvedXAxisOptions,
  ResolvedYAxisOptions,
} from "./types";

/**
 * Rounds a measured width up to this unit and uses that as the axis width.
 *
 * Using the raw label width would make the axis jitter by a pixel or two
 * every time a value's digit count changes during pan (99.8 ↔ 102.4).
 * Rounding up to a unit means it only jumps when a digit is actually
 * added.
 */
const AXIS_WIDTH_STEP = 8;

/** Vertical space (px) left for a pane no matter how large the axis gets. Zero would let the whole frame get dropped. */
export const MIN_PANE_HEIGHT = 1;

/** Horizontal space (px) left for the data area no matter how large the axis gets. The horizontal counterpart to `MIN_PANE_HEIGHT`. */
const MIN_DATA_WIDTH = 1;

function quantizeUp(value: number): number {
  return Math.ceil(value / AXIS_WIDTH_STEP) * AXIS_WIDTH_STEP;
}

/** One pane's value-axis ticks, and whether to show its labels. */
export interface PaneTicks {
  pane: Pane;
  ticks: Tick[];
  showLabels: boolean;
  /**
   * **The layout collapsed this pane** — a different fact from a consumer
   * turning labels off. Folding the two into a single `showLabels` would
   * make the price badge disappear too under the ordinary setting
   * `axis: { showLabels: false }` ("clean axis, badges only"). A collapsed
   * pane's range is a fake 1px `floorAtOnePixel` laid down, so there's no
   * real space to put a badge on in the first place.
   */
  collapsed: boolean;
}

/** How to measure, and the font to measure with. The two are always present or absent together. */
export interface FrameMeasure {
  font: string;
  of(text: string, font: string): TextSize;
}

export interface FrameInput {
  /** The drawing area with margins subtracted. The axis claims its space here first, then panes split the rest. */
  area: PlotArea;
  panes: readonly Pane[];
  /**
   * What the height split reads, one per pane — `panes` itself when absent.
   * A maximized pane is laid out through this: the chart hands over every
   * other pane at flex 0 without touching the panes' own flex.
   */
  shares?: readonly PaneBox[];
  /** Gap between panes (px). */
  gap: number;
  axis: ResolvedPlotConfig["axis"];
  xScale: Scale;
  x: XMapping;
  /**
   * Whether something puts up tick labels.
   *
   * **If not, no axis claims any space** — leaving this out affects
   * layout, not just drawing. This is the sparkline case.
   */
  labels: boolean;
  /** Something that can measure, if available. **Without it, axis size falls back to a fixed value.** */
  measure: FrameMeasure | null;
}

export interface Frame {
  slices: AxisSlices;
  ticks: { x: Tick[]; y: PaneTicks[] };
}

/**
 * **Nails down one frame's geometry** — axis slices, pane areas, scale
 * range, and one set of ticks.
 *
 * These can't be pulled apart — the number of y ticks comes from a pane's
 * height (in pixels), the y-axis width comes from those ticks' labels, and
 * the x scale's range is only decided after that width is known. The
 * dependency runs one way, so no iterative convergence is needed:
 * **vertical settles first, and horizontal builds on that result.**
 *
 * **Not pure.** It actually plants the scale's range and each pane's
 * area — that's the output of this pass. But the chart (`Plot`) itself
 * knows nothing about any of this: every input arrives as an argument, so
 * this can be called with no layers, no renderer, and no scheduler at all.
 */
/**
 * Whether an area is one a scale can't live in. `setRange(x, x)` is a
 * contract violation, so **either side under 1px counts as undrawable.**
 * `!(x >= 1)` is also true for `NaN`, so an area with `NaN` mixed in is
 * caught as degenerate too.
 */
function isDegenerate(area: PlotArea): boolean {
  return !(area.right - area.left >= 1) || !(area.bottom - area.top >= 1);
}

/**
 * Raises any pane under 1px up to 1px, and subtracts what was borrowed
 * from **the largest pane.**
 *
 * The sum is preserved because `sliceAreas` right after this accumulates
 * this very array to build pane areas — raising heights without
 * compensating would push the last pane below the data area.
 *
 * `null` if the largest pane has nothing to lend — at that point the
 * vertical space is genuinely too small to use, so the whole frame is
 * dropped.
 */
function floorAtOnePixel(
  heights: readonly number[],
): { heights: number[]; collapsed: ReadonlySet<number> } | null {
  const raised = heights.map((height) => Math.max(1, height));
  const collapsed = new Set<number>();
  heights.forEach((height, index) => {
    if (height < 1) collapsed.add(index);
  });

  const borrowed = raised.reduce((total, height, index) => {
    return total + (height - heights[index]);
  }, 0);
  if (borrowed === 0) return { heights: raised, collapsed };

  let tallest = 0;
  for (let index = 1; index < raised.length; index += 1) {
    if (raised[index] > raised[tallest]) tallest = index;
  }
  if (raised[tallest] - borrowed < 1) return null;

  raised[tallest] -= borrowed;
  return { heights: raised, collapsed };
}

/** What the vertical half of a frame needs to know. */
export type PaneHeightInput = Pick<FrameInput, "area" | "panes" | "shares" | "gap" | "axis" | "labels" | "measure">;

/**
 * The pane heights a frame of this input lays out — the vertical half of
 * `layoutFrame`, on its own: nothing is assigned, no tick is made, no scale
 * is touched. `null` when that frame would be dropped for want of space.
 *
 * A divider move measures from this rather than from the areas the last
 * frame left: moves, a resized viewport or a flex written since then have
 * not reached those areas yet, and drawing a frame to catch them up runs
 * listeners that can change the chart again before the move lands.
 */
export function layoutPaneHeights(input: PaneHeightInput): {
  heights: number[];
  collapsed: ReadonlySet<number>;
  xHeight: number;
} | null {
  const { area, panes, gap } = input;
  const shares = input.shares ?? panes;

  // **Check the incoming area first — ahead of any assignment.** If area
  // itself carries a NaN, the checks below would pass it through silently,
  // so it's filtered out here first.
  if (isDegenerate(area)) return null;

  // 1) x-axis height — font height doesn't depend on the label values, so this settles before ticks do.
  const xHeight = xAxisHeight(input);

  // 2) Vertical distribution — the y tick count comes from pixels, so range is set before anything else.
  //    Areas (setArea) still can't be set: the left edge is waiting on the y-axis width.
  const rawHeights = distributeHeights(
    shares,
    area.bottom - area.top - xHeight,
    gap,
  );
  /**
   * **The vertical degeneracy check — ahead of the first assignment.**
   * `setRange(top + h, top)` is `layoutFrame`'s first assignment once these
   * heights come back, and it throws as a contract violation if `h` is `0`.
   *
   * **"all", not "any".** With `some`, a single collapsed pane would wipe
   * out the whole chart — what this guard blocks is "the transition where
   * the chart's entire vertical space disappears", not "a pane the
   * consumer deliberately collapsed". `minHeight: 0` is deliberately let
   * through: a pane at that floor collapses to nothing when another pane is
   * maximized, and that is what the consumer asked for.
   */
  if (rawHeights.every((height) => height < 1)) return null;

  /**
   * Lays a 1px floor under any collapsed pane. Since a range has to be
   * valid (giving it 1px is a smaller violation of invariants than "a pane
   * with no range"), the borrowed pixels are subtracted from the largest
   * pane — otherwise the sum would exceed what's available and push the
   * last pane outside the data area.
   */
  const floored = floorAtOnePixel(rawHeights);
  return floored && { ...floored, xHeight };
}

export function layoutFrame(input: FrameInput): Frame | null {
  const { area, panes, gap, axis, xScale, x, labels } = input;

  const vertical = layoutPaneHeights(input);
  if (vertical === null) return null;
  const { heights, collapsed, xHeight } = vertical;

  // **Inversion is asked of the pane** — ticks are baked with this range
  // right below. If `setArea` flips the range later, the already-baked
  // positions don't follow.
  let top = area.top;
  panes.forEach((pane, index) => {
    pane.setValueRange(top, top + heights[index]);
    top += heights[index] + gap;
  });

  /**
   * 3) y ticks — labels are settled here. **A collapsed pane shows no
   * labels.** The 1px floor exists to make the range valid, not to say
   * "show this pane". Without filtering it out, a collapsed pane would
   * produce ticks like a normal one, and its labels would mix into the
   * y-axis width every pane shares (`shown` right below), needlessly
   * widening the axis. Turning off `showLabels` makes the width
   * calculation and the label drawing read the same flag, so a single
   * change fixes both.
   */
  const y = yTicks(panes, axis.y).map((group, index) =>
    collapsed.has(index)
      ? { ...group, showLabels: false, collapsed: true }
      : group,
  );

  // 4) y-axis width — decided by the longest label.
  const shown = y.filter((group) => group.showLabels);
  const yWidth = !labels || shown.length === 0 ? 0 : yAxisWidth(input, shown);

  // 5) Slices settle — a pane's final area and the x scale's range both come out of this.
  //    x is shared by every pane, so the data area's width is used as-is.
  const slices = sliceAxes(area, {
    yWidth,
    xHeight,
    ySide: axis.y.position,
  });
  const paneSlices = sliceAreas(slices.data, heights, gap);

  /**
   * **A degenerate frame is never drawn.** The intermediate values
   * `ResizeObserver` emits mid-resize (a few frames where width nears
   * zero) are normal input — degeneracy is ignored without throwing, the
   * same way zero already is.
   *
   * **By this point a pane's `yScale` range is already planted** (step
   * 2) — the vertical check passed above, so it's a valid value. The next
   * normal frame overwrites it, so this is a frame stale by one cycle,
   * not a half-broken state.
   */
  if (isDegenerate(slices.data) || paneSlices.some(isDegenerate)) return null;

  paneSlices.forEach((slice, index) => panes[index].setArea(slice));
  xScale.setRange(slices.data.left, slices.data.right);

  // 6) x ticks — can only be counted once the range is settled.
  return { slices, ticks: { x: xTicks(xScale, x, axis.x), y } };
}

/**
 * The height the x-axis claims. Zero if labels aren't shown — the
 * placement rule matches the drawing rule. Skips measurement if a fixed
 * `size` is given.
 */
function xAxisHeight({ area, axis, labels, measure }: PaneHeightInput): number {
  const options = axis.x;
  if (!labels || !options.showLabels) return 0;

  /**
   * **Clamped before it's used, not after.** `sliceAxes` clamps too, but
   * that's too late — this value is already used as a pane's vertical
   * budget before that point, so without clamping here, a negative or
   * excessive `size` would flip the budget negative and leave the chart
   * silently and permanently blank.
   *
   * **A consumer-given size is clamped to leave the pane's 1px share.**
   * Clamping only to the area's height would let `size >= height` drive
   * the budget to exactly zero — the same blank result the clamp is meant
   * to prevent. That 1px isn't reserved on the measured-height side: if
   * the measured height eats all the vertical space, the container is
   * genuinely too small to use, so dropping the whole frame is correct —
   * but `size` eating all of it is a number the consumer wrote down
   * themselves, so there's no reason to starve the pane.
   */
  const available = Math.max(0, area.bottom - area.top);
  if (options.size !== undefined) {
    return Math.min(
      Math.max(0, options.size),
      Math.max(0, available - MIN_PANE_HEIGHT),
    );
  }
  if (!measure) return Math.min(FALLBACK_X_AXIS_HEIGHT, available);

  return Math.min(
    Math.ceil(measure.of("0", measure.font).height + 2 * AXIS_LABEL_OFFSET),
    available,
  );
}

/** The width the y-axis claims. Decided by the longest label. Rounding up to 8px stops the axis from jittering when a value's digit count shifts during pan. */
function yAxisWidth(
  { area, axis, measure }: FrameInput,
  shown: readonly PaneTicks[],
): number {
  const options = axis.y;

  // **A consumer-given size is clamped to leave the data area's 1px
  // share** — the counterpart to `xAxisHeight`. Leaving this only to
  // `sliceAxes`'s later clamp would let the width eat the entire area,
  // driving the data area to zero and leaving the frame silently and
  // permanently blank.
  if (options.size !== undefined) {
    const available = Math.max(0, area.right - area.left);
    return Math.min(
      Math.max(0, options.size),
      Math.max(0, available - MIN_DATA_WIDTH),
    );
  }
  if (!measure) return FALLBACK_Y_AXIS_WIDTH;

  return quantizeUp(widestLabel(shown, measure) + 2 * AXIS_LABEL_OFFSET);
}

function widestLabel(
  groups: readonly PaneTicks[],
  measure: FrameMeasure,
): number {
  let widest = 0;
  for (const group of groups) {
    for (const tick of group.ticks) {
      widest = Math.max(widest, measure.of(tick.label, measure.font).width);
    }
  }
  return widest;
}

/**
 * When a strategy decides placement and labeling as one unit. **`null` if
 * there's none, falling back to the axis's default arithmetic.**
 * `xOf`/`domainOf` are a pair for converting between coordinate systems —
 * the x-axis passes the bar-index mapping, the y-axis passes the identity.
 */
function strategyTicks(
  scale: Scale,
  options: AxisOptions,
  minTickSpacing: number,
  space: {
    xOf(value: number): number;
    domainOf(value: number): number;
    snap?: (value: number) => number;
  },
): Tick[] | null {
  if (!options.ticks) return null;

  const [min, max] = scale.getDomain();
  const [from, to] = scale.getRange();

  return options.ticks
    .ticks({
      min,
      max,
      span: Math.abs(to - from),
      minTickSpacing,
      xOf: space.xOf,
      domainOf: space.domainOf,
      positionOf: (value) => scale.scale(value),
      snap: space.snap,
    })
    .map(({ value, label }) => ({
      value,
      label,
      position: scale.scale(value),
    }));
}

/** The y domain is the value itself — there's no other space to map it into. */
const IDENTITY_SPACE = {
  xOf: (value: number) => value,
  domainOf: (value: number) => value,
};

/**
 * Ticks are computed **exactly once** in this pass — if the grid and the
 * labels each computed their own, they'd eventually drift apart. x gets
 * one set, shared by every pane; y is computed separately per pane.
 */
function xTicks(
  xScale: Scale,
  x: XMapping,
  options: ResolvedXAxisOptions,
): Tick[] {
  // A strategy, if present, takes over both placement and labeling. The
  // default arithmetic and `format` aren't used — mixing them halfway
  // would leave nobody sure who owns the label.
  /**
   * In a bar-index coordinate system, a calendar boundary can fall
   * **between** bars — midnight on a weekend interpolates to 1/3 or 2/3 of
   * the way through the gap between Friday's and Monday's bars. Left as-is,
   * ticks for dates with no bar pile two onto a single gap and overlap, and
   * the date under a bar reads as belonging to its neighbor instead. So the
   * strategy is told which bar a boundary is drawn on: the boundary's own
   * day, or the first bar after it (`ceil`) — "December" lands on
   * December's first trading day even if the 1st is a Sunday, the
   * convention in financial charts. Which of several boundaries landing on
   * one bar survives is the strategy's to decide, because only it knows
   * that one of them is the month's name.
   */
  const strategy = strategyTicks(xScale, options, options.minTickSpacing, {
    xOf: (value) => x.fromDomain(value),
    domainOf: (value) => x.toDomain(value),
    snap: x.rebuild === undefined ? undefined : (value) => Math.ceil(value - 1e-9),
  });
  if (strategy) return strategy;

  /**
   * In a bar-index coordinate system, the label **recovers the x that
   * belongs there.** Ticks are computed in the domain (the index), but
   * the user's `format` always receives data x regardless of coordinate
   * system — a format that turns a timestamp into a date is the same code
   * no matter which coordinate system it runs under. The interval never
   * drops below 1 because of `AxisConfig.minInterval`.
   */
  const barIndexed = x.rebuild !== undefined;
  const labelOf = options.format ?? String;

  return new Axis(xScale, "horizontal", {
    format: barIndexed ? (value) => labelOf(x.fromDomain(value)) : options.format,
    minTickSpacing: options.minTickSpacing,
    minInterval: barIndexed ? 1 : undefined,
  }).getTicks();
}

/**
 * When the scale owns placement (`Scale.tickGeometry` — the log axis's
 * decade ladder). Unlike a strategy, geometry never carries labels: the
 * label stays with whatever `format` is in force, so toggling to a log
 * axis doesn't silently drop the formatter a user installed. Ownership
 * still isn't split — placement has one owner (the scale), the label has
 * one owner (the format); the "mixing halfway" rule forbids two owners
 * of the same half. `null` when the scale has no geometry of its own.
 */
function geometryTicks(
  scale: Scale,
  options: ResolvedYAxisOptions,
): Tick[] | null {
  if (!scale.tickGeometry) return null;

  const geometry = scale.tickGeometry(options.minTickSpacing);
  const format = options.format ?? ((value: number) => value.toString());

  return geometry.values().map((value) => ({
    value,
    position: scale.scale(value),
    // The local step rides along — the same ruler the badge asks for,
    // so tick labels and badges can't split digit counts.
    label: format(value, geometry.stepAt(value)),
  }));
}

/**
 * Per-pane value-axis ticks. **A pane's own setting overrides the
 * chart-wide default.** Ownership goes: a user strategy (placement and
 * labels as one unit) > the scale's own geometry combined with `format`
 * > the linear axis arithmetic.
 */
function yTicks(
  panes: readonly Pane[],
  defaults: ResolvedYAxisOptions,
): PaneTicks[] {
  return panes.map((pane) => {
    /**
     * **Anything omitted falls back to the chart.** A plain spread would
     * let a pane's own `format: undefined` erase the chart's formatting —
     * ticks would then show the default formatting while the badge shows
     * the chart's, splitting digit counts on the same axis.
     */
    const options = { ...defaults, ...definedOnly(pane.axis) };

    return {
      pane,
      showLabels: options.showLabels,
      collapsed: false,
      ticks:
        strategyTicks(pane.yScale, options, options.minTickSpacing, IDENTITY_SPACE) ??
        geometryTicks(pane.yScale, options) ??
        new Axis(pane.yScale, "vertical", {
          format: options.format,
          minTickSpacing: options.minTickSpacing,
        }).getTicks(),
    };
  });
}
