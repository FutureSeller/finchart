/**
 * A type experiment for seriesSpec — the compile itself is the assertion,
 * not the runtime (only tsc looks at this file). What's being asked: can
 * an array whose element derived-point types differ be written as one
 * type, without `any`?
 */

import type { DataView, LineDataPoint, OHLC } from "../../data";
import { LineDataAccessor } from "../../data";
import { candleSeries } from "../../series";
import { lineSeries } from "../../series/line-series";
import { type SeriesSpec, seriesSpec } from "../../registration";

const ma = (source: DataView<OHLC>): LineDataPoint[] =>
  source.map((c) => ({ x: c.x, y: c.close }));

// (1) No derivation — series only. TPoint is inferred as TSource.
const price = seriesSpec<OHLC>({ id: "price", series: candleSeries() });

// (2) With derivation — TPoint is captured from derive's return type,
//     and series and coordinates are bound to it.
const ma20 = seriesSpec({
  id: "ma20",
  series: lineSeries(),
  derive: ma,
  deriveKey: [20],
  coordinates: new LineDataAccessor(),
});

// * The key question: do these two, with different point types, fit into **one array**?
export const specs: SeriesSpec<OHLC>[] = [price, ma20];

// ── everything below must be a compile error (each @ts-expect-error is the assertion) ──

// Caught when derive's return type disagrees with the series' point type.
// @ts-expect-error: Series<LineDataPoint> with a derive that produces OHLC
seriesSpec({ id: "x", series: lineSeries(), derive: (s: DataView<OHLC>) => [...s], deriveKey: [] });

/**
 * Caught when coordinates has a different point type. The point type is
 * not pinned by hand — leaving it to inference means no overload matches,
 * so the error lands at the call site and the property's @ts-expect-error
 * goes unused.
 */
seriesSpec<OHLC, LineDataPoint>({
  id: "y",
  series: lineSeries(),
  derive: ma,
  deriveKey: [20],
  // @ts-expect-error: an OHLC-shaped value where CoordinateAccessor<LineDataPoint> belongs
  coordinates: new (class {
    getX(p: OHLC) {
      return Number(p.x);
    }
    getY(p: OHLC) {
      return p.close;
    }
  })(),
});

// Caught when derive is present but deriveKey is missing (at compile time, not a runtime throw).
// @ts-expect-error: deriveKey is missing
seriesSpec({ id: "z", series: lineSeries(), derive: ma });

// A spec with a different source type cannot go in the same array.
const lineOnly = seriesSpec<LineDataPoint>({ id: "l", series: lineSeries() });
// @ts-expect-error: SeriesSpec<LineDataPoint> is not a SeriesSpec<OHLC>
export const mixed: SeriesSpec<OHLC>[] = [price, lineOnly];

// ── registration type: three branches, so an invalid combination cannot be written (2026-08-09) ──

import type { Source } from "../../data";
import type { SeriesRegistration } from "../../registration";

declare const candles: OHLC[];
declare const points: LineDataPoint[];
declare const feed: Source<LineDataPoint>;

/** (1) The plain-draw branch — series and data share the same point type. */
const plain: SeriesRegistration<LineDataPoint> = {
  series: lineSeries(),
  data: points,
};

/** (2) Derived — only here do the source and the drawn point diverge. */
const derived: SeriesRegistration<OHLC, LineDataPoint> = {
  series: lineSeries(),
  data: candles,
  derive: ma,
};

/** (3) Input — does not own the data. */
const fromInput: SeriesRegistration<LineDataPoint> = {
  series: lineSeries(),
  input: feed,
};

// The three branches export no names of their own — `SeriesRegistration` alone is the public surface.
void [plain, derived, fromInput];

/** This is the reason this split exists — with a flat interface, this
 * line used to pass the compile, and at runtime the line series read
 * OHLC's .y and got undefined. */
// @ts-expect-error: candles cannot feed a line series without a derive
const wrong: SeriesRegistration<OHLC> = { series: lineSeries(), data: candles };
void wrong;

// @ts-expect-error: giving input rules out also giving data
const both: SeriesRegistration<LineDataPoint> = {
  series: lineSeries(),
  input: feed,
  data: points,
};
void both;

// @ts-expect-error: giving input rules out also giving derive
const inputAndDerive: SeriesRegistration<OHLC, LineDataPoint> = {
  series: lineSeries(),
  input: feed,
  derive: ma,
};
void inputAndDerive;
