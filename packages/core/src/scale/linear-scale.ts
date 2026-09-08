import { requireInterval, requireRange } from "../primitives";
import { lerp, unlerp } from "./finite-lerp";
import type { Scale } from "./types";

export class LinearScale implements Scale {
  private domain: [number, number] = [0, 1];
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
   * **This is a chokepoint.** Both the y domain and the x domain pass
   * through here without exception (`pane.ts:589·1006·1021` ·
   * `x-viewport.ts`, 9 places), and axes only read via `getDomain()`
   * (`axis.ts:52`). So unless the scale refuses a non-finite domain,
   * the tick loop in `axis.ts` can end up infinite.
   *
   * An earlier version only checked `min >= max`. **`-Infinity < Infinity`
   * passed that check**, and once that domain reached the axis, `count`
   * became `Infinity` and the tab died of OOM.
   */
  setDomain(min: number, max: number): void {
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
   * A domain — or a range — is two finite numbers, but their difference
   * need not be one: `[-MAX_VALUE, MAX_VALUE]` is legal for either, its span
   * overflows, and `∞ / ∞` is `NaN`, a pixel the canvas silently drops.
   * `lerp`/`unlerp` take the plain arithmetic wherever it is finite (an
   * ordinary axis's pixels are the same bits as before) and the same
   * interpolation at half scale where it is not.
   */
  scale(value: number): number {
    const [domainMin, domainMax] = this.domain;
    const [rangeMin, rangeMax] = this.range;
    return lerp(rangeMin, rangeMax, unlerp(domainMin, domainMax, value));
  }

  invert(screenValue: number): number {
    const [domainMin, domainMax] = this.domain;
    const [rangeMin, rangeMax] = this.range;
    return lerp(domainMin, domainMax, unlerp(rangeMin, rangeMax, screenValue));
  }
}
