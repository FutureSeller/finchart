/**
 * The one-way mapping from data domain to screen coordinates. It's mutable
 * because the domain keeps changing during pan/zoom. Bad input is signaled
 * by throwing, not by returning a Result.
 */
export interface Scale {
  /** Stable scale kind. Custom scales declare their own kind for declarative pane updates. */
  readonly kind: string;
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

  /**
   * Tick geometry in this scale's own arithmetic — where the log axis's
   * decade ladder goes. Omit it and the linear default arithmetic is
   * used; same shape as `expand`: only a scale with different geometry
   * supplies its own.
   *
   * Placement only, never labels — the axis combines these values with
   * whatever `format` is in force, so a user's formatter keeps working
   * when the scale changes. `minTickSpacing` arrives already resolved by
   * the caller; the pixel span comes from this scale's own `getRange()`,
   * so there is no second source for either number.
   */
  tickGeometry?(minTickSpacing: number): TickGeometry;
}

/**
 * What `Scale.tickGeometry` answers with. A geometry answers for the
 * domain and range it was asked under — after the window moves, ask
 * again; holding one across frames would hand out stale placement, the
 * same staleness `formatOnAxis` refuses to cache.
 */
export interface TickGeometry {
  /**
   * Tick values in domain space: ascending, all finite, and already
   * density-filtered — every adjacent pair sits at least the requested
   * pixel spacing apart. Capped at 1,000 values; the linear axis earned
   * that cap from a real OOM (a degenerate domain once spun tick
   * generation forever), and this path leaves that door, so it carries
   * its own copy of the lock.
   *
   * A method, not a field: badges ask this geometry for `stepAt` on
   * every frame and never need placement — a field would rebuild and
   * allocate the whole ladder on each of those calls. Only the frame
   * pass calls `values()`.
   */
  values(): number[];

  /**
   * The value-space distance separating `value` from its would-be
   * neighbor ticks — the ruler a formatter uses to choose how many
   * digits distinguish neighbors. O(1) and allocation-free: the paint
   * pass calls this once per axis badge, every frame.
   */
  stepAt(value: number): number;
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
 * things in quiet ways — `unionRange` drops fields when there are two
 * series. An unfilled field failed silently instead of throwing.
 */
export interface ExpandHints {
  /**
   * The smallest value greater than 0 in this interval, or `null` if there
   * is none. The caller is lazy about it — it's only invoked when the log
   * axis hits a non-positive lower bound.
   */
  minPositive(): number | null;
}
