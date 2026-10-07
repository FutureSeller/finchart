import { describe, expect, it } from "vitest";
import { LineDataAccessor, OHLCAccessor } from "../accessors";
import { OhlcAggregation } from "../aggregation";
import { SimpleDataManager } from "../data-manager";
import { M4Decimation } from "../decimation";
import type {
  DecimationStrategy,
  LineDataPoint,
  OHLC,
  Viewport,
} from "../types";

/** Counts how many points decimation scanned — this is where the tiers' work shows up. */
class Counting implements DecimationStrategy<OHLC> {
  scanned = 0;
  private inner = new OhlcAggregation();

  decimate(
    data: OHLC[],
    range: { start: number; end: number },
    threshold: number,
  ): OHLC[] {
    this.scanned += range.end - range.start;
    return this.inner.decimate(data, range, threshold);
  }
}

function candles(count: number): OHLC[] {
  return Array.from({ length: count }, (_, i) => ({
    x: i,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
}

function setup(tiered: boolean, data = candles(100_000)) {
  const decimation = new Counting();
  const dataManager = new SimpleDataManager<OHLC>({
    decimation,
    coordinates: new OHLCAccessor(),
    pointsPerPixel: 1,
    tiered,
  });

  dataManager.setData(data);
  return { dataManager, decimation };
}

const wide = (startX: number): Viewport => ({
  startX,
  endX: startX + 100_000,
  width: 1000,
  height: 600,
});

describe("tiered data", () => {
  it("should not build tiers unless asked", () => {
    const { dataManager, decimation } = setup(false);

    dataManager.getVisibleData(wide(0));

    // Scanned all 100,000 original points directly.
    expect(decimation.scanned).toBe(100_000);
  });

  it("should scan far less once the tiers are up", () => {
    const { dataManager, decimation } = setup(true);

    dataManager.getVisibleData(wide(0));
    const building = decimation.scanned;

    decimation.scanned = 0;
    for (let frame = 1; frame <= 20; frame++) {
      dataManager.getVisibleData(wide(frame));
    }

    // Building the tiers is paid for only once.
    expect(building).toBeGreaterThan(100_000);
    // Even the 20 frames after that, combined, are cheaper than a single original scan.
    expect(decimation.scanned).toBeLessThan(100_000);
  });

  it("should keep the extremes the untiered manager draws, within budget", () => {
    const data = candles(100_000);
    data[40_000].high = 9999;
    data[60_000].low = -9999;

    const plain = setup(false, data).dataManager.getVisibleData(wide(0));
    const tiered = setup(true, data).dataManager.getVisibleData(wide(0));

    // Buckets are whole candles of the array they cut, so a tier's grid can
    // be coarser than the original's (3125 tier candles in 1000 make 782) —
    // never over budget, and never below half of it.
    expect(plain.length).toBe(1000);
    expect(tiered.length).toBeLessThanOrEqual(plain.length);
    expect(tiered.length).toBeGreaterThan(plain.length / 2);
    // Extremes survive passing through the tiers — because merging is associative.
    expect(tiered.map((candle) => candle.high)).toContain(9999);
    expect(tiered.map((candle) => candle.low)).toContain(-9999);
  });

  it("should use the original when zoomed in", () => {
    const { dataManager, decimation } = setup(true);

    // A 1000-point window at 1000px — no reason to shrink it.
    dataManager.getVisibleData({
      startX: 50_000,
      endX: 51_000,
      width: 1000,
      height: 600,
    });

    expect(decimation.scanned).toBeLessThan(2000);
  });

  it("should drop the tiers when the data changes", () => {
    const { dataManager, decimation } = setup(true);

    dataManager.getVisibleData(wide(0));
    dataManager.setData(candles(100_000));

    decimation.scanned = 0;
    dataManager.getVisibleData(wide(0));

    // Rebuilds from the new source — it must not draw the stale tiers.
    expect(decimation.scanned).toBeGreaterThan(100_000);
  });

  /**
   * Extremes survive the tiers because each tier keeps its own bucket's
   * min/max. A higher tier's bucket is the union of the lower tier's
   * buckets, so extremes propagate upward.
   */
  it("should carry extremes up through the M4 tiers", () => {
    const data: LineDataPoint[] = Array.from({ length: 100_000 }, (_, i) => ({
      x: i,
      y: 0,
    }));
    data[40_000].y = 999;
    data[60_001].y = -999;

    const dataManager = new SimpleDataManager<LineDataPoint>({
      decimation: new M4Decimation(new LineDataAccessor()),
      coordinates: new LineDataAccessor(),
      tiered: true,
    });
    dataManager.setData(data);

    const ys = dataManager.getVisibleData(wide(0)).map((point) => point.y);

    expect(ys).toContain(999);
    expect(ys).toContain(-999);
  });

  /** M4 emits up to four per column but usually only two, so assuming "half per tier" climbs further than necessary and underfills the budget. */
  it("should fill the budget as well as the untiered manager does", () => {
    const data: LineDataPoint[] = Array.from({ length: 200_000 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 50) * 10 + (i % 7) - 3,
    }));

    const measure = (tiered: boolean) => {
      const dataManager = new SimpleDataManager<LineDataPoint>({
        decimation: new M4Decimation(new LineDataAccessor()),
        coordinates: new LineDataAccessor(),
        tiered,
      });
      dataManager.setData(data);

      return dataManager.getVisibleData({
        startX: 0,
        endX: 200_000,
        width: 1200,
        height: 600,
      }).length;
    };

    const plain = measure(false);
    const tiered = measure(true);

    expect(tiered).toBeGreaterThan(plain * 0.8);
  });

  /** M4 shrinks by x resolution, not point count, so when points cluster on one side, a tier's overall size isn't proportional to how many fall inside the window. */
  it("should not collapse a dense window in unevenly spaced data", () => {
    // The first 199,000 points are dense over x in [0,1000]; the last 1,000 are sparse over x in [1000,1e6].
    const dense: LineDataPoint[] = Array.from({ length: 199_000 }, (_, i) => ({
      x: (i / 199_000) * 1000,
      y: Math.sin(i / 50) * 10,
    }));
    const sparse: LineDataPoint[] = Array.from({ length: 1000 }, (_, i) => ({
      x: 1000 + (i + 1) * 999,
      y: 0,
    }));

    const measure = (tiered: boolean) => {
      const dataManager = new SimpleDataManager<LineDataPoint>({
        decimation: new M4Decimation(new LineDataAccessor()),
        coordinates: new LineDataAccessor(),
        tiered,
      });
      dataManager.setData([...dense, ...sparse]);

      // Looking only at the dense range — 0.1% of x, but 99.5% of the points live here.
      return dataManager.getVisibleData({
        startX: 0,
        endX: 1000,
        width: 1200,
        height: 600,
      }).length;
    };

    expect(measure(true)).toBeGreaterThan(measure(false) * 0.8);
  });

  /**
   * A strategy whose tier comes back no smaller than its source: the
   * manager gives up on that level and remembers it, so a later frame
   * neither builds the same tier again nor stacks copies of it.
   */
  it("should try a tier that cannot shrink once, across frames", () => {
    let tierBuilds = 0;
    const aggregation = new OhlcAggregation();
    const stubborn: DecimationStrategy<OHLC> = {
      decimate(data, range, threshold) {
        if (range.preserveBuckets !== true) return aggregation.decimate(data, range, threshold);
        tierBuilds += 1;
        // A runaway tier loop never returns on its own — fail it instead.
        if (tierBuilds > 10) throw new Error("tier building did not stop");
        return data.slice(range.start, range.end);
      },
    };
    const dataManager = new SimpleDataManager<OHLC>({
      decimation: stubborn,
      coordinates: new OHLCAccessor(),
      pointsPerPixel: 1,
      tiered: true,
    });
    dataManager.setData(candles(100_000));

    dataManager.getVisibleData(wide(0));
    dataManager.getVisibleData(wide(1));

    expect(tierBuilds).toBe(1);
  });

  it("should terminate on data that cannot shrink further", () => {
    const { dataManager } = setup(true, candles(3));

    expect(() =>
      dataManager.getVisibleData({
        startX: 0,
        endX: 3,
        width: 1,
        height: 600,
      }),
    ).not.toThrow();
  });
});
