/**
 * Only what's needed for tick computation. The axis doesn't decide whether
 * to draw anything — a decoration decides the grid, an overlay renderer
 * decides the labels.
 */
export interface AxisConfig {
  min?: number;
  max?: number;
  tickInterval?: number;
  /**
   * Minimum pixels a single tick occupies. Omit for the per-orientation
   * default.
   *
   * It picks the step. For `timeTicks` it is also the floor the drawn
   * ticks are held to (to within a millionth of a pixel): a calendar
   * step's real length varies — the day a clock moves forward is an hour
   * short, February is shorter than the thirty days a ladder has to call a
   * month, and where a clock jumped by hours two neighbouring boundaries
   * can stand a third of a step apart — so among boundaries that would
   * stand closer than this the strategy keeps the one standing for the
   * bigger unit; among equals the earlier, or where several land on one
   * bar the one whose own boundary the bar sits nearest. The axis's own
   * arithmetic uses this to choose an automatic step; it does not enforce a
   * drawn-spacing floor, and an explicit `tickInterval` is drawn as asked.
   */
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
  /**
   * Where a domain value is drawn along the axis, in pixels — the frame's
   * own scale, so a strategy thins what will actually be drawn rather than
   * an estimate of it made from the window's average density.
   */
  positionOf: (value: number) => number;
  /**
   * In a bar-index coordinate system, the bar a boundary is drawn on: its
   * own, or the first after it — "December" lands on December's first
   * trading day even when the 1st is a Sunday. Absent where the domain is
   * continuous and a boundary is drawn where it falls.
   */
  snap?: (value: number) => number;
}

/**
 * The contract that decides tick placement, which ticks survive, and their
 * labels, together. `format` only changes the label, but for a time axis
 * placement itself is the problem — ticks need to land on calendar
 * boundaries, not on multiples of 1·2·5×10ⁿ. When a strategy is present,
 * the axis's default arithmetic and `format` go unused, and the frame
 * draws what the strategy returns without choosing among it.
 *
 * **The choosing is the strategy's because only it knows what a tick is
 * worth.** A frame that snapped ticks onto bars and thinned them by pixel
 * after they were labelled kept whichever was closer or earlier, and
 * dropped "Feb" for the 31st of January in front of it. So the context
 * carries what the frame alone knows — where a value is drawn, and which
 * bar a boundary lands on — and the strategy places, selects, and only
 * then labels, so a boundary that stands for a month outranks one that
 * stands for a day. It doesn't emit `position`; the axis fills that in.
 */
export interface TickStrategy {
  ticks(context: TickStrategyContext): { value: number; label: string }[];
  /**
   * The label a decoration gives a data x — the crosshair badge, the
   * tooltip header — in the same clock and language the ticks use. Takes
   * data x (what the feed holds), not the axis domain. Optional: a strategy
   * that does not offer one leaves the plot's own x notation in place.
   * The plot reads it after the consumer's `axis.x.format` and before its
   * default, so one `timeTicks({ timeZone })` sets the zone for the axis
   * and every decoration at once. The value axis does not consult it — a
   * y strategy's `format` is never read.
   */
  format?: (value: number) => string;
}

export type AxisOrientation = "horizontal" | "vertical";
