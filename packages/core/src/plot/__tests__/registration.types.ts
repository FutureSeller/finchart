/**
 * The registration's point-type lock — the compile itself is the
 * assertion (only tsc looks at this file). What's being asked: is there
 * any path left where a mismatched series and data can reach the stage?
 * If even one place drops the point type, the whole discrimination scheme is defeated.
 */

import type { OHLC } from "../../data";
import { lineSeries } from "../../series";
import { Plot } from "../plot";
import { createPlotModel } from "../model";
import { testBrowserDeps } from "../../__tests__/dom-fakes";

const candles: OHLC[] = [{ x: 0, open: 1, high: 2, low: 0, close: 1 }];
const size = { width: 100, height: 100 };
const config = {
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  showGrid: true,
};

const plot = new Plot({ deps: testBrowserDeps(), config, size });

// ── everything below must be a compile error ──

// (1) The constructor doesn't accept a series at all. Back when it did,
//     it was non-generic, so `{ line series + candles }` passed right through.
new Plot({
  deps: testBrowserDeps(),
  config,
  size,
  // @ts-expect-error: a series is only attached through addSeries
  series: { series: lineSeries(), data: candles },
});

// (2) The attach path (a method generic) catches a mismatched pair.
// @ts-expect-error: Series<LineDataPoint> with OHLC[]
plot.mainPane.addSeries({ series: lineSeries(), data: candles });

// (3) The swap path is the same.
// @ts-expect-error: Series<LineDataPoint> with OHLC[]
plot.setSeries({ series: lineSeries(), data: candles });

// (4) So is the headless entry point.
// @ts-expect-error: Series<LineDataPoint> with OHLC[]
createPlotModel({ size, series: { series: lineSeries(), data: candles } });
