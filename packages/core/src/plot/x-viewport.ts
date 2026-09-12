import { requireFinite, requirePositive } from "../primitives";
import type { Range } from "../data";
import type { Scale, XMapping } from "../scale";
import { expandFor } from "./range";

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
   * A range awaiting restoration (in data x). **State arrived before data
   * did.** URL restoration applies state at mount, and data arrives after
   * — so setting the domain right away would grab a wrong value, since
   * `toDomain` is still the identity in a bar-index coordinate system at
   * that point. This holds it as x and applies it **in place of `fit`,
   * at the moment the first `fit` would run.**
   */
  private pending: Range | null = null;

  /** The right edge of data as last known (in data x). The basis for detecting a new bar. */
  private lastMax: number | null = null;

  get fitted(): boolean {
    return this.fittedOnce;
  }

  /**
   * The range currently in view, **in data x**. `null` if it's never been
   * fit — the scale's default `[0,1]` isn't state the user made, so
   * there's nothing to save either.
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

  /** A state slice from outside. Same arithmetic as `setVisibleRange`. */
  restore(xDomain: Range): void {
    this.setVisibleRange(xDomain.min, xDomain.max);
  }

  /**
   * Fits so that all of the data in hand is visible. Does nothing if
   * there's no range to fit to.
   *
   * Asks "is there a range to fit to", not "is data empty" — the chart has
   * no way to answer the latter once data has been handed off to a
   * registration.
   *
   * A window restored before the data (`restore`, `setVisibleRange`) is
   * applied in place of the fit — if it touches the data's x range at all
   * (an endpoint in common counts). One that misses the data entirely is
   * dropped and the ordinary fit runs.
   */
  fit(): void {
    const range = this.deps.dataRange();
    if (!range) return;

    // Once fit has run at least once, the window belongs to the user from then on.
    this.fittedOnce = true;

    // If a restoration arrived before data did, apply it instead of
    // fitting — the mapping has the index set up by now, so `toDomain`
    // gives the correct value → pending
    if (this.pending) {
      const { min, max } = this.pending;
      this.pending = null;
      // A window that does not touch the data at all — a state saved on
      // another symbol's history — would show an empty screen. Touching at
      // an endpoint counts; a window with no point inside it (sparse data)
      // is still the caller's window. Otherwise the ordinary fit below.
      if (max >= range.min && min <= range.max) {
        this.setDomain(this.deps.x.toDomain(min), this.deps.x.toDomain(max));
        return;
      }
    }

    // The domain is the mapping's own space — for bar index, x becomes the
    // index here. **Padding is asked of the scale** — using linear
    // addition directly could push a log axis's lower bound past zero.
    const [min, max] = expandFor(this.deps.scale, range, 0);

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
    const offset = this.deps.options().rightOffset;
    const domainMin = this.deps.x.toDomain(min);
    const domainMax = this.deps.x.toDomain(max) + offset;

    this.setDomain(
      domainMin,
      domainMax > domainMin ? domainMax : this.deps.x.toDomain(max),
    );
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
    const target = this.deps.x.toDomain(range.max) + offset;
    if (max >= target) return;

    const delta = Math.min(
      this.deps.x.toDomain(range.max) - previousDomainMax,
      target - max,
    );
    this.setDomain(min + delta, max + delta);
  }

  /**
   * Keeps the window's width and snaps the right edge to live (last bar +
   * `rightOffset`). This is the manual return path from browsing history —
   * the automatic half is `followNewBar` (`shiftVisibleRangeOnNewBar`).
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
    const newMax = this.deps.x.toDomain(range.max) + offset;
    this.setDomain(newMax - (max - min), newMax);
  }

  /**
   * Shifts the domain by `offset`. `offset` is in **domain units** — data
   * x if continuous, bar count if bar-index.
   *
   * **There's a boundary — data never fully disappears from the screen.**
   * It shifts only up to `domain.min ≤ last bar`, `domain.max ≥ first bar`.
   * Every gesture-driven pan (drag, kinetic, keyboard) funnels through
   * here; programmatic paths (`fit`, `restore`, `setVisibleRange`,
   * `followNewBar`) don't.
   *
   * A window already outside the boundary (e.g. a restoration pointing
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
   * domain has several callers (pan, zoom, refit, shift, restore), so this
   * gathers them into one place. **Notifies now, without waiting for a
   * render** — the visible range is state, and state changes
   * synchronously.
   */
  private setDomain(min: number, max: number): void {
    const [previousMin, previousMax] = this.deps.scale.getDomain();
    if (min === previousMin && max === previousMax) return;

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
   * restoration happens before the first render, when the scale's pixel
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
     * a restoration narrower than it) only gets blocked from getting
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
