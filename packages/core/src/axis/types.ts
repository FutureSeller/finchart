/**
 * Only what's needed for tick computation. The axis doesn't decide whether
 * to draw anything — a decoration decides the grid, an overlay renderer
 * decides the labels.
 */
export interface AxisConfig {
  min?: number;
  max?: number;
  tickInterval?: number;
  /** Minimum pixels a single tick occupies. Omit for the per-orientation default. */
  minTickSpacing?: number;
  /**
   * The automatic interval never gets tighter than this. Ignored if
   * `tickInterval` is given directly.
   *
   * The bar-index axis sets this to 1 — an integer index is a real bar, so
   * a label can recover that bar's x, but a fractional index falls in the
   * empty space between bars, so the label would show an interpolated
   * value (like a weekend timestamp) that has no x in the data.
   */
  minInterval?: number;
  /**
   * The second argument is the tick interval — the formatter can use it to
   * choose the precision that distinguishes neighboring ticks. A
   * single-argument formatter still plugs in fine.
   */
  format?: (value: number, step?: number) => string;
}

export interface Tick {
  value: number;
  position: number;
  label: string;
}

/** The context a `TickStrategy` receives. The domain is in scale space. */
export interface TickStrategyContext {
  min: number;
  max: number;
  /** Available pixels. */
  span: number;
  minTickSpacing: number;
  /** Domain value → the data's x. In bar-index coordinates, recovers that bar's x. */
  xOf: (value: number) => number;
  /** The data's x → domain value. For mapping a boundary back into the domain. */
  domainOf: (x: number) => number;
}

/**
 * The contract that decides both tick placement and labels together.
 * `format` only changes the label, but for a time axis placement itself is
 * the problem — ticks need to land on calendar boundaries, not on
 * multiples of 1·2·5×10ⁿ. When a strategy is present, the axis's default
 * arithmetic and `format` go unused.
 *
 * It doesn't emit `position` — the axis fills that in via the scale, so
 * the strategy stays pure, with no knowledge of pixel space.
 */
export interface TickStrategy {
  ticks(context: TickStrategyContext): { value: number; label: string }[];
}

export type AxisOrientation = "horizontal" | "vertical";
