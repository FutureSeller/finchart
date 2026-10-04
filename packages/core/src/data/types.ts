/**
 * The data layer's contract.
 *
 * This module knows only "what a point is" and "how to pull numbers out of a
 * point." It doesn't import scales, renderers, or the chart.
 */

export interface BaseDataPoint {
  /**
   * A number — epoch ms or bar index, either way. Formatting is the axis's
   * job. Why not accept `Date` or a string: the moment you do, every
   * consumption site owes a conversion, and the workaround (`Number(x)`)
   * produces a silent `NaN`. `Date` data needs one `.getTime()` at the
   * consumer boundary.
   */
  x: number;
  label?: string;
}

export interface LineDataPoint extends BaseDataPoint {
  /**
   * The value. `null` means "there's no value here" (whitespace).
   *
   * Needed in two places — an indicator's warmup (the first 19 points of
   * MA(20)), and a bar that exists on only one series. Dropping the point
   * entirely would make the line jump straight across the gap.
   *
   * No separate type (`WhitespaceData`) because the array needs to be one
   * type for slicing, sorting, and decimation to work unmodified.
   */
  y: number | null;
}

export interface OHLC extends BaseDataPoint {
  open: number;
  high: number;
  low: number;
  close: number;
  /**
   * Optional, and — unlike the four prices — `null` is a **gap**, not a
   * rejection. A bar without volume is still a bar (a feed's JSON says
   * `"volume": null` on a halted day and the candle still draws), where a
   * bar without a close is nothing to draw. What is rejected: a string, a
   * `NaN`, an infinity — the data gate checks volume for finiteness the
   * same way it checks the prices. Consumers of volume (aggregation, the
   * indicators) read a gap through `isGap`.
   */
  volume?: number | null;
}

export type DataPoint = LineDataPoint | OHLC;

/**
 * Where the points to draw come from. Passed by value — it has no name.
 *
 * If you point at what an indicator runs on with a string id, that name
 * becomes public API and a typo survives to runtime. Passed by value, you
 * can't reference something that doesn't exist, so cycles are structurally
 * impossible.
 *
 * The pulling side asks every frame, so if nothing changed, return the same
 * array reference — that comparison is the only basis for deciding whether
 * to recompute or re-feed.
 */
/**
 * A borrowed view of chart-owned points.
 *
 * Array identity stays stable until the source changes, because computations
 * use it as their inexpensive change signal. It is therefore not a
 * collection callers may edit: copy before reshaping it.
 */
export type DataView<T extends BaseDataPoint = BaseDataPoint> = readonly Readonly<T>[];

export interface Source<T extends BaseDataPoint = BaseDataPoint> {
  read(): DataView<T>;
}

/** Pulls display x/y coordinates out of a point. */
export interface CoordinateAccessor<T extends BaseDataPoint = BaseDataPoint> {
  /**
   * Where to place it. Can't be absent.
   *
   * A point with no x isn't whitespace — it's a point that must be dropped.
   * If you don't know where to put it, you can't even draw a gap for it.
   */
  getX(point: T): number;

  /**
   * What to draw. `null` means there's no value (whitespace).
   *
   * Where there's no value the line breaks, the value range (`valueExtent`)
   * doesn't count that point, and decimation doesn't swallow that spot.
   *
   * Can also return `undefined` — meaning "couldn't read it." For the
   * manager to point out a mismatched field name like `{x, value}`, that
   * value has to surface here.
   *
   * Consumers already receive all of this uniformly through `isGap` (line,
   * area, histogram, baseline).
   */
  getY(point: T): number | null | undefined;

  /**
   * Are all of this point's value fields finite? If not, throw `DataError`.
   * `label` names the door the point came through ("data" for a whole
   * array, "updateLast(point)" for a tick) — put it in front of the
   * message, so a consumer reading a socket callback's error knows which
   * call it was. Omitted, say "data".
   *
   * If omitted, the data gate only checks `getY` — for a line or a derived
   * series where there's one value, that's enough. For OHLC, where there
   * are four, you must implement this: `getY` only reads `close`, so
   * `open`, `high`, and `low` pass through no gate at all.
   *
   * One bar with `close: null` drew a 7140px red bar in a 600px pane, and
   * `close: "102"` produced not a broken screen but a wrong one — a
   * perfectly normal-looking bar that reads as a doji. Not failing to draw,
   * but confidently drawing the wrong price — the worst failure a financial
   * chart can produce.
   *
   * Where the value comes from: exchange REST APIs give prices as strings.
   * Unwrap `open`/`high`/`low` with `+` and let one `close` slip through
   * and that's the row. `close: null` on a closed or unfilled bar is just
   * an ordinary day on the feed, and `parseFloat("")` is `NaN`.
   *
   * The cost was measured: on 100k bars, a loop that only touches x takes
   * 0.10ms; checking all four OHLC fields in the same loop still takes
   * 0.10ms — same loop, no extra pass. But laying the fields out by hand
   * instead of a loop over them (iterator allocation plus a dynamic lookup
   * per point) is more than twice as slow — `ohlc-fields.test.ts` guards
   * against a dropped field.
   */
  assertFinite?(point: T, index: number, label?: string): void;

  /**
   * This one point's data value span — low to high for a candle. If
   * omitted, the point's value is just `getY` (line, derived).
   *
   * This is a different truth than `Series.valueExtent` — that one is "the
   * drawing's value span," so a histogram includes zero, while this is the
   * span the data actually has. Using the drawing's criterion here turns
   * snapping into a bug that sticks to a histogram's zero.
   */
  getYRange?(point: T): Range | null;

  /**
   * The smallest positive value this one point holds on the axis — what a
   * log axis stands on when the point dips to zero or below. If omitted,
   * the point's positive floor is its range's `min` (then `getY`) when
   * that is positive, and nothing otherwise — right for a candle, whose
   * `low` is its lowest value, and wrong for a point that holds more
   * values than its range names, such as a column of boxes whose lowest
   * box is below zero and whose next is not: without this door the log
   * axis is fitted from a constant instead of that box.
   */
  getPositiveFloor?(point: T): number | null;

  /**
   * Declares that this accessor can never produce a gap. If omitted, assume
   * it can.
   *
   * `getY`'s return type already knows this fact (`number` vs.
   * `number | null`), but the runtime can't read the type, so this is where
   * that fact gets written down again as a value.
   *
   * What this saves: checking gap presence by calling `getY` over the whole
   * window every frame is hundreds of thousands of calls on a large window.
   * For a series whose answer is always "no" (bars, etc.), this declaration
   * removes that scan entirely. The viewport cache can't help here — gap
   * presence is a property of the array, not the window.
   *
   * Declaring this falsely swallows gaps — never declare it if `getY` can
   * return `null` or `undefined`.
   */
  readonly gapless?: boolean;

  /**
   * Declares that one x holds one point — a bar per moment. If omitted,
   * a repeated x is legal (two points at one moment: line data's contract).
   *
   * Like `gapless`, a static fact about the accessor written down as a
   * value (`gapFree` on the manager is the array's runtime state — a
   * different thing). Unlike `gapless`, the risk runs the other way:
   * declaring `gapless` falsely swallows a gap **quietly**, while
   * declaring `uniqueX` makes every door **loud** — a repeated x at
   * `setData`, a seam, or the tick's previous bar is a `DataError`
   * (`duplicate-x`), and data that was legal without the declaration is
   * rejected with it. Declare it only where a repeat is a defect, not a
   * second point: the reconnect gap-fill that hands back the boundary
   * candle twice is the case this exists for.
   */
  readonly uniqueX?: boolean;
}

/** The data range currently visible on screen. */
export interface Viewport {
  startX: number;
  endX: number;
  width: number;
  height: number;
  /**
   * A factory that opens a pass for screen-place lookups. If absent, x is
   * the screen place (continuous coordinate space, the default). A bar-index
   * coordinate space supplies this — decimation that buckets by x
   * (`M4Decimation`, `LttbDecimation`) has to bucket in that same space to
   * line up with the screen.
   *
   * Why a factory and not a function: a cursor that speeds up lookups has
   * to be owned by a single scan. Share one function and you share the
   * cursor too, so a sweeping consumer and a point-by-point consumer
   * trample each other. Whoever opens the pass holds the cursor, and it
   * dies when the pass ends.
   *
   * Why this travels with the range (`startX`, `endX`): two consumers
   * (drawing, the value axis) both ask "what's visible," and if the
   * definition splits, the same viewport gets different answers and the
   * cache goes out of sync.
   */
  screenXScan?: () => (x: number) => number;

  /**
   * How many times the x mapping has recounted indices. Screen place is a
   * domain value of the mapping, so it goes stale on a rebuild — another
   * series's `setData` changing the merged x list shifts my places even
   * though my data didn't change. This count is the invalidation key for
   * the place cache. Only travels together with `screenXScan` — a
   * continuous mapping has nothing to count.
   */
  xEpoch?: number;
}

/**
 * Visible points, plus each point's screen place (a scale domain value).
 *
 * `places[i]` is the place for `points[i]`. `null` means places weren't
 * carried (continuous coordinate space — x is already the place, so there's
 * nothing to carry), and drawing asks the mapping directly.
 */
export interface VisiblePlaced<T extends BaseDataPoint = BaseDataPoint> {
  /** The same borrowed point view as `DataManager.getVisibleData`. */
  points: DataView<T>;
  places: number[] | null;
}

/** A half-open index window `[start, end)` into an array. */
export interface IndexRange {
  start: number;
  end: number;
  /** Stable bucket boundary for strategies that group by index. Defaults to 0. */
  originIndex?: number;
}

export interface DecimationStrategy<T extends BaseDataPoint = BaseDataPoint> {
  /**
   * Ask a data manager to retain an x anchor when indices shift after a
   * prepend. An implementation using tiers must keep the anchor bar in each
   * reduced array so its index remains a bucket boundary.
   */
  readonly indexAnchored?: true;
  /**
   * Decimates only the `[range.start, range.end)` window, not all of `data`.
   *
   * Why the window is a range, not an array: if the caller copied the
   * visible range with `slice`, that's a big new array every frame on large
   * data, most of it thrown away unused. Why the range is required, not
   * optional: if it were optional, a strategy that doesn't know the range
   * could decimate the whole array and the type system wouldn't catch it.
   *
   * `screenXScan` is a factory that opens a pass for screen-place lookups
   * (see `Viewport.screenXScan`). A strategy that buckets by x
   * (`M4Decimation`, `LttbDecimation`) has to bucket in that same space when
   * the screen space differs. Each
   * sweep opens one pass — the cursor belongs to that pass, so strategies
   * and frames can't interfere with each other. If absent, x is the screen
   * place (continuous coordinate space, the default).
   *
   * `gapFree` is a fact the caller already knows — if true, this data is
   * guaranteed gap-free, so the window scan that would otherwise find gap
   * boundaries is skipped. Gap presence is a property of the array, not the
   * window, so the viewport cache can't save this for you — only the side
   * that owns the changes can maintain it incrementally.
   *
   * Not merged with `gapless` — that's a static fact about the accessor,
   * this is runtime state of the array.
   *
   * False covers "don't know," not just "has gaps" — the safe default is
   * false. Passing true incorrectly swallows gaps, and the line runs
   * straight across a spot that should have no value.
   */
  decimate(
    data: T[],
    range: IndexRange,
    threshold: number,
    screenXScan?: () => (x: number) => number,
    gapFree?: boolean,
  ): T[];
}

export interface Range {
  min: number;
  max: number;
}

export interface DataManager<T extends BaseDataPoint = BaseDataPoint> {
  /**
   * The whole history, right now. A live borrowed view — don't mutate it
   * (mutation doesn't produce a new reference, which breaks the `Source`
   * contract).
   *
   * This gate is what makes history singly owned — if another place held
   * the same history separately, an update could land on only one of them.
   */
  read(): DataView<T>;

  /**
   * Must be x-ascending. A repeated x is fine unless the accessor declares
   * `uniqueX` (bars do) — then it is a `duplicate-x` rejection.
   *
   * Needed because slicing is a binary search, and data that breaks this
   * gets drawn wrong regardless — the line follows array order and
   * decimation buckets by index.
   */
  setData(data: T[]): void;
  /**
   * Appends the latest data to the end. Checked only within the chunk plus
   * at the seam — a full check is what `setData` (a new dataset) is for,
   * and if one tick's cost scaled with history size, a real-time chart
   * couldn't work. Data that breaks the contract still stops with the same
   * `DataError`.
   */
  append(points: T[]): void;
  /** Prepends past data to the front. Checking rules mirror `append`. */
  prepend(points: T[]): void;
  /**
   * Replaces the head and retains this manager's previously accepted tail
   * starting at `retainedFrom`. This is the narrow landing door for a
   * declared incremental derivation: the manager, not its caller, owns the
   * unvalidated suffix, so only `head` and its seam need a new check.
   *
   * Optional — a manager without it simply keeps declared derivations on
   * the full `setData` route.
   */
  adoptHeadRetainingTail?(head: T[], retainedFrom: number): void;
  /**
   * The reconciliation door, optional the way the landing doors are: a
   * manager without it is handed the merged array through `setData`,
   * which is correct and costs a full validation. With it, `points` are
   * merged by x — every x they name is theirs, every x they do not name
   * keeps what it had — and only the incoming chunk and its seam are
   * checked. `points` must be sorted the way `append`'s are.
   */
  merge?(points: T[]): void;
  /**
   * Swaps out the last point — the tick of a bar in progress.
   * `DataError` if the new point's x is less than the x of the point before
   * it (second-to-last) — or equal to it, when the accessor declares
   * `uniqueX`. If empty, it becomes the first point.
   */
  replaceLast(point: T): void;
  getVisibleData(viewport: Viewport): DataView<T>;
  /**
   * What drawing gets: `getVisibleData`'s points plus the one point just
   * outside the window on each side (so lines reach the plot edges and
   * edge-cut candles still draw), with places. This gate is optional — if
   * absent, drawing gets `getVisibleData` alone and finds places itself,
   * and lines stop at the last point inside the view.
   */
  getVisiblePlaced?(viewport: Viewport): VisiblePlaced<T>;
  /**
   * The range by `CoordinateAccessor.getX` — the material for the x-axis
   * domain. The y-axis domain is up to the `Series` (a single point for a
   * line, a low-to-high span for a candle).
   *
   * `null` if empty — once data is per-series, the x domain is the union of
   * the managers, and if an empty manager returned `{0, 0}`, that zero would
   * bleed into the union.
   */
  getXRange(): Range | null;
}

/**
 * How to decimate these points.
 *
 * Can only be decided where the point type is known — `OhlcAggregation` is
 * a `DecimationStrategy<OHLC>`, so it can't just go anywhere.
 *
 * Anything omitted falls back in this order: a registration override, then
 * the `Series` default, then the wiring's default.
 */
export interface DecimationPolicy<T extends BaseDataPoint = BaseDataPoint> {
  /** How to decimate. If omitted, the wiring decides (`M4Decimation`). */
  strategy?: DecimationStrategy<T>;
  /** Target points per pixel. If omitted, the wiring decides (default 4). */
  pointsPerPixel?: number;
}

/** Merges two. The first wins. Merged field by field — either can be partial. */
export function mergePolicy<T extends BaseDataPoint>(
  strong: DecimationPolicy<T> | undefined,
  weak: DecimationPolicy<T> | undefined,
): DecimationPolicy<T> | undefined {
  if (!strong) return weak;
  if (!weak) return strong;

  return {
    strategy: strong.strategy ?? weak.strategy,
    pointsPerPixel: strong.pointsPerPixel ?? weak.pointsPerPixel,
  };
}

/**
 * Give it a way to read coordinates and it builds you a manager.
 *
 * Every series needs its own manager — a manager instance holds data, so it
 * can't be shared. Hence passing the way to build one, rather than an
 * instance.
 *
 * The ceiling (`maxPoints`) and tiering (`tiered`) are decided by the
 * wiring and can't be changed here. The only thing that should differ per
 * series is **what to decimate and how**.
 */
export interface DataManagerFactory {
  <T extends BaseDataPoint>(
    coordinates: CoordinateAccessor<T>,
    /** If absent, use the wiring's default as is. */
    policy?: DecimationPolicy<T>,
  ): DataManager<T>;
}

/** For strategies like `LttbDecimation` that need coordinates, so it's built via a factory. */
export interface DecimationFactory {
  <T extends BaseDataPoint>(
    coordinates: CoordinateAccessor<T>,
  ): DecimationStrategy<T>;
}
