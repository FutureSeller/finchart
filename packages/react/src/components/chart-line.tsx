import type { BaseDataPoint, CoordinateAccessor, DataView, LineDataPoint, Source } from '@finchart/core';
import { defaultCoordinates, LineSeries } from '@finchart/core';
import { ChartSeries } from './chart-series';

interface LineLook {
  /** Display name — the legend and tooltip refer to it by this. */
  name?: string;
  /** Line color. Falls back to the CSS variable (`--chart-line`) or the default when omitted. */
  color?: string;
  /** Line width (px). */
  width?: number;
  /** Point radius (px). 0 draws no points. */
  pointRadius?: number;
  /** Point color. Left unset, it goes its own way from the line color — falls back to the CSS variable (`--chart-point`). */
  pointColor?: string;
}

interface PlainLineProps<TSource extends BaseDataPoint> extends LineLook {
  /** The data this line draws. Falls back to what's passed down from above when omitted. */
  data?: TSource[];
  /** How to read coordinates from a point. Falls back to `x`/`y` when omitted. */
  coordinates?: CoordinateAccessor<TSource>;
  derive?: undefined;
  deriveKey?: undefined;
  input?: undefined;
}

interface InputLineProps extends LineLook {
  /**
   * Draws points someone else built — the computed-node branch. **The
   * reference is the identity**: pin it with `useMemo`. An indicator
   * factory's output (`movingAverage(...).out.ma`) is exactly this shape.
   */
  input: Source<LineDataPoint>;
  data?: undefined;
  derive?: undefined;
  deriveKey?: undefined;
  coordinates?: undefined;
}

interface DerivedLineProps<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint,
> extends LineLook {
  input?: undefined;
  /** The source the derivation receives. Falls back to what's passed down from above when omitted. */
  data?: TSource[];
  /** Builds the points to draw from the whole source — an indicator like a moving average. */
  derive: (source: DataView<TSource>) => TPoint[];
  /** The condition for re-running the derivation. Follows the same rule as a `useMemo` dependency array. */
  deriveKey: readonly unknown[];
  /** How to read coordinates from the points `derive` built. Falls back to `x`/`y` when omitted. */
  coordinates?: CoordinateAccessor<TPoint>;
}

export type ChartLineProps<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint = TSource,
> =
  | PlainLineProps<TSource>
  | DerivedLineProps<TSource, TPoint>
  | InputLineProps;

/** Not giving coordinates means the points have `x`/`y` — the same assumption as the core's default accessor. */
function coordinatesOf<T extends BaseDataPoint>(
  given: CoordinateAccessor<T> | undefined,
): CoordinateAccessor<T> {
  return given ?? defaultCoordinates<T>();
}

/**
 * Connects points with a line. No need to build a series object yourself.
 *
 * ```tsx
 * // sma20: (source: DataView<OHLC>) => LineDataPoint[] — a derivation is just a function (see README)
 * <ChartLine color="#f59e0b" derive={sma20} deriveKey={[20]} />
 * ```
 *
 * **Color is an argument.** Keep the theme (the default color for every
 * line) in a CSS variable, but give something that varies per series —
 * "this indicator is orange" — here instead: there's no element on the
 * canvas, so CSS has no way to pick out a single series.
 *
 * A new series object gets built every render, but the derivation cache
 * survives it → see `<ChartSeries>`.
 */
export function ChartLine<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint = TSource,
>(props: ChartLineProps<TSource, TPoint>) {
  const { color, width, pointRadius, pointColor } = props;
  const style = {
    line: { ...(color !== undefined && { color }), ...(width !== undefined && { width }) },
    point: {
      ...(pointColor !== undefined && { color: pointColor }),
      ...(pointRadius !== undefined && { radius: pointRadius }),
    },
  };

  if (props.input) {
    return (
      <ChartSeries<TSource, LineDataPoint>
        series={new LineSeries<LineDataPoint>({ coordinates: defaultCoordinates(), style })}
        input={props.input}
        name={props.name}
        color={color}
      />
    );
  }

  if (props.derive) {
    const coordinates = coordinatesOf<TPoint>(props.coordinates);

    return (
      <ChartSeries<TSource, TPoint>
        series={new LineSeries({ coordinates, style })}
        data={props.data}
        name={props.name}
        color={color}
        derive={props.derive}
        deriveKey={props.deriveKey}
        coordinates={coordinates}
      />
    );
  }

  return (
    <ChartSeries<TSource>
      series={new LineSeries({ coordinates: coordinatesOf(props.coordinates), style })}
      data={props.data}
      name={props.name}
      color={color}
    />
  );
}
