/**
 * The focus mechanism's invariants — the core's own witness. The sole
 * witness for focusAreaOf/containsFocus used to be `tools`, and `tools`
 * reads the core from dist, so mutations in the core source all survived
 * green. These two tests are the core's own witness, one that never goes
 * through dist.
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

function mounted() {
  return createPlotModel({
    size: { width: 400, height: 300 },
    series: { series: candleSeries(), data: candles },
    config: { showGrid: false },
  });
}

it("the bottom edge is exclusive — the 1px boundary belongs to the neighbor below", () => {
  const { plot } = mounted();
  const upper = plot.claimFocusArea(() => ({
    left: 0,
    right: 100,
    top: 0,
    bottom: 50,
  }));
  const lower = plot.claimFocusArea(() => ({
    left: 0,
    right: 100,
    top: 50,
    bottom: 100,
  }));

  // y=50 belongs to the lower area: the upper area must yield it exclusively so the lower one can contest it.
  expect(upper.contestedAt({ x: 10, y: 50 })).toBe(true); // lower contests it
  expect(lower.contestedAt({ x: 10, y: 50 })).toBe(false); // upper yields it
  // Just above the boundary belongs to the upper area — the control case.
  expect(lower.contestedAt({ x: 10, y: 49 })).toBe(true);

  upper.release();
  lower.release();
});

it("a degenerate area contests nothing — not even a zero-width vertical line", () => {
  const { plot } = mounted();
  const degenerate = plot.claimFocusArea(() => ({
    left: 40,
    right: 40, // zero width — the entire vertical line at x=40 must not be contested
    top: 0,
    bottom: 100,
  }));
  const witness = plot.claimFocusArea(() => ({
    left: 200,
    right: 300,
    top: 0,
    bottom: 100,
  }));

  expect(witness.contestedAt({ x: 40, y: 50 })).toBe(false);

  degenerate.release();
  witness.release();
});
