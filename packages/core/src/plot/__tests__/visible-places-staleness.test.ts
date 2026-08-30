/**
 * Staleness in shared placement — if a rebuild shifts placement, drawing
 * must use the new placement. The trap: series A's place cache stays
 * valid as long as A's data is unchanged, but series B's setData
 * rewriting the merged x list shifts A's places (bar indices) anyway.
 * xEpoch is the key that lets that staleness be discarded, and this test
 * locks down the whole chain — rebuild -> increment -> cache eviction.
 * The oracle is a stage that runs the same sequence with no place cache at all.
 */
import { expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { barIndexX } from "../../scale";
import type { Scale, XMapping } from "../../scale";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel } from "../model";

const candles = (xs: number[]): OHLC[] =>
  xs.map((x) => ({ x, open: 100, high: 104, low: 98, close: 102 }));

function run(createXMapping: (scale: Scale) => XMapping) {
  const model = createPlotModel<OHLC>({
    size: { width: 400, height: 300 },
    // Even x's only — once an odd x is inserted later, the existing bars' merged indices shift.
    series: { series: candleSeries(), data: candles([0, 2, 4, 6, 8]) },
    config: { showGrid: false },
    deps: { createXMapping },
  });
  const line = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data: [] as LineDataPoint[],
  });
  model.plot.render(); // The place cache fills in here — before any odd x arrives.

  // An in-between bar was inserted — every existing candle's merged index shifts.
  line.setData([1, 3, 5].map((x) => ({ x, y: 100 })));
  model.plot.render();

  return model.commands();
}

it("does not draw from a stale place even when another series' setData shifts it", () => {
  const placed = run(barIndexX);
  const fallback = run((scale) => ({
    ...barIndexX(scale),
    // Removes the placement door — `screenXAt`/`slotWidth` fall back to `toPixel`.
    // That path asks fresh per point and can never go stale, so it's the source of truth for the answer.
    domainToPixel: undefined,
    scanToPixel: undefined,
  }));

  expect(placed).toEqual(fallback);
});
