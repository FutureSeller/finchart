import { isGap } from "../data";
import { LINE_COORDINATES } from "../data/accessors";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataView,
  LineDataPoint,
  Range,
} from "../data";
import type { DrawTarget, LineStyle, StyleOverridesOf, StyleSpec } from "../render";
import { fillLinearGradient, noStyle, resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";
import type { Point } from "../primitives";
import { requireObject } from "../primitives";
import type { Series, SeriesContext } from "./types";
import { screenXAt, settleCoordinates } from "./types";

export interface AreaSeriesStyle {
  line: LineStyle;
  fill: string;
  /**
   * The color the fill touches at the bottom of the pane. Supplying a
   * value turns the fill into a vertical gradient — from `fill` (top) to
   * this color (bottom), across the pane's full height. An empty string
   * keeps it a flat color, as before.
   */
  fillBottom: string;
}

/** The CSS variables an area owns. */
export const AREA_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  line: {
    width: { css: "--chart-area-line-width", fallback: 2 },
    color: { css: "--chart-area-line", fallback: "#3b82f6" },
    dashArray: { css: "--chart-area-line-dash", fallback: "" },
  },
  fill: { css: "--chart-area", fallback: "rgba(59, 130, 246, 0.16)" },
  fillBottom: { css: "--chart-area-bottom", fallback: "" },
}) satisfies StyleSpec<AreaSeriesStyle>;

export type AreaSeriesStyleOverrides = StyleOverridesOf<typeof AREA_STYLE_SPEC>;

/** When there's neither a variable nor an override. */
export const DEFAULT_AREA_STYLE: AreaSeriesStyle = /* @__PURE__ */ resolveStyle(
  AREA_STYLE_SPEC,
  noStyle,
);

/** For swapping in an accessor — the same shape as `LineSeriesOptions`. */
export interface AreaSeriesOptions<T extends BaseDataPoint> {
  coordinates: CoordinateAccessor<T>;
  style?: AreaSeriesStyleOverrides;
}

/**
 * A series that fills below its line down to the bottom of the plot. A
 * gap splits the fill too — the fill follows the same rule as the line
 * breaking at a gap. One polygon per run of unbroken values.
 *
 * The accessor is injected, for the same reason as `LineSeries`: drawing
 * a close-price area over OHLC is `areaSeries({ coordinates: new
 * OHLCAccessor() })`.
 */
export class AreaSeries<T extends BaseDataPoint = LineDataPoint>
  implements Series<T>
{
  readonly coordinates: CoordinateAccessor<T>;
  private readonly overrides: AreaSeriesStyleOverrides;

  constructor(options: AreaSeriesOptions<T>) {
    this.coordinates = options.coordinates;
    this.overrides = options.style ?? {};
  }

  valueExtent(data: DataView<T>): Range | null {
    let min = Infinity;
    let max = -Infinity;

    for (const point of data) {
      const y = this.coordinates.getY(point);
      if (isGap(y)) continue;
      if (y < min) min = y;
      if (y > max) max = y;
    }

    return min === Infinity ? null : { min, max };
  }

  draw(target: DrawTarget, context: SeriesContext<T>): void {
    const style = resolveStyle(AREA_STYLE_SPEC, context.readStyle, this.overrides);
    const bottom = context.area.bottom;

    for (const run of screenRuns(context, this.coordinates)) {
      if (run.length < 2) continue;

      const polygon = [
        ...run,
        { x: run[run.length - 1].x, y: bottom },
        { x: run[0].x, y: bottom },
      ];

      // Fill first — the line stays crisp on top of the fill's edge.
      if (style.fillBottom) {
        // The anchor is the pane, not the run — if the gradient
        // restarted for every run split by a gap, the color at the same
        // height would differ from run to run.
        fillLinearGradient(target, {
          points: polygon,
          from: { x: 0, y: context.area.top },
          to: { x: 0, y: bottom },
          stops: [
            { offset: 0, color: style.fill },
            { offset: 1, color: style.fillBottom },
          ],
        });
      } else {
        target.drawShape({ shape: "polygon", points: polygon, fill: style.fill });
      }
      target.drawLine(run, style.line);
    }
  }

}

/** The default wiring for LineDataPoint, or an area over any point shape given `coordinates` — the same two calls as `lineSeries`. */
export function areaSeries(
  style?: AreaSeriesStyleOverrides & { coordinates?: never },
): AreaSeries<LineDataPoint>;
export function areaSeries<T extends BaseDataPoint>(
  options: AreaSeriesOptions<T> & { [K in keyof AreaSeriesStyleOverrides]?: never },
): AreaSeries<T>;
export function areaSeries<T extends BaseDataPoint>(
  options?: AreaSeriesStyleOverrides | AreaSeriesOptions<T>,
): AreaSeries<T> | AreaSeries<LineDataPoint> {
  if (options === undefined) return new AreaSeries({ coordinates: LINE_COORDINATES });
  // Prevents a bad type from passing through quietly and drawing with defaults.
  requireObject(options, "areaSeries(options)");
  if (hasCoordinates(options)) {
    return new AreaSeries<T>({
      coordinates: settleCoordinates(options, AREA_STYLE_SPEC, "areaSeries(options)"),
      style: options.style,
    });
  }
  return new AreaSeries({ coordinates: LINE_COORDINATES, style: options });
}

function hasCoordinates<T extends BaseDataPoint>(
  options: AreaSeriesStyleOverrides | AreaSeriesOptions<T>,
): options is AreaSeriesOptions<T> {
  return "coordinates" in options;
}

/** The runs of unbroken values, in screen coordinates. A gap is a boundary — the same rule as LineSeries. */
export function screenRuns<T extends BaseDataPoint>(
  context: SeriesContext<T>,
  coordinates: CoordinateAccessor<T>,
): Point[][] {
  const { data, yScale } = context;
  const runs: Point[][] = [];
  let run: Point[] = [];
  const pixelX = screenXAt(context, coordinates);

  for (let i = 0; i < data.length; i++) {
    const point = data[i];
    const y = coordinates.getY(point);
    if (isGap(y)) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }

    run.push({
      x: pixelX(i, point),
      y: yScale.scale(y),
    });
  }

  if (run.length > 0) runs.push(run);
  return runs;
}
