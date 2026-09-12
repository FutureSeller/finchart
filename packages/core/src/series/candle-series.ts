import { requireObject, requireOptionalBoolean } from "../primitives";
import { OhlcAggregation, OHLCAccessor } from "../data";
import type { DataView, OHLC, Range } from "../data";
import type { DrawTarget, StyleOverridesOf, StyleSpec } from "../render";
import { noStyle, resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";
import { slotWidth } from "./slot";
import type { Series, SeriesContext, SeriesRow } from "./types";
import { screenXAt } from "./types";

export interface CandleSeriesStyle {
  up: string;
  down: string;
  wickWidth: number;
  /** Body width as a fraction of slot width (0–1). */
  bodyRatio: number;
}

/** The CSS variables a candle owns. */
export const CANDLE_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  up: { css: "--chart-candle-up", fallback: "#16a34a" },
  down: { css: "--chart-candle-down", fallback: "#dc2626" },
  // Why the name gets a `-width` suffix: this leaf is a number (wick
  // width in px) while its two sibling tokens are colors, so a name
  // without the suffix reads too easily as "wick color" — the wick's
  // color isn't a token at all, it's just the body color.
  wickWidth: { css: "--chart-candle-wick-width", fallback: 1 },
  bodyRatio: { css: "--chart-candle-body-ratio", fallback: 0.6, range: [0, 1] },
}) satisfies StyleSpec<CandleSeriesStyle>;

export type CandleSeriesStyleOverrides = StyleOverridesOf<
  typeof CANDLE_STYLE_SPEC
>;

/** When there's neither a variable nor an override. */
export const DEFAULT_CANDLE_STYLE: CandleSeriesStyle = /* @__PURE__ */ resolveStyle(
  CANDLE_STYLE_SPEC,
  noStyle,
);

/**
 * A choice about the shape a candle draws — not a style token.
 * `StyleSpec`'s leaves are only colors and numbers, so faking a boolean
 * as a CSS variable would mismatch the leaf type and fall back silently.
 * So this comes as an options object instead (the same precedent as
 * `baselineSeries` and `histogramSeries`).
 */
export interface CandleDrawOptions {
  /** Outline only on an up candle, filled on a down candle ("hollow candles"). Default false. */
  hollow?: boolean;
}

export class CandleSeries implements Series<OHLC> {
  /**
   * A candle is aggregated, not thinned. One per pixel is the ceiling —
   * thinning would lose that interval's high and low, and drawing two
   * candles into one pixel just means the later one covers the earlier
   * one.
   */
  readonly decimation = {
    strategy: new OhlcAggregation(),
    pointsPerPixel: 1,
  };

  /** A candle's value is `close`. `OHLC` has no `y`, so the default accessor can't read it. */
  readonly coordinates = new OHLCAccessor();

  /** O/H/L/C, and V when the bar carries a volume — a gap (`null` or absent) is left out, not shown as a dash. */
  describe(point: OHLC): readonly SeriesRow[] {
    const rows: SeriesRow[] = [
      { label: "O", value: point.open },
      { label: "H", value: point.high },
      { label: "L", value: point.low },
      { label: "C", value: point.close },
    ];
    if (typeof point.volume === "number") rows.push({ label: "V", value: point.volume });
    return rows;
  }

  constructor(
    private overrides: CandleSeriesStyleOverrides = {},
    private draws: CandleDrawOptions = {},
  ) {}

  /**
   * A candle occupies the low-to-high span.
   * Looking only at close would let the wick stick out past the plot.
   */
  valueExtent(data: DataView<OHLC>): Range | null {
    if (data.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;

    for (const candle of data) {
      if (candle.low < min) min = candle.low;
      if (candle.high > max) max = candle.high;
    }

    return { min, max };
  }

  draw(target: DrawTarget, context: SeriesContext<OHLC>): void {
    const { data, yScale } = context;
    if (data.length === 0) return;

    const style = resolveStyle(CANDLE_STYLE_SPEC, context.readStyle, this.overrides);
    const bodyWidth = this.bodyWidth(context, style.bodyRatio);
    const pixelX = screenXAt(context, this.coordinates);

    for (let i = 0; i < data.length; i++) {
      const candle = data[i];
      const x = pixelX(i, candle);
      const color = candle.close >= candle.open ? style.up : style.down;

      // Wick: low to high
      target.drawLine(
        [
          { x, y: yScale.scale(candle.high) },
          { x, y: yScale.scale(candle.low) },
        ],
        { width: style.wickWidth, color },
      );

      // Body: open to close. Screen y increases downward, so the top is the larger value.
      const openY = yScale.scale(candle.open);
      const closeY = yScale.scale(candle.close);
      const top = Math.min(openY, closeY);
      const height = Math.max(Math.abs(closeY - openY), 1);

      const left = x - bodyWidth / 2;
      const right = left + bodyWidth;
      const bottom = top + height;

      if (this.draws.hollow && candle.close >= candle.open) {
        // One closed line — the four sides aren't drawn separately. The
        // command count is the unit of the drawing budget, and drawing
        // each side separately would turn one candle into four.
        target.drawLine(
          [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
            { x: left, y: top },
          ],
          { width: style.wickWidth, color },
        );
        continue;
      }

      target.drawShape({
        shape: "rect",
        x: left,
        y: top,
        width: bodyWidth,
        height,
        fill: color,
      });
    }
  }

  private bodyWidth(
    { data, x, places, fullData }: SeriesContext<OHLC>,
    ratio: number,
  ): number {
    // Slot arithmetic is shared by every series that has width. → slot.ts
    return Math.max(slotWidth(data, x, places, fullData) * ratio, 1);
  }

}

export function candleSeries(
  style?: CandleSeriesStyleOverrides,
  options?: CandleDrawOptions,
): CandleSeries {
  // Prevents a bad type from passing through quietly and drawing with defaults.
  if (style !== undefined) requireObject(style, "candleSeries(style)");
  if (options !== undefined) {
    requireObject(options, "candleSeries(options)");
    requireOptionalBoolean(options.hollow, "candleSeries({ hollow })");
  }
  return new CandleSeries(style, options);
}
