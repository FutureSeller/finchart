import { isGap, LineDataAccessor } from "../data";
import type { DataView, LineDataPoint, Range } from "../data";
import type { DrawTarget, StyleOverridesOf, StyleSpec } from "../render";
import { noStyle, resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";
import type { Point } from "../primitives";
import { requireObject } from "../primitives";
import { screenRuns } from "./area-series";
import type { Series, SeriesContext } from "./types";

export interface BaselineSeriesStyle {
  /**
   * The stroke width (px) of the above/below data line. Not the baseline
   * itself — the line that the `baseline` (threshold value) option
   * defines isn't even drawn (it doesn't occupy value space). The CSS
   * variable name always includes `-line-` — baseline is the only series
   * that also has a `baseline` option, so dropping that infix would let a
   * consumer misread it as "the baseline's width" and raise the value
   * only to see nothing change.
   */
  lineWidth: number;
  topLine: string;
  topFill: string;
  bottomLine: string;
  bottomFill: string;
}

/** The CSS variables baseline owns. */
export const BASELINE_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  lineWidth: { css: "--chart-baseline-line-width", fallback: 2 },
  topLine: { css: "--chart-baseline-top", fallback: "#16a34a" },
  topFill: { css: "--chart-baseline-top-fill", fallback: "rgba(22, 163, 74, 0.16)" },
  bottomLine: { css: "--chart-baseline-bottom", fallback: "#dc2626" },
  bottomFill: {
    css: "--chart-baseline-bottom-fill",
    fallback: "rgba(220, 38, 38, 0.16)",
  },
}) satisfies StyleSpec<BaselineSeriesStyle>;

export type BaselineSeriesStyleOverrides = StyleOverridesOf<
  typeof BASELINE_STYLE_SPEC
>;

/** When there's neither a variable nor an override. */
export const DEFAULT_BASELINE_STYLE: BaselineSeriesStyle = /* @__PURE__ */ resolveStyle(
  BASELINE_STYLE_SPEC,
  noStyle,
);

export interface BaselineSeriesOptions {
  /** The value that splits above from below. Default 0 — the natural spot for P&L and returns. */
  baseline?: number;
  style?: BaselineSeriesStyleOverrides;
}

/**
 * A series colored differently above and below a threshold value — a
 * P&L curve, performance versus a benchmark.
 *
 * The crossing is cut by linear interpolation — switching color point by
 * point without cutting would flip color at a bar, painting the wrong
 * color onto the span that merely grazes the baseline. The gap rule is
 * the same as area's — both fill and line break there.
 */
export class BaselineSeries implements Series<LineDataPoint> {
  readonly coordinates = new LineDataAccessor();
  private readonly baseline: number;
  private readonly overrides: BaselineSeriesStyleOverrides;

  constructor(options: BaselineSeriesOptions = {}) {
    this.baseline = options.baseline ?? 0;
    this.overrides = options.style ?? {};
  }

  /** This is the line's extent — the baseline itself occupies no value space (unlike a bar). */
  valueExtent(data: DataView<LineDataPoint>): Range | null {
    let min = Infinity;
    let max = -Infinity;

    for (const point of data) {
      if (isGap(point.y)) continue;
      if (point.y < min) min = point.y;
      if (point.y > max) max = point.y;
    }

    return min === Infinity ? null : { min, max };
  }

  draw(target: DrawTarget, context: SeriesContext<LineDataPoint>): void {
    const style = resolveStyle(BASELINE_STYLE_SPEC, context.readStyle, this.overrides);
    const baseY = context.yScale.scale(this.baseline);
    const [lowY, highY] = context.yScale.getRange();

    for (const run of screenRuns(context, this.coordinates)) {
      if (run.length < 2) continue;

      for (const segment of splitAtBaseline(run, baseY, highY < lowY)) {
        const above = segment.side === "above";

        target.drawShape({
          shape: "polygon",
          points: [
            ...segment.points,
            { x: segment.points[segment.points.length - 1].x, y: baseY },
            { x: segment.points[0].x, y: baseY },
          ],
          fill: above ? style.topFill : style.bottomFill,
        });
        target.drawLine(segment.points, {
          width: style.lineWidth,
          color: above ? style.topLine : style.bottomLine,
        });
      }
    }
  }

}

export function baselineSeries(
  options?: BaselineSeriesOptions,
): BaselineSeries {
  // Prevents a bad type from passing through quietly and drawing with defaults.
  if (options !== undefined) requireObject(options, "baselineSeries(options)");
  return new BaselineSeries(options);
}

interface BaselineSegment {
  side: "above" | "below";
  points: Point[];
}

/**
 * Cuts a screen-space polyline at the baseline y. The crossing point goes
 * into both segments — the line and the fill both meet exactly at that
 * point.
 *
 * By default, "above" is the side with smaller screen y. An inverted
 * value axis reverses that comparison so colors still describe values. A
 * point sitting exactly on the baseline (y === baseY) sticks with
 * whichever side is already in progress — splitting a segment for a
 * point that merely grazes the line would spawn a flood of one-point
 * fragments.
 */
export function splitAtBaseline(
  run: readonly Point[],
  baseY: number,
  aboveIsSmaller = true,
): BaselineSegment[] {
  const segments: BaselineSegment[] = [];
  let current: Point[] = [run[0]];
  const sideOf = (y: number): "above" | "below" =>
    y === baseY || (y < baseY) === aboveIsSmaller ? "above" : "below";
  let side = sideOf(run[0].y);

  for (let i = 1; i < run.length; i++) {
    const previous = run[i - 1];
    const point = run[i];
    const nextSide: "above" | "below" =
      point.y === baseY ? side : sideOf(point.y);

    if (nextSide !== side) {
      // Interpolate the crossing x linearly — color changes at the crossing point, not at a bar.
      const t = (baseY - previous.y) / (point.y - previous.y);
      const crossing = {
        x: previous.x + (point.x - previous.x) * t,
        y: baseY,
      };
      current.push(crossing);
      segments.push({ side, points: current });
      current = [crossing];
      side = nextSide;
    }

    current.push(point);
  }

  if (current.length > 1) segments.push({ side, points: current });
  return segments;
}
