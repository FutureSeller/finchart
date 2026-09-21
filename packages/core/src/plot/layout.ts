import type { PlotArea } from "../primitives";

/** Size of the axis slices. Zero means that axis doesn't take up any space. */
export interface AxisSliceSizes {
  /** y-axis width. */
  yWidth: number;
  /** x-axis (bottom) height. */
  xHeight: number;
  /** Which side the y-axis is on. Left if omitted. */
  ySide?: "left" | "right";
}

/** Fallback space reserved when the axis has no way to measure its own labels. Only wiring without a text measurer falls back to these fixed values. */
export const FALLBACK_Y_AXIS_WIDTH = 48;
export const FALLBACK_X_AXIS_HEIGHT = 24;

/** Splits an area into axis slices and a data area. The bottom-left corner belongs to neither axis. */
export interface AxisSlices {
  /** Space for the y-axis labels. `null` if labels aren't shown. */
  y: PlotArea | null;
  /** Space for the x-axis labels. `null` if labels aren't shown. */
  x: PlotArea | null;
  /** The remaining drawing area. Panes stack inside this. */
  data: PlotArea;
}

/**
 * The axis claims its space first, and the data gets whatever's left.
 *
 * If the container is smaller than the axis, the axis loses — a negative
 * data area would flip the scale's range and mirror the entire drawing
 * left-to-right, so the slice is clamped to the container's size.
 */
export function sliceAxes(area: PlotArea, sizes: AxisSliceSizes): AxisSlices {
  const yWidth = Math.min(Math.max(0, sizes.yWidth), area.right - area.left);
  const xHeight = Math.min(Math.max(0, sizes.xHeight), area.bottom - area.top);
  const right = sizes.ySide === "right";

  const dataLeft = right ? area.left : area.left + yWidth;
  const dataRight = right ? area.right - yWidth : area.right;
  const dataBottom = area.bottom - xHeight;

  return {
    y:
      yWidth > 0
        ? {
            left: right ? dataRight : area.left,
            right: right ? area.right : dataLeft,
            top: area.top,
            bottom: dataBottom,
          }
        : null,
    x:
      xHeight > 0
        ? { left: dataLeft, right: dataRight, top: dataBottom, bottom: area.bottom }
        : null,
    data: { left: dataLeft, right: dataRight, top: area.top, bottom: dataBottom },
  };
}

export interface PaneBox {
  /** Ratio for sharing the remaining space. */
  flex: number;
  /** Never shrinks below this (px). */
  minHeight: number;
}

/**
 * Decides the heights of vertically stacked panes.
 *
 * Splits by `flex` ratio, with `minHeight` as a floor. A pane that hits its
 * floor gets pinned there, and the rest re-split whatever's left — this
 * doesn't settle in one pass, so it repeats until no floor is violated (it's
 * guaranteed to converge within as many passes as there are panes).
 */
export function distributeHeights(
  boxes: readonly PaneBox[],
  available: number,
  gap: number,
): number[] {
  if (boxes.length === 0) return [];

  const space = available - gap * (boxes.length - 1);
  const floors = boxes.map((box) => Math.max(0, box.minHeight));
  const floorSum = floors.reduce((sum, height) => sum + height, 0);
  const floorMax = floors.reduce((max, height) => Math.max(max, height), 0);
  const floorTotal = floorMax === 0 ? 0 : floors.reduce((sum, height) => sum + height / floorMax, 0);

  // If even the sum of the floors doesn't fit, everyone shrinks together.
  // More predictable than cutting some out or letting things overflow.
  if (space <= floorSum) {
    if (Number.isFinite(floorSum)) {
      const ratio = floorSum === 0 ? 0 : Math.max(0, space) / floorSum;
      return floors.map(height => height * ratio);
    }
    return floors.map((height) => floorMax === 0 ? 0
      : Math.max(0, space) * ((height / floorMax) / floorTotal));
  }

  const heights = boxes.map(() => 0);
  const pinned = boxes.map(() => false);

  for (;;) {
    let pinnedTotal = 0;
    const flexMax = boxes.reduce((max, box, index) =>
      pinned[index] ? max : Math.max(max, box.flex), 0);
    let flexTotal = 0;
    let normalizedTotal = 0;
    let freeCount = 0;

    boxes.forEach((box, index) => {
      if (pinned[index]) {
        pinnedTotal += heights[index];
        return;
      }
      flexTotal += Math.max(0, box.flex);
      normalizedTotal += flexMax === 0 ? 0 : Math.max(0, box.flex) / flexMax;
      freeCount += 1;
    });

    const remaining = space - pinnedTotal;

    boxes.forEach((box, index) => {
      if (pinned[index]) return;

      // If nobody declared a flex ratio, split evenly.
      heights[index] =
        flexTotal > 0
          ? remaining * (Number.isFinite(flexTotal)
            ? Math.max(0, box.flex) / flexTotal
            : (Math.max(0, box.flex) / flexMax) / normalizedTotal)
          : remaining / freeCount;
    });

    const starved = heights.findIndex(
      (height, index) => !pinned[index] && height < floors[index],
    );
    if (starved === -1) return heights;

    heights[starved] = floors[starved];
    pinned[starved] = true;
  }
}

/** Slices one area from the top into the given heights. All slices share the same horizontal extent. */
export function sliceAreas(
  area: PlotArea,
  heights: readonly number[],
  gap: number,
): PlotArea[] {
  const areas: PlotArea[] = [];
  let top = area.top;

  for (const height of heights) {
    areas.push({ left: area.left, right: area.right, top, bottom: top + height });
    top += height + gap;
  }

  return areas;
}
