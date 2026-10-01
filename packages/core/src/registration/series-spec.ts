/**
 * One series carried in a declarative spec array — a registration closed
 * over its point type, with an identity (`id`) on the outside for a pane
 * to reconcile against.
 */
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataManagerFactory,
  DataView,
  Source,
} from "../data";
import type { Series } from "../series";
import { checkDisplay, createEntry } from "./entry";
import type { Entry, SeriesId, SeriesRegistration } from "./entry";

/**
 * **The point type survives in only one place: `data`.** Each array element
 * can have a different derived-result type, so a single element type can't
 * express it — the same move `Entry` makes. `seriesSpec()` seals off that
 * type, leaving outside only the identity (`id`) and whatever an update
 * verdict needs.
 *
 * `TSource` sits **only in covariant position** (`data`), so a
 * `SeriesSpec<OHLC>` can be dropped straight into a `SeriesSpec` slot. This
 * is the property a pane relies on when it takes the list.
 */
export interface SeriesSpec<TSource extends BaseDataPoint = BaseDataPoint> {
  /** The identity an update matches against. An index would quietly get this wrong on a conditional insert. */
  readonly id: string;

  /**
   * What gets swapped in when the identity matches. The point type is erased.
   *
   * **A Series must be stateless** — swapping it loses any internal state.
   * Things that carry state (a crosshair, say) go through decorations, not series.
   */
  readonly series: SeriesId;

  /** The values that decide whether to rerun the derivation. `undefined` when there's no derivation. */
  readonly deriveKey?: readonly unknown[];

  /**
   * The data this series draws. **A changed reference counts as an update.**
   *
   * Passing the list again can't distinguish "replace" from "prepend past
   * data," so what arrives here is **always a replacement**. It doesn't
   * refit, though — in the declarative world, growing data means infinite
   * scroll, and the window shouldn't jump when that happens. Use the
   * imperative `SeriesHandle` when you need incremental updates and refitting.
   *
   * Same handoff as `SeriesHandle.setData`: the array is copied, the points
   * are kept as given — a point isn't edited after it's been passed in.
   */
  readonly data?: TSource[];

  /**
   * Input for a registration that draws someone else's output — the
   * declarative world's third mode. **The reference is the identity** —
   * changing it rebuilds the entry. It doesn't own data, so it can't
   * coexist with `data` or `deriveKey`.
   */
  readonly input?: Source<BaseDataPoint>;

  /** What the series is shown as — re-read on every sync, so a changed name or colour reaches the legend. */
  readonly name?: string;
  readonly color?: string;
  readonly zIndex?: number;
  readonly readout?: boolean;

  /** What a Pane uses to seal this into an Entry. The point type is concrete only inside this function. */
  readonly toEntry: (createDataManager: DataManagerFactory) => Entry;
}

/**
 * Turns one registration into a spec closed over TPoint.
 *
 * Two overloads, because: without a derivation, TPoint is just TSource, so
 * `series` alone suffices; with one, the three of series, derive, and
 * coordinates need to be tied together by TPoint. The call site infers that
 * relationship, so no `as` is needed.
 */
export function seriesSpec<TSource extends BaseDataPoint>(spec: {
  id: string;
  series: Series<TSource>;
  data?: TSource[];
  name?: string;
  color?: string;
  zIndex?: number;
  readout?: boolean;
}): SeriesSpec<TSource>;

export function seriesSpec<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
>(spec: {
  id: string;
  series: Series<TPoint>;
  data?: TSource[];
  name?: string;
  color?: string;
  zIndex?: number;
  readout?: boolean;
  derive: (source: DataView<TSource>) => TPoint[];
  /** Required whenever there's a derivation — without it, everything recomputes on every update. */
  deriveKey: readonly unknown[];
  coordinates?: CoordinateAccessor<TPoint>;
}): SeriesSpec<TSource>;

export function seriesSpec<TPoint extends BaseDataPoint>(spec: {
  id: string;
  series: Series<TPoint>;
  /** Draws points someone else made — a computed node's branch (`node.out.*`) arrives here. */
  input: Source<TPoint>;
  name?: string;
  color?: string;
  zIndex?: number;
  readout?: boolean;
  coordinates?: CoordinateAccessor<TPoint>;
}): SeriesSpec<never>;

/**
 * The implementation signature **takes the registration type as is.**
 *
 * Since the overloads already sorted out whether `deriveKey` is required,
 * there's no need to re-discriminate the branch here — pass the spec
 * straight to `createEntry` and each branch carries its own type along.
 * Having `id` and `deriveKey` tacked on doesn't stop it from passing as a
 * registration.
 */
export function seriesSpec<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
>(
  spec: { id: string; deriveKey?: readonly unknown[] } & SeriesRegistration<
    TSource,
    TPoint
  >,
): SeriesSpec<TSource> {
  checkDisplay(spec, "seriesSpec");
  return {
    id: spec.id,
    series: spec.series,
    data: spec.data,
    deriveKey: spec.deriveKey,
    input: spec.input,
    name: spec.name,
    color: spec.color,
    zIndex: spec.zIndex,
    readout: spec.readout,
    toEntry: (createDataManager) =>
      createEntry<TSource, TPoint>(spec, createDataManager, "seriesSpec"),
  };
}
