import { describe, expect, it } from "vitest";
import { LineDataAccessor } from "../accessors";
import { SimpleDataManager } from "../data-manager";
import { M4Decimation } from "../decimation";
import type { LineDataPoint } from "../types";

function manager(points: LineDataPoint[] = []) {
  const coordinates = new LineDataAccessor();
  const instance = new SimpleDataManager<LineDataPoint>({
    decimation: new M4Decimation(coordinates),
    coordinates,
  });
  instance.setData(points);
  return instance;
}

const point = (x: number, y = x): LineDataPoint => ({ x, y });

describe("DataManager.append", () => {
  it("should extend the range without a full re-check", () => {
    // Counts how many points get validated — only the chunk should be.
    class CountingAccessor extends LineDataAccessor {
      checked = 0;
      override assertFinite(point: LineDataPoint, index: number, label?: string): void {
        this.checked += 1;
        super.assertFinite(point, index, label);
      }
    }
    const coordinates = new CountingAccessor();
    const m = new SimpleDataManager<LineDataPoint>({
      decimation: new M4Decimation(coordinates),
      coordinates,
    });
    m.setData([point(0), point(1), point(2)]);
    coordinates.checked = 0;

    m.append([point(3), point(4)]);

    expect(coordinates.checked).toBe(2);
    expect(m.getXRange()).toEqual({ min: 0, max: 4 });
  });

  it("should allow an equal x at the seam — one tick, two points", () => {
    const m = manager([point(0), point(1)]);

    expect(() => m.append([point(1)])).not.toThrow();
  });

  it("should refuse a chunk that starts before the tail", () => {
    const m = manager([point(0), point(5)]);

    expect(() => m.append([point(3)])).toThrow(/continue after/);
  });

  it("should refuse an unsorted chunk", () => {
    const m = manager([point(0)]);

    expect(() => m.append([point(2), point(1)])).toThrow(/sorted/);
  });

  it("should become the dataset when appending to nothing", () => {
    const m = manager();

    m.append([point(1), point(2)]);

    expect(m.getXRange()).toEqual({ min: 1, max: 2 });
  });

  it("should invalidate the visible-window cache", () => {
    const m = manager([point(0), point(1), point(2)]);
    const viewport = { startX: 0, endX: 10, width: 100, height: 100 };
    m.getVisibleData(viewport);

    m.append([point(3)]);

    expect(m.getVisibleData(viewport)).toHaveLength(4);
  });
});

describe("DataManager.prepend", () => {
  it("should refuse a chunk that ends after the head", () => {
    const m = manager([point(5), point(6)]);

    expect(() => m.prepend([point(7)])).toThrow(/end before/);
  });

  it("should extend the range backwards", () => {
    const m = manager([point(5), point(6)]);

    m.prepend([point(3), point(4)]);

    expect(m.getXRange()).toEqual({ min: 3, max: 6 });
  });
});

describe("DataManager.replaceLast", () => {
  it("should swap the closing bar in place", () => {
    const m = manager([point(0, 10), point(1, 20)]);
    const viewport = { startX: 0, endX: 10, width: 100, height: 100 };

    m.replaceLast(point(1, 25));

    const visible = m.getVisibleData(viewport);
    expect(visible).toHaveLength(2);
    expect(visible.at(-1)).toEqual({ x: 1, y: 25 });
  });

  it("should refuse to move behind the previous point", () => {
    const m = manager([point(0), point(5)]);

    expect(() => m.replaceLast(point(-1))).toThrow(/keep x/);
  });

  it("should seed an empty dataset", () => {
    const m = manager();

    m.replaceLast(point(3));

    expect(m.getXRange()).toEqual({ min: 3, max: 3 });
  });
});
