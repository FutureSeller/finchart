import { describeValue, requireOptions } from "./kernels";
/**
 * Volume Profile — the traded volume distribution over the visible range,
 * as horizontal bars per price bucket.
 *
 * A decoration, not a series — since it draws a distribution instead of
 * plotting data points by x, the registration/decimation contract doesn't
 * apply here. It re-aggregates the visible x-range on every render
 * (TradingView's "Visible Range" lineage) — O(n) over visible candles, so
 * it's within budget.
 *
 * v1 approximation: a candle's whole volume lands in the single bucket of
 * its typical price (H+L+C)/3. Candles without volume are excluded from
 * the aggregation — if none have it, nothing is drawn.
 */
import type { OHLC, PaneDecoration, Source, StyleSpec } from "@finchart/core";
import { ContractError, isGap, resolveStyle, styleSpec } from "@finchart/core";

export interface VolumeProfileOptions {
  source: Source<OHLC>;
  /** Number of price buckets. Default 24. */
  bins?: number;
  /** The fraction of the data area's width the longest bar occupies. Default 0.28. */
  widthFraction?: number;
  /** Overrides on top of the CSS variables. `poc` is the peak bucket (Point of Control). */
  style?: { fill?: string; poc?: string };
}

/** Single source of truth for defaults — see `MACD_DEFAULTS`. */
export const VOLUME_PROFILE_DEFAULTS = {
  bins: 24,
  widthFraction: 0.28,
} as const;

/** CSS variables owned by the volume profile — a manifest test enforces the list. */
export const VOLUME_PROFILE_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  fill: { css: "--chart-profile", fallback: "rgba(100, 116, 139, 0.28)" },
  poc: { css: "--chart-profile-poc", fallback: "rgba(245, 158, 11, 0.55)" },
}) satisfies StyleSpec<{ fill: string; poc: string }>;

export function volumeProfile(options: VolumeProfileOptions): PaneDecoration {
  requireOptions(options, "volumeProfile");
  const bins = options.bins ?? VOLUME_PROFILE_DEFAULTS.bins;
  const fraction =
    options.widthFraction ?? VOLUME_PROFILE_DEFAULTS.widthFraction;
  // Rejects silent failure — bins of 0 flows into a negative index and
  // draws nothing, and fraction > 1 makes bars punch through the area.
  // Symmetric with renko's brickSize validation.
  if (!Number.isInteger(bins) || bins < 1) {
    throw new ContractError(
      `volumeProfile bins must be a positive integer, got ${describeValue(bins)}`,
    );
  }
  // `Number.isFinite` comes first — a bare relational comparison lets `"0.28"` slip through via coercion.
  if (!Number.isFinite(fraction) || !(fraction > 0) || fraction > 1) {
    throw new ContractError(
      `volumeProfile widthFraction must be in (0, 1], got ${describeValue(fraction)}`,
    );
  }

  return {
    draw(target, context) {
      const { area, x: mapping, yScale, readStyle } = context;
      const data = options.source.read();
      if (data.length === 0) return;

      // The visible range — resting on the sort contract, two inverse-pixel lookups suffice.
      const fromX = mapping.fromPixel(area.left);
      const toX = mapping.fromPixel(area.right);

      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      let volumeScale = 0;
      const visible: OHLC[] = [];
      // The first visible bar by binary search — the walk then covers only
      // what is on screen, not the whole history, every frame.
      let lo = 0;
      let hi = data.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (data[mid].x < fromX) lo = mid + 1;
        else hi = mid;
      }
      for (let at = lo; at < data.length; at++) {
        const candle = data[at];
        if (candle.x > toX) break;
        visible.push(candle);
        if (candle.low < low) low = candle.low;
        if (candle.high > high) high = candle.high;
        if (!isGap(candle.volume) && candle.volume > volumeScale) volumeScale = candle.volume;
      }
      if (visible.length === 0 || high <= low || volumeScale <= 0) return;

      const totals = new Array<number>(bins).fill(0);
      for (const candle of visible) {
        const volume = candle.volume;
        // `isGap` covers `null` too — `null <= 0` happened to be true, but
        // that was luck, not a rule. Finiteness is the data gate's job.
        if (isGap(volume) || volume <= 0) continue;
        const sum = candle.high + candle.low + candle.close;
        const typical = Number.isFinite(sum) ? sum / 3 : candle.high / 3 + candle.low / 3 + candle.close / 3;
        const span = high - low;
        const fraction = Number.isFinite(span)
          ? (typical - low) / span
          : (typical / 2 - low / 2) / (high / 2 - low / 2);
        const index = Math.min(
          bins - 1,
          Math.max(0, Math.floor(fraction * bins)),
        );
        // Only ratios are drawn. In units of the largest volume each
        // contribution is at most one, so a finite tape cannot overflow.
        totals[index] += volume / volumeScale;
      }

      let max = 0;
      let poc = -1;
      for (let index = 0; index < bins; index++) {
        if (totals[index] > max) {
          max = totals[index];
          poc = index;
        }
      }
      if (max <= 0) return; // volume is entirely absent — absence stays absence

      const style = resolveStyle(
        VOLUME_PROFILE_STYLE_SPEC,
        readStyle,
        options.style,
      );
      const maxWidth = (area.right - area.left) * fraction;
      const priceAt = (index: number): number => {
        const fraction = index / bins;
        return low * (1 - fraction) + high * fraction;
      };

      for (let index = 0; index < bins; index++) {
        const total = totals[index];
        if (total <= 0) continue;

        const bandTop = yScale.scale(priceAt(index + 1));
        const bandBottom = yScale.scale(priceAt(index));
        const width = (total / max) * maxWidth;

        target.drawShape({
          shape: "rect",
          x: area.right - width,
          y: bandTop,
          // A 1px gap between buckets — so bars don't merge into one solid mass.
          height: Math.max(1, bandBottom - bandTop - 1),
          width,
          fill: index === poc ? style.poc : style.fill,
        });
      }
    },
  };
}
