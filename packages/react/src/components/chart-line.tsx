import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataView,
  LineDataPoint,
  LineSeriesStyleOverrides,
  Source,
} from '@finchart/core';
import { defaultCoordinates, LineSeries } from '@finchart/core';
import { useMemo } from 'react';
import { ChartSeries } from './chart-series';

interface LineLook {
  /** Display name — the legend and tooltip refer to it by this. */
  name?: string;
  /**
   * `false` for a series drawn for the eye rather than read out (a band
   * fill, a marker row) — the tooltip and legend leave it out. Like `name`,
   * fixed at registration: change the React `key` to change it.
   */
  readout?: boolean;
  /**
   * The line's look, in the imperative lane's override shape — the same
   * `LineSeriesStyleOverrides` that `lineSeries(style)` takes, so what you
   * learn in one lane holds in the other: `{ line: { color, width,
   * dashArray }, point: { radius, color } }`. `line.color` is also the
   * legend swatch. Omitted fields fall back to the CSS variables
   * (`--chart-line`, `--chart-point-radius`, …).
   */
  style?: LineSeriesStyleOverrides;
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
  /**
   * Reads the derived points; defaults to x/y. Changing this reference
   * reinstalls the registration and derivation; pin custom accessors.
   */
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
  fallback: CoordinateAccessor<BaseDataPoint>,
): CoordinateAccessor<T> {
  return given ?? fallback;
}

/**
 * Connects points with a line. No need to build a series object yourself.
 *
 * ```tsx
 * // sma20: (source: DataView<OHLC>) => LineDataPoint[] — a derivation is just a function (see README)
 * <ChartLine style={{ line: { color: "#f59e0b" } }} derive={sma20} deriveKey={[20]} />
 * ```
 *
 * **Color is an argument.** Keep the theme (the default color for every
 * line) in a CSS variable, but give something that varies per series —
 * "this indicator is orange" — here instead: there's no element on the
 * canvas, so CSS has no way to pick out a single series. The shape is the
 * imperative lane's — `style` here is what `lineSeries(style)` takes.
 *
 * A new series object gets built every render, but the derivation cache
 * survives it → see `<ChartSeries>`.
 */
export function ChartLine<
  TSource extends BaseDataPoint,
  TPoint extends BaseDataPoint = TSource,
>(props: ChartLineProps<TSource, TPoint>) {
  const { style } = props;
  const defaults = useMemo(defaultCoordinates<BaseDataPoint>, []);
  // The registration's color is the legend swatch — the stroke color doubles as it.
  const color = style?.line?.color;

  if (props.input) {
    return (
      <ChartSeries<TSource, LineDataPoint>
        series={new LineSeries<LineDataPoint>({ coordinates: defaults, style })}
        input={props.input}
        name={props.name}
        color={color}
        readout={props.readout}
      />
    );
  }

  if (props.derive) {
    const coordinates = coordinatesOf<TPoint>(props.coordinates, defaults);

    return (
      <ChartSeries<TSource, TPoint>
        series={new LineSeries({ coordinates, style })}
        data={props.data}
        name={props.name}
        color={color}
        readout={props.readout}
        derive={props.derive}
        deriveKey={props.deriveKey}
        coordinates={coordinates}
      />
    );
  }

  return (
    <ChartSeries<TSource>
      series={new LineSeries({ coordinates: coordinatesOf(props.coordinates, defaults), style })}
      data={props.data}
      name={props.name}
      color={color}
      readout={props.readout}
    />
  );
}
