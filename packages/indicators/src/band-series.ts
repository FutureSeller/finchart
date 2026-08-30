import type { CoordinateAccessor, Point, Range, Series, SeriesContext, StyleSpec } from "@finchart/core";
import { isGap, resolveStyle, styleSpec } from "@finchart/core";
import type { BandPoint } from "./factories";

export interface BandSeriesOptions {
  /** Fill color. Falls back to the CSS variable `--chart-band`, then the default. */
  fill?: string;
}

/** CSS variables owned by the band (the same style-spec format core uses). */
export const BAND_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  fill: { css: "--chart-band", fallback: "rgba(148, 163, 184, 0.18)" },
}) satisfies StyleSpec<{ fill: string }>;


/**
 * A series that fills between an upper and lower boundary — Bollinger's
 * `band` branch is the input. A gap (either boundary null) splits the
 * polygon into segments — the fill follows the same rule as a line
 * breaking at a gap.
 */
export function bandSeries(options: BandSeriesOptions = {}): Series<BandPoint> {
  return {
    coordinates: bandCoordinates,

    valueExtent(data) {
      let extent: Range | null = null;

      for (const point of data) {
        if (isGap(point.upper) || isGap(point.lower)) continue;
        extent =
          extent === null
            ? { min: point.lower, max: point.upper }
            : {
                min: Math.min(extent.min, point.lower),
                max: Math.max(extent.max, point.upper),
              };
      }

      return extent;
    },

    draw(target, context: SeriesContext<BandPoint>) {
      const { fill } = resolveStyle(BAND_STYLE_SPEC, context.readStyle, {
        fill: options.fill,
      });

      for (const segment of segments(context.data)) {
        target.drawShape({
          shape: "polygon",
          points: outline(segment, context),
          fill,
        });
      }
    },
  };
}

/**
 * The upper boundary stands in for the value — it's what decimation uses
 * as the bucket representative. The lower boundary's extremes can get
 * smoothed away within a bucket, but a band is a smooth statistic, so
 * that's visually harmless.
 */
const bandCoordinates: CoordinateAccessor<BandPoint> = {
  getX: (point) => point.x,
  getY: (point) => point.upper,
};

/** Contiguous runs where both boundaries exist. A gap splits a run. */
function segments(data: readonly BandPoint[]): BandPoint[][] {
  const runs: BandPoint[][] = [];
  let current: BandPoint[] = [];

  for (const point of data) {
    if (isGap(point.upper) || isGap(point.lower)) {
      // A one-point run has no area — nothing to draw.
      if (current.length > 1) runs.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }

  if (current.length > 1) runs.push(current);
  return runs;
}

/** Traces the upper boundary left→right, then the lower right→left, to close the outline. */
function outline(
  segment: readonly BandPoint[],
  { x, yScale }: SeriesContext<BandPoint>,
): Point[] {
  const points: Point[] = [];

  for (const point of segment) {
    points.push({
      x: x.toPixel(point.x),
      y: yScale.scale(point.upper!),
    });
  }
  for (let index = segment.length - 1; index >= 0; index--) {
    const point = segment[index];
    points.push({
      x: x.toPixel(point.x),
      y: yScale.scale(point.lower!),
    });
  }

  return points;
}
