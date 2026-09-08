/**
 * The world that seals a registration into an Entry.
 *
 * This is as far as a concrete point type goes — `createEntry` seals it off
 * in a closure, and only a type-erased `Entry` goes into a Pane's list. The
 * face that handles data (`TypedEntry`) survives only where it was registered.
 */
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataView,
  DataManager,
  DataManagerFactory,
  DecimationPolicy,
  Range,
  Source,
  Viewport,
} from "../data";
import {
  checkPoint,
  continuesAfter,
  defaultCoordinates,
  headDelta,
  isGap,
  lowerBoundBy,
  mergePolicy,
  tailDelta,
} from "../data";
import {
  ContractError,
  DataError,
  describe,
  requireDataArray,
  requireDataPoint,
  requireFiniteX,
  requireFinite,
  requireObject,
  type PlotArea,
} from "../primitives";
import type { StyleReader, DrawTarget } from "../render";
import type { Scale, XMapping } from "../scale";
import type { Series } from "../series";

/** What every branch takes. The point type belongs to the **drawn point**. */
interface RegistrationBase<TPoint extends BaseDataPoint> {
  /**
   * Display name — legends and tooltips call it. **Belongs to the
   * registration, not the series.** A series is a way of drawing, not an
   * identity — the same `lineSeries()` can be registered as "MA(20)" or as "BTC."
   */
  name?: string;
  /** Display color swatch — the legend's dot, the tooltip's row color. Separate from the drawing color. */
  color?: string;
  /**
   * Overlap order. Lower goes underneath; registration order on a tie.
   * Default 0. This is purely a drawing order — probe, legend, and tooltip
   * row order stay in registration order regardless.
   */
  zIndex?: number;
  /** How to read coordinates off a drawn point. Falls back to the series's, then to x/y if that's absent too. */
  coordinates?: CoordinateAccessor<TPoint>;

  /**
   * A decimation policy for this registration alone. Overrides the `Series` default.
   *
   * Priority, **field by field**: registration > `Series.decimation` > wiring —
   * the wiring's `createDecimation` for a `strategy` neither names, its
   * `pointsPerPixel` for a density neither names. Giving just one field on
   * one side is fine; the other field still resolves down the same chain.
   */
  decimation?: DecimationPolicy<TPoint>;
}

/**
 * Draws its own data as is. **The drawn point is the source, exactly.**
 *
 * That's why `series` is `Series<TSource>` — feeding a candle into a line
 * series becomes a compile error right here.
 */
interface PlainRegistration<TSource extends BaseDataPoint>
  extends RegistrationBase<TSource> {
  series: Series<TSource>;

  /**
   * The data this registration draws. **The registration owns it** — if the
   * chart handed out one shared dataset, BTC and ETH couldn't be drawn on
   * the same chart. Swapping it later goes through the `SeriesHandle` that
   * `addSeries` returns.
   */
  data?: TSource[];

  derive?: undefined;
  input?: undefined;
}

/** Transforms its own data before drawing it. **The one branch where the source and the drawn point differ.** */
interface DerivedRegistration<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
> extends RegistrationBase<TPoint> {
  series: Series<TPoint>;

  /** Input to the derivation. → `PlainRegistration.data` */
  data?: TSource[];

  /**
   * Builds the points this series draws, from the source.
   *
   * Receives **all of `data`, not just the visible range.** That's required
   * so an indicator like a moving average, which has to look back, doesn't
   * cut off at the screen's left edge. Recomputes wholesale every time the
   * source changes unless a door takes the change — `deriveLast` for a tail,
   * `deriveFirst` for a landing; with neither, values near the boundary
   * correct themselves automatically once `prepend` splices in more history.
   *
   * If there are several branches, use a computed node instead of
   * attaching this more than once → `computation`
   */
  derive: (source: DataView<TSource>) => TPoint[];

  /**
   * **Tail increment.** Without it, every change is a full re-derivation —
   * this door is optional and additive. It folds what used to be a full
   * reload on every tick (re-derive, full validation, re-mapping) into the
   * manager's tail operation, for derivations that can say "only the last
   * `count` changed."
   *
   * **Length is the contract**: exactly 1 for `kind: "replace"` (replacing
   * the last output), exactly `count` for `"append"`. Violate it and you
   * get `DataError` — a silently mismatched tail getting drawn is the worst
   * outcome. Derivations whose output tail isn't 1:1 with the source tail
   * don't attach this door.
   *
   * **The entry notifies the shape of the change** — it doesn't detect it.
   * Whatever received `updateLast`/`append` already knows what changed.
   */
  deriveLast?: (
    previous: DataView<TPoint>,
    source: DataView<TSource>,
    change: { kind: "append" | "replace"; count: number },
  ) => TPoint[];

  /**
   * **Head increment** — a history page landing. Optional and additive,
   * like `deriveLast`; without it a landing re-derives the whole output
   * and hands it to `setData`, which validates all of it. `head` runs when
   * the manager can adopt a head over a retained tail
   * (`adoptHeadRetainingTail`), there is prior output, and the page is
   * non-empty; its result is spliced over a retained tail only when some
   * old output outlives the lookback — when the lookback covers all of it,
   * the head goes through `setData` and its full validation instead.
   *
   * `lookback` declares how many old head outputs the landing corrects —
   * a window's warmup (`period - 1`), or a recursion's decay horizon.
   * **The declaration is the contract**: `head` must return exactly
   * `count + min(lookback, previous.length)` points, and the corrected
   * ones must sit on the old head's x. Declared, not inferred from the
   * returned length — inferred, any answer passes, and an off-by-one
   * correction slips through every x check on a uniform series as a
   * silently stale head.
   *
   * The cheap way to build `head`: fold the new source's prefix from
   * scratch — a landing needs no checkpoint, its resume point is the
   * beginning of time.
   */
  deriveFirst?: {
    lookback: number;
    head: (
      previous: DataView<TPoint>,
      source: DataView<TSource>,
      change: { kind: "prepend"; count: number },
    ) => TPoint[];
  };

  input?: undefined;
}

/**
 * Draws points someone else made. **Doesn't own the data.**
 *
 * A computed node's branch, or another series's handle, arrives here.
 * What gets swapped is the **input**, not this registration, so this
 * registration's handle throws on `setData`.
 *
 * ```ts
 * lower.addSeries({ series: lineSeries(), input: macd.out.signal });
 * ```
 */
interface InputRegistration<TPoint extends BaseDataPoint>
  extends RegistrationBase<TPoint> {
  series: Series<TPoint>;
  input: Source<TPoint>;

  /** Can't be given since it doesn't own data. A bad combination is caught at compile time. */
  data?: undefined;
  derive?: undefined;
}

/**
 * How to mount one series on a chart. **Splits into three by where the
 * drawn point comes from.** Separating the branches lets each pin down its
 * own relationship: a mismatched combination like `{ series: lineSeries(),
 * data: candles }` is blocked at compile time.
 *
 * | branch | series | data |
 * |---|---|---|
 * | plain | `Series<TSource>` | its own |
 * | derived | `Series<TPoint>` | its own (`derive`'s input) |
 * | input | `Series<TPoint>` | someone else's |
 *
 * `derive?: undefined` and `input?: undefined` are the discriminants.
 * Without them, TS would fit anything into any of the three, letting a bad
 * combination leak back through.
 */
export type SeriesRegistration<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint = TSource,
> =
  | PlainRegistration<TSource>
  | DerivedRegistration<TSource, TPoint>
  | InputRegistration<TPoint>;

/**
 * A series's **identity**. This says nothing about what it knows how to do.
 *
 * A pane holds series with different point types in one array — an
 * existential type, which TS doesn't have. Sealing is `Entry`'s job:
 * `createEntry` closes over the point type in a closure, and that interface
 * never names it.
 *
 * **Confirmed that the only thing done with this from outside is `===`
 * comparison** — every `getSeries()` consumer compares identity, and none
 * calls a method. As `unknown`, anything fits in, `===` works, and the
 * compiler blocks method calls.
 */
export type SeriesId = unknown;

/** What one registration needs from outside to draw. */
interface EntryDrawContext {
  viewport: Viewport;
  x: XMapping;
  yScale: Scale;
  area: PlotArea;
  readStyle: StyleReader;
}

/**
 * One registered series. **No point type appears anywhere in it.**
 *
 * A pane only sees this face. Both the source type and the derived-result
 * type are sealed inside `createEntry`'s closure, which is why one pane can
 * hold BTC (OHLC) and ETH (line) side by side. The spot that handles data
 * (`TypedEntry`) survives only where it was registered.
 */
export interface Entry {
  /** Exactly what the registration received. For identity comparison. */
  readonly series: SeriesId;

  /** Display metadata — what the registration gave. `null` if none. */
  readonly name: string | null;
  readonly color: string | null;

  /** Overlap order — used only for drawing. Default 0. */
  readonly zIndex: number;

  /**
   * The drawn point nearest to x. `null` if empty. A binary search built on
   * the sort contract. The value comes out through the accessor, so the
   * point type never leaks out — a candle yields its close. `min` and
   * `max` are the point's data value span (`getYRange`).
   */
  nearest(
    x: number,
  ): {
    x: number;
    value: number | null;
    min: number | null;
    max: number | null;
    /** Which index the chosen point sits at in the registration's own points (the derived output, under a transform). */
    index: number;
  } | null;

  /**
   * Swaps in a new series for the same slot. **Both the data and the
   * derivation cache survive** — that's what lets a user build a new series
   * on every render. The point type is erased — giving the same id is
   * itself the declaration that it's "the same slot," so that judgment is
   * confined to the call site (`syncSeries`).
   */
  swapSeries(next: SeriesId): void;

  /**
   * A data entry point with the point type erased. **`syncSeries`-only.**
   * `syncSeries`'s contract is that the same id means the same slot and the
   * same point type. TS has no existential type to write that fact down
   * with, so it's confined to this one place.
   */
  feed(data: readonly BaseDataPoint[]): void;

  /** The x range of the drawn points. `null` if empty. */
  xRange(): Range | null;

  /**
   * Every x of the drawn points, ascending. Raw material for the bar-index
   * mapping to count indices — called only when data changes, and returns
   * the same array when it hasn't.
   */
  xValues(): readonly number[];

  /** Given a viewport, measures only that range; `null` measures everything it has. */
  valueExtent(visible: Viewport | null): Range | null;

  /**
   * **The smallest value greater than 0** in the same range. `null` if
   * none. Used only to set a log axis's floor — `LogScale.expand` calls it
   * when the lower bound is non-positive. Since it only runs then, a linear
   * axis doesn't pay a cent for this lazy scan.
   *
   * Why this isn't tacked onto `valueExtent`: `Series.valueExtent` is a
   * public contract that returns a `Range`, so adding a field would break
   * the public surface. `Entry` is an internal interface absent from the
   * public barrel, so adding it here asks nothing of consumers.
   */
  positiveFloor(visible: Viewport | null): number | null;
  draw(target: DrawTarget, context: EntryDrawContext): void;
}

/**
 * The face that can handle data. **Exists only where it was registered.**
 *
 * `addSeries` takes this and wraps it into a handle, while only the `Entry`
 * above goes into a pane's list. Meaning: the only thing that needs the
 * point type is putting data in and reading it out.
 */
export interface TypedEntry<TSource extends BaseDataPoint> extends Entry {
  setData(data: TSource[]): void;
  prepend(points: TSource[]): void;
  append(points: TSource[]): void;
  /**
   * A tick for the bar in progress. **Returns true if the set of x values
   * changed.** A same-x replacement (most ticks) only changes the drawn
   * point's value, so the bar-index mapping has no reason to recount. A
   * derived registration is always true, since `toPoints` can move x
   * (when unsure, recounting is the safe side).
   */
  updateLast(point: TSource): boolean;
  /**
   * The drawn points. Where an indicator's input lives.
   *
   * The derived result's type is erased here too — the only place that
   * knows it is where `addSeries` was called, and the handle recovers it there.
   */
  read(): DataView<BaseDataPoint>;
}

/**
 * Seals a registration into an Entry. **TPoint is concrete only inside this function.**
 * Discriminating the branch is itself the type narrowing — since the
 * registration type already splits into three, neither an `as` nor a
 * runtime check against bad combinations is needed here.
 */
/**
 * Whether two point arrays' **x sets differ.** False if they match — no
 * reason to recount the bar index. Checking length first settles most
 * cases. Same length means an O(n) scan over x, which is cheaper than the
 * full sort O(N log N) that the rebuild being spared would cost — one
 * series's linear scan comes out ahead.
 */
function xValuesDiffer<T extends BaseDataPoint>(
  before: readonly T[],
  after: readonly T[],
  coordinates: CoordinateAccessor<T>,
  beforeOffset = 0,
  afterOffset = 0,
  count?: number,
): boolean {
  const beforeRemaining = before.length - beforeOffset;
  const afterRemaining = after.length - afterOffset;
  if (count === undefined && beforeRemaining !== afterRemaining) return true;
  const compared = count ?? Math.min(beforeRemaining, afterRemaining);
  for (let i = 0; i < compared; i++) {
    if (
      coordinates.getX(before[beforeOffset + i]) !==
      coordinates.getX(after[afterOffset + i])
    ) {
      return true;
    }
  }
  return false;
}

export function createEntry<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
>(
  registration: SeriesRegistration<TSource, TPoint> | Series<TSource>,
  createDataManager: DataManagerFactory,
  /** The door name to carry on error labels. `setSeries` and `seriesSpec` also pass through here. */
  door = "addSeries",
): TypedEntry<TSource> {
  /**
   * **The choke point for registration** — `addSeries` and `setSeries` all
   * pass through here. Without this check, something like
   * `addSeries(null)` or `{series: {}}` would clear assembly and then blow
   * up inside a `requestAnimationFrame` callback, with the stack not
   * pointing at the consumer's call site.
   */
  requireObject(registration, `${door}(registration)`);
  if ("series" in registration) {
    requireSeries(registration.series, `${door}({ series })`);
  }

  /**
   * **`zIndex` passes through the same door.** Feed it `NaN` and the
   * comparator that decides draw order becomes an inconsistent comparator
   * that returns false on every comparison, so overlap order varies by
   * browser and by data count. Since this fails quietly instead of
   * throwing, it's caught right at the door.
   */
  if ("zIndex" in registration && registration.zIndex !== undefined) {
    requireFinite(registration.zIndex, `${door}({ zIndex })`);
  }

  /**
   * Only a series was given — the drawn point is the source itself, and
   * data comes later. With no `series` key, the whole registration object
   * is passed through as a `Series`. This is exactly the habit
   * lightweight-charts trains, with `chart.addLineSeries({ color, data })`
   * — `addSeries({ type:"line", data })` would quietly pass, then blow up
   * forever on the next render with `series.valueExtent is not a function`.
   */
  if (!("series" in registration)) {
    requireSeries(registration, `${door}(series)`);
    return plainEntry(registration, undefined, createDataManager, undefined, door);
  }

  if (registration.input) {
    return entryOf<TSource, TPoint>(
      registration.series,
      registration.input,
      (series) => drawSideOf(series, registration, createDataManager),
      registration,
      door,
    );
  }

  if (registration.derive) {
    /**
     * The lookback declaration is a chokepoint — unvalidated, a negative
     * value flips `previous.slice(corrected)` into slice-from-the-end and
     * the retained body silently truncates to its last point, with the
     * length check agreeing all the way. Refused here, before any
     * landing can reach it.
     */
    if (registration.deriveFirst !== undefined) {
      const { lookback } = registration.deriveFirst;
      if (!Number.isInteger(lookback) || lookback < 0) {
        throw new ContractError(
          `deriveFirst.lookback must be a non-negative integer, got ${describe(lookback)}`,
        );
      }
    }
    return entryOf<TSource, TPoint>(
      registration.series,
      {
        data: registration.data,
        toPoints: registration.derive,
        toTail: registration.deriveLast,
        toHead: registration.deriveFirst,
      },
      (series) => drawSideOf(series, registration, createDataManager),
      registration,
      door,
    );
  }

  // In the remaining branch, `series` is a `Series<TSource>` — the type says so.
  return plainEntry(
    registration.series,
    registration.data,
    createDataManager,
    registration,
    door,
  );
}

/**
 * A series's **shape**. `valueExtent` and `draw` are the whole contract.
 * Dropping the parentheses, as in `addSeries({ series: candleSeries })`, is
 * the most common mistake at this door, so it's named in our own words at
 * registration time.
 */
function seriesGap(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  for (const member of ["valueExtent", "draw"]) {
    if (typeof Reflect.get(value, member) !== "function") return member;
  }
  return "";
}

/** Where `unknown` gets narrowed — `seriesGap` alone makes the call. */
function isSeries<T extends BaseDataPoint>(value: unknown): value is Series<T> {
  return seriesGap(value) === "";
}

export function requireSeries<T extends BaseDataPoint>(
  value: unknown,
  door: string,
): Series<T> {
  if (!isSeries<T>(value)) {
    const gap = seriesGap(value);
    throw new ContractError(
      gap === null
        ? `${door} must be an object, got ${describe(value)}`
        : `${door} is missing ${gap} — a series is { valueExtent, draw }. ` +
          `Did you forget to call the factory? It's candleSeries(), not candleSeries`,
    );
  }
  return value;
}

/** Coordinates and manager for the drawn-point side. All three branches use the same chain. */
function drawSideOf<TPoint extends BaseDataPoint>(
  series: Series<TPoint>,
  overrides: RegistrationBase<TPoint> | undefined,
  createDataManager: DataManagerFactory,
): [CoordinateAccessor<TPoint>, DataManager<TPoint>] {
  const coordinates =
    overrides?.coordinates ?? series.coordinates ?? defaultCoordinates<TPoint>();

  return [
    coordinates,
    createDataManager<TPoint>(
      coordinates,
      mergePolicy(overrides?.decimation, series.decimation),
    ),
  ];
}

/** A registration without a derivation. The drawn point is the source, so **the path is the same.** */
function plainEntry<TSource extends BaseDataPoint>(
  series: Series<TSource>,
  data: TSource[] | undefined,
  createDataManager: DataManagerFactory,
  overrides?: RegistrationBase<TSource>,
  door = "addSeries",
): TypedEntry<TSource> {
  return entryOf<TSource, TSource>(
    series,
    {
      data,
      toPoints: (source) => source,
      identity: true,
      // The drawn point is the source point, so the source's ordering x is
      // the accessor's — built here, where the two types are one, instead
      // of asserting it at the tick door.
      sourceX: (coordinates, point) => coordinates.getX(point),
      checkSource: (coordinates, point, index, label) =>
        checkPoint(point, index, coordinates, label, null, true),
    },
    (next) => drawSideOf(next, overrides, createDataManager),
    overrides,
    door,
  );
}

/**
 * Where the drawn point comes from. **One of two.**
 *
 * Either it owns its own data (a derivation is just a transform on top of
 * that), or it pulls in something someone else made. Without ownership,
 * there's nothing to swap out either.
 */
interface OwnedOrigin<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
> {
  data: TSource[] | undefined;
  toPoints: (source: TSource[]) => TPoint[];
  /** Tail-increment door → `DerivedRegistration.deriveLast`. Absent on identity — the splice path already exists. */
  toTail?: (
    previous: DataView<TPoint>,
    source: DataView<TSource>,
    change: { kind: "append" | "replace"; count: number },
  ) => TPoint[];
  /** Head-increment door → `DerivedRegistration.deriveFirst`. Absent on identity — prepend splices as is. */
  toHead?: {
    lookback: number;
    head: (
      previous: DataView<TPoint>,
      source: DataView<TSource>,
      change: { kind: "prepend"; count: number },
    ) => TPoint[];
  };
  /**
   * The declaration that `toPoints` is the identity function — only then do
   * increments (append, prepend, updateLast) go straight to the manager's
   * splice path with no re-derivation or full validation. A derivation
   * takes an increment only through a door it declares — `deriveLast` for
   * the tail, `deriveFirst` for the head — and the full route otherwise.
   */
  identity?: boolean;
  /**
   * How to read the ordering x off a **source** point — the x the tick
   * router compares. An identity registration reads it through the
   * accessor (the drawn point *is* the source point), so the router, the
   * manager and the pre-check door all order in one space. A derivation's
   * source has no accessor (the accessor is for the drawn point), so it
   * falls back to the data x every point carries.
   */
  sourceX?: (coordinates: CoordinateAccessor<TPoint>, point: TSource) => number;
  /**
   * The per-point rules on a **source** point, under the tick door's label
   * and index — so a tick that opens a new bar is judged as the tick it is
   * (`updateLast(point)`, index n) before it rides the append path, whose
   * walker would otherwise report it as "data", index 0.
   */
  checkSource?: (
    coordinates: CoordinateAccessor<TPoint>,
    point: TSource,
    index: number,
    label: string,
  ) => void;
}

type Origin<TSource extends BaseDataPoint, TPoint extends BaseDataPoint> =
  | OwnedOrigin<TSource, TPoint>
  | Source<TPoint>;

const owns = <TSource extends BaseDataPoint, TPoint extends BaseDataPoint>(
  origin: Origin<TSource, TPoint>,
): origin is OwnedOrigin<TSource, TPoint> => "toPoints" in origin;

/** Gatekeeper for commands that require ownership — stops here when an input registration receives a data command. */
function owned<TSource extends BaseDataPoint, TPoint extends BaseDataPoint>(
  origin: Origin<TSource, TPoint>,
): OwnedOrigin<TSource, TPoint> {
  if (!owns(origin)) {
    throw new ContractError(
      "this registration doesn't own its data — it draws via input, so swap the input instead",
    );
  }
  return origin;
}

/**
 * The body of an Entry. **One path, whether there's a derivation, none, or
 * it draws someone else's output.** A registration without a derivation is
 * one where `toPoints` is the identity function, and a registration
 * drawing a computed node is just one with no data of its own.
 */
function entryOf<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
>(
  initial: Series<TPoint>,
  origin: Origin<TSource, TPoint>,
  /**
   * The series-to-drawn-point chain (accessor, decimation manager). Runs
   * once at creation and again on every `swapSeries` — when the
   * representation changes, its shadow (how it's read, how it's decimated)
   * has to belong to that representation too.
   */
  drawSide: (
    series: Series<TPoint>,
  ) => [CoordinateAccessor<TPoint>, DataManager<TPoint>],
  meta?: { name?: string; color?: string; zIndex?: number },
  door = "addSeries",
): TypedEntry<TSource> {
  // The closure reads this variable, since it needs to be swappable.
  let series = initial;
  let [coordinates, manager] = drawSide(initial);
  let source: TSource[] = [];
  let points: DataView<TPoint> = [];

  /** `xValues`'s cache. The mapping rebuild runs on every data change, so this spares the recomputation. */
  let xsOf: DataView<TPoint> | null = null;
  let xs: number[] = [];

  /**
   * **k more got appended to the tail — so the mapping only extends its
   * tail too.** The cache key is the array's identity, so building a new
   * array every time would force remapping the entire history. **Growing
   * the same array in place** lets the mapping know the tail in O(1) via
   * identity plus length — the array's identity is itself the notification.
   *
   * That's why `xValues`'s contract is narrow: **it's a borrowed array** —
   * read within the calling frame and discarded. Its only consumer
   * (`Plot.rebuildX` → the mapping) reads it synchronously and lets it go.
   */
  const extendXs = (previous: DataView<TPoint> | null, appended: number): void => {
    if (xsOf === null || xsOf !== previous) return;
    for (let i = points.length - appended; i < points.length; i++) {
      xs.push(coordinates.getX(points[i]));
    }
    xsOf = points;
  };

  /**
   * **`prepended` more landed at the head — the mapping learns it the way
   * it learns tails: the same array grew.** A rebuilt array would force
   * the mapping into a full re-merge of every source; growing this one in
   * place carries "head, by m" as identity + length + a moved front. The
   * shift is O(n) over plain numbers — the cheap end of a landing.
   */
  const extendXsHead = (previous: DataView<TPoint> | null, prepended: number): void => {
    if (xsOf === null || xsOf !== previous) return;
    const old = xs.length;
    xs.length = old + prepended;
    for (let i = old - 1; i >= 0; i--) xs[i + prepended] = xs[i];
    for (let i = 0; i < prepended; i++) xs[i] = coordinates.getX(points[i]);
    xsOf = points;
  };

  /**
   * Replaces the source and rebuilds the drawn points. **Runs only when
   * data changes** — not every frame. `setData` does a full sort check and
   * a derivation is O(n), so putting this in the draw path would turn data
   * size into part of the frame budget.
   *
   * **Commits only after the manager accepts.** Swapping `source` and
   * `points` first would leave only the closure corrupted if the manager
   * throws, and `read()` would break the "drawn points" contract by
   * returning rejected data — every frame and pan after that would rethrow
   * the same exception forever.
   *
   * **After committing, it aliases the manager's array.** If the entry kept
   * its own separate copy, it and the manager's history would become two
   * copies with only one getting updated — validation and commit are the
   * manager's job, and the entry receives the successful result through `read()`.
   */
  /**
   * **Validates and commits** what arrived through the tail-increment door.
   * Atomicity follows the same order as the identity path — compute the
   * tail first, and if the manager operation throws, nothing is left
   * behind; the alias and mapping update only after success. **Length is
   * the contract**: violate it and instead of a silently mismatched tail
   * getting drawn, it stops right here with a label attached.
   */
  const commitTail = (
    tail: readonly TPoint[],
    change: { kind: "append" | "replace"; count: number },
    nextSource: TSource[],
  ): void => {
    const expected = change.kind === "replace" ? 1 : change.count;
    if (!Array.isArray(tail) || tail.length !== expected) {
      throw new DataError(
        `deriveLast(${change.kind}) must return exactly ${expected}, ` +
          `got ${describe(tail)} — length is the contract (resumable-fold-approach)`,
      );
    }

    const previous = points;
    if (change.kind === "replace") {
      manager.replaceLast(tail[0]);
    } else {
      manager.append([...tail]);
    }
    points = manager.read();
    source = nextSource;
    if (change.kind === "append") {
      extendXs(previous, change.count);
    } else if (xsOf === previous) {
      // Replace — if x stayed the same, just carry the key over; if it moved, recount on the natural cache miss.
      const sameX =
        coordinates.getX(tail[0]) ===
        coordinates.getX(previous[previous.length - 1]);
      if (sameX) xsOf = points;
      else xsOf = null;
    }
  };

  /**
   * A history page landing on a derivation. The full route re-validates
   * and re-maps the entire output for what is, in shape, a head extension
   * — so when the re-derived output actually is one (it grew, and every
   * old x kept its place), the mapping learns of the growth through the
   * grown-in-place xs cache. A fresh full derivation still goes through
   * `setData`: it can legitimately correct any body value, and only the
   * manager-owned tail of a declared door can skip a full validation.
   *
   * A derivation that reshapes history instead (bricks renumber, spans
   * shift) fails the x comparison and takes today's full route — with the
   * output already in hand, not a second derivation.
   */
  const commitDerivedHead = (older: TSource[]): void => {
    const own = owned(origin);
    const nextSource = [...older, ...source];
    const previous = points;
    const adopt = manager.adoptHeadRetainingTail?.bind(manager);

    /**
     * The declared door first: the head comes from the derivation's own
     * increment, the tail is the previous output reused as is — the
     * landing pays O(page + lookback) instead of a re-derivation. Length
     * and corrected-zone x are checked against the declaration; a
     * silently mismatched head drawn is the worst outcome, so both
     * violations stop with a `DataError` naming the door.
     */
    if (own.toHead && adopt && previous.length > 0 && older.length > 0) {
      const count = older.length;
      const corrected = Math.min(own.toHead.lookback, previous.length);
      const head = own.toHead.head(previous, nextSource, {
        kind: "prepend",
        count,
      });
      requireDataArray(head, "deriveFirst.head(...)");
      if (head.length !== count + corrected) {
        throw new DataError(
          `deriveFirst.head must return count + min(lookback, previous) = ${count + corrected} points, got ${head.length}`,
        );
      }
      if (xValuesDiffer(previous, head, coordinates, 0, count, corrected)) {
        throw new DataError("deriveFirst.head corrected points moved off their prior x values");
      }
      if (corrected < previous.length) {
        adopt(head, corrected);
      } else {
        // No accepted suffix survives. The head is the entire new output,
        // so it must take the normal full-validation route.
        manager.setData(head);
      }
      source = nextSource;
      points = manager.read();
      extendXsHead(previous, count);
      return;
    }

    const out = own.toPoints(nextSource);
    const grown = out.length - previous.length;
    let headExtension = grown > 0;
    if (headExtension) {
      headExtension = !xValuesDiffer(
        previous,
        out,
        coordinates,
        0,
        grown,
        previous.length,
      );
    }

    // `out` is a fresh derivation, even if its x values align. Never let a
    // caller-vouched body bypass production validation;
    // `adoptHeadRetainingTail` is reserved for a suffix the manager itself
    // retains.
    manager.setData(out);
    source = nextSource;
    points = manager.read();
    if (headExtension) extendXsHead(previous, grown);
    else xsOf = null;
  };

  const load = (next: TSource[]): void => {
    const own = owned(origin);
    manager.setData(own.toPoints(next));
    points = manager.read();
    // A derivation must hold its source (the derivation's input) separately. Identity is the same array.
    source = own.identity ? (points as unknown as TSource[]) : next;
  };

  /**
   * Pulls from the input. **A reference that stays the same does nothing**
   * — the computation only ever runs once, inside the node itself, so all
   * that's done here is asking "is this result the same as last time."
   *
   * **What comes down from above also passes through the data door.** This
   * is the only door that runs inside a render (`valueExtent`, `draw`), so
   * without a check, a computed node producing a bad value would throw a
   * `TypeError` inside an rAF callback, and the next frame would throw the
   * same way. `DataError` at least attaches a label.
   */
  /** The change-detection key for an input registration — the source's (the node's) array identity. */
  let lastRead: DataView<TPoint> | null = null;

  const pull = (): DataView<TPoint> => {
    if (owns(origin)) return points;

    const next = origin.read();
    if (next === lastRead) return points;
    requireDataArray(next, `points ${meta?.name ?? "input"} read`);

    /**
     * **An input registration's tail is still a tail.** A node has no way
     * to notify the shape of a change, but `calcLast`'s output rule (reuse
     * the front of the previous array) carries that information through
     * point identity. `tailDelta` reads it out with a full check — if it
     * can't decide (`null`), the full path runs as is.
     */
    const delta = lastRead !== null ? tailDelta(lastRead, next) : null;

    if (delta?.kind === "none") {
      lastRead = next;
      return points;
    }

    // **The baseline moves only after the manager accepts** — the same
    // line as "a rejection leaves nothing behind." Moving it first would
    // mean that if the manager rejects a generation, the next delta gets
    // computed against an array the manager never saw. Every sibling commit
    // path (`load`, `commitTail`, `updateLast`) follows this same order.
    if (delta?.kind === "replace" && delta.count === 1) {
      const previous = points;
      const incoming = next[next.length - 1];
      const sameX =
        previous.length > 0 &&
        coordinates.getX(incoming) ===
          coordinates.getX(previous[previous.length - 1]);
      manager.replaceLast(incoming);
      lastRead = next;
      points = manager.read();
      if (xsOf === previous) xsOf = sameX ? points : null;
      return points;
    }

    if (delta?.kind === "append") {
      const previous = points;
      manager.append(next.slice(next.length - delta.count));
      lastRead = next;
      points = manager.read();
      extendXs(previous, delta.count);
      return points;
    }

    /**
     * **A landing is still a landing one registration downstream.**
     * `calcFirst`'s output rule (reuse the previous array's tail beyond
     * the corrected zone) carries the shape through point identity, and
     * `headDelta` reads it back out. The corrected zone rides inside the
     * validated head; a correction whose x drifted isn't treated as a
     * violation here — this is detection, not a declared door — it just
     * takes the full route, which is always correct.
     */
    const landing =
      delta === null && lastRead !== null ? headDelta(lastRead, next) : null;
    if (landing !== null) {
      const adopt = manager.adoptHeadRetainingTail?.bind(manager);
      const previous = points;
      if (adopt !== undefined && previous.length > 0) {
        const aligned = !xValuesDiffer(
          previous,
          next,
          coordinates,
          0,
          landing.count,
          landing.corrected,
        );
        if (aligned) {
          // `headDelta` proved that the remaining suffix is the same point
          // objects the manager already accepted. Pass only the changed
          // head; the manager retains that suffix itself.
          adopt(
            next.slice(0, landing.count + landing.corrected),
            landing.corrected,
          );
          lastRead = next;
          points = manager.read();
          extendXsHead(previous, landing.count);
          return points;
        }
      }
    }

    manager.setData([...next]);
    lastRead = next;
    points = manager.read();
    return points;
  };

  /**
   * Appending — only an identity registration is incremental (tick cost
   * becomes independent of history size). A derivation's contract is
   * re-derivation, so it always takes the full path. When `identity` is
   * true, TSource and TPoint are the same type — the cast only recovers
   * that declaration.
   */
  const appendChunk = (newer: readonly TSource[]): void => {
    requireDataArray(newer, "append(points)");
    if (!owns(origin) || !origin.identity) {
      const own = owns(origin) ? origin : null;
      if (own?.toTail && source.length > 0 && newer.length > 0) {
        // A derivation's tail is still a tail — takes the door instead of a full reload.
        const nextSource = source.concat(newer);
        const change = { kind: "append" as const, count: newer.length };
        commitTail(own.toTail(points, nextSource, change), change, nextSource);
        return;
      }
      load([...source, ...newer]);
      return;
    }
    manager.append([...newer] as unknown as TPoint[]);
    // The manager appends (one copy) and the entry aliases the result — the
    // second copy used to be here (`source.concat`). Every new bar on a
    // tick copied the entire history twice.
    const previous = points;
    points = manager.read();
    source = points as unknown as TSource[];
    extendXs(previous, newer.length);
  };

  const prependChunk = (older: readonly TSource[]): void => {
    requireDataArray(older, "prepend(points)");
    if (!owns(origin)) {
      load([...older, ...source]);
      return;
    }
    if (!origin.identity) {
      commitDerivedHead([...older]);
      return;
    }
    const previous = points;
    manager.prepend([...older] as unknown as TPoint[]);
    points = manager.read();
    source = points as unknown as TSource[];
    extendXsHead(previous, older.length);
  };

  if (owns(origin)) {
    // An array from outside is copied once here — even if the caller later
    // mutates that array, what's drawn shouldn't change along with it. The
    // extending side builds a new array anyway. This distinguishes
    // `undefined` (legitimately not declared) from `null` (e.g. a failed
    // fetch) — collapsing both into one falsy branch would turn both into a
    // zero-command blank screen with no clue for the consumer.
    if (origin.data === undefined) {
      load([]);
    } else {
      load([...requireDataArray(origin.data, `${door}'s data`)]);
    }
  } else {
    pull();
  }

  return {
    get series() {
      return series;
    },

    name: meta?.name ?? null,
    color: meta?.color ?? null,
    zIndex: meta?.zIndex ?? 0,

    /**
     * A binary search built on the sort contract — finds the lower bound
     * and picks whichever neighbor is closer. The value comes out through
     * the accessor, so the point type doesn't leak.
     */
    nearest(target) {
      const drawn = pull();
      if (drawn.length === 0) return null;

      const low = lowerBoundBy<TPoint>(drawn, target, (point) =>
        coordinates.getX(point as TPoint),
      );
      const right = Math.min(low, drawn.length - 1);
      const left = Math.max(low - 1, 0);
      const index =
        Math.abs(coordinates.getX(drawn[left]) - target) <=
        Math.abs(coordinates.getX(drawn[right]) - target)
          ? left
          : right;
      const best = drawn[index];

      const range = coordinates.getYRange?.(best) ?? null;
      /**
       * **The read path normalizes gaps too.** `SeriesSample.value` is
       * declared `number | null`, but letting the accessor's raw output
       * through would leak `undefined` from a point with no key —
       * consumers (`tooltip.ts`, `legend.ts`) trust that declaration and
       * only guard against `null`. Making the declared type true is the right answer.
       */
      const y = coordinates.getY(best);
      return {
        x: coordinates.getX(best),
        value: isGap(y) ? null : y,
        min: range?.min ?? null,
        max: range?.max ?? null,
        index,
      };
    },

    swapSeries(next) {
      // **Stand up the representation first, then swap** — doing `series =
      // next` first would mean that if `swapSeries(candleSeries)` drops the
      // parentheses, the series is already swapped when the next line
      // throws, permanently killing the chart.
      const nextSeries = requireSeries<TPoint>(next, "swapSeries(series)");
      /**
       * Rebuilds the drawn-point chain for the new representation too —
       * decimating a candle under a line's policy would drop that range's
       * high and low. Right after rebuilding, the current points are fed
       * back in, so the next tick's increment already sees the new manager.
       */
      const [nextCoordinates, nextManager] = drawSide(nextSeries);
      nextManager.setData([...points] as TPoint[]);
      series = nextSeries;
      coordinates = nextCoordinates;
      manager = nextManager;
      xsOf = null;
    },

    feed: (data) =>
      load([...requireDataArray(data, "feed(data)")] as TSource[]),

    setData: (data) => load([...requireDataArray(data, "setData(data)")]),

    prepend: prependChunk,
    append: appendChunk,

    /**
     * A tick for the bar in progress — same x as the last point means
     * replace, greater means append, smaller means rejected. Doesn't touch
     * the domain anywhere.
     */
    updateLast: (point) => {
      // Shape comes before finiteness — the instant an x is read off the point, a `null` is a TypeError.
      // Reported at the bar this tick replaces — the last one — not a
      // made-up index 0. The manager's own check says the same index.
      requireDataPoint(point, Math.max(source.length - 1, 0), "updateLast(point)");
      const own = owned(origin);

      if (source.length === 0) {
        appendChunk([point]);
        return true;
      }

      // One ordering space per registration — see `OwnedOrigin.sourceX`.
      // Branched inline: this is the tick path, and a closure per tick
      // would be an allocation the measurement never saw.
      const last = source[source.length - 1];
      const lastX = own.sourceX ? own.sourceX(coordinates, last) : last.x;
      const newX = own.sourceX ? own.sourceX(coordinates, point) : point.x;

      /**
       * **Finiteness comes before ordering.** Both comparisons below let
       * `NaN` through (`NaN > x` and `NaN < x` are both false) — a bad tick
       * falling quietly into the replace path would make that whole series
       * vanish on the next frame. The manager's `replaceLast` carries the
       * same check — an input API trusts incoming values no more than a parser does.
       */
      requireFiniteX(newX, source.length - 1, "updateLast(point)");

      if (newX > lastX) {
        // A new bar opened — the same thing as appending. x grew by one.
        // Judged here first, as a tick at its own index — the append
        // walker would name it "data", index 0.
        own.checkSource?.(coordinates, point, source.length, "updateLast(point)");
        appendChunk([point]);
        return true;
      }

      // The same seam sentence the manager and the pre-check door read.
      // A tick never declares uniqueX here: the same x is the bar being
      // replaced, which is this door's whole meaning.
      if (!continuesAfter(newX, lastX, false)) {
        throw new DataError(
          `updateLast(point) must keep x >= ${lastX}, but index ${source.length - 1} is ${describe(newX)} — fix the past with setData`,
        );
      }

      /**
       * **Commits only after the manager accepts** — swapping `source`
       * first would leave `read()`'s last point holding a bad value even if
       * the manager rejects it. **Only one copy**: `slice(0,
       * -1).concat(point)` is two copies, so this matches the symmetry of
       * the manager's `replaceLast`, which handles it in one.
       */
      if (own.identity) {
        // Validation, commit, and the single copy are all the manager's —
        // throwing leaves nothing behind, and success only gets an alias.
        const previous = points;
        manager.replaceLast(point as unknown as TPoint);
        points = manager.read();
        source = points as unknown as TSource[];
        // A same-x replacement (smaller already threw above) — the x mapping survives as is.
        if (xsOf === previous) xsOf = points;
        // **The x set stays the same.** A same-x replacement only changes
        // the drawn point's value — the bar-index mapping has no reason to recount.
        return false;
      }

      const nextSource = source.slice();
      nextSource[nextSource.length - 1] = point;

      if (own.toTail && points.length > 0) {
        // A same-x replacement — a derivation only needs to change its last output too.
        const change = { kind: "replace" as const, count: 1 };
        const tail = own.toTail(points, nextSource, change);
        const lastXBefore = coordinates.getX(points[points.length - 1]);
        commitTail(tail, change, nextSource);
        // The x signal only looks at the tail too — a full comparison disappears on this branch.
        return coordinates.getX(tail[0]) !== lastXBefore;
      }

      const previousPoints = points;
      manager.setData(own.toPoints(nextSource));
      source = nextSource;
      points = manager.read();

      // For a derivation, **check, don't assume.** `toPoints` promises
      // nothing beyond being a pure function, so the drawn point's x can
      // change even when the last source x stayed put. The result is
      // already in hand, so comparing settles it — one O(n) pass is
      // cheaper than a full sort at O(N log N).
      return xValuesDiffer(previousPoints, points, coordinates);
    },

    read: () => pull(),

    xRange: () => {
      pull();
      return manager.getXRange();
    },

    /**
     * **This is a borrowed array** — read within the calling frame and
     * discarded. Its tail can grow on the next data change (`extendXs`
     * pushes it in place). The only consumer is `Plot.rebuildX`.
     */
    xValues: () => {
      const drawn = pull();
      if (drawn !== xsOf) {
        xsOf = drawn;
        // The manager already checked the sort order — this only reads.
        xs = drawn.map((point) => coordinates.getX(point));
      }
      return xs;
    },

    valueExtent: (visible) => {
      const drawn = pull();
      return series.valueExtent(visible ? manager.getVisibleData(visible) : drawn);
    },

    positiveFloor: (visible) => {
      const drawn = pull();
      const points = visible ? manager.getVisibleData(visible) : drawn;
      // The doors in order, each asked only when the one before is absent.
      const floorOf = (point: TPoint): number | null | undefined => {
        const own = coordinates.getPositiveFloor?.(point);
        if (own !== undefined) return own;
        const low = coordinates.getYRange?.(point)?.min;
        if (low !== undefined) return low;
        return coordinates.getY(point);
      };

      let smallest: number | null = null;
      for (const point of points) {
        /**
         * **Looks through the same door as `valueExtent`.** Reading only
         * `getY` would pull the domain's top and bottom from different
         * doors — the upper bound comes from `valueExtent`'s
         * `getYRange.max` (the high), and if the lower bound alone came
         * from `getY` (a candle's close), one flat bar would cut off every
         * other bar's lower wick. `getYRange` already exists, and a line or
         * derivation lacking it falls back to `getY` naturally.
         */
        // A point that knows its own positive floor answers for itself — a column of boxes dipping below zero
        // still has a lowest box above it; the range's `min` would say the column has none.
        const y = floorOf(point);
        // Skips gaps and non-finite values — something with no place on the axis isn't a floor candidate either.
        if (isGap(y) || !Number.isFinite(y)) continue;
        if (y <= 0) continue;
        if (smallest === null || y < smallest) smallest = y;
      }
      return smallest;
    },

    draw: (target, context) => {
      pull();

      // A derived result also has to be clipped by the same bound as the
      // source, or it draws past the screen edge. Place accompaniment is a
      // door — without a manager for it, the series asks the mapping directly.
      const visible = manager.getVisiblePlaced
        ? manager.getVisiblePlaced(context.viewport)
        : { points: manager.getVisibleData(context.viewport), places: null };

      series.draw(target, {
        data: visible.points,
        places: visible.places,
        fullData: manager.read(),
        x: context.x,
        yScale: context.yScale,
        area: context.area,
        readStyle: context.readStyle,
      });
    },
  };
}
