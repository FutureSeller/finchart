import {
  ContractError,
  requireFinite,
  requireInterval,
  requireRange,
} from "../primitives";
import { niceInterval, withoutFloatNoise } from "./tick-arithmetic";
import type { ExpandHints, Scale, TickGeometry } from "./types";

/**
 * Same number, same reason as the linear axis's `MAX_TICKS` — a
 * degenerate domain once spun tick generation forever and killed the tab
 * with an OOM. Geometry ticks skip that door, so they carry their own
 * copy of the lock.
 */
const MAX_GEOMETRY_TICKS = 1000;

/**
 * The mantissa ladder's tightest neighbors are 1→2 and 5→10 — both
 * log₁₀2 ≈ 0.301 decades. Whether the full ladder fits is decided from
 * this one number and the pixel density.
 */
const LOG10_2 = Math.log10(2);

/**
 * 1·2·5 is the axis's public vocabulary (the linear `niceInterval` and
 * the glossary both commit to it) — the ladder never invents other
 * mantissas, and its only coarser rungs are {1} and skipped decades, so
 * every transition is a pure thinning: surviving ticks keep their
 * values, the grid fades rather than reshuffles.
 */
const MANTISSA_LADDER: readonly number[] = [1, 2, 5];

/**
 * Everything `values()`/`stepAt` answer from, snapshotted at
 * `tickGeometry()` time so both stay consistent and O(1)-cheap. Either
 * the linear candidate won (`linearStep` set) or the ladder did.
 */
interface TickPlan {
  domainMin: number;
  domainMax: number;
  pxPerDecade: number;
  /** Set when the linear candidate kept more ticks than the ladder. */
  linearStep: number | null;
  linearFirst: number;
  linearCount: number;
  /** Ladder shape: mantissas per decade, and the decade stride. */
  mantissas: readonly number[];
  skip: number;
  /** `stepAt`'s clamp bounds — the visible domain's decade range. */
  stepFloor: number;
  stepCeiling: number;
}

/** `10^floor(log₁₀ v)` — the decade a value lives in. */
function decadeOf(value: number): number {
  return 10 ** Math.floor(Math.log10(value));
}

/** The smallest k ≥ `from` with `k ≡ 0 (mod stride)` — an absolute anchor, so a moving domain edge can't re-seat the whole ladder. */
function alignDecade(from: number, stride: number): number {
  return Math.ceil(from / stride) * stride;
}

/**
 * The fallback used only when the lower bound is at or below 0 and there's
 * no way to ask for the real floor — how many multiples below the upper
 * bound. A log axis's floor can never come from 0 (0 is infinitely far
 * away). 1000 is three orders of magnitude, a width that leaves three or
 * four ticks on screen.
 *
 * This is no longer the first answer — `expand` asks
 * `ExpandHints.minPositive()` for the real smallest positive value in the
 * visible interval first. This constant is what's left for when there's
 * nowhere to ask (a direct call with no hints, or an interval with no
 * positive value at all).
 */
const LOG_FLOOR_DECADES = 1000;

/**
 * Pairs well with `priceFormat()` on the axis: the log ladder's local
 * step (`tickGeometry`) is what lets a step-aware formatter show
 * `0.00003` near the floor of a wide domain instead of `0.00`.
 */
export class LogScale implements Scale {
  private domain: [number, number] = [1, 10];
  private range: [number, number] = [0, 1];

  constructor(
    domainMin?: number,
    domainMax?: number,
    rangeMin?: number,
    rangeMax?: number,
  ) {
    if (domainMin !== undefined && domainMax !== undefined) {
      this.setDomain(domainMin, domainMax);
    }
    if (rangeMin !== undefined && rangeMax !== undefined) {
      this.setRange(rangeMin, rangeMax);
    }
  }

  /**
   * Check finiteness first — checking only `min <= 0 || max <= 0` would
   * let `max = Infinity` through, since `Infinity > 0`, and that can reach
   * an infinite tick loop.
   */
  setDomain(min: number, max: number): void {
    requireFinite(min, "domain min");
    requireFinite(max, "domain max");
    if (min <= 0 || max <= 0) {
      throw new ContractError("LogScale domain must be positive");
    }
    this.domain = requireInterval(min, max, "domain");
  }

  setRange(start: number, end: number): void {
    this.range = requireRange(start, end, "range");
  }

  getDomain(): [number, number] {
    return [...this.domain];
  }

  getRange(): [number, number] {
    return [...this.range];
  }

  /**
   * Value → pixel.
   *
   * A value at or below 0 doesn't throw — it's sent off below the axis.
   * This function is on the draw path — a series calls it per point, and
   * a single `close: 0` candle mixed in would otherwise kill the whole
   * frame. On a log axis, 0 is a value infinitely far below, not a
   * contract violation.
   *
   * It gets the same treatment an off-screen value gets on a linear axis
   * — a pixel comes out, it's just outside the area so nothing draws
   * there. The actual contract violation (a domain with no positive value
   * at all) is still rejected by `setDomain`, under its own name.
   *
   * Returning a finite value instead of `-Infinity` matters — a
   * non-finite coordinate turns `fillRect` into a no-op, wiping out the
   * whole body.
   */
  scale(value: number): number {
    if (value <= 0) {
      const [rangeMin, rangeMax] = this.range;
      /**
       * Off the bottom of the domain — regardless of which way the range
       * points. In the default path `rangeMin` is the bottom of the
       * screen (the non-inverted branch in `pane.ts`). A value at or
       * below 0 is below the domain minimum, and the domain minimum lands
       * at `rangeMin`, so this goes one axis-height past `rangeMin`, away
       * from `rangeMax` — down in the non-inverted case, up in the
       * inverted one; either way it's outside the area.
       */
      return rangeMin + (rangeMin - rangeMax);
    }

    const [domainMin, domainMax] = this.domain;
    const [rangeMin, rangeMax] = this.range;

    const logMin = Math.log(domainMin);
    const logMax = Math.log(domainMax);
    const ratio = (Math.log(value) - logMin) / (logMax - logMin);

    return rangeMin + ratio * (rangeMax - rangeMin);
  }

  invert(screenValue: number): number {
    const [domainMin, domainMax] = this.domain;
    const [rangeMin, rangeMax] = this.range;

    const ratio = (screenValue - rangeMin) / (rangeMax - rangeMin);
    const logValue =
      Math.log(domainMin) + ratio * (Math.log(domainMax) - Math.log(domainMin));

    return Math.exp(logValue);
  }

  /**
   * Tick geometry on this scale's own arithmetic — the ladder of 1·2·5
   * mantissas over decades, or a linear run when the window is narrow
   * enough that the ladder would be sparser. One predicate decides:
   * **whichever candidate keeps more ticks wins** (tie goes to the
   * ladder — its values are the rounder ones, and its membership doesn't
   * depend on where the domain's edges sit, so panning can't reshuffle
   * the interior). There is no threshold constant to snap at.
   */
  tickGeometry(minTickSpacing: number): TickGeometry {
    requireFinite(minTickSpacing, "tickGeometry(minTickSpacing)");
    if (minTickSpacing <= 0) {
      throw new ContractError(
        `tickGeometry(minTickSpacing) must be positive, got ${minTickSpacing}`,
      );
    }

    const plan = this.planTicks(minTickSpacing);

    return {
      values: () => collectTicks(plan),
      stepAt: (value) => stepFromPlan(plan, value),
    };
  }

  /**
   * Decides linear-vs-ladder once, without materializing either
   * candidate — `stepAt` sits on the per-frame badge path, so the
   * decision has to be a handful of arithmetic, not an array build.
   */
  private planTicks(minTickSpacing: number): TickPlan {
    const [min, max] = this.domain;
    const [from, to] = this.range;
    // The range's direction carries the y flip — geometry only needs the
    // magnitude. Taking it here, in the module that owns the range
    // invariant, is what spares every caller a sign contract.
    const span = Math.abs(to - from);
    // Difference of logs, not log of the ratio — `max / min` overflows to
    // Infinity past ~600 decades (1e300 / 1e-300), and an infinite decade
    // count silently produced zero ticks. Caught by a mutation run.
    const decades = Math.log10(max) - Math.log10(min); // > 0 — the domain contract is min < max
    const pxPerDecade = span / decades;

    /**
     * Ladder shape from the pixel density alone — a value-local rule.
     * The domain's edges play no part in which rung a value belongs to,
     * so a moving lower bound only adds or drops ticks at the ends.
     */
    let mantissas: readonly number[] = [1];
    let skip = 1;
    if (pxPerDecade * LOG10_2 >= minTickSpacing) {
      mantissas = MANTISSA_LADDER;
    } else if (pxPerDecade < minTickSpacing) {
      skip = Math.ceil(minTickSpacing / pxPerDecade);
    }

    let ladderCount = 0;
    const kFirst = alignDecade(Math.floor(Math.log10(min)), skip);
    const kLast = Math.floor(Math.log10(max));
    for (let k = kFirst; k <= kLast && ladderCount < MAX_GEOMETRY_TICKS; k += skip) {
      for (const mantissa of mantissas) {
        const value = mantissa * 10 ** k;
        if (value >= min && value <= max) ladderCount++;
      }
    }

    /**
     * Linear candidate — the same step arithmetic the linear axis uses.
     * The log top compresses, so pixel gaps shrink monotonically along
     * the run; the survivors are exactly a prefix, kept while the gap
     * still clears the spacing.
     */
    const fits = Math.max(1, Math.floor(span / minTickSpacing));
    const linearStep = niceInterval((max - min) / fits);
    const linearFirst = Math.ceil(min / linearStep) * linearStep;
    let linearCount = 0;
    let previousLog = 0;
    for (let index = 0; linearCount < MAX_GEOMETRY_TICKS; index++) {
      const value = linearFirst + index * linearStep;
      if (value > max) break;
      const logValue = Math.log10(value);
      // Gaps only shrink from here on, so the first miss ends the prefix.
      // This also ends a run whose step underflowed to no progress.
      if (linearCount > 0 && (logValue - previousLog) * pxPerDecade < minTickSpacing) {
        break;
      }
      linearCount++;
      previousLog = logValue;
    }

    // `stepAt` clamps to the visible domain's decade range — one rule
    // for out-of-domain values of either sign, instead of a special case
    // per sign. `decadeOf` can underflow to 0 on a denormal bound; the
    // floor stays a formattable positive number (the failure mode isn't
    // an exception but a silent collapse to base digits downstream).
    const stepFloor = decadeOf(min) || Number.MIN_VALUE;
    const stepCeiling = decadeOf(max) || Number.MIN_VALUE;

    return {
      domainMin: min,
      domainMax: max,
      pxPerDecade,
      linearStep: linearCount > ladderCount ? linearStep : null,
      linearFirst,
      linearCount,
      mantissas,
      skip,
      stepFloor,
      stepCeiling,
    };
  }

  /**
   * Pads linearly in log space.
   *
   * On screen it looks the same as a linear axis — "ratio's worth of room
   * above and below" — but in values it becomes a multiplication:
   * `[min / f, max × f]`, `f = (max/min)^ratio`.
   *
   * The result can't cross 0 — as long as the input is already positive.
   * But `expand` receives the raw data, so if a non-positive value like
   * `close: 0` is mixed in, `Math.pow(max/0, ratio) = Infinity`, and a
   * negative value produces `NaN`. If that value reached `setDomain`
   * unchanged, the message would look like a finiteness problem and hide
   * the real cause (a non-positive value mixed in).
   *
   * So only the positive part of the interval is kept — mixing in a value
   * at or below 0 doesn't throw here. Those values have no place on a log
   * axis, so they simply fall off below the axis (the same treatment an
   * off-screen value gets on a linear axis). Only when there's no
   * positive value at all is it truly undrawable, and `setDomain` below
   * states that under its own name, with "LogScale domain must be
   * positive".
   *
   * Unfilled orders and halted candles' `close: 0`, and negative
   * settlement prices, are where these values come from.
   */
  expand(
    range: readonly [number, number],
    ratio: number,
    hints?: ExpandHints,
  ): [number, number] {
    const [min, max] = range;

    // Leave it untouched if there's no positive value — setDomain rejects
    // it under its own name.
    if (max <= 0) return [min, max];

    /**
     * The lower bound is non-positive — a value with no place on this
     * axis got mixed in. Ask for the real floor first — falling straight
     * to `max / LOG_FLOOR_DECADES` would use a constant that never
     * looked at the data, and a single `close: 0` candle could rewrite
     * the whole domain, cramming the real candles into a sliver of the
     * axis height.
     *
     * Falls back to the old constant when there's no `hints`, or no
     * positive value at all.
     */
    if (min <= 0) {
      const floor = hints?.minPositive() ?? null;
      /**
       * `floor === max` is accepted too — using `< max` would, in an
       * interval where every visible positive value is the same, discard
       * the hint and fall to the constant, pinning the real candles to
       * the top. With `<=`, `bottom === max`, which drops straight into
       * the `min === max` branch below (`[max/2, max*2]`).
       */
      const bottom =
        floor !== null && floor > 0 && floor <= max
          ? floor
          : max / LOG_FLOOR_DECADES;
      /**
       * If the floor sinks to 0, the recursion never ends — for a
       * denormalized `max`, `max / 1000` underflows to 0 and the same
       * argument recurses forever, overflowing the stack. If no floor can
       * be established, `max` is passed through unchanged, into the
       * `min === max` branch.
       */
      return this.expand([bottom > 0 ? bottom : max, max], ratio);
    }

    // An interval collapsed to a single point. Where a linear axis pads
    // by ±1, log pads by ×÷2 — the unit of distance on this axis is a
    // multiple, not a value.
    //
    // For a denormalized number (`5e-324`), even `min / 2` underflows to
    // 0. That branch would then **restore exactly the condition the
    // `min <= 0` branch above tried to eliminate** — 0 re-enters the log
    // axis and `toPixel` returns `-Infinity`. If there's nowhere to go
    // down, only open upward.
    if (min === max) return min / 2 > 0 ? [min / 2, max * 2] : [min, max * 2];

    const factor = Math.pow(max / min, ratio);
    // For a denormalized number, `min / factor` can underflow to 0 too —
    // the same hole the two branches above (`min <= 0`'s floor, and
    // `min === max`) already close. If it becomes 0, `setDomain` below
    // rejects it on the render path, throwing every frame. If there's
    // nowhere to go down, the lower bound is left unchanged.
    const lower = min / factor;
    return [lower > 0 ? lower : min, max * factor];
  }
}

/** Materializes the winning candidate — only the frame pass pays this. */
function collectTicks(plan: TickPlan): number[] {
  const values: number[] = [];

  if (plan.linearStep !== null) {
    for (let index = 0; index < plan.linearCount; index++) {
      // Multiplication instead of accumulating addition — error doesn't
      // build up. `withoutFloatNoise` keeps 2 × 10⁻⁷ from reaching a
      // toString label as 2.0000000000000002e-7.
      values.push(
        withoutFloatNoise(plan.linearFirst + index * plan.linearStep),
      );
    }
    return values;
  }

  const kFirst = alignDecade(Math.floor(Math.log10(plan.domainMin)), plan.skip);
  const kLast = Math.floor(Math.log10(plan.domainMax));
  for (let k = kFirst; k <= kLast && values.length < MAX_GEOMETRY_TICKS; k += plan.skip) {
    for (const mantissa of plan.mantissas) {
      const value = mantissa * 10 ** k;
      if (value >= plan.domainMin && value <= plan.domainMax) {
        values.push(withoutFloatNoise(value));
        // The outer check alone lets a decade's worth of mantissas
        // overshoot the cap (measured: 1,002).
        if (values.length >= MAX_GEOMETRY_TICKS) return values;
      }
    }
  }
  return values;
}

/**
 * The local ruler: the linear run's own step, or the value's decade
 * clamped into the visible domain's decade range. The clamp is what
 * keeps a legend row far outside the window (an oscillator's 1e-8 next
 * to prices in the thousands) from blowing the digit count — and it
 * answers for zero and negative values too, which have no decade of
 * their own, without a sign special-case.
 */
function stepFromPlan(plan: TickPlan, value: number): number {
  if (plan.linearStep !== null) return plan.linearStep;

  let decade =
    Number.isFinite(value) && value > 0 ? decadeOf(value) : plan.stepFloor;
  if (!(decade > 0)) decade = plan.stepFloor;

  return Math.min(Math.max(decade, plan.stepFloor), plan.stepCeiling);
}
