import type {
  BaseDataPoint,
  CoordinateAccessor,
  Series,
  SeriesSpec,
  Source,
} from '@finchart/core';
import { seriesSpec } from '@finchart/core';
import { useEffect, useId, useRef } from 'react';
import { useChartData, useSeriesCollector } from './chart-context';

/** What every variant accepts. */
interface CommonSeriesProps<TSource extends BaseDataPoint> {
  /**
   * The data this series draws. Falls back to what's passed down from
   * above when omitted (`<ChartData>` or `<ChartContainer data>`).
   *
   * Since the registration owns the data, each series can draw something
   * different.
   */
  data?: TSource[];

  /** Display name — the legend and tooltip refer to it by this. Belongs to the registration, not the series. */
  name?: string;
  /** Display color swatch — the dot in the legend. Separate from the color it's drawn in. */
  color?: string;
}

interface PlainSeriesProps<TSource extends BaseDataPoint>
  extends CommonSeriesProps<TSource> {
  series: Series<TSource>;
  derive?: undefined;
  deriveKey?: undefined;
  coordinates?: undefined;
  input?: undefined;
}

interface DerivedSeriesProps<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
> extends CommonSeriesProps<TSource> {
  series: Series<TPoint>;
  /**
   * Builds the points to draw from the whole source. Keeps a look-back
   * indicator like a moving average from cutting off at the edge of the
   * screen.
   */
  derive: (source: TSource[]) => TPoint[];
  /**
   * The condition for re-running the derivation. Follows the same rule as
   * a `useMemo` dependency array.
   *
   * Required whenever there's a `derive` — without it, every update
   * recalculates everything, and at 100k points with four indicators that
   * alone is 7.23ms (half the frame budget).
   */
  deriveKey: readonly unknown[];
  /** How to read coordinates from the points `derive` built. Falls back to x/y when omitted. */
  coordinates?: CoordinateAccessor<TPoint>;
  input?: undefined;
}

interface InputSeriesProps<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
> extends CommonSeriesProps<TSource> {
  series: Series<TPoint>;
  /**
   * Draws points someone else built — a computed node's branch
   * (`node.out.*`) goes here. Doesn't own the data, so it can't coexist
   * with `data` or `derive`.
   *
   * **The reference is the identity** — building a new node every render
   * rebuilds every render. Pinning it with `useMemo` is the contract.
   */
  input: Source<TPoint>;
  /** How to read coordinates from the points `input` produced. Falls back to x/y when omitted. */
  coordinates?: CoordinateAccessor<TPoint>;
  data?: undefined;
  derive?: undefined;
  deriveKey?: undefined;
}

/**
 * **One of three** ways to get points — handed in (`data`), derived
 * (`derive`), or built by someone else (`input`). **The branches are
 * mutually exclusive and can't be mixed.**
 *
 * TypeScript catches giving two at once, but the message is indirect:
 * give both `input` and `derive` and you get *"Type '(s: OHLC[]) =>
 * LineDataPoint[]' is not assignable to type 'undefined'"* — it points at
 * the right field, but the reason has to be inferred. That's the nature
 * of a discriminated union, so the message itself can't be improved; this
 * sentence shows up on hover instead.
 */
export type ChartSeriesProps<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint = TSource,
> =
  | PlainSeriesProps<TSource>
  | DerivedSeriesProps<TSource, TPoint>
  | InputSeriesProps<TSource, TPoint>;

function toSpec<TSource extends BaseDataPoint, TPoint extends BaseDataPoint>(
  id: string,
  props: ChartSeriesProps<TSource, TPoint>,
  data: TSource[],
): SeriesSpec<TSource> {
  // In every branch, `series` and `coordinates` are tied to `TPoint`.
  // Thanks to the narrowed union, neither side needs an `as`.
  if (props.input) {
    return seriesSpec<TPoint>({
      id,
      series: props.series,
      input: props.input,
      name: props.name,
      color: props.color,
      coordinates: props.coordinates,
    });
  }

  return props.derive
    ? seriesSpec<TSource, TPoint>({
        id,
        series: props.series,
        data,
        name: props.name,
        color: props.color,
        derive: props.derive,
        deriveKey: props.deriveKey,
        coordinates: props.coordinates,
      })
    : seriesSpec<TSource>({
        id,
        series: props.series,
        data,
        name: props.name,
        color: props.color,
      });
}

/**
 * Mounts a series onto whichever pane it's currently in. Outside a
 * `<ChartPane>`, it goes to `mainPane`.
 *
 * **No need to hold a stable reference.** Building a new series object
 * every render is fine — the derivation cache survives it, and
 * `deriveKey` decides whether to recompute. The draw order is JSX order,
 * not registration order.
 *
 * The identity the core asks for (`SeriesSpec.id`) is **exactly this
 * component instance.** Nobody assigns it by hand — staying in the same
 * slot means being the same series, and whether the slot changed is
 * something React has already decided with `key`.
 */
export function ChartSeries<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint = TSource,
>(props: ChartSeriesProps<TSource, TPoint>) {
  const collector = useSeriesCollector<TSource>('ChartSeries');
  const inherited = useChartData<TSource>();
  const id = useId();
  // The prop wins when given. Otherwise, whatever came down from above.
  const spec = toSpec(id, props, props.data ?? inherited);

  // This is the only place that knows the JSX order — effects run in mount order.
  collector.place(spec);

  // What to hand over when the effect reattaches. `place` already applied it to the list.
  const latest = useRef(spec);
  latest.current = spec;

  // Entering and leaving the list.
  useEffect(() => {
    collector.keep(latest.current);
    collector.flush();

    return () => {
      collector.remove(id);
      collector.flush();
    };
  }, [collector, id]);

  /**
   * The case where something already mounted has its content changed — a
   * new series or a new `deriveKey`.
   *
   * `place` only swaps the collector during the render phase, and the
   * effect above doesn't re-run since its deps are unchanged. **When
   * neither the pane nor the container re-renders and only the component
   * in between does, this is the only place left to hand it over to the
   * chart.** `syncSeries` doesn't notify when nothing changed, so calling
   * it every time is cheap.
   */
  useEffect(() => {
    collector.flush();
  });

  return null;
}
