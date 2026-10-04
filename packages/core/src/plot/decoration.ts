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
  /**
   * A list-wide registration number that is never reused after removal.
   * Within one z the list keeps insertion order, so `(zIndex, seq)` is
   * exactly the list's order — a walk can always tell where it is, whatever
   * was removed around it, and what arrived after it began.
   */
  readonly seq: number;
}

/** A list's next registration number lives on that list, not in a global registry. */
const NEXT_SEQUENCE = Symbol("decoration next sequence");

/** One past the largest `seq` in an externally supplied list. */
function nextSeqOf<D>(list: DecorationList<D>): number {
  let next = 0;
  for (const entry of list) if (entry.seq >= next) next = entry.seq + 1;
  return next;
}

/** **Kept in ascending z order.** The drawing side never has to sort. */
export type DecorationList<D> = DecorationEntry<D>[] & { [NEXT_SEQUENCE]?: number };

function sequenceOf<D>(list: DecorationList<D>): number {
  return list[NEXT_SEQUENCE] ?? nextSeqOf(list);
}

function setSequence<D>(list: DecorationList<D>, next: number): void {
  if (list[NEXT_SEQUENCE] === undefined) {
    Object.defineProperty(list, NEXT_SEQUENCE, { value: next, writable: true });
  } else {
    list[NEXT_SEQUENCE] = next;
  }
}

export function emptyDecorations<D>(): DecorationList<D> {
  const list: DecorationList<D> = [];
  setSequence(list, 0);
  return list;
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

  const seq = sequenceOf(list);
  setSequence(list, seq + 1);
  const entry: DecorationEntry<D> = {
    decoration,
    zIndex: options.zIndex ?? ABOVE_SERIES,
    seq,
  };

  let at = list.length;
  while (at > 0 && list[at - 1].zIndex > entry.zIndex) at--;
  list.splice(at, 0, entry);

  return () => {
    const index = list.indexOf(entry);
    if (index !== -1) list.splice(index, 1);
  };
}

/** Whether `entry` comes after the place `(zIndex, seq)` in the list's order. */
function after<D>(entry: DecorationEntry<D>, zIndex: number, seq: number): boolean {
  return entry.zIndex > zIndex || (entry.zIndex === zIndex && entry.seq > seq);
}

/**
 * Walks the list in order while a visit may change it — `visit` is someone
 * else's `draw` or `axisBadges`, and the unmount function `addDecoration`
 * returned can run inside it, for that decoration or any other.
 *
 * **It never loses its place and never allocates.** After each visit it
 * finds the first entry that comes after the one just visited, by
 * `(zIndex, seq)` rather than by slot, so a visit that removes entries —
 * itself, the one before it, several — skips nothing. An entry added during
 * the walk (its `seq` is past where the walk began) waits for the next
 * frame, and nothing is visited twice. The search starts from the last
 * slot, so a list nobody touched costs one step per entry, as before.
 *
 * `visit` returns `true` to stop.
 */
function walk<D>(list: DecorationList<D>, visit: (entry: DecorationEntry<D>) => boolean | void): void {
  const limit = sequenceOf(list);
  let zIndex = -Infinity;
  let seq = -1;
  let at = 0;
  for (;;) {
    // Back up past anything that now sits after the place (a removal above
    // shifted the slots down), then forward past anything at or before it.
    if (at > list.length) at = list.length;
    while (at > 0 && after(list[at - 1], zIndex, seq)) at--;
    while (at < list.length && !after(list[at], zIndex, seq)) at++;
    // Skip what arrived after the walk began.
    while (at < list.length && list[at].seq >= limit) at++;
    const entry = list[at];
    if (entry === undefined) return;
    zIndex = entry.zIndex;
    seq = entry.seq;
    if (visit(entry) === true) return;
    at++;
  }
}

/**
 * Yields everything below the series, in order, and stops at the series's
 * slot. Safe against visits that unmount decorations → `walk`.
 */
export function forEachBelowSeries<D>(
  list: DecorationList<D>,
  visit: (decoration: D) => void,
): void {
  walk(list, (entry) => {
    if (entry.zIndex >= SERIES_Z) return true;
    visit(entry.decoration);
  });
}

/** Yields everything at or above the series, in order → `walk`. */
export function forEachAboveSeries<D>(
  list: DecorationList<D>,
  visit: (decoration: D) => void,
): void {
  walk(list, (entry) => {
    if (entry.zIndex >= SERIES_Z) visit(entry.decoration);
  });
}

/** Yields every decoration, in order — for the axis badges → `walk`. */
export function forEachEntry<D>(
  list: DecorationList<D>,
  visit: (decoration: D) => void,
): void {
  walk(list, (entry) => {
    visit(entry.decoration);
  });
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
  try {
    changed();
  } catch (error) {
    // No remover can reach the caller when mounting throws. Release only
    // this entry; a synchronous draw or subscriber may have added others.
    remove();
    throw error;
  }

  let off = false;
  return () => {
    if (off) return;
    off = true;
    remove();
    changed();
  };
}
