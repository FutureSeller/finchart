import { DataError, describe, requireObject } from "../primitives";
import { isGap } from "../data";
import type { BaseDataPoint, CoordinateAccessor, DataView, Range } from "../data";
import type { DrawTarget, StyleOverridesOf, StyleSpec } from "../render";
import { noStyle, resolveStyle } from "../render";
import { isGiven, styleSpec } from "../render/style-spec";
import { slotWidth } from "./slot";
import type { Series, SeriesContext } from "./types";
import { screenXAt } from "./types";

/**
 * A single bar. `LineDataPoint` passes straight through — `tone` and
 * `color` are optional.
 *
 * Why a point can say something about its own colour: it's the convention
 * that a volume bar wears its candle's up/down colour. Up or down is a
 * fact about the data, not a style, and only whoever produces the point
 * knows that fact. `tone` states the fact and leaves the colour to the
 * theme (`--chart-histogram-up` / `--chart-histogram-down`); `color` is
 * the older door — an explicit colour that steps outside the theme.
 */
export interface HistogramPoint extends BaseDataPoint {
  y: number | null;
  /**
   * Which of the two colour slots this bar wears. What counts as up is the
   * producer's to say — a volume bar follows its candle, an oscillator's
   * bar follows the bar before it. A bar without a tone wears the plain
   * histogram colour.
   */
  tone?: "up" | "down";
  /** An explicit colour for this bar. Wins over everything; cannot be themed. */
  color?: string;
}

export interface HistogramSeriesStyle {
  /** The colour of a bar that carries no tone. */
  color: string;
  /** The colour of a bar whose tone is `up` / `down`. */
  up: string;
  down: string;
  /** Bar width as a fraction of slot width (0–1). */
  barRatio: number;
}

/**
 * The CSS variables a histogram owns. The two tone slots fall back to the
 * candle's colours — with no theme at all, a volume bar and its candle
 * speak the same language.
 */
export const HISTOGRAM_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  color: { css: "--chart-histogram", fallback: "#94a3b8" },
  up: { css: "--chart-histogram-up", fallback: "#16a34a" },
  down: { css: "--chart-histogram-down", fallback: "#dc2626" },
  barRatio: { css: "--chart-histogram-bar-ratio", fallback: 0.6, range: [0, 1] },
}) satisfies StyleSpec<HistogramSeriesStyle>;

export type HistogramSeriesStyleOverrides = StyleOverridesOf<
  typeof HISTOGRAM_STYLE_SPEC
>;

/** When there's neither a variable nor an override. */
export const DEFAULT_HISTOGRAM_STYLE: HistogramSeriesStyle = /* @__PURE__ */ resolveStyle(
  HISTOGRAM_STYLE_SPEC,
  noStyle,
);

export interface HistogramSeriesOptions {
  /** The value bars grow from. Default 0 — the natural spot for volume and a MACD histogram. */
  baseline?: number;
  style?: HistogramSeriesStyleOverrides;
}

class HistogramAccessor implements CoordinateAccessor<HistogramPoint> {
  getX(point: HistogramPoint): number {
    return point.x;
  }
  getY(point: HistogramPoint): number | null {
    return point.y;
  }

  /** The same rule as line — `null` is a gap, any other non-finite value is rejected. */
  assertFinite(point: HistogramPoint, index: number, label = "data"): void {
    const y = point.y;
    if (isGap(y) || Number.isFinite(y)) return;
    throw new DataError(
      `${label} y must be a finite number or null (gap), but index ${index} is ${describe(y)}`,
    );
  }
}

export class HistogramSeries implements Series<HistogramPoint> {
  readonly coordinates = new HistogramAccessor();
  private readonly baseline: number;
  private readonly overrides: HistogramSeriesStyleOverrides;

  constructor(options: HistogramSeriesOptions = {}) {
    this.baseline = options.baseline ?? 0;
    this.overrides = options.style ?? {};
  }

  /**
   * A bar grows from the baseline — the baseline occupies value space
   * too. This is why a volume pane starts at 0: the extent includes 0,
   * so autoscale never pushes the floor below it.
   */
  valueExtent(data: DataView<HistogramPoint>): Range | null {
    let min = Infinity;
    let max = -Infinity;

    for (const point of data) {
      if (isGap(point.y)) continue;
      if (point.y < min) min = point.y;
      if (point.y > max) max = point.y;
    }

    if (min === Infinity) return null;

    return {
      min: Math.min(min, this.baseline),
      max: Math.max(max, this.baseline),
    };
  }

  draw(target: DrawTarget, context: SeriesContext<HistogramPoint>): void {
    const { data, yScale } = context;
    if (data.length === 0) return;

    const style = resolveStyle(HISTOGRAM_STYLE_SPEC, context.readStyle, this.overrides);
    const barWidth = Math.max(
      slotWidth(data, context.x, context.places, context.fullData) * style.barRatio,
      1,
    );
    const baseY = yScale.scale(this.baseline);
    const pixelX = screenXAt(context, this.coordinates);
    // The most local explicit value wins, as in CSS: a slot override, then
    // one explicit series colour (a consumer who wrote `style: { color }`
    // asked for one colour, and a toned input must not take it away), then
    // the slot's variable. The plain variable never reaches a toned bar.
    const upFill = this.slotFill("up", style);
    const downFill = this.slotFill("down", style);

    for (let i = 0; i < data.length; i++) {
      const point = data[i];
      if (isGap(point.y)) continue;

      const x = pixelX(i, point);
      const valueY = yScale.scale(point.y);
      const top = Math.min(valueY, baseY);
      // Even a zero-value bar sitting on the baseline shows at least one pixel — the same rule as a candle's body.
      const height = Math.max(Math.abs(valueY - baseY), 1);

      target.drawShape({
        shape: "rect",
        x: x - barWidth / 2,
        y: top,
        width: barWidth,
        height,
        fill:
          point.color ??
          (point.tone === "up"
            ? upFill
            : point.tone === "down"
              ? downFill
              : style.color),
      });
    }
  }

  private slotFill(slot: "up" | "down", style: HistogramSeriesStyle): string {
    if (isGiven(this.overrides[slot])) return style[slot];
    if (isGiven(this.overrides.color)) return style.color;
    return style[slot];
  }
}

export function histogramSeries(
  options?: HistogramSeriesOptions,
): HistogramSeries {
  // Prevents a bad type from passing through quietly and drawing with defaults.
  if (options !== undefined) requireObject(options, "histogramSeries(options)");
  return new HistogramSeries(options);
}
