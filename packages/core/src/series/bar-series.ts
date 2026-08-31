import { requireObject } from "../primitives";
import { OhlcAggregation, OHLCAccessor } from "../data";
import type { DataView, OHLC, Range } from "../data";
import type { DrawTarget, StyleOverridesOf, StyleSpec } from "../render";
import { noStyle, resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";
import { slotWidth } from "./slot";
import type { Series, SeriesContext } from "./types";
import { screenXAt } from "./types";

export interface BarSeriesStyle {
  up: string;
  down: string;
  /**
   * The stroke width (px) of the vertical line and the ticks. Not the
   * bar's horizontal width — that's `tickRatio`. This is exactly why the
   * CSS variable name carries a `-width` suffix — without it, a consumer
   * whose complaint is "the bar is too thin" would raise the stroke
   * width, see the width stay the same, and conclude "I can't change the
   * bar's width" when the answer was right next to it.
   */
  lineWidth: number;
  /** The tick (open/close horizontal line) length as a fraction of slot width (0–1). **This is what sets the horizontal width.** */
  tickRatio: number;
}

/** The CSS variables a bar owns. */
export const BAR_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  up: { css: "--chart-bar-up", fallback: "#16a34a" },
  down: { css: "--chart-bar-down", fallback: "#dc2626" },
  lineWidth: { css: "--chart-bar-line-width", fallback: 1 },
  tickRatio: { css: "--chart-bar-tick-ratio", fallback: 0.4, range: [0, 1] },
}) satisfies StyleSpec<BarSeriesStyle>;

export type BarSeriesStyleOverrides = StyleOverridesOf<typeof BAR_STYLE_SPEC>;

/** When there's neither a variable nor an override. */
export const DEFAULT_BAR_STYLE: BarSeriesStyle = /* @__PURE__ */ resolveStyle(
  BAR_STYLE_SPEC,
  noStyle,
);

/**
 * An OHLC bar — the 3-stroke notation for a candle. A vertical line
 * (high to low), a left tick (open), and a right tick (close). Value
 * extent and decimation policy are the same as a candle's — it's just a
 * different notation for the same data.
 */
export class BarSeries implements Series<OHLC> {
  /** Aggregated for the same reason as a candle, with one per pixel as the ceiling. */
  readonly decimation = {
    strategy: new OhlcAggregation(),
    pointsPerPixel: 1,
  };

  readonly coordinates = new OHLCAccessor();

  constructor(private overrides: BarSeriesStyleOverrides = {}) {}

  valueExtent(data: DataView<OHLC>): Range | null {
    if (data.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;

    for (const bar of data) {
      if (bar.low < min) min = bar.low;
      if (bar.high > max) max = bar.high;
    }

    return { min, max };
  }

  draw(target: DrawTarget, context: SeriesContext<OHLC>): void {
    const { data, yScale } = context;
    if (data.length === 0) return;

    const style = resolveStyle(BAR_STYLE_SPEC, context.readStyle, this.overrides);
    const tick = Math.max(
      (slotWidth(data, context.x, context.places, context.fullData) * style.tickRatio) / 2,
      1,
    );
    const stroke = { width: style.lineWidth, color: "" };
    const pixelX = screenXAt(context, this.coordinates);

    for (let i = 0; i < data.length; i++) {
      const bar = data[i];
      const x = pixelX(i, bar);
      const color = bar.close >= bar.open ? style.up : style.down;
      const line = { ...stroke, color };

      target.drawLine(
        [
          { x, y: yScale.scale(bar.high) },
          { x, y: yScale.scale(bar.low) },
        ],
        line,
      );

      const openY = yScale.scale(bar.open);
      target.drawLine(
        [
          { x: x - tick, y: openY },
          { x, y: openY },
        ],
        line,
      );

      const closeY = yScale.scale(bar.close);
      target.drawLine(
        [
          { x, y: closeY },
          { x: x + tick, y: closeY },
        ],
        line,
      );
    }
  }

}

export function barSeries(style?: BarSeriesStyleOverrides): BarSeries {
  // Prevents a bad type from passing through quietly and drawing with defaults.
  if (style !== undefined) requireObject(style, "barSeries(style)");
  return new BarSeries(style);
}
