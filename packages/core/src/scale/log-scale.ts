import {
  ContractError,
  requireFinite,
  requireInterval,
  requireRange,
} from "../primitives";
import type { ExpandHints, Scale } from "./types";

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
