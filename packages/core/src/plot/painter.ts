/**
 * Puts one settled frame onto the surface — dividers, decorations, panes,
 * boundaries, labels. Nothing here decides *what* the frame is; `frame.ts`
 * settled the geometry, and the chart decided whether to draw at all.
 *
 * **A plain function over a stage built once**, not a per-frame object.
 * This runs on every pointermove of a drag pan, so the only allocations
 * left are the ones the contract hands out to someone else's code: the
 * decoration contexts and the per-pane draw context.
 */
import type { AxisBadge, AxisLabelRenderer, Tick } from "../axis";
import type { Viewport } from "../data";
import { resolveStyle, type Renderer, type StyleReader } from "../render";
import type { XMapping } from "../scale";
import type { ValueFormat } from "../axis";
import {
  forEachAboveSeries,
  forEachBelowSeries,
  type DecorationList,
  type PlotDecoration,
  type PlotDecorationContext,
} from "./decoration";
import { dividerRange, type DividerRenderer, type DividerSide } from "./dividers";
import type { Frame, PaneTicks } from "./frame";
import type { AxisSlices } from "./layout";
import type { Pane } from "./pane";
import { PLOT_STYLE_SPEC } from "./style";
import type { ResolvedPlotConfig } from "./types";

/**
 * What the chart lends the painter — built once with the chart and shared
 * by every frame. `panes` is the chart's own list (live, not a copy), and
 * `decorations` its own store, so a frame always sees the current ones.
 */
export interface PaintStage {
  readonly renderer: Renderer;
  /** null unless supplied — no labels, and no badges either. */
  readonly axisLabels: AxisLabelRenderer | null;
  /** null unless supplied — pane heights are set by flex alone. */
  readonly dividers: DividerRenderer | null;
  readonly decorations: DecorationList<PlotDecoration>;
  readonly panes: readonly Pane[];
  readonly x: XMapping;
  readonly formatX: ValueFormat;
}

/**
 * Draws one frame. The caller has already cleared the surface and commits
 * after this returns — clearing, drawing and committing must be one task,
 * and the caller owns the two ends of it.
 *
 * `config` is passed per frame, not held on the stage — it's reassigned by
 * `applyOptions`, and reading a stale one here would make toggling
 * `resizablePanes` or `showLabels` a dead option.
 */
export function paintFrame(
  stage: PaintStage,
  config: ResolvedPlotConfig,
  frame: Frame,
  viewport: Viewport,
  readStyle: StyleReader,
): void {
  const { renderer, panes, x, formatX } = stage;
  const { slices, ticks } = frame;

  drawDividers(stage, config);

  /**
   * Plot decorations wrap the pane loop.
   *
   * "Plot-owned things sit outside, pane-owned things sit close to the
   * data" isn't a rule set separately — it's a consequence of this
   * nesting.
   */
  const decorationContext: PlotDecorationContext = {
    // The draw area after the axes have taken their space — decorations
    // don't cover the axis slices.
    area: slices.data,
    x,
    panes,
    ticks: { x: ticks.x },
    readStyle,
    formatX,
  };

  /**
   * **The boundary of the drawing is set right here.** Neither series nor
   * decorations know where they end — it's right for whoever handed out
   * the space to do the clipping → `Renderer.clip`
   *
   * Without it, it actually leaks. If a manual value range is narrower
   * than the data, a line stretches hundreds of pixels past the pane, and
   * with two panes, the lower one covers the upper one. This was only
   * invisible under the default wiring, where the value axis follows the
   * data.
   *
   * Plot decorations get the whole data area; pane decorations and series
   * get that pane's slice. The axis slice belongs to neither — what
   * mounts there isn't drawn, it's described (`AxisBadge`).
   */
  renderer.clip?.(slices.data);

  forEachBelowSeries(stage.decorations, (decoration) =>
    decoration.draw(renderer, decorationContext),
  );

  panes.forEach((pane, index) => {
    /**
     * **The ticks were baked from the pane list as it stood at layout
     * time.** The plot decoration running just above is someone else's
     * code, and it holds `PaneHost` (`addPane`, `removePane`) — if one of
     * those `draw` calls grows the list, the pairing here is thrown off
     * — `ticks.y[index]` becomes `undefined`, throwing a `TypeError`
     * inside an rAF callback, and the next frame does the same, so **the
     * chart dies permanently.** A pane that arrives late this frame is
     * drawn next frame instead.
     */
    const group = ticks.y[index];
    if (!group) return;

    renderer.clip?.(pane.area);
    pane.draw(renderer, {
      viewport,
      x,
      readStyle,
      ticks: { x: ticks.x, y: group.ticks },
      formatX,
    });
  });

  renderer.clip?.(slices.data);
  drawPaneBoundaries(stage, config, readStyle);
  forEachAboveSeries(stage.decorations, (decoration) =>
    decoration.draw(renderer, decorationContext),
  );

  // Labels mount on the axis slice, so the clip boundary is released before handing off.
  renderer.clip?.(null);

  /**
   * Labels come after the drawing. The DOM path doesn't care about order
   * (it's a different layer), but on the canvas path, command order is
   * stacking order, so a series spilling into the axis space must not
   * cover the labels. It just has to happen before commit — labels are
   * commands in this frame too.
   */
  drawAxisLabels(
    stage,
    config,
    ticks,
    slices,
    readStyle,
    collectAxisBadges(stage, decorationContext, slices, ticks),
  );
}

/**
 * Collects what decorations described for mounting on the axis, in z
 * order — later is on top.
 *
 * Drops badges for an axis with no space (labels off, or no collaborator
 * to render them). Drawing outside the axis slice would cover data, and
 * that isn't a badge, that's an intrusion.
 *
 * Pane decorations are asked too. The pane context is built from the same
 * material as the draw call.
 */
function collectAxisBadges(
  stage: PaintStage,
  context: PlotDecorationContext,
  slices: AxisSlices,
  ticks: { x: Tick[]; y: PaneTicks[] },
): AxisBadge[] {
  if (!stage.axisLabels) return [];

  const badges: AxisBadge[] = [];
  const keep = (badge: AxisBadge): void => {
    if (badge.axis === "x" ? slices.x : slices.y) badges.push(badge);
  };

  for (const { decoration } of stage.decorations) {
    for (const badge of decoration.axisBadges?.(context) ?? []) keep(badge);
  }

  stage.panes.forEach((pane, index) => {
    /**
     * **A pane that mounts no labels mounts no badges either.**
     *
     * The tick side is already filtered by `drawAxisLabels` via
     * `showLabels`. The badge side had no such door, so badges from a
     * collapsed pane (`{flex:0, minHeight:0}`) were collected as-is —
     * that pane's range is a **1px fake** laid down by
     * `floorAtOnePixel`, so every one of its badges piled into a 1px band
     * and got stamped right on top of a still-visible pane's price
     * labels. This is the other half of what was fixed on the
     * tick side.
     *
     * **What's checked is `collapsed`, not `showLabels`.** It was first
     * written as the latter, but that made a
     * **normal setting** — *"clean axis, badges only"*
     * (`axis: {showLabels: false}`) — **make the price badge disappear
     * too,** and that's a common shape for a trading screen, where a
     * neighboring pane has labels on and the axis strip is perfectly
     * intact. The only pane with no space is a collapsed one.
     */
    // Checked for the same reason as the draw loop — a decoration can add a pane.
    const group = ticks.y[index];
    if (!group || group.collapsed) return;

    const paneContext = {
      area: pane.area,
      x: stage.x,
      readStyle: context.readStyle,
      pane,
      yScale: pane.yScale,
      ticks: { x: ticks.x, y: group.ticks },
      formatX: stage.formatX,
      formatY: pane.formatValue,
    };
    for (const badge of pane.collectAxisBadges(paneContext)) keep(badge);
  });

  return badges;
}

/**
 * Labels mount on the overlay, not the canvas, so they survive a redraw.
 *
 * Each pane's scale already produces y-tick position in absolute
 * coordinates, so merging them and passing them straight through lands
 * each one inside its own pane.
 */
function drawAxisLabels(
  stage: PaintStage,
  config: ResolvedPlotConfig,
  ticks: { x: Tick[]; y: PaneTicks[] },
  slices: AxisSlices,
  readStyle: StyleReader,
  badges: AxisBadge[],
): void {
  if (!stage.axisLabels) return;

  const showX = config.axis.x.showLabels;
  const yTicks = ticks.y
    .filter((group) => group.showLabels)
    .flatMap((group) => group.ticks);

  if (!showX && yTicks.length === 0) {
    stage.axisLabels.clear();
    return;
  }

  const bottomPane = stage.panes[stage.panes.length - 1];
  stage.axisLabels.render({
    x: showX ? ticks.x : [],
    y: yTicks,
    badges,
    // x labels sit below the bottom pane.
    area: { ...slices.data, bottom: bottomPane.area.bottom },
    axes: { x: slices.x, y: slices.y },
    readStyle,
  });
}

/**
 * Draws pane boundary lines on the canvas — the divider handle (DOM) is a
 * transparent hit area, so this line is the entire visible boundary.
 * Because it's a drawing, it appears the same way in a headless chart and
 * in screenshots, and it's drawn regardless of whether resizing is
 * allowed (perceiving a boundary and being able to drag it are separate
 * facts).
 */
function drawPaneBoundaries(
  stage: PaintStage,
  config: ResolvedPlotConfig,
  readStyle: StyleReader,
): void {
  const { panes, renderer } = stage;
  if (panes.length < 2) return;

  const gap = config.paneGap;
  const style = resolveStyle(PLOT_STYLE_SPEC, readStyle).paneDivider;

  for (const pane of panes.slice(0, -1)) {
    const y = pane.area.bottom + gap / 2;
    renderer.drawLine(
      [
        { x: pane.area.left, y },
        { x: pane.area.right, y },
      ],
      style,
    );
  }
}

/** A divider sits in the middle of the gap between panes. */
function drawDividers(stage: PaintStage, config: ResolvedPlotConfig): void {
  const { dividers, panes } = stage;
  if (!dividers) return;

  const gap = config.paneGap;

  if (!config.resizablePanes || panes.length < 2) {
    dividers.clear();
    return;
  }

  const side = (pane: Pane): DividerSide => ({
    height: pane.area.bottom - pane.area.top,
    minHeight: pane.minHeight,
  });

  dividers.render(
    panes.slice(0, -1).map((pane, index) => ({
      index,
      y: pane.area.bottom + gap / 2,
      left: pane.area.left,
      right: pane.area.right,
      value: dividerRange(side(pane), side(panes[index + 1])),
      panes: [pane, panes[index + 1]],
    })),
  );
}
