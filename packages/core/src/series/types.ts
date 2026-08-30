import type { PlotArea } from "../primitives";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DecimationPolicy,
  Range,
} from "../data";
import type { StyleReader, DrawTarget } from "../render";
import type { Scale, XMapping } from "../scale";

/** The stage information Plot hands a series when it draws. */
export interface SeriesContext<T extends BaseDataPoint = BaseDataPoint> {
  data: T[];
  /**
   * Where a point's x lands on screen. Not a `Scale` — a series has no
   * reason to know whether the domain is time or a bar index; ask, and
   * the answer comes back.
   */
  x: XMapping;
  /**
   * `data[i]`'s screen place (a scale domain value) — carried by the
   * decimation cache. `null` or omitted means asking the mapping
   * directly. A series should never read this array itself — go through
   * `screenXAt` instead, so the choice between a place and the mapping
   * lives in one spot and there's no way for a stale place to end up
   * drawn.
   */
  places?: number[] | null;
  yScale: Scale;
  area: PlotArea;
  /**
   * Turns a CSS variable into a resolved value. It receives a way to
   * read, not the element itself, because `getComputedStyle` flushes
   * pending style recalculation — this is built once per render and
   * shared across series. That's why a series never has to know about
   * the DOM at all.
   */
  readStyle: StyleReader;
  /**
   * The full registered dataset (before slicing to the viewport). Used
   * only by `slotWidth`, to re-measure slot width at the current zoom
   * level when the viewport has no neighbor left at all (panning past
   * the end of the data) — drawing itself still only looks at `data`.
   */
  fullData?: readonly T[];
}

/**
 * The one place that turns a point's x into a screen px. When a place
 * accompanies it (`places` + `domainToPixel`), the per-point cost is one
 * arithmetic operation; otherwise it asks the mapping (slower, but
 * correct). The index passed in must belong to `context.data` — places
 * run parallel to that array.
 */
export function screenXAt<T extends BaseDataPoint>(
  context: SeriesContext<T>,
  coordinates: CoordinateAccessor<T>,
): (index: number, point: T) => number {
  const places = context.places;
  const toPx = context.x.domainToPixel;
  if (places != null && toPx !== undefined) {
    return (index) => toPx(places[index]);
  }
  const mapping = context.x;
  return (_index, point) => mapping.toPixel(coordinates.getX(point));
}

/**
 * A data representation that can be swapped out on the same stage (Plot).
 *
 * The grid, axes, pan/zoom, and layers belong to Plot, so they stay put
 * even when the series changes. A series is responsible for exactly two
 * things — how much of the y axis it occupies, and how it draws.
 */
export interface Series<T extends BaseDataPoint = BaseDataPoint> {
  /**
   * The range this representation occupies on the y axis. A line is a
   * single point, so min === max, but a candle occupies a low-to-high
   * span — that can't be expressed as a single number, so it returns a
   * `Range`.
   *
   * `null` when there's nothing to measure — returning `{ min: 0, max: 0 }`
   * would let a series whose data hasn't arrived yet drag the value axis
   * down to 0.
   */
  valueExtent(data: T[]): Range | null;

  draw(target: DrawTarget, context: SeriesContext<T>): void;

  /**
   * The decimation policy fit for this representation. Omitted means
   * wiring decides — this is a series's third responsibility. A candle
   * can't be thinned, only aggregated (thinning loses the interval's
   * high and low); one per pixel is the ceiling. A registration can
   * override this (`SeriesRegistration.decimation`).
   */
  readonly decimation?: DecimationPolicy<T>;

  /**
   * How to read coordinates from its own point. Omitted means reading
   * `x` and `y` directly. It's here for the same reason as `decimation`
   * — a candle's value is `close` (`OHLC` has no `y`), and only the
   * candle knows that.
   */
  readonly coordinates?: CoordinateAccessor<T>;
}
