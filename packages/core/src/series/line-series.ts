import type { Point } from "../primitives";
import { requireObject } from "../primitives";
import type { BaseDataPoint, CoordinateAccessor, DataView, LineDataPoint, Range } from "../data";
import { isGap, LineDataAccessor } from "../data";
import type { DrawTarget, LineStyle, StyleOverridesOf, StyleSpec } from "../render";
import { noStyle, resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";
import type { Series, SeriesContext } from "./types";
import { screenXAt, settleCoordinates } from "./types";

export interface PointStyle {
  radius: number;
  color: string;
}

export interface LineSeriesStyle {
  line: LineStyle;
  point: PointStyle;
}

/**
 * The CSS variables a line owns. A name not listed here is never read by
 * the line — the defaults, the override type, and the manifest test all
 * come from this one constant.
 */
export const LINE_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  line: {
    width: { css: "--chart-line-width", fallback: 2 },
    color: { css: "--chart-line", fallback: "#3b82f6" },
    dashArray: { css: "--chart-line-dash", fallback: "" },
  },
  point: {
    radius: { css: "--chart-point-radius", fallback: 3 },
    color: { css: "--chart-point", fallback: "#3b82f6" },
  },
}) satisfies StyleSpec<LineSeriesStyle>;

export type LineSeriesStyleOverrides = StyleOverridesOf<typeof LINE_STYLE_SPEC>;

/** When there's neither a variable nor an override. */
export const DEFAULT_LINE_STYLE: LineSeriesStyle = /* @__PURE__ */ resolveStyle(
  LINE_STYLE_SPEC,
  noStyle,
);

export interface LineSeriesOptions<T extends BaseDataPoint> {
  coordinates: CoordinateAccessor<T>;
  style?: LineSeriesStyleOverrides;
}



export class LineSeries<T extends BaseDataPoint = LineDataPoint>
  implements Series<T>
{
  readonly coordinates: CoordinateAccessor<T>;
  private readonly overrides: LineSeriesStyleOverrides;

  constructor(options: LineSeriesOptions<T>) {
    this.coordinates = options.coordinates;
    this.overrides = options.style ?? {};
  }

  /**
   * Turns a connected run into a path to draw. Default is a no-op.
   *
   * Step is a subclass rather than an option because of bundle budget —
   * as an option it would become a branch in `draw`, and a consumer that
   * never uses step would still ship that code. As a subclass, it drops
   * out entirely for anyone who doesn't use it.
   */
  protected toPath(run: Point[]): Point[] {
    return run;
  }

  /**
   * A gap isn't counted — treating a missing value as 0 would drag the
   * value axis all the way down to 0. `null` when everything is a gap,
   * since there's nothing to measure.
   */
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

  /**
   * The line breaks at a gap — a separate `drawLine` call for each run
   * where values are unbroken. Drawing it as one continuous line would
   * let the line cross a spot with no data — like an indicator's warmup
   * span (MA(20)'s first 19 points) — making a missing value look like
   * it's there.
   */
  draw(target: DrawTarget, context: SeriesContext<T>): void {
    const style = resolveStyle(LINE_STYLE_SPEC, context.readStyle, this.overrides);

    for (const run of this.toScreenSpace(context)) {
      // Step changes **only the drawn path** — the point markers below
      // still use the data's own places (run) as they are. A corner is a
      // place we invented, not an observation.
      const path = this.toPath(run);
      if (path.length >= 2) target.drawLine(path, style.line);

      if (style.point.radius <= 0) continue;

      for (const point of run) {
        target.drawShape({
          shape: "circle",
          cx: point.x,
          cy: point.y,
          r: style.point.radius,
          fill: style.point.color,
        });
      }
    }
  }

  /** The runs where values are unbroken. A gap is a boundary. */
  private toScreenSpace(context: SeriesContext<T>): Point[][] {
    const { data, yScale } = context;
    const runs: Point[][] = [];
    let run: Point[] = [];
    const pixelX = screenXAt(context, this.coordinates);

    for (let i = 0; i < data.length; i++) {
      const point = data[i];
      const y = this.coordinates.getY(point);

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
}

/**
 * The default wiring for LineDataPoint — or, given `coordinates`, a line
 * over any point shape: `lineSeries({ coordinates: new OHLCAccessor() })`
 * draws candles by their close, so a candle ↔ line toggle is
 * `handle.swapSeries(...)` between two factories.
 */
export function lineSeries(
  style?: LineSeriesStyleOverrides & { coordinates?: never },
): LineSeries<LineDataPoint>;
export function lineSeries<T extends BaseDataPoint>(
  options: LineSeriesOptions<T> & { [K in keyof LineSeriesStyleOverrides]?: never },
): LineSeries<T>;
export function lineSeries<T extends BaseDataPoint>(
  options?: LineSeriesStyleOverrides | LineSeriesOptions<T>,
): LineSeries<T> | LineSeries<LineDataPoint> {
  if (options === undefined) return new LineSeries({ coordinates: new LineDataAccessor() });
  // Prevents a bad type from passing through quietly and drawing with defaults.
  requireObject(options, "lineSeries(options)");
  if (hasCoordinates(options)) {
    return new LineSeries<T>({
      coordinates: settleCoordinates(options, LINE_STYLE_SPEC, "lineSeries(options)"),
      style: options.style,
    });
  }
  return new LineSeries({ coordinates: new LineDataAccessor(), style: options });
}

/** Which of the two calls this is — the key, not its value, decides (a present `coordinates` is then checked). */
function hasCoordinates<T extends BaseDataPoint>(
  options: LineSeriesStyleOverrides | LineSeriesOptions<T>,
): options is LineSeriesOptions<T> {
  return "coordinates" in options;
}

/**
 * A line whose value holds until the next x (horizontal first, then
 * vertical). Connecting a discrete series (rate decisions, inventory,
 * ratings) with a straight diagonal line would draw an in-between value
 * that never existed.
 *
 * Point markers stay at the data's own places, not at a step's corner —
 * a corner is a place we invented, and marking it would show an
 * observation that was never made. This is a separate subclass rather
 * than an option for the same reason explained in `LineSeries.toPath`.
 */
export class StepLineSeries<
  T extends BaseDataPoint = LineDataPoint,
> extends LineSeries<T> {
  protected override toPath(run: Point[]): Point[] {
    if (run.length < 2) return run;
    const path: Point[] = [run[0]];
    for (let i = 1; i < run.length; i++) {
      // The y at the corner belongs to the **previous** point — the value held over, it isn't a new one.
      path.push({ x: run[i].x, y: run[i - 1].y }, run[i]);
    }
    return path;
  }
}

export function stepLineSeries(
  style?: LineSeriesStyleOverrides,
): StepLineSeries<LineDataPoint> {
  if (style !== undefined) requireObject(style, "stepLineSeries(style)");
  return new StepLineSeries({ coordinates: new LineDataAccessor(), style });
}
