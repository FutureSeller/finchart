import type {
  DecimationStrategy,
  IndexRange,
  Point,
  Range,
  Series,
  SeriesContext,
  StyleOverridesOf,
  StyleSpec,
} from "@finchart/core";
import { DataError, OHLCAccessor, resolveStyle, slotWidth, styleSpec } from "@finchart/core";
import { describeValue, requireOptions } from "./kernels";
import type { PointAndFigureColumn } from "./point-and-figure";
import { requireBoxSize } from "./point-and-figure";

export interface PointAndFigureSeriesStyle {
  /** The colour of a column of X's (`tone: "up"`). */
  up: string;
  /** The colour of a column of O's (`tone: "down"`). */
  down: string;
  /** The stroke width (px) of an X and an O. */
  width: number;
}

/**
 * The CSS variables a Point & Figure chart reads. The colours are the
 * candle's own — a column of X's is an "up" like a rising candle, and the
 * two can share a pane — so the only new name is the stroke width.
 */
export const POINT_AND_FIGURE_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  up: { css: "--chart-candle-up", fallback: "#16a34a" },
  down: { css: "--chart-candle-down", fallback: "#dc2626" },
  width: { css: "--chart-pnf-width", fallback: 1 },
}) satisfies StyleSpec<PointAndFigureSeriesStyle>;

export interface PointAndFigureSeriesOptions {
  /**
   * The box the columns were built on — the `boxSize` `pointAndFigure` was
   * given, required. The series does not read it off the columns: a
   * column of one box says nothing about the box's height. The data door
   * holds each column to it — one whose ends are not levels of this box,
   * or whose `low`..`high` does not span `boxes` of them, is refused —
   * which catches a different box whenever the columns do not happen to
   * fit it too (a one-box column at 100 fits a box of 1 and a box of 2
   * alike; the door cannot tell those apart).
   */
  boxSize: number;
  /** Overrides for the variables in `POINT_AND_FIGURE_STYLE_SPEC` — an override beats the variable, the variable beats the fallback. */
  style?: StyleOverridesOf<typeof POINT_AND_FIGURE_STYLE_SPEC>;
}

/** The glyph leaves this much of its cell free on each side, so stacked X's and O's do not touch. */
const GLYPH_INSET = 0.15;
/** A cell narrower or shorter than this (px) cannot hold a legible glyph — the column is drawn as one bar instead. */
const PIXEL_FLOOR = 4;
/** An O is a closed polyline with this many sides. */
const O_SIDES = 12;

/**
 * How many boxes of `boxSize` a column from `low` to `high` spans — the
 * level arithmetic run backwards, level by level rather than as a
 * difference of prices (whose subtraction can overflow where the prices
 * themselves are finite). `NaN` unless both ends are grid prices the
 * transform could have produced: a level under 2⁴⁷ boxes from zero whose
 * price, `level × boxSize` in one multiplication, is exactly the end
 * given (the transform prices every level with that same multiplication,
 * so a genuine end always is; an end off the grid never is).
 */
function spanOf(low: number, high: number, boxSize: number): number {
  const bottom = Math.round(low / boxSize);
  const top = Math.round(high / boxSize);
  if (!(Math.abs(bottom) < 2 ** 47 && Math.abs(top) < 2 ** 47)) return Number.NaN;
  if (bottom * boxSize !== low || top * boxSize !== high) return Number.NaN;
  return top - bottom + 1;
}

/**
 * Merges columns instead of thinning them — the aggregation `pointAndFigureSeries`
 * declares. Picking one column out of a bucket would drop the others' high
 * and low (the reason the default strategy is not used for candles either),
 * so a bucket becomes one column spanning the bucket's lowest and highest
 * box, of the last column's `tone` — its `open` and `close` at the ends
 * that tone runs between, `boxes` the boxes the span holds, `x` the first
 * column's and `closedAt` the last's (the candle whose close last extended
 * the bucket) — so a merged column keeps every invariant a column has, and
 * draws like one. Buckets split by index, one per pixel of budget, as
 * candles do.
 */
export class PnfAggregation implements DecimationStrategy<PointAndFigureColumn> {
  private readonly boxSize: number;

  constructor(boxSize: number) {
    this.boxSize = requireBoxSize(boxSize, "PnfAggregation");
  }

  decimate(data: PointAndFigureColumn[], range: IndexRange, threshold: number): PointAndFigureColumn[] {
    const count = range.end - range.start;
    if (count <= threshold) {
      return range.start === 0 && range.end === data.length ? data : data.slice(range.start, range.end);
    }
    const buckets = Math.max(1, Math.floor(threshold));
    // Fractional boundaries so the budget is met exactly rather than half-filled by whole-number grouping.
    const step = count / buckets;
    const merged: PointAndFigureColumn[] = [];
    for (let i = 0; i < buckets; i++) {
      const start = range.start + Math.floor(i * step);
      const end = i === buckets - 1 ? range.end : range.start + Math.floor((i + 1) * step);
      merged.push(this.merge(data, start, end));
    }
    return merged;
  }

  private merge(data: PointAndFigureColumn[], start: number, end: number): PointAndFigureColumn {
    const first = data[start];
    const last = data[end - 1];
    let low = first.low;
    let high = first.high;
    for (let i = start + 1; i < end; i++) {
      const column = data[i];
      if (column.low < low) low = column.low;
      if (column.high > high) high = column.high;
    }
    const tone = last.tone;
    return {
      x: first.x,
      open: tone === "up" ? low : high,
      high,
      low,
      close: tone === "up" ? high : low,
      closedAt: last.closedAt,
      tone,
      boxes: spanOf(low, high, this.boxSize),
    };
  }
}

/**
 * The candle's accessor with the column's own fields at the door: the
 * series draws `boxes` glyphs in `tone`'s colour and a probe hands back
 * `closedAt`, so each is checked where the four prices are — and the ends
 * are held to the grid of the box, which is also where a series given a
 * different `boxSize` than the transform is caught.
 */
class PnfAccessor extends OHLCAccessor {
  constructor(private readonly boxSize: number) {
    super();
  }

  override assertFinite(point: PointAndFigureColumn, index: number, label = "data"): void {
    super.assertFinite(point, index, label);
    if (!(point.low <= point.high)) {
      throw new DataError(`${label} low must not exceed high, but index ${index} has low ${point.low} and high ${point.high}`);
    }
    // One comparison judges `boxes` — a NaN, a fraction, a negative or a wrong count all differ from the span.
    const span = spanOf(point.low, point.high, this.boxSize);
    if (span !== point.boxes) {
      throw new DataError(
        `${label} index ${index} from ${point.low} to ${point.high} does not hold ${describeValue(point.boxes)} boxes of ${this.boxSize} — each end must be a level of the box, priced as the transform prices it; the series needs the boxSize the transform was given`,
      );
    }
    if (point.tone !== "up" && point.tone !== "down") {
      throw new DataError(`${label} tone must be "up" or "down", but index ${index} is ${describeValue(point.tone)}`);
    }
    // A column runs from the end it started at to the end it reached: X's from low to high, O's from high to low.
    const from = point.tone === "up" ? point.low : point.high;
    const to = point.tone === "up" ? point.high : point.low;
    if (point.open !== from || point.close !== to) {
      throw new DataError(
        `${label} index ${index} is a column of ${point.tone === "up" ? "X's" : "O's"} from ${point.low} to ${point.high}, so its open must be ${from} and its close ${to}, but they are ${point.open} and ${point.close}`,
      );
    }
    if (!Number.isFinite(point.closedAt)) {
      throw new DataError(`${label} closedAt must be a finite number, but index ${index} is ${describeValue(point.closedAt)}`);
    }
  }

  /**
   * A log axis stands on the column's lowest box above zero: `low` when
   * that is positive, else the first level above zero if the column
   * reaches it (the box holding zero itself has no place on a log axis),
   * else nothing.
   */
  getPositiveFloor(point: PointAndFigureColumn): number | null {
    if (point.low > 0) return point.low;
    if (!(point.high > 0)) return null;
    const first = Math.max(1, Math.round(point.low / this.boxSize));
    const price = first * this.boxSize;
    return price <= point.high ? price : null;
  }
}

/**
 * Draws `pointAndFigure`'s columns as X's and O's. A column's boxes are
 * cells one slot wide (the slot is the column's, as a candle's is) and one
 * `boxSize` high. An X is two strokes across the cell, an O a closed
 * polyline of twelve sides; both leave a margin of the cell so a stack
 * does not touch. Colours follow `tone` (the candle's up/down), the stroke
 * width is `--chart-pnf-width`.
 *
 * The series assumes of the value axis what every series assumes — that
 * it is monotone: a price between two others lands between their pixels
 * — and nothing else about its shape. Everything below follows from that
 * alone. Only the boxes whose cells reach into the pane are drawn, found
 * by binary search on the cell edges' pixels (monotone in the box index),
 * so a column zoomed to a hundred-box window draws that window, however
 * tall it is. A box's cell is measured on the axis it is drawn on as twice
 * the distance from the box's price to the nearer edge of its cell, so a
 * glyph always sits inside its cell — on a log axis, which folds every
 * price at or below zero onto one spot, the box holding zero measures
 * nothing. Below a floor — a cell narrower or shorter than 4 px — a glyph
 * is only a smudge, so a run of such boxes is drawn as one bar from the
 * top of its highest to the bottom of its lowest, in the same colour. The
 * boxes are judged by halving: a stretch of boxes that spans fewer than
 * 4 px holds no legible cell (a cell cannot be taller than the stretch it
 * lies in), so it joins the run whole, and only a stretch that spans more
 * is split and looked into. Together those bound a frame: a glyph needs
 * 4 px of the pane's height to itself, so at most the pane's cells at the
 * floor (its area over 16 px²) plus the box at each edge of a visible
 * column that only partly reaches in, and a bar per run of smaller boxes.
 * The axis is asked, per column, about its edges and the window (two
 * halvings, log₂ of its boxes each), then once per stretch the halving
 * looks into — at most the pane's height over 4 px, plus two, per level of
 * halving: for a 600 px pane and a column of 2⁴⁷ boxes some seven
 * thousand times, for a column of a hundred boxes a few hundred, never
 * once per box; a column too narrow for a glyph is asked twice.
 *
 * Two things stay the axis's: it keeps a pixel finite where its own
 * arithmetic would leave the doubles (a linear axis over
 * ±`Number.MAX_VALUE`, a log axis over two adjacent doubles), and when a
 * log axis fits a range that crosses zero it asks the accessor's
 * `getPositiveFloor`, which this accessor answers with the column's lowest
 * box above zero rather than its `low`.
 *
 * `coordinates` is the candle's accessor with the column's fields at the
 * door — the value is `close`, the span `low`..`high` (what a probe snaps
 * to), one column per x and no gaps. Decimation is `PnfAggregation` at one
 * point per pixel, declared: columns are merged, never thinned. The y axis
 * is claimed half a box beyond the lowest and highest box so the end glyphs
 * are not clipped (as far as the double range allows).
 */
export function pointAndFigureSeries(options: PointAndFigureSeriesOptions): Series<PointAndFigureColumn> {
  requireOptions(options, "pointAndFigureSeries");
  const boxSize = requireBoxSize(options.boxSize, "pointAndFigureSeries");
  const overrides = options.style ?? {};
  return {
    coordinates: new PnfAccessor(boxSize),
    decimation: { strategy: new PnfAggregation(boxSize), pointsPerPixel: 1 },

    valueExtent(data) {
      if (data.length === 0) return null;
      let min = Infinity;
      let max = -Infinity;
      for (const column of data) {
        if (column.low < min) min = column.low;
        if (column.high > max) max = column.high;
      }
      const below = min - boxSize / 2;
      const above = max + boxSize / 2;
      const extent: Range = { min: Number.isFinite(below) ? below : min, max: Number.isFinite(above) ? above : max };
      return extent;
    },

    draw(target, context: SeriesContext<PointAndFigureColumn>) {
      const { data, x: mapping, yScale, area } = context;
      if (data.length === 0) return;
      const style = resolveStyle(POINT_AND_FIGURE_STYLE_SPEC, context.readStyle, overrides);
      const cellWidth = slotWidth(data, mapping, context.places, context.fullData);
      const barWidth = Math.max(cellWidth * (1 - 2 * GLYPH_INSET), 1);
      const paneTop = Math.min(area.top, area.bottom);
      const paneBottom = Math.max(area.top, area.bottom);

      for (const column of data) {
        const x = mapping.toPixel(column.x);
        const color = column.tone === "up" ? style.up : style.down;
        const line = { width: style.width, color };
        // Prices are levels times the box, as the transform makes them — a difference of two prices can
        // overflow where both are finite, a level cannot. Box k of the column sits at level `bottom + k`.
        const bottom = Math.round(column.low / boxSize);
        const priceAt = (level: number): number => {
          const price = level * boxSize;
          // Only a half box past the column's end can leave the doubles; the end itself stands in for it.
          return Number.isFinite(price) ? price : level < 0 ? column.low : column.high;
        };
        // `edge(k)` is the pixel of the lower edge of box k (its price less half a box); `edge(boxes)` the top.
        const edge = (k: number): number => yScale.scale(priceAt(bottom + k - 0.5));
        const count = column.boxes;
        // A bar is the part of the run inside the pane: an axis asked about a price far outside its domain may
        // answer with a pixel past the doubles, and a rect with an infinite side draws nothing at all. The pane
        // is taken a pixel wide on each side — the painter's clip is the real edge; this only keeps the numbers.
        const bar = (a: number, b: number): void => {
          const y1 = edge(a);
          const y2 = edge(b + 1);
          const top = Math.max(Math.min(y1, y2), paneTop - 1);
          const bottom = Math.min(Math.max(y1, y2), paneBottom + 1);
          if (top > bottom) return;
          target.drawShape({ shape: "rect", x: x - barWidth / 2, y: top, width: barWidth, height: Math.max(bottom - top, 1), fill: color });
        };
        // A column too narrow for any glyph is one bar, whole — the pane clips it — without a look at its boxes.
        if (cellWidth < PIXEL_FLOOR) {
          bar(0, count - 1);
          continue;
        }
        const first = edge(0);
        const last = edge(count);
        // A monotone axis puts the edges in box order, one way or the other.
        const rising = last >= first;
        // The boxes whose cells reach into the pane — the first whose far edge is past the pane's near side,
        // the last whose near edge is short of the pane's far side — each by binary search on the edges.
        const firstEdge = (past: (px: number) => boolean): number => {
          let lo = 0;
          let hi = count;
          while (lo < hi) {
            // Halved in safe integers — a column may hold more than 2³² boxes, past a 32-bit shift.
            const mid = Math.floor((lo + hi) / 2);
            if (past(edge(mid))) hi = mid;
            else lo = mid + 1;
          }
          return lo;
        };
        const from = (rising ? firstEdge((px) => px >= paneTop) : firstEdge((px) => px <= paneBottom)) - 1;
        const to = (rising ? firstEdge((px) => px > paneBottom) : firstEdge((px) => px < paneTop)) - 1;
        const start = Math.max(0, from);
        const stop = Math.min(count - 1, to);
        if (start > stop) continue;

        const glyph = (k: number, half: number): void => {
          const y = yScale.scale(priceAt(bottom + k));
          if (column.tone === "up") {
            target.drawLine([{ x: x - half, y: y - half }, { x: x + half, y: y + half }], line);
            target.drawLine([{ x: x - half, y: y + half }, { x: x + half, y: y - half }], line);
          } else {
            const ring: Point[] = [];
            for (let s = 0; s < O_SIDES; s++) {
              const angle = (s / O_SIDES) * 2 * Math.PI;
              ring.push({ x: x + half * Math.cos(angle), y: y + half * Math.sin(angle) });
            }
            ring.push(ring[0]);
            target.drawLine(ring, line);
          }
        };
        // The cell as the box's own price sees it: twice the distance to the nearer edge, so a glyph sized from
        // it sits inside the cell whatever the axis's shape. An edge past the doubles (half a box beyond a
        // column's end at the very top of the range) is open: it bounds nothing.
        const cellOf = (k: number, lower: number, upper: number): number => {
          const y = yScale.scale(priceAt(bottom + k));
          const openBelow = !Number.isFinite((bottom + k - 0.5) * boxSize);
          const openAbove = !Number.isFinite((bottom + k + 0.5) * boxSize);
          const below = openBelow ? Number.POSITIVE_INFINITY : Math.abs(y - lower);
          const above = openAbove ? Number.POSITIVE_INFINITY : Math.abs(upper - y);
          return Math.min(cellWidth, 2 * Math.min(below, above));
        };

        let runStart = -1;
        const flush = (before: number): void => {
          if (runStart >= 0) bar(runStart, before - 1);
          runStart = -1;
        };
        // Halving: a stretch spanning fewer than 4 px holds no legible cell, so it joins the run whole.
        const paint = (a: number, b: number, lower: number, upper: number): void => {
          if (Math.abs(upper - lower) < PIXEL_FLOOR) {
            if (runStart < 0) runStart = a;
            return;
          }
          if (a === b) {
            const cell = cellOf(a, lower, upper);
            if (cell < PIXEL_FLOOR) {
              if (runStart < 0) runStart = a;
              return;
            }
            flush(a);
            glyph(a, (cell * (1 - 2 * GLYPH_INSET)) / 2);
            return;
          }
          const mid = Math.floor((a + b) / 2);
          const between = edge(mid + 1);
          paint(a, mid, lower, between);
          paint(mid + 1, b, between, upper);
        };
        paint(start, stop, edge(start), edge(stop + 1));
        flush(stop + 1);
      }
    },
  };
}
