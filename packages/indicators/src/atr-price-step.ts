import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { assertPeriod, requireOptions, requireSourceArray, rma, trueRanges } from "./kernels";

export interface AtrPriceStepOptions {
  /** The ATR's window — a positive integer, required: which ATR is the step is the caller's call. */
  period: number;
}

/**
 * The step a chart's own volatility suggests — the last ATR of the tape,
 * as a price distance: a starting point for `renko`'s `brickSize`,
 * `kagi`'s `reversal` and `pointAndFigure`'s `boxSize`, which are all
 * price distances the consumer has to name. "The ATR of when" is in the
 * call — the whole tape handed in, its last value out — so a consumer
 * choosing a step for a live chart chooses the tape it is measured on.
 *
 * The doors keep the transforms from failing under a name that is not
 * theirs: fewer bars than `period` (Wilder's average seeds on `period`
 * true ranges — there is no ATR before that), and an ATR that is no step
 * — 0 on a flat tape, or under 2⁻¹⁰²², the smallest step the strictest of
 * the three (`pointAndFigure`, whose grid arithmetic needs a normal
 * double) accepts, or over half the largest double, past which `renko`
 * cannot lay its two-brick reversal — are refused here, as
 * `ContractError`; what comes out passes the three transforms' option doors (`renko` and `pointAndFigure`
 * also hold the prices themselves to within 2⁴⁷ steps of zero — a step of
 * 16,384 on a price of 10²⁰ is below the doubles' spacing there, and that
 * is their door to raise, under their own names). The step follows the
 * tape's recent volatility: for a period above 1, Wilder's average decays
 * older true ranges exponentially — a bar's weight halves every
 * `ln 2 / ln(period / (period − 1))` bars, about nine for a period of 14 —
 * so the last window weighs most and older history still counts: two
 * tapes with the same last bars and different pasts give different steps
 * (a period of 1 is the last true range alone). Pass the source you will
 * draw. What the step sizes is the tape's travel along the price
 * axis, in steps: `renko` lays a brick per step of travel, `pointAndFigure`
 * a box per step (in as many columns as there are reversals), `kagi` a
 * line per reversal — at most one vertex per bar. With the ATR step the
 * travel is near the bar count on a tape whose volatility is even; a
 * hand-picked step far below the average move multiplies it. To size a
 * chart, count the transform's output on that source; the step is the
 * caller's choice, not this helper's.
 *
 * The classic Point & Figure box tables (a box of ¼ under 5, ½ under 20…)
 * are not shipped: they differ by market and era. This is the starting
 * point; the tables are the consumer's.
 */
export function atrPriceStep(source: readonly OHLC[], options: AtrPriceStepOptions): number {
  requireSourceArray(source, "atrPriceStep");
  requireOptions(options, "atrPriceStep");
  const { period } = options;
  assertPeriod(period);
  if (source.length < period) {
    throw new ContractError(`atrPriceStep needs at least ${period} bars for an ATR(${period}), got ${source.length}`);
  }
  const last = rma(trueRanges(source), period)[source.length - 1];
  // Seeded on `period` true ranges, the last value is a number — unless one of them was not (a NaN price, or a
  // true range whose sum with its neighbours leaves the doubles): the average restarts from a gap, and there
  // is no ATR to hand out.
  if (last === null) {
    throw new ContractError(`atrPriceStep has no ATR(${period}) over ${source.length} bars — a true range could not be committed (not a finite number, or one whose accumulation leaves the usable range)`);
  }
  if (!(last >= 2 ** -1022)) {
    throw new ContractError(
      `atrPriceStep found an ATR(${period}) of ${last} — no step: a flat tape has none, and the strictest transform requires a positive normal number (2⁻¹⁰²² or more)`,
    );
  }
  if (!Number.isFinite(2 * last)) {
    throw new ContractError(
      `atrPriceStep found an ATR(${period}) of ${last} — no step: past half the largest double renko cannot lay its two-brick reversal`,
    );
  }
  return last;
}
