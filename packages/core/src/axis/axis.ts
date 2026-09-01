import { niceInterval, withoutFloatNoise, type Scale } from "../scale";
import type { AxisConfig, AxisOrientation, Tick } from "./types";

/**
 * Minimum pixels a single label needs. Horizontal-axis labels lie flat and
 * vertical-axis labels sit on one line, so the vertical axis stays readable
 * even when packed tighter.
 */
export const MIN_TICK_SPACING: Record<AxisOrientation, number> = {
  horizontal: 80,
  vertical: 40,
};

/**
 * The tick interval the axis would choose for this domain and pixel width.
 *
 * This shares the arithmetic, not a value — a badge or tooltip must call
 * the same function too, so it always uses the current interval instead of
 * a stale value from the last frame. `Pane.formatValue` is this gate's
 * second consumer.
 */
export function autoTickStep(options: {
  min: number;
  max: number;
  pixels: number;
  minTickSpacing?: number;
  minInterval?: number;
  orientation: AxisOrientation;
}): number {
  const range = options.max - options.min;
  if (!(range > 0)) return 1;

  const spacing =
    options.minTickSpacing ?? MIN_TICK_SPACING[options.orientation];
  const fits = Math.max(1, Math.floor(Math.abs(options.pixels) / spacing));

  return Math.max(niceInterval(range / fits), options.minInterval ?? 0);
}

export class Axis {
  private ticks: Tick[] = [];
  private readonly tickInterval: number;
  private readonly formatLabel: (value: number, step?: number) => string;
  private readonly min: number;
  private readonly max: number;

  constructor(
    private scale: Scale,
    private orientation: AxisOrientation,
    private config: AxisConfig,
  ) {
    const [domainMin, domainMax] = scale.getDomain();
    this.min = config.min ?? domainMin;
    this.max = config.max ?? domainMax;
    this.formatLabel = config.format ?? ((v) => v.toString());
    this.tickInterval = config.tickInterval ?? this.calculateAutoTickInterval();

    this.generateTicks();
  }

  /**
   * The tick count is decided by the available pixels, not the domain
   * width — going by width alone, a small domain change can jump the
   * interval a whole order of magnitude, snapping the tick count from 6 to
   * 50. This bites hardest on a narrow pane.
   */
  private calculateAutoTickInterval(): number {
    const [from, to] = this.scale.getRange();

    // One set of arithmetic in autoTickStep — a badge or tooltip calls the same gate.
    return autoTickStep({
      min: this.min,
      max: this.max,
      pixels: to - from,
      minTickSpacing: this.config.minTickSpacing,
      minInterval: this.config.minInterval,
      orientation: this.orientation,
    });
  }

  /**
   * Ticks land on multiples of the interval, not at the domain's edge —
   * counting from the edge would produce labels like 97.3 / 107.3 / 117.3,
   * because of the slack the value domain carries.
   */
  private generateTicks(): void {
    this.ticks = [];

    const step = this.tickInterval;
    if (!(step > 0) || !Number.isFinite(step)) return;

    const first = Math.ceil(this.min / step) * step;

    /**
     * Defense in depth. `Scale.setDomain` already blocks a degenerate
     * domain, so `count` is already finite — but `config.min`/`config.max`
     * can bypass the scale, and the tab needs to survive even if a new path
     * shows up later. `count = Infinity` used to spin this loop forever and
     * kill the tab with an OOM — 1000 ticks on one axis is already more
     * than anyone can read, so more than that means the math is wrong.
     */
    const MAX_TICKS = 1000;
    const count = Math.min(
      Math.floor((this.max - first) / step) + 1,
      MAX_TICKS,
    );

    for (let index = 0; index < count; index++) {
      // Multiplication instead of accumulating addition — error doesn't build up.
      const value = withoutFloatNoise(first + index * step);

      this.ticks.push({
        value,
        // The scale's range already carries the direction flip. If the
        // axis flipped it again, it would drift out of sync with what the
        // chart draws.
        position: this.scale.scale(value),
        // Pass the interval along — the formatter uses it to choose how
        // many digits distinguish neighboring ticks.
        label: this.formatLabel(value, step),
      });
    }
  }

  getTicks(): Tick[] {
    return this.ticks;
  }

}
