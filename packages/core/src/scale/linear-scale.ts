import { requireInterval, requireRange } from "../primitives";
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

  scale(value: number): number {
    const [domainMin, domainMax] = this.domain;
    const [rangeMin, rangeMax] = this.range;

    const ratio = (value - domainMin) / (domainMax - domainMin);
    return rangeMin + ratio * (rangeMax - rangeMin);
  }

  invert(screenValue: number): number {
    const [domainMin, domainMax] = this.domain;
    const [rangeMin, rangeMax] = this.range;

    const ratio = (screenValue - rangeMin) / (rangeMax - rangeMin);
    return domainMin + ratio * (domainMax - domainMin);
  }
}
