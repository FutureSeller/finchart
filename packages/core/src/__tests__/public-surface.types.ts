/**
 * Things that must not be on the public surface — the compile itself is the
 * assertion (this isn't a `.test.ts`; only tsc looks at it). Where
 * `public-api.test.ts` guards the barrel's list of exports, this file nails
 * down, with reasons, the names that must never be accidentally added to
 * that list.
 */

import type * as Public from "../index";

/**
 * `Entry`/`TypedEntry` — this is where the point-type seal would leak. The
 * contract `feed`/`swapSeries` rely on (same id means same point type, etc.)
 * can't be written in TS, so it's confined to the call site instead — if a
 * consumer could reach it directly, the seal breaks. A consumer only ever
 * needs `SeriesSpec` and `seriesSpec()`.
 */
// @ts-expect-error: Entry is not part of the public contract
export type NoEntry = Public.Entry;

// @ts-expect-error: TypedEntry is not part of the public contract
export type NoTypedEntry = Public.TypedEntry;

/**
 * `Pane` — what's public isn't the class but a narrowed face of it. The
 * four members below are wiring for a single render pass (placing the area,
 * drawing, collecting badges, and the x used for bar-index mapping), so
 * calling them from outside means the next frame can overwrite state, or a
 * command leaks outside a commit.
 */
type PublicPane = Public.Pane;

// @ts-expect-error: setArea is a slot the stage writes every frame
export type NoSetArea = PublicPane["setArea"];

// @ts-expect-error: draw must only be called from inside a commit
export type NoDraw = PublicPane["draw"];

// @ts-expect-error: collectAxisBadges is wiring for the axis-label path
export type NoCollectBadges = PublicPane["collectAxisBadges"];

// @ts-expect-error: xValuesPerSeries feeds bar-index mapping
export type NoXValues = PublicPane["xValuesPerSeries"];

/** The members that are meant to be used must remain — this checks that the assertions above are not overly broad. */
export type PaneKeeps = Pick<
  PublicPane,
  | "addSeries"
  | "addDecoration"
  | "applyOptions"
  | "probe"
  | "getSeries"
  | "setValueDomain"
  | "setYScale"
  | "syncSeries"
  | "area"
  | "yScale"
  | "flex"
  | "autoScale"
>;

/** A pane is never constructed directly — you use the one the stage hands you. */
// @ts-expect-error: the constructor is not public
export type NoPaneConstructor = InstanceType<typeof Public.Pane>;

/** If the whole class were accidentally re-exported as a barrel, the assertions above would be silently defeated — this pins that down too. */
export type SpecIsPublic = Public.SeriesSpec;
export type SpecFactory = typeof Public.seriesSpec;

/**
 * The opposite direction: if a sibling exists, this one should stand
 * alongside it. These are names that were missing — `AreaSeriesOptions` was
 * the odd one out while its three siblings (`Line`, `Baseline`, `Histogram`)
 * were in the barrel, and `PaneMaximizeOptions` only had a return type
 * exported with no parameter type, so a consumer wrapping that extension
 * had no way to type the wrapper's props.
 */
export type AreaOptionsIsPublic = Public.AreaSeriesOptions<{ x: number }>;
export type PaneMaximizeOptionsIsPublic = Public.PaneMaximizeOptions;

/** The door for both parity features — the options object is public. */
export type CandleDrawIsPublic = Public.CandleDrawOptions;
export type StepLineIsPublic = typeof Public.stepLineSeries;
