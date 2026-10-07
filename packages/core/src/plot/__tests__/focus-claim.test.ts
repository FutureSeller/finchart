/**
 * The chart wires its focus contest through `claimFocusArea`. The contest's
 * own rules (an exclusive bottom edge, degenerate or throwing neighbours,
 * release) are pinned in `interaction/__tests__/focus-claims.test.ts`; this
 * only checks that claims made through the chart meet in one contest.
 */
import { expect, it } from "vitest";
import type { OHLC } from "../../data";
import { candleSeries } from "../../series";
import { createPlotModel } from "../model";

const candles: OHLC[] = Array.from({ length: 10 }, (_, i) => ({
  x: i,
  open: 100,
  high: 104,
  low: 98,
  close: 102,
}));

it("claims made through the chart contest each other until released", () => {
  const { plot } = createPlotModel({
    size: { width: 400, height: 300 },
    series: { series: candleSeries(), data: candles },
    config: { showGrid: false },
  });
  const other = plot.claimFocusArea(() => ({ left: 0, right: 100, top: 0, bottom: 50 }));
  const mine = plot.claimFocusArea(() => null);

  expect(mine.contestedAt({ x: 10, y: 10 })).toBe(true);
  expect(mine.contestedAt({ x: 10, y: 60 })).toBe(false);

  other.release();
  expect(mine.contestedAt({ x: 10, y: 10 })).toBe(false);

  mine.release();
  plot.destroy();
});
