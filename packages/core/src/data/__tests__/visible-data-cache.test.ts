import { describe, expect, it } from "vitest";
import { LineDataAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import { M4Decimation } from "../decimation";
import type { DecimationStrategy, LineDataPoint, Viewport } from "../types";

/** Counts how many times the decimation was recomputed. */
class Counting implements DecimationStrategy<LineDataPoint> {
  calls = 0;
  private inner = new M4Decimation<LineDataPoint>(new LineDataAccessor());

  decimate(
    data: LineDataPoint[],
    range: { start: number; end: number },
    threshold: number,
  ): LineDataPoint[] {
    this.calls += 1;
    return this.inner.decimate(data, range, threshold);
  }
}

function series(count: number): LineDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: i, y: i % 17 }));
}

function setup() {
  const decimation = new Counting();
  const dataManager = new SimpleDataManager<LineDataPoint>({
    decimation,
    coordinates: new LineDataAccessor(),
  });

  dataManager.setData(series(10_000));
  return { dataManager, decimation };
}

const viewport = (overrides: Partial<Viewport> = {}): Viewport => ({
  startX: 0,
  endX: 5000,
  width: 800,
  height: 600,
  ...overrides,
});

describe("visible data cache", () => {
  it("should not recompute for the same viewport", () => {
    const { dataManager, decimation } = setup();

    dataManager.getVisibleData(viewport());
    dataManager.getVisibleData(viewport());
    dataManager.getVisibleData(viewport());

    expect(decimation.calls).toBe(1);
  });

  it("should give the same answer from the cache", () => {
    const { dataManager } = setup();

    const first = dataManager.getVisibleData(viewport());
    const second = dataManager.getVisibleData(viewport());

    expect(second).toEqual(first);
  });

  it("should recompute when the window moves", () => {
    const { dataManager, decimation } = setup();

    dataManager.getVisibleData(viewport());
    dataManager.getVisibleData(viewport({ startX: 100, endX: 5100 }));

    expect(decimation.calls).toBe(2);
  });

  it("should recompute when the window zooms", () => {
    const { dataManager, decimation } = setup();

    dataManager.getVisibleData(viewport());
    dataManager.getVisibleData(viewport({ endX: 2500 }));

    expect(decimation.calls).toBe(2);
  });

  it("should recompute when the plot gets wider", () => {
    const { dataManager, decimation } = setup();

    dataManager.getVisibleData(viewport());
    dataManager.getVisibleData(viewport({ width: 1600 }));

    expect(decimation.calls).toBe(2);
  });

  it("should not recompute when only the height changes", () => {
    const { dataManager, decimation } = setup();

    dataManager.getVisibleData(viewport());
    dataManager.getVisibleData(viewport({ height: 300 }));

    // Height doesn't factor into slicing or the point budget.
    expect(decimation.calls).toBe(1);
  });

  it("should recompute after the data changes", () => {
    const { dataManager, decimation } = setup();

    dataManager.getVisibleData(viewport());
    dataManager.setData(series(20_000));
    dataManager.getVisibleData(viewport());

    expect(decimation.calls).toBe(2);
  });

  /**
   * Empty data hits an early return before ever reaching the cache. This
   * only checks that a stale answer doesn't leak through — the recompute
   * count isn't the point here.
   */
  it("should not serve the stale answer after being emptied", () => {
    const { dataManager } = setup();

    expect(dataManager.getVisibleData(viewport()).length).toBeGreaterThan(0);
    dataManager.setData([]);

    expect(dataManager.getVisibleData(viewport())).toEqual([]);
  });

  it("should recompute after being refilled", () => {
    const { dataManager, decimation } = setup();

    dataManager.getVisibleData(viewport());
    dataManager.setData([]);
    dataManager.getVisibleData(viewport());
    dataManager.setData(series(10_000));

    expect(dataManager.getVisibleData(viewport()).length).toBeGreaterThan(0);
    expect(decimation.calls).toBe(2);
  });
});
