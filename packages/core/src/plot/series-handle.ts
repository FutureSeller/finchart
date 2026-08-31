/**
 * A handle onto one registration's data — what `addSeries` returns. On a
 * chart with several series, "who gets the new data" can't be answered by
 * `plot.setData`, so each registration gets its own handle.
 *
 * Rule: **a function if all it hands back is disposal, an object if there's
 * more.** That's why `addDecoration` and `plot.on` return a bare function.
 * `dispose` shares a name with `PluginApi` but doesn't inherit from it —
 * inheriting would imply a promise that doesn't exist, that the Plot cleans
 * it up on its own.
 */
import type { BaseDataPoint, DataView, Range, Source } from "../data";
import { ContractError, requireDataArray } from "../primitives";
import type { TypedEntry } from "../registration";
import type { Series } from "../series";
import type { PaneChange } from "./pane";

export interface SeriesHandle<
  T extends BaseDataPoint,
  TPoint extends BaseDataPoint = T,
> extends Source<TPoint> {
  /**
   * The points this registration **draws**. Where an indicator's input lives.
   *
   * ```ts
   * const price = pane.addSeries({ series: candleSeries(), data: candles });
   * computation({ inputs: [price], calc: (candles) => ... });
   * ```
   *
   * If a derivation is attached, this is its result — what's on screen is
   * exactly the next computation's input.
   *
   * **The returned view is live and read-only.** The reason it isn't a
   * copy is that this door is an indicator pipeline's input — copying
   * 100,000 points somewhere that runs on every tick would eat the frame
   * budget on its own. If the receiver needs to sort or filter, it floats
   * one off with `[...handle.read()]`.
   */
  read(): DataView<TPoint>;

  /**
   * Replaces the whole dataset. **Refits both axes.**
   *
   * The array is copied; the points are not. **A point is handed over,
   * not lent** — from here on the chart reads `x` off the object you gave
   * it, so editing that object afterward changes the chart with nothing
   * scheduled and the sort order that slicing relies on possibly gone.
   * To change a point, pass a new one (`updateLast`, or `setData` again).
   * Copying every point on a door that takes 100,000 of them per call
   * would cost the frame budget on its own, so it's a contract instead.
   */
  setData(data: T[]): void;

  /**
   * Splices past data onto the front. Leaves the domain alone — dragging
   * left to load history shouldn't snap the screen back to the full range.
   */
  prepend(points: T[]): void;

  /** Splices the latest onto the back. Leaves the domain alone. */
  append(points: T[]): void;

  /**
   * A tick for the bar in progress. **Same x as the last point means
   * replace, greater means append.** Smaller throws `DataError` — fixing
   * the past is `setData`'s job. Doesn't touch the domain — pan/zoom and a
   * manual value range both stay put.
   */
  updateLast(point: T): void;

  /**
   * Swaps out **only the drawn representation** — the data, the derivation,
   * and whatever holds this handle (an indicator's source, live
   * `updateLast`) all stay put. This is the door for switching chart type,
   * like candle to area: `plot.setSeries` also discards the pane's other
   * series (a moving average, say), so it can't be used there.
   *
   * Refits the value axis — different series occupy different ranges (a
   * candle spans low to high, a close line only close).
   *
   * **A Series must be stateless** (the same rule as `SeriesSpec.series`) —
   * a representation that carries state loses it the moment it's swapped out.
   */
  swapSeries(next: Series<TPoint>): void;

  /**
   * The x range of the points this registration **draws**. `null` if empty.
   *
   * If it's a derivation, this is the derived result's range — a moving
   * average is shorter than the source by its period, since the leading
   * points are missing. What infinite scroll asks — "how far have we come"
   * — should be answered by what's drawn.
   */
  readonly xRange: Range | null;

  /**
   * Whether this handle is **still attached to the pane**. The five write
   * doors throw on a detached handle, so this is where to ask before that.
   *
   * ```ts
   * socket.on("tick", (t) => { if (handle.attached) handle.updateLast(t); });
   * ```
   *
   * Without it, the only option for code holding onto a late-arriving
   * callback is wrapping it in `try/catch` — a throwing contract only holds
   * up if you can ask first.
   *
   * **The line between asking and throwing sits in a different place.**
   * When the whole chart has come down (`Plot.removePane`, `destroy`), this
   * is also false, but the write doors **don't throw** — a late callback
   * firing mid-unmount is the normal path, and by then the pane is already
   * out of both the list and the layout, so whatever it wrote lands
   * nowhere. Read the two cases apart:
   *
   * | `attached` | write door | what happened |
   * |---|---|---|
   * | false | throws | the registration is gone — `dispose()` or a `syncSeries` eviction |
   * | false | silent | the chart came down — `removePane` or `destroy` |
   *
   * `read()`, `xRange`, and `dispose()` are safe even after detaching —
   * reading before asking doesn't blow up.
   */
  readonly attached: boolean;

  /** Detaches the registration. Safe to call twice. */
  dispose(): void;
}

/** What a handle needs from the pane that issued it. */
export interface HandleHost {
  /** Whether the registration is still in the pane's list. */
  registered(): boolean;
  /** Whether the pane itself is still on the chart **and** the registration is in it. */
  attached(): boolean;
  /** Takes the registration out of the list. Called once per handle, by `dispose`. */
  remove(): void;
  /** The pane's change notification. No argument means "the data changed." */
  notify(change?: PaneChange): void;
}

/**
 * A handle pointing at one registration. **The refit verdict is decided
 * here.** Replacing outright means a new dataset, so it refits both axes;
 * extending keeps the current window in place.
 *
 * **A detached handle isn't used.** Without this check, an entry dropped
 * from the list could still be edited, and that's not a quiet no-op — it
 * actually moves the chart: `setData` fires a refit, re-fitting the x
 * window to the remaining series, and the user's held pan position jumps
 * for no reason. There are two ways to drop out, so this asks the host
 * **whether it's in the list** rather than checking a flag: `dispose()`,
 * and eviction by `syncSeries`, which owns the whole list. Only `dispose`
 * is the exception that stays idempotent.
 */
export function createSeriesHandle<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
>(entry: TypedEntry<TSource>, host: HandleHost): SeriesHandle<TSource, TPoint> {
  const live = (door: string): void => {
    if (host.registered()) return;
    throw new ContractError(
      `this is a detached series handle — ${door} can't revive it. ` +
        "to draw again, mount with addSeries",
    );
  };

  return {
    // The point type is sealed inside Entry. The only place outside that
    // knows that type is where the registration was called, so the
    // TPoint that came from there is recovered here.
    read: () => entry.read() as DataView<TPoint>,
    setData: (data) => {
      live("setData");
      entry.setData(data);
      host.notify({ data: true, refit: true });
    },
    /**
     * **The shape is checked here first.**
     *
     * Even with `entry` holding a guard, this wrapper reading
     * `points.length` **first** made a `null` blow up as `TypeError:
     * Cannot read properties of null (reading 'length')` — put the guard
     * on the inside and let the outside touch it first, and the inner
     * guard is never reached. **The public door is the handle side.**
     *
     * For the same reason, **detachment is also checked before the empty
     * array.** Put it after, and only `append([])` slips through quietly,
     * making *"the five write doors throw"* false — streaming that mixes
     * in empty chunks happens to be exactly this door's consumer.
     */
    prepend: (points) => {
      requireDataArray(points, "prepend(points)");
      live("prepend");
      if (points.length === 0) return;
      entry.prepend(points);
      host.notify();
    },
    append: (points) => {
      requireDataArray(points, "append(points)");
      live("append");
      if (points.length === 0) return;
      entry.append(points);
      host.notify();
    },
    updateLast: (point) => {
      live("updateLast");
      // Only the spot that picked the branch knows whether x moved — carry that answer through as is.
      const xValues = entry.updateLast(point);
      host.notify({ data: true, refit: false, xValues });
    },
    swapSeries: (next) => {
      live("swapSeries");
      entry.swapSeries(next);
      // Same notification as plot.setSeries — the drawn points stay the
      // same, but the value axis needs refitting to the new series's extent.
      host.notify();
    },
    get xRange() {
      return entry.xRange();
    },
    get attached() {
      return host.attached();
    },
    dispose: () => {
      if (!host.registered()) return; // already disposed
      host.remove();
      host.notify();
    },
  };
}
