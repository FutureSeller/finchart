import type { CoordinateAccessor, Point, Range, Series, SeriesContext, StyleOverridesOf, StyleSpec } from "@finchart/core";
import { DataError, M4Decimation, resolveStyle, styleSpec } from "@finchart/core";
import type { KagiPoint } from "./kagi";
import { describeValue, requireOptions } from "./kernels";

export interface KagiSeriesStyle {
  /** The colour of a yang (`tone: "up"`) stroke. */
  up: string;
  /** The colour of a yin (`tone: "down"`) stroke. */
  down: string;
  /** The width (px) of a yang stroke — the thick line. */
  upWidth: number;
  /** The width (px) of a yin stroke — the thin line. */
  downWidth: number;
}

/**
 * The CSS variables a Kagi line reads. The colours are the candle's own —
 * a Kagi line and a candle series can share a pane, and one "up" should
 * be one colour there — so the only new names are the two widths, the
 * second channel that tells yang from yin without colour.
 */
export const KAGI_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  up: { css: "--chart-candle-up", fallback: "#16a34a" },
  down: { css: "--chart-candle-down", fallback: "#dc2626" },
  upWidth: { css: "--chart-kagi-up-width", fallback: 3 },
  downWidth: { css: "--chart-kagi-down-width", fallback: 1 },
}) satisfies StyleSpec<KagiSeriesStyle>;

export interface KagiSeriesOptions {
  /** Overrides for the variables in `KAGI_STYLE_SPEC` — an override beats the variable, the variable beats the fallback. */
  style?: StyleOverridesOf<typeof KAGI_STYLE_SPEC>;
}

/**
 * The vertices carry the value; a vertex has one and is never a gap, so
 * `gapless` is declared and the pane skips its per-frame gap scan — which
 * is why the data door must refuse a `y` that is not a finite number (a
 * gap declared away would be drawn as a price), and a `breakY` that is
 * present but not finite (it becomes a path point).
 */
const kagiCoordinates: CoordinateAccessor<KagiPoint> = {
  getX: (point) => point.x,
  getY: (point) => point.y,
  assertFinite: (point, index, label = "data") => {
    if (!Number.isFinite(point.y)) {
      throw new DataError(`${label} y must be a finite number, but index ${index} is ${describeValue(point.y)}`);
    }
    if (point.breakY !== undefined && !Number.isFinite(point.breakY)) {
      throw new DataError(`${label} breakY must be a finite number when present, but index ${index} is ${describeValue(point.breakY)}`);
    }
  },
  gapless: true,
};

/**
 * Draws `kagi`'s points as one stepped line at two widths. Between two
 * vertices the line runs horizontally to the new x at the old price, then
 * vertically to the new price — the corner is `(new x, old y)`, the same
 * rule as the step line's (a straight diagonal would draw prices the line
 * never held). A vertical stroke is yang (thick, `--chart-kagi-up-width`)
 * or yin (thin) by its point's `tone`, and where the point carries a
 * `breakY` the stroke splits there: the tone that was standing runs up to
 * the shoulder or waist, the new one from it. The horizontal join carries
 * the tone standing when it was drawn. Same-tone strokes are one
 * `drawLine`, so a frame costs as many lines as the tone changes plus one.
 *
 * Decimation is M4 at four points per pixel, declared: every vertex is a
 * local extreme, so a strategy that keeps every nth would drop turns, while
 * M4 keeps a pixel column's first, lowest, highest and last **as the points
 * they are**, `tone` and `breakY` intact (four per column is what makes a
 * column one bucket). A tone change at a vertex that is none of a column's
 * four is still lost with that vertex — a run that begins and ends inside
 * one pixel column can vanish, the same known limit as a toned histogram
 * bar's colour.
 */
export function kagiSeries(options: KagiSeriesOptions = {}): Series<KagiPoint> {
  requireOptions(options, "kagiSeries");
  const overrides = options.style ?? {};
  return {
    coordinates: kagiCoordinates,
    decimation: { strategy: new M4Decimation(kagiCoordinates), pointsPerPixel: 4 },

    valueExtent(data) {
      let extent: Range | null = null;
      for (const point of data) {
        extent =
          extent === null
            ? { min: point.y, max: point.y }
            : { min: Math.min(extent.min, point.y), max: Math.max(extent.max, point.y) };
      }
      return extent;
    },

    draw(target, context: SeriesContext<KagiPoint>) {
      const { data, x: mapping, yScale } = context;
      if (data.length < 2) return;
      const style = resolveStyle(KAGI_STYLE_SPEC, context.readStyle, overrides);
      // A vertex is asked of the mapping directly — a Kagi line has a few hundred vertices where a tape has a million candles.
      const pixelX = (point: KagiPoint): number => mapping.toPixel(point.x);
      const stroke = (path: Point[], tone: KagiPoint["tone"]): void => {
        target.drawLine(
          path,
          tone === "up" ? { width: style.upWidth, color: style.up } : { width: style.downWidth, color: style.down },
        );
      };

      let tone = data[0].tone;
      let path: Point[] = [{ x: pixelX(data[0]), y: yScale.scale(data[0].y) }];
      for (let i = 1; i < data.length; i++) {
        const point = data[i];
        const x = pixelX(point);
        // The join runs to the corner at the old price, in the tone that was standing.
        path.push({ x, y: yScale.scale(data[i - 1].y) });
        if (point.tone !== tone) {
          // The tone changes inside the vertical stroke at `breakY`; without one it changes at the corner.
          const at = point.breakY === undefined ? path[path.length - 1] : { x, y: yScale.scale(point.breakY) };
          if (at !== path[path.length - 1]) path.push(at);
          stroke(path, tone);
          tone = point.tone;
          path = [at];
        }
        path.push({ x, y: yScale.scale(point.y) });
      }
      stroke(path, tone);
    },
  };
}
