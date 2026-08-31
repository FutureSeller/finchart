/**
 * A type experiment for `<ChartSeries>` props. Not a runtime test — here
 * **compilation itself is the assertion**. (Since the file isn't
 * `.test.tsx`, vitest ignores it and only `tsc` looks at it.)
 *
 * What it asks: do core `seriesSpec`'s two overloads hold up in JSX too —
 * when a derive is present, do the three (series, derive, coordinates) bind
 * to a single point type, and does a missing `deriveKey` get caught at
 * compile time instead of runtime?
 */

import type { DataView, LineDataPoint, OHLC } from '@finchart/core';
import { candleSeries, LineDataAccessor, lineSeries } from '@finchart/core';
import { ChartSeries } from '../components';

const ma = (source: DataView<OHLC>): LineDataPoint[] =>
  source.map((c) => ({ x: c.x, y: c.close }));

// (1) No derive — TPoint = TSource.
export const price = <ChartSeries<OHLC> series={candleSeries()} />;

// (2) Has a derive — TPoint is inferred from derive's return type.
export const ma20 = (
  <ChartSeries
    series={lineSeries()}
    derive={ma}
    deriveKey={[20]}
    coordinates={new LineDataAccessor()}
  />
);

// ── Everything below must be a compile error ──

export const noKey = (
  // @ts-expect-error: has a derive but no deriveKey
  <ChartSeries series={lineSeries()} derive={ma} />
);

// Caught when the series' and derive's point types don't match (TPoint is
// pinned by series first, so the mismatch is reported on the derive side).
export const mismatched = (
  <ChartSeries
    series={candleSeries()}
    // @ts-expect-error: a derive that produces LineDataPoint on a candle series
    derive={ma}
    deriveKey={[20]}
  />
);
