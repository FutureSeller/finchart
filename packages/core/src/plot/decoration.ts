import {
  ContractError,
  describe,
  requireFinite,
  requireObject,
} from "../primitives";
import type { AxisBadge, Tick } from "../axis";
import type { PlotArea } from "../primitives";
import type { StyleReader, DrawTarget } from "../render";
import type { Scale, XMapping } from "../scale";
import type { ValueFormat } from "../axis";
import type { PaneApi } from "./pane";

/**
 * Where the series is drawn. A decoration's z sorts above or below this
 * value.
 *
 * A series itself has no z — its order within a pane is fixed. Only
 * decorations interleave in front of or behind it.
 */
export const SERIES_Z = 0;

/** Below the series. The grid lives here. */
export const BELOW_SERIES = -1000;

/** Above the series. Where a decoration lands if `z` is omitted. */
export const ABOVE_SERIES = 1000;

/**
 * The part of what a decoration receives that's independent of where it's
 * registered. There's no `data` (the source's visible range) here — every
 * series has a different array, so there's no single one to hand over. If
 * you need "each series's value at cursor x", use
 * `PlotDecorationContext.panes` instead. A decoration no longer knows a
 * point type anywhere.
 */
interface DecorationBase {
  /**
   * The drawable area. A pane-registered decoration gets that pane's
   * slice; a plot-registered one gets the entire data area. **The axis
   * slice belongs to neither** — anything meant for the axis is described,
   * not drawn.
   */
  area: PlotArea;
  /** Where a point's x lands on screen. The same mapping a series sees. */
  x: XMapping;
  /** Built once per render and shared by everyone. */
  readStyle: StyleReader;
  /**
   * The resolved x formatting — `config.axis.x.format`, else the tick
   * strategy's own, else a rounded integer. The axis owns formatting; a
   * decoration falls back to this only when it has no option of its own.
   */
  formatX: ValueFormat;
}

/**
 * What a pane-registered decoration receives.
 *
 * Needing y is what makes it pane-scoped — Plot owns x, and Pane owns y.
 * So here, both `yScale` and `pane` are guaranteed to be present.
 */
export interface PaneDecorationContext extends DecorationBase {
  pane: PaneApi;
  yScale: Scale;
  /** Already-computed ticks. `y` belongs to this pane. */
  ticks: { x: Tick[]; y: Tick[] };
  /** The resolved y formatting — sugar over `pane.formatValue`. */
  formatY: ValueFormat;
}

/**
 * What a plot-registered decoration receives.
 *
 * No y ticks, no value axis — those differ per pane. Iterate `panes` if you
 * need them.
 */
export interface PlotDecorationContext extends DecorationBase {
  panes: readonly PaneApi[];
  /** x is shared by every pane, so there's just one set. */
  ticks: { x: Tick[] };
}

/**
 * Something drawn on the chart that isn't a representation of data.
 *
 * There's exactly one line that separates it from a `Series` — **it
 * doesn't participate in value-axis fitting.** Register a target line as a
 * series and `valueExtent` pulls y toward it, flattening the price. A
 * crosshair or a watermark has no value to contribute in the first place.
 *
 * Context is a type parameter because what each registration site receives
 * differs. Folding it into one type with `yScale: Scale | null` would force
 * even a decoration that can only ever register on a pane to narrow away a
 * `null` that never happens.
 */
export interface Decoration<Context> {
  draw(target: DrawTarget, context: Context): void;
  /**
   * Describes something to place on the axis — a crosshair value box, a
   * price-line label.
   *
   * **The reason it's described rather than drawn is layering.** When tick
   * labels are DOM, a box drawn on canvas can't cover them — whoever draws
   * the ticks has to draw the badge too, for the overlap to come out right
   * whether the path is DOM or canvas. A badge for an axis that isn't
   * showing labels is dropped — drawing into space that doesn't exist would
   * cover the data instead.
   */
  axisBadges?(context: Context): AxisBadge[];
}

export type PaneDecoration = Decoration<PaneDecorationContext>;

export type PlotDecoration = Decoration<PlotDecorationContext>;

export interface DecorationOptions {
  /**
   * Stacking order. Smaller is further down; ties keep registration order.
   * Defaults to `ABOVE_SERIES` if omitted.
   */
  zIndex?: number;
}

/** One registration. Options are already filled in with their defaults. */
export interface DecorationEntry<D> {
  readonly decoration: D;
  readonly zIndex: number;
}

/** **Kept in ascending z order.** The drawing side never has to sort. */
export type DecorationList<D> = DecorationEntry<D>[];

export function emptyDecorations<D>(): DecorationList<D> {
  return [];
}

/**
 * Inserts at the right z position and returns an unsubscribe function.
 *
 * Same shape as `addSeries`, so it drops right into a React effect's
 * cleanup.
 *
 * **Finds its slot on insertion** rather than sorting every frame —
 * registration is rare, drawing happens every frame. Entries with the same
 * `z` go after the last tie, so registration order is preserved.
 */
export function addDecoration<D>(
  list: DecorationList<D>,
  decoration: D,
  options: DecorationOptions = {},
): () => void {
  /**
   * **A decoration is a hand-built object.** lightweight-charts' primitive
   * calls it `renderer()`, KLineChart's overlay calls it
   * `createPointFigures`, we call it `draw` — getting the name wrong isn't
   * a typo, it's a habit carried over from elsewhere. Left unchecked, that
   * surfaces as a `TypeError` in the next rAF callback and kills the chart
   * for good.
   *
   * `zIndex: NaN` is blocked for the same reason — every `>` comparison
   * against `NaN` is false, which produces the same draw order as
   * `BELOW_SERIES`, and a price line silently hides behind the candles.
   */
  if (typeof decoration !== "object" || decoration === null) {
    throw new ContractError(
      `addDecoration(decoration) must be an object, got ${describe(decoration)}`,
    );
  }
  if (typeof Reflect.get(decoration, "draw") !== "function") {
    throw new ContractError(
      "addDecoration(decoration) has no draw — a decoration is { draw(target, context) }. " +
        "(this is where lightweight-charts' renderer() or KLineChart's createPointFigures goes)",
    );
  }
  requireObject(options, "addDecoration(options)");
  if (options.zIndex !== undefined) {
    requireFinite(options.zIndex, "addDecoration({ zIndex })");
  }

  const entry: DecorationEntry<D> = {
    decoration,
    zIndex: options.zIndex ?? ABOVE_SERIES,
  };

  let at = list.length;
  while (at > 0 && list[at - 1].zIndex > entry.zIndex) at--;
  list.splice(at, 0, entry);

  return () => {
    const index = list.indexOf(entry);
    if (index !== -1) list.splice(index, 1);
  };
}

/**
 * Yields everything below the series, in order. Never allocates a new
 * array — this runs every frame. The list is already sorted, so it scans
 * from the front and stops at the series's slot.
 *
 * **A shrinking list during iteration never skips the next entry.**
 * `addDecoration`'s unsubscribe function can be called from inside
 * `visit` — a notification banner that draws once and then removes itself
 * is exactly that shape. Unlike sibling loops elsewhere, this one **rewinds
 * the index** instead of copying: if the entry at the current slot has
 * changed after a visit, it looks at that same slot again.
 */
export function forEachBelowSeries<D>(
  list: DecorationList<D>,
  visit: (decoration: D) => void,
): void {
  for (let at = 0; at < list.length; at++) {
    const entry = list[at];
    if (entry.zIndex >= SERIES_Z) return;
    visit(entry.decoration);
    if (list[at] !== entry) at--;
  }
}

/** Yields everything above the series, in order. */
export function forEachAboveSeries<D>(
  list: DecorationList<D>,
  visit: (decoration: D) => void,
): void {
  for (let at = 0; at < list.length; at++) {
    const entry = list[at];
    if (entry.zIndex >= SERIES_Z) visit(entry.decoration);
    if (list[at] !== entry) at--;
  }
}

/**
 * Mounts a decoration and hands back an **idempotent** remover — the
 * unsubscribe-function convention across this repo (`Pane.subscribe`,
 * `Plot.on`, `FocusClaim.release`, `claimCursor` all carry their own flag).
 *
 * `changed` runs once on mount and once on the first removal. The inner
 * `remove` is idempotent on its own, but the notification sits outside it,
 * so an effect cleanup running twice used to give every subscriber a
 * phantom frame.
 */
export function mountDecoration<D>(
  list: DecorationList<D>,
  decoration: D,
  options: DecorationOptions,
  changed: () => void,
): () => void {
  const remove = addDecoration(list, decoration, options);
  changed();

  let off = false;
  return () => {
    if (off) return;
    off = true;
    remove();
    changed();
  };
}
