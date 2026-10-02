import { requireFinite, requirePositive } from "../primitives";
import type { Range } from "../data";
import type { Scale, XMapping } from "../scale";
import { FALLBACK_SLOT } from "../series/slot";

/**
 * The bars' worth of window a lone x gets — one bar alone would fill the
 * screen — and how many bars a first history needs before the first layout
 * to count as filling it.
 */
const FEW_BARS = 10;

/**
 * The **fields of `PlotConfig` the x window reads**. Taken as a function to
 * read rather than a value — `applyOptions` can change them, so holding
 * onto a captured value would go stale.
 */
export interface XViewportOptions {
  rightOffset: number;
  /**
   * These two stay optional — a computed default: the coordinate system's
   * `barSpacingDefaults` fills them at the single read site (`clampSpan`),
   * and `0` carries the meaning "no limit in that direction".
   */
  minBarSpacing?: number;
  maxBarSpacing?: number;
  shiftVisibleRangeOnNewBar: boolean;
}

export interface XViewportDeps {
  /** Domain ↔ pixels. The domain is the mapping's own space. */
  scale: Scale;
  /** Data's x ↔ domain. In a bar-index coordinate system, the domain is the index. */
  x: XMapping;
  /** The x range of data the chart has. The result of asking every series. */
  dataRange: () => Range | null;
  /**
   * Every series' x, each ascending — where the bar spacing at each end is
   * measured. `barBodied` asks for only the series that draw bar bodies —
   * the ones the fit margin is for.
   */
  xValues: (barBodied?: boolean) => readonly (readonly number[])[];
  options: () => XViewportOptions;
  /**
   * The domain **actually** changed. Not called when set to the same
   * value. The range is given **in data x** — subscribers get x even in a
   * bar-index coordinate system.
   */
  onChange: (visible: { startX: number; endX: number }) => void;
}

/**
 * The x range in view. **A single-window state machine, split out of `Plot`.**
 *
 * The three pieces of state (`fitted`, `pending`, `lastMax`) only reference
 * each other, and touch the outside world through exactly one `Scale`.
 * **The only thing decided here is x** — the value axis belongs to the
 * pane, so whoever calls a refit loops over panes separately.
 */
export class XViewport {
  constructor(private readonly deps: XViewportDeps) {}

  /** Whether x has ever been fit to data. */
  private fittedOnce = false;

  /**
   * A window chosen before the data (in data x). **The window arrived
   * before the data did** — a `setVisibleRange` at mount, with data after
   * — so setting the domain right away would grab a wrong value, since
   * `toDomain` is still the identity in a bar-index coordinate system at
   * that point. This holds it as x and applies it **in place of `fit`,
   * at the moment the first `fit` would run.**
   */
  private pending: Range | null = null;

  /** The right edge of data as last known (in data x). The basis for detecting a new bar. */
  private lastMax: number | null = null;

  /**
   * Whether the window is still the fit of a chart that started from a
   * single x (mounted empty, fed from a socket). A fit to one bar says
   * nothing about the window the data wants, so until something else
   * sets the window, each data change fits again — filling the screen,
   * then following the newest bar at the default spacing — otherwise the
   * chart stays zoomed onto its first bar for good.
   */
  private following = false;

  /**
   * The last bar spacing measured (domain units). A lone bar has no
   * neighbour to measure against, so it borrows the spacing the chart last
   * knew — one unit per bar until data has said otherwise, the same
   * reading the bar-index mapping gives a single bar.
   */
  private gap = 1;

  get fitted(): boolean {
    return this.fittedOnce;
  }

  /** Whether a data change should fit x again → `following`. */
  get followsData(): boolean {
    return this.following;
  }

  /**
   * The range currently in view, **in data x**. `null` if it's never been
   * fit — the scale's default `[0,1]` isn't a window anyone chose.
   */
  visibleRange(): Range | null {
    if (!this.fittedOnce) return null;

    const [min, max] = this.deps.scale.getDomain();
    return { min: this.deps.x.fromDomain(min), max: this.deps.x.fromDomain(max) };
  }

  /**
   * Sets the visible range in data x (this is `setVisibleRange`, as in
   * lightweight-charts). Reconciled via `pending` if there's no data yet.
   */
  setVisibleRange(fromX: number, toX: number): void {
    if (!this.deps.dataRange()) {
      this.pending = { min: fromX, max: toX };
      return;
    }

    this.fittedOnce = true;
    this.pending = null;
    this.setDomain(this.deps.x.toDomain(fromX), this.deps.x.toDomain(toX));
  }

  /**
   * Fits so that all of the data in hand is visible. Does nothing if
   * there's no range to fit to.
   *
   * Asks "is there a range to fit to", not "is data empty" — the chart has
   * no way to answer the latter once data has been handed off to a
   * registration.
   *
   * A window set before the data (`setVisibleRange`) is
   * applied in place of the fit — if it touches the data's x range at all
   * (an endpoint in common counts). One that misses the data entirely is
   * dropped and the ordinary fit runs.
   *
   * `follow` keeps a window that is following the data (`followsData`)
   * following; any other fit follows only when it fits a single x, or when
   * it is the first fit and the data is too short to fill the screen at
   * the default bar spacing.
   */
  fit(follow = false): void {
    const range = this.deps.dataRange();
    if (!range) return;

    // Once fit has run at least once, the window belongs to the user from then on.
    // The first window is announced even if it happens to equal the scale's
    // starting domain — it is the first one fitted to data.
    const first = !this.fittedOnce;
    this.fittedOnce = true;

    // If a window was chosen before data did, apply it instead of
    // fitting — the mapping has the index set up by now, so `toDomain`
    // gives the correct value → pending
    if (this.pending) {
      const { min, max } = this.pending;
      this.pending = null;
      // A window that does not touch the data at all — one set for another
      // symbol's history — would show an empty screen. Touching at
      // an endpoint counts; a window with no point inside it (sparse data)
      // is still the caller's window. Otherwise the ordinary fit below.
      if (max >= range.min && min <= range.max) {
        this.setDomain(this.deps.x.toDomain(min), this.deps.x.toDomain(max), first);
        return;
      }
    }

    /**
     * **Half a bar at each end**, so the first and last candles are drawn
     * whole instead of cut down the middle by the plot edge. Worked in the
     * domain — for bar index, x becomes the index here and half a bar is
     * half an index.
     */
    const [left, right] = this.halfBars();
    let domainMin = this.deps.x.toDomain(range.min) - left;
    const end = this.deps.x.toDomain(range.max) + right;
    // A bar's width in the domain — measured over every series, margin or not.
    const bar = this.spacing(this.deps.xValues())[1];
    const [rangeLeft, rangeRight] = this.deps.scale.getRange();
    const width = Math.abs(rangeRight - rangeLeft);
    // How many bars the screen holds at the default spacing; before the first
    // layout the pixel width is meaningless, so a few bars.
    const fits = Math.max(width / FALLBACK_SLOT, FEW_BARS);
    const lone = range.min === range.max;
    // A first history too short to fill the screen at the default spacing is
    // the head of a feed: it fills now and keeps fitting as bars arrive.
    const following = follow || lone || (first && end - domainMin < fits * bar);

    /**
     * A window following streamed data fills the screen only until its bars
     * would be squeezed below the default bar spacing; from there it keeps
     * that width and follows the newest bar. Until then it is the same window
     * a fit of that data gives. Before the first layout the pixel width is
     * meaningless, so there is no limit yet.
     */
    // Never narrower than the default bar spacing — the width a lone bar is drawn at.
    if (following && width >= FALLBACK_SLOT) domainMin = Math.max(domainMin, end - (width / FALLBACK_SLOT) * bar);
    // A lone x would fill the screen: it gets a few bars' width, anchored at the live end.
    if (lone) domainMin = Math.min(domainMin, end - FEW_BARS * bar);

    /**
     * Empty space after the last bar, so an in-progress bar doesn't sit
     * flush against the right edge.
     *
     * **A negative offset that would flip the window is dropped.**
     * `rightOffset` can legitimately be negative, and this is the only
     * place that sets each end separately, so only the right edge could
     * get pushed left far enough to flip the domain. Fitting to the whole
     * range is a programmatic call and must not fail — if padding can't be
     * given, it shows the whole range without padding instead.
     */
    const domainMax = end + this.deps.options().rightOffset;

    // Set even when announcing the window throws — the window has moved.
    try {
      this.setDomain(domainMin, domainMax > domainMin ? domainMax : end, first);
    } finally {
      this.following = following;
    }
  }

  /**
   * The fit margin at each end, in domain units: half the bar spacing of the
   * series that draw bar bodies, so the end bodies are drawn whole. `0`
   * with none — a line's end point sits on the plot edge.
   */
  halfBars(): [number, number] {
    const bodied = this.deps.xValues(true);
    if (bodied.length === 0) return [0, 0];
    const [left, right] = this.spacing(bodied);
    return [left / 2, right / 2];
  }

  /**
   * The bar spacing at each end of `lists`, in domain units — the gap
   * between the two outermost x of each series, the narrowest across
   * series. With no end measurable (a single x), the last known spacing.
   * O(series) reads of cached arrays, plus the mapping's `toDomain`.
   */
  private spacing(lists: readonly (readonly number[])[]): [number, number] {
    const { x } = this.deps;
    let left = Infinity;
    let right = Infinity;
    for (const xs of lists) {
      const n = xs.length;
      if (n < 2) continue;
      // A repeated x (legal for lines) is no spacing — it would collapse the window.
      const first = x.toDomain(xs[1]) - x.toDomain(xs[0]);
      const last = x.toDomain(xs[n - 1]) - x.toDomain(xs[n - 2]);
      if (first > 0 && first < left) left = first;
      if (last > 0 && last < right) right = last;
    }
    if (right < Infinity) this.gap = right;
    else right = this.gap;
    if (left === Infinity) left = right;
    return [left, right];
  }

  /**
   * Updates where the data's end was, and **returns the old value.**
   *
   * The basis for detecting a new bar is "the end as last known", which
   * means updating it and checking against it have to be separate steps —
   * even a path that falls through to a refit still has to update this
   * baseline, or the next bar won't be recognized.
   */
  noteData(range: Range | null): number | null {
    const previous = this.lastMax;
    this.lastMax = range?.max ?? null;
    // With no data left, nothing is in its place again — the next data is a first arrival and gets fitted.
    if (!range) this.fittedOnce = this.following = false;
    return previous;
  }

  /**
   * A new bar arrived, and **if the last bar was in view**, shifts the
   * window by that much. "Was in view" means the previous end sat inside
   * the screen's right edge — while scrolling through history, the window
   * must not get dragged along.
   */
  followNewBar(previousMax: number | null, range: Range | null): void {
    if (!this.deps.options().shiftVisibleRangeOnNewBar) return;
    if (previousMax === null || !range || range.max <= previousMax) return;

    const [min, max] = this.deps.scale.getDomain();
    const previousDomainMax = this.deps.x.toDomain(previousMax);
    if (max < previousDomainMax) return;

    /**
     * Never overshoots the live target (`scrollToRealTime`'s
     * destination). In a `syncX` group, someone else's shift via sync may
     * have already moved this window — adding this delta on top of that
     * would let the window run ahead of live, so only the remaining
     * distance is shifted. Doesn't shift at all if we're already looking
     * deep into the future (`max ≥ target`).
     */
    const offset = this.deps.options().rightOffset;
    const target = this.deps.x.toDomain(range.max) + this.halfBars()[1] + offset;
    if (max >= target) return;

    const delta = Math.min(
      this.deps.x.toDomain(range.max) - previousDomainMax,
      target - max,
    );
    this.setDomain(min + delta, max + delta);
  }

  /**
   * Keeps the window's width and snaps the right edge to live (last bar +
   * half a bar + `rightOffset` — where a fit puts it). This is the manual
   * return path from browsing history — the automatic half is
   * `followNewBar` (`shiftVisibleRangeOnNewBar`).
   * Unlike `fitDomains`, the zoom level survives. If there's no window yet
   * (before the first fit), fitting is itself the live position.
   */
  scrollToRealTime(): void {
    const range = this.deps.dataRange();
    if (!range) return;

    if (!this.fittedOnce) {
      this.fit();
      return;
    }

    const [min, max] = this.deps.scale.getDomain();
    const offset = this.deps.options().rightOffset;
    const newMax = this.deps.x.toDomain(range.max) + this.halfBars()[1] + offset;
    this.setDomain(newMax - (max - min), newMax);
  }

  /**
   * Shifts the domain by `offset`. `offset` is in **domain units** — data
   * x if continuous, bar count if bar-index.
   *
   * **There's a boundary — data never fully disappears from the screen.**
   * It shifts only up to `domain.min ≤ last bar`, `domain.max ≥ first bar`.
   * Every gesture-driven pan (drag, kinetic, keyboard) funnels through
   * here; programmatic paths (`fit`, `setVisibleRange`,
   * `followNewBar`) don't.
   *
   * A window already outside the boundary (e.g. one chosen pointing
   * into empty space) only gets blocked from **getting worse** — a pan
   * that moves it back through passes freely, and it's never pulled back
   * in on its own.
   */
  pan(offset: number): void {
    const [min, max] = this.deps.scale.getDomain();
    const bounded = this.clampPan(offset, min, max);
    this.setDomain(min + bounded, max + bounded);
  }

  /** Zooms by `factor` with `center` held fixed (`factor` > 1 zooms in). */
  zoom(factor: number, center: number): void {
    // **Don't invent a check here** — use the shared guards
    // (`requirePositive`, `requireFinite`). A hand-written guard tends to
    // get the error message wrong.
    requirePositive(factor, "zoom factor");
    requireFinite(center, "zoom center");

    /**
     * The limit is applied **only to the width**; position is decided by
     * the cursor's relative offset (`t`) — because zoom's invariant is
     * that the point under the cursor doesn't move. Re-centering a clamped
     * window on the target center instead would let a zoom-out that's hit
     * the limit push the window toward the cursor, and a large `factor`
     * would teleport the window past the limit.
     *
     * **The center is clamped to the data range.** If zoom-in's point of
     * convergence is inside the data, data can never be lost — this stops
     * a run of zoom-ins anchored on empty space from landing on a screen
     * with zero candles. With no data, there's no basis to clamp against,
     * so it's unconstrained.
     */
    const [min, max] = this.deps.scale.getDomain();
    const span = this.clampSpan((max - min) / factor);
    const range = this.deps.dataRange();
    if (range) {
      const dataMin = this.deps.x.toDomain(range.min);
      const dataMax = this.deps.x.toDomain(range.max);
      center = Math.min(Math.max(center, dataMin), dataMax);
    }

    /**
     * **An anchor that fell outside the window is pulled back inside it.**
     * The clamp above puts the center inside the *data*, not inside the
     * *window*. If the window has moved entirely past the data (a state
     * the pan boundary permits), the clamped center can land outside the
     * window, pushing `t` outside `[0,1]` — and the arithmetic below stops
     * being a zoom and becomes a pan instead. Pulling it back inside the
     * window keeps `t` in `[0,1]`, so even in the worst case this is a
     * zoom anchored at an edge.
     */
    center = Math.min(Math.max(center, min), max);
    const t = (center - min) / (max - min);

    // The floating-point floor — if the width drops below the domain
    // value's ulp, `min` and `max` collapse to the same number. When it
    // can't go further, it just quietly stops.
    const next: [number, number] = [center - t * span, center + (1 - t) * span];
    if (!(next[0] < next[1])) return;

    this.setDomain(next[0], next[1]);
  }

  /**
   * Converts a drag distance to a domain shift. Dragging right should
   * reveal the previous range, so the sign is flipped.
   */
  panByPixels(dx: number): void {
    if (dx === 0) return;

    const [min, max] = this.deps.scale.getDomain();
    const [left, right] = this.deps.scale.getRange();
    const span = right - left;
    if (span === 0) return;

    this.pan((-dx * (max - min)) / span);
  }

  /** Zooms with the point under the wheel cursor held fixed. */
  zoomAtPixel(factor: number, screenX: number): void {
    this.zoom(factor, this.deps.scale.invert(screenX));
  }

  /**
   * Moves the domain and notifies **only if it actually changed.** The
   * domain has several callers (pan, zoom, refit, shift, setVisibleRange), so this
   * gathers them into one place. **Notifies now, without waiting for a
   * render** — the visible range changes synchronously, so its
   * announcement does too.
   */
  private setDomain(min: number, max: number, announce = false): void {
    const [previousMin, previousMax] = this.deps.scale.getDomain();
    if (!announce && min === previousMin && max === previousMax) return;
    // Any window set other than by a fit is the window from now on — but
    // only one that moves: a syncX peer echoing this very window must not
    // end following.
    this.following = false;

    this.deps.scale.setDomain(min, max);
    this.deps.onChange({
      startX: this.deps.x.fromDomain(min),
      endX: this.deps.x.fromDomain(max),
    });
  }

  /**
   * The pan boundary — clamps `offset` to "one end of the data stays on
   * screen". Unconstrained if there's no data. Wrapping both limits around
   * `0` is what "never gets worse" means: if the window has already moved
   * past the last bar, the future-direction limit comes out negative, and
   * using it as-is would make pan move backward.
   */
  private clampPan(offset: number, min: number, max: number): number {
    const range = this.deps.dataRange();
    if (!range) return offset;

    const dataMin = this.deps.x.toDomain(range.min);
    const dataMax = this.deps.x.toDomain(range.max);
    const most = Math.max(0, dataMax - min); // room toward the future (positive offset)
    const least = Math.min(0, dataMin - max); // room toward the past

    return Math.min(Math.max(offset, least), most);
  }

  /**
   * The bar-spacing limit — clamps the domain width against a pixel
   * budget to stop zoom. Decides only the width — position is decided by
   * the caller (`zoom`) via the cursor's fixed point.
   *
   * **Applied only in `zoom`, never in `setDomain`.** A refit or a
   * window chosen before data lands before the first render, when the scale's pixel
   * range is still its default, so clamping against a pixel budget there
   * would produce garbage.
   */
  private clampSpan(span: number): number {
    const defaults = this.deps.x.barSpacingDefaults;
    const options = this.deps.options();
    const minBarSpacing = options.minBarSpacing ?? defaults?.min;
    const maxBarSpacing = options.maxBarSpacing ?? defaults?.max;
    if (minBarSpacing === undefined && maxBarSpacing === undefined) {
      return span;
    }

    const [left, right] = this.deps.scale.getRange();
    const width = Math.abs(right - left);
    if (width === 0) return span;

    let most = minBarSpacing ? width / minBarSpacing : Infinity;
    let least = maxBarSpacing ? width / maxBarSpacing : 0;

    /**
     * A window already outside the limit (a fit wider than the limit, or
     * a chosen window narrower than it) only gets blocked from getting
     * worse — the first zoom mustn't make the screen jump straight to the
     * limit.
     */
    const [currentMin, currentMax] = this.deps.scale.getDomain();
    const current = currentMax - currentMin;
    if (current > most) most = current;
    if (current < least) least = current;

    return Math.min(Math.max(span, least), most);
  }
}
