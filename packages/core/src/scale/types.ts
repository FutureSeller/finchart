/**
 * The one-way mapping from data domain to screen coordinates. It's mutable
 * because the domain keeps changing during pan/zoom. Bad input is signaled
 * by throwing, not by returning a Result.
 */
export interface Scale {
  /** The data domain [min, max]. */
  getDomain(): [number, number];
  /**
   * The screen range [start, end] (px).
   *
   * A reversed range (start > end) is allowed. Screen y increases
   * downward, so the y axis is set to [bottom, top] to put larger values
   * on top — the scale has to hold this inversion so the chart and the
   * axis agree on the same coordinates.
   */
  getRange(): [number, number];

  setDomain(min: number, max: number): void;
  setRange(min: number, max: number): void;

  /** Data value → screen coordinate. */
  scale(value: number): number;
  /** Screen coordinate → data value. */
  invert(screenValue: number): number;

  /**
   * Pads the data interval with its own arithmetic. Omit it and linear
   * addition is used (`[min - span·ratio, max + span·ratio]`) — a scale
   * whose default arithmetic is good enough needs nothing here, and only a
   * scale with different geometry supplies its own.
   *
   * The log axis is the real consumer that forced this hook to exist —
   * additive padding subtracts more the smaller `min` is, so on data with
   * a wide interval the lower bound crosses 0 and `LogScale.setDomain`
   * rejects it.
   *
   * `ratio` is a fraction of the interval's width — what "width" means is
   * up to the scale (linear: width in value space, log: width in log
   * space).
   */
  expand?(
    range: readonly [number, number],
    ratio: number,
    hints?: ExpandHints,
  ): [number, number];
}

/**
 * Things a scale can ask back for, only when it needs them. There's only
 * one right now — the real floor the log axis uses when it has to invent a
 * lower bound.
 *
 * Why a function and not a value: computing it means scanning every
 * visible point, and that cost shouldn't be paid every frame by axes that
 * aren't logarithmic — as a callback it's only invoked from
 * `LogScale.expand`'s `min <= 0` branch.
 *
 * Why this isn't just a field on `Range`: adding a field there broke
 * things along several paths in quiet ways — `unionRange` drops fields
 * when there are two series, and `asRange` reconstructs the object,
 * losing it on a round trip through a URL. An unfilled field failed
 * silently instead of throwing.
 */
export interface ExpandHints {
  /**
   * The smallest value greater than 0 in this interval, or `null` if there
   * is none. The caller is lazy about it — it's only invoked when the log
   * axis hits a non-positive lower bound.
   */
  minPositive(): number | null;
}
