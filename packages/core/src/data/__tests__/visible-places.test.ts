/**
 * Places travel alongside points. Three things to hold: places line up
 * index-for-index with points; the same viewport doesn't recompute (identity
 * reuse); and a rebuild (xEpoch) discards stale places — if another series's
 * setData changes the merged x list, my own data staying the same doesn't
 * stop my places from shifting, so unlike the point cache, a stale place is
 * a wrong picture, not just a wasted recompute.
 */
import { describe, expect, it } from "vitest";
import { LineDataAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import { M4Decimation } from "../decimation";
import type { LineDataPoint, Viewport } from "../types";

function setup() {
  const dataManager = new SimpleDataManager<LineDataPoint>({
    decimation: new M4Decimation<LineDataPoint>(new LineDataAccessor()),
    coordinates: new LineDataAccessor(),
  });
  dataManager.setData(
    Array.from({ length: 200 }, (_, i) => ({ x: i * 2, y: i % 17 })),
  );
  return dataManager;
}

const viewport = (overrides: Partial<Viewport> = {}): Viewport => ({
  startX: 0,
  endX: 400,
  width: 800,
  height: 600,
  ...overrides,
});

describe("getVisiblePlaced", () => {
  it("places line up with points — values from the same scan space", () => {
    const manager = setup();
    const vp = viewport({ screenXScan: () => (x) => x / 2, xEpoch: 0 });

    const { points, places } = manager.getVisiblePlaced(vp);

    expect(points).toBe(manager.getVisibleData(vp)); // the same cache instance
    expect(places).not.toBeNull();
    expect(places).toHaveLength(points.length);
    for (let i = 0; i < points.length; i++) {
      expect(places?.[i]).toBe(points[i].x / 2);
    }
  });

  it("doesn't carry places when there's no place space (a continuous coordinate system)", () => {
    const manager = setup();

    expect(manager.getVisiblePlaced(viewport()).places).toBeNull();
  });

  it("gives the same places array for the same viewport — no recompute", () => {
    const manager = setup();
    let opened = 0;
    const vp = viewport({
      screenXScan: () => {
        opened += 1;
        return (x) => x / 2;
      },
      xEpoch: 0,
    });

    const first = manager.getVisiblePlaced(vp).places;
    const second = manager.getVisiblePlaced(vp).places;

    expect(second).toBe(first);
    expect(opened).toBe(1);
  });

  it("doesn't cache when only the pass factory is present and xEpoch is missing — recomputes rather than trust a stale place", () => {
    const manager = setup();
    let space = 2;
    const scan = () => {
      const divisor = space;
      return (x: number) => x / divisor;
    };

    // A viewport carrying only the pass factory, with no key (xEpoch) — the
    // contract expects them to travel as a pair, but the type system can't
    // enforce that. With no key, remeasuring every time is the safe choice.
    const before = manager.getVisiblePlaced(viewport({ screenXScan: scan }));
    space = 4;
    const after = manager.getVisiblePlaced(viewport({ screenXScan: scan }));

    expect(after.places?.[1]).toBe(before.points[1].x / 4);
  });

  it("discards stale places and remeasures in the new space when xEpoch changes", () => {
    const manager = setup();
    let space = 2;
    const scan = () => {
      const divisor = space;
      return (x: number) => x / divisor;
    };

    const before = manager.getVisiblePlaced(
      viewport({ screenXScan: scan, xEpoch: 0 }),
    );

    // A rebuild happened — the merged list changed, shifting the place of the same x.
    space = 4;
    const after = manager.getVisiblePlaced(
      viewport({ screenXScan: scan, xEpoch: 1 }),
    );

    expect(after.places).not.toBe(before.places);
    expect(after.places?.[1]).toBe(before.points[1].x / 4);
  });
});
