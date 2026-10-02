/**
 * The series a pane draws, in draw order — and **who is allowed to change
 * the list.** Exactly one API owns it at a time: `syncSeries` reconciles a
 * complete declarative list, while handles are meaningful only for an
 * imperative list. Letting one silently replace the other would detach
 * live handles with no call at the point of failure.
 *
 * Knows nothing about the pane's scale or area — those arrive with each
 * draw. What lives here is the list, the reconcile plan, and the questions
 * the chart asks of every registration at once.
 */
import type { DataManagerFactory, Range, Viewport } from "../data";
import { ContractError, forEachStill, mapStill, type PlotArea } from "../primitives";
import type { DrawTarget, StyleReader } from "../render";
import type { Scale, XMapping } from "../scale";
import type { Entry, SeriesId, SeriesSpec } from "../registration";
import type { SeriesRow } from "../series";
import { unionOf } from "./range";

type Owner = "imperative" | "declarative";
type Door = "addSeries" | "setSeries" | "syncSeries" | "clearSeries";

/** What `probe` answers for one registration — raw material for tooltips and legends. */
export interface SeriesSample {
  series: SeriesId;
  /** Registration metadata. `null` if none. */
  name: string | null;
  color: string | null;
  /** The x of the point actually hit — not the queried x. Between bars, it's the neighboring bar's. */
  x: number;
  /** That point's value (by accessor — close, for a candle). `null` on a gap. */
  value: number | null;
  /**
   * That point's data value span (`CoordinateAccessor.getYRange`) — low and
   * high for a candle. `null` for series whose accessor omits it (line,
   * derived) — the point's value is `value` alone. These three are the
   * candidates for snapping.
   */
  min: number | null;
  max: number | null;
  /** What the series says about that point — a candle's O/H/L/C/V. Absent when the series does not describe itself. */
  rows?: readonly SeriesRow[];
  /**
   * `false` when the registration is drawn for the eye and readouts should
   * leave it out (`SeriesRegistration.readout`). Present only then — a
   * readout skips `sample.readout === false`.
   */
  readout?: false;
  /**
   * **Which index the chosen point sits at in the registration's own
   * points** — the array the registration holds, which for a derived
   * registration is the derived output, not its source. The consumer's key
   * back to that array — the core seals off the point type so it can't
   * hand back OHLC, but it can hand back a position: `bars[sample.index]`
   * (or `bricks[sample.index]` under a transform). Without this the
   * consumer has to hand-roll a binary search, and then the tooltip and
   * the header can end up naming different bars.
   */
  index: number;
}

/** What the pane lends each registration's draw — its own scale and slice, and the frame's shared parts. */
export interface SeriesDrawContext {
  viewport: Viewport;
  x: XMapping;
  yScale: Scale;
  area: PlotArea;
  readStyle: StyleReader;
}

/**
 * Whether the derivation needs to rerun.
 *
 * If both are missing, both are derivation-less registrations, so they're
 * equal. If only one is missing, the nature of the registration changed.
 */
function sameDeriveKey(
  a: readonly unknown[] | undefined,
  b: readonly unknown[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;

  return a.every((value, index) => Object.is(value, b[index]));
}

interface Synced {
  spec: SeriesSpec;
  entry: Entry;
}

export class SeriesList {
  private list: Entry[] = [];
  private owner: Owner | null = null;

  /**
   * What `sync` last received. **The baseline the next update compares
   * against.** It has to compare against the previous spec, not the pane's
   * current state — dragging a divider overwrites `flex` from outside, and
   * comparing against current state would revert that every time.
   */
  private synced = new Map<string, Synced>();

  /** Draw order. The live array — the pane reads it, nobody outside does. */
  get entries(): readonly Entry[] {
    return this.list;
  }

  has(entry: Entry): boolean {
    return this.list.includes(entry);
  }

  /** Mounts one more on top — `addSeries`. */
  add(entry: Entry): void {
    this.assertOwner("imperative", "addSeries");
    this.owner = "imperative";
    this.list.push(entry);
  }

  /** Discards everything and leaves just this one — `setSeries`. */
  replace(entry: Entry): void {
    this.assertOwner("imperative", "setSeries");
    this.owner = "imperative";
    this.list = [entry];
    this.synced.clear();
  }

  /** Drops everything and releases ownership — `clearSeries`. */
  clear(): void {
    this.assertOwner("imperative", "clearSeries");
    this.list = [];
    this.synced.clear();
    this.owner = null;
  }

  /** Takes one registration out. `false` if it was already gone — `dispose` stays idempotent on this. */
  remove(entry: Entry): boolean {
    const index = this.list.indexOf(entry);
    if (index === -1) return false;
    this.list.splice(index, 1);
    return true;
  }

  private assertOwner(requested: Owner, door: Door): void {
    if (this.owner === null || this.owner === requested) return;

    const owner = this.owner === "declarative" ? "syncSeries" : "addSeries/setSeries";
    const next = requested === "declarative" ? "syncSeries" : "addSeries/setSeries";
    throw new ContractError(
      `pane series are owned by ${owner}; ${door} cannot take them over. ` +
        `Clear the ${owner} list first, then use ${next}.`,
    );
  }

  /**
   * Fits the list to what the array says. **Owns the whole list.** Returns
   * whether anything changed — if nothing did, there's no reason to refit
   * the value axis either.
   *
   * The identity is `id`. With a matching id, the Entry is kept as is and
   * only the series reference is swapped, so the derivation cache
   * survives — the user is free to build a new series on every render.
   * `deriveKey` decides whether the derivation reruns.
   *
   * **Draw order is array order.** `add` pushes, so whatever was turned on
   * last always went on top; here, even something inserted late
   * conditionally lands in its rightful place.
   *
   * An explicit empty list releases declarative ownership, so it is the
   * deliberate reset before moving back to an imperative list.
   */
  sync(specs: readonly SeriesSpec[], createDataManager: DataManagerFactory): boolean {
    if (!Array.isArray(specs)) {
      throw new ContractError("syncSeries(specs) must be an array");
    }
    /**
     * **All ids are checked first — before anything is changed.** Putting
     * the duplicate check inside the loop would mean a duplicate later in
     * the list throws after `swapSeries`/`feed` has already been committed
     * to a reused registration — the earlier one's new data sits inside its
     * manager with no notification firing, so the chart refits neither the
     * x index nor the value axis. Moving the check up front means a
     * throwing path ends with nothing touched.
     */
    const seen = new Set<string>();
    for (const spec of specs) {
      if (seen.has(spec.id)) {
        throw new ContractError(`Duplicate series id: "${spec.id}"`);
      }
      seen.add(spec.id);
    }
    this.assertOwner("declarative", "syncSeries");

    const next = new Map<string, Synced>();
    const entries: Entry[] = [];
    const commits: (() => void)[] = [];

    // All construction, derivation and data validation finish before any
    // live entry is changed. A later sibling failure discards the staged
    // states, preserving both live values and the reconciliation baseline.
    type Step = { spec: SeriesSpec; reuse: Synced } | { spec: SeriesSpec; built: Entry };
    const plan: Step[] = [];
    for (const spec of specs) {
      const prior = this.synced.get(spec.id);
      const reusable =
        prior &&
        sameDeriveKey(prior.spec.deriveKey, spec.deriveKey) &&
        prior.spec.input === spec.input;

      // Keep the Entry when the derivation is unchanged — this is where the
      // cache survives. For input, the reference is the identity: reusing
      // across a mode switch (data ↔ input) or an input swap would either
      // feed the old entry (the gatekeeper throws) or ignore the new input,
      // so it's rebuilt instead.
      plan.push(
        reusable && prior
          ? { spec, reuse: prior }
          : { spec, built: spec.toEntry(createDataManager) },
      );
    }

    for (const step of plan) {
      if ("reuse" in step) {
        const swapped = step.reuse.spec.series !== step.spec.series;
        const fed = step.reuse.spec.data !== step.spec.data;
        if (swapped || fed) {
          commits.push(step.reuse.entry.prepare(
            step.spec.series,
            fed ? step.spec.data ?? [] : undefined,
          ));
        }
        // A new name or colour (a theme change, `MA(${period})`) must reach
        // the legend even though the drawn points stay.
        const { entry } = step.reuse;
        const display = {
          name: step.spec.name ?? null,
          color: step.spec.color ?? null,
          zIndex: step.spec.zIndex ?? 0,
          readout: step.spec.readout !== false,
        };
        if (display.name !== entry.name || display.color !== entry.color ||
            display.zIndex !== entry.zIndex || display.readout !== entry.readout) {
          commits.push(() => Object.assign(entry, display));
        }

        next.set(step.spec.id, { spec: step.spec, entry: step.reuse.entry });
        entries.push(step.reuse.entry);
        continue;
      }

      next.set(step.spec.id, { spec: step.spec, entry: step.built });
      entries.push(step.built);
    }

    const changed =
      commits.length > 0 ||
      entries.length !== this.list.length ||
      entries.some((entry, index) => entry !== this.list[index]);

    for (const commit of commits) commit();
    this.owner = specs.length === 0 ? null : "declarative";
    this.list = entries;
    this.synced = next;
    return changed;
  }

  /**
   * The value range spanning every registration. Each occupies a different
   * span (a line just its close, a candle its low to high), so the union
   * has to be taken so nothing gets clipped. `null` if there's nothing at
   * all to measure.
   */
  valueExtent(visible: Viewport | null): Range | null {
    // Each entry reads someone else's code (a series' `valueExtent`, a
    // source's `read`) that may dispose a registration → `mapStill`.
    return unionOf(mapStill(this.list, (entry) => entry.valueExtent(visible)));
  }

  /** The x range drawn. `null` if all are empty. */
  xRange(): Range | null {
    return unionOf(mapStill(this.list, (entry) => entry.xRange()));
  }

  /**
   * The x list for each registration's drawn points — raw material for the
   * bar-index mapping. Handed over per registration rather than merged:
   * each is already sorted, and merging them into an index is the
   * mapping's job. `barBodied` keeps only the series that draw bar bodies.
   */
  xValuesPerSeries(barBodied = false): readonly (readonly number[])[] {
    return mapStill(barBodied ? this.list.filter((entry) => entry.barBody) : this.list, (entry) => entry.xValues());
  }

  /**
   * The smallest positive value across registrations — what a log axis asks
   * for **only when it hits a non-positive floor**, so a linear axis's frame
   * never pays for this scan.
   */
  minPositive(visible: Viewport | null): number | null {
    let smallest: number | null = null;
    forEachStill(this.list, (entry) => {
      const candidate = entry.positiveFloor(visible);
      if (candidate === null) return;
      if (smallest === null || candidate < smallest) smallest = candidate;
    });
    return smallest;
  }

  /**
   * The nearest point of each registration at a data x — the door tooltips
   * use to ask "what are the values under this cursor." **Based on drawn
   * points** — a derivation's result, if there is one. Empty registrations
   * are dropped. Order is registration order (draw order).
   */
  probe(x: number): SeriesSample[] {
    /**
     * **`NaN` means "pointing at nothing."** `nearest`'s selection compares
     * with `Math.abs(...) <= Math.abs(...)`, and with `NaN` both sides are
     * `NaN`, so every comparison is false and the first point is left
     * standing — measured: `probe(NaN)` returned the first bar's value **as
     * a normal sample.** A tooltip showing the first bar's price while
     * claiming it's the value under the cursor is the quietly-wrong side,
     * so an empty list is the right answer.
     */
    if (!Number.isFinite(x)) return [];

    const samples: SeriesSample[] = [];

    forEachStill(this.list, (entry) => {
      const nearest = entry.nearest(x);
      if (!nearest) return;

      samples.push({
        series: entry.series,
        name: entry.name,
        color: entry.color,
        x: nearest.x,
        value: nearest.value,
        min: nearest.min,
        max: nearest.max,
        index: nearest.index,
        ...(nearest.rows !== undefined && { rows: nearest.rows }),
        ...(!entry.readout && { readout: false }),
      });
    });

    return samples;
  }

  /**
   * Draws every registration — zIndex ascending, registration order (stable
   * sort) on ties. This is where a band fill turned on late still lands
   * underneath the candles. Skips sorting entirely when all are 0.
   *
   * **Walks a copy.** A series `draw` is someone else's code, and disposing
   * a handle from inside it splices this list — walking it live would skip
   * the next registration for the frame. One taken at the start keeps every
   * registration's turn; one removed before its turn is skipped, and one
   * added mid-frame draws next frame.
   */
  draw(target: DrawTarget, context: SeriesDrawContext): void {
    const ordered = this.list.some((entry) => entry.zIndex !== 0)
      ? [...this.list].sort((a, b) => a.zIndex - b.zIndex)
      : [...this.list];

    for (const entry of ordered) {
      if (!this.list.includes(entry)) continue;
      // Drawing is an ascending scan — this opens a scanning plane instead
      // of a per-point binary search (`toPixel`). The plane is born and
      // dies with a single registration's draw, so registrations can't
      // interfere with each other's cursor, and a series author uses the
      // same `x.toPixel` without ever knowing the idiom — the context is
      // what opens that door.
      const scanPixel = context.x.scanToPixel?.();
      /**
       * **This is delegation, not copying.**
       *
       * It used to be `{ ...context.x, toPixel }`. A spread carries over
       * **only its own enumerable properties**, so a mapping written as a
       * class (`createXMapping` is a legitimate public extension point and
       * arrives that way) reached the series with only `toPixel` left on
       * it. A third-party series calling `context.x.fromPixel` — legal by
       * the declared type — would throw forever inside the render loop, and
       * `screenXAt` would also fail to find `domainToPixel` and quietly
       * fall off the O(1) fast path — exactly the path this spread was
       * meant to open.
       *
       * `Object.create` keeps the original as a **prototype**, so nothing
       * fails to carry over. The original stays untouched — the override
       * is the new object's own property.
       */
      let scanning: XMapping | null = null;
      if (scanPixel) {
        // `Object.create` produces `any` — receiving it into the declared type needs no assertion.
        const delegate: XMapping = Object.create(context.x);
        delegate.toPixel = scanPixel;
        scanning = delegate;
      }
      entry.draw(target, {
        viewport: context.viewport,
        x: scanning ?? context.x,
        yScale: context.yScale,
        area: context.area,
        readStyle: context.readStyle,
      });
    }
  }
}
