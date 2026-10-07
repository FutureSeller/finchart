/**
 * A collection of regression checks for the data layer. Each describe is
 * one fixed spot, and its title records what was actually observed at the
 * time — if the next person reopens the same spot, this is where it cries out.
 */
import { describe, expect, it } from "vitest";
import { defaultCoordinates, LINE_COORDINATES, OHLCAccessor } from "../accessors";
import { M4Decimation, SimpleDecimation } from "../decimation";
import { SimpleDataManager } from "../data-manager";
import { ContractError, DataError } from "../../primitives";
import { createPlotDeps } from "../../plot/presets";
import { createMemoryLayers } from "../../render/memory-layers";
import { recordingRenderer } from "../../render/recording-renderer";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  LineDataPoint,
  OHLC,
} from "../types";

/** The full window — `decimate(...whole(data), threshold)`. */
const whole = <T,>(data: T[]): [T[], { start: number; end: number }] => [
  data,
  { start: 0, end: data.length },
];

/**
 * A point that isn't `{x, y}` — the common shape when a consumer uses a
 * different field name. The point is that `y` is **absent**, so the type
 * reflects exactly that.
 */
interface ValuePoint extends BaseDataPoint {
  value: number;
}

const valuePoints = (count: number): ValuePoint[] =>
  Array.from({ length: count }, (_, i) => ({ x: i, value: i % 17 }));

describe("the default accessor tells 'missing y' apart from 'a hole'", () => {
  /**
   * If `getY` were `point.y ?? null`, "missing y" and "a hole" would become
   * the same value, `assertReadableValue` would never fire, and every point
   * would turn into a hole — an empty chart with no error and no warning.
   */
  it("a point shape with no y is caught at the door", () => {
    const coordinates = defaultCoordinates<ValuePoint>();

    expect(coordinates.getY(valuePoints(1)[0])).toBeUndefined();
  });

  it("a hole (y: null) is still a hole", () => {
    const coordinates = defaultCoordinates<LineDataPoint>();

    expect(coordinates.getY({ x: 0, y: null })).toBeNull();
    expect(coordinates.getY({ x: 0, y: 3 })).toBe(3);
  });

  /**
   * If `NaN` reaches an `M4Decimation` column, both `y < minY` and
   * `y > maxY` come out false, and that column's high/low vanish entirely.
   */
  it("NaN is caught at the finiteness door", () => {
    const coordinates = defaultCoordinates<LineDataPoint>();

    expect(() =>
      coordinates.assertFinite?.({ x: 0, y: Number.NaN }, 0),
    ).toThrow(DataError);
    expect(() => coordinates.assertFinite?.({ x: 0, y: null }, 0)).not.toThrow();
  });
});

describe("grid decimation also reads through its own accessor", () => {
  /** A hand-rolled accessor carried the same `?? null` bug too. */
  it("doesn't collapse the window to one point for a point shape with no y", () => {
    const data = valuePoints(1000);
    const out = new SimpleDecimation<ValuePoint>({
      getX: (point) => point.x,
      getY: (point) => point.value,
    }).decimate(...whole(data), 400);

    expect(out.length).toBeGreaterThan(100);
  });
});

describe("step decimation doesn't blow up on a large window", () => {
  /**
   * `out.push(...run(...))` spreads an array into the argument list — the
   * push length tracks the data size, not the threshold, so on large data
   * it throws `RangeError: Maximum call stack size exceeded` every frame.
   */
  it("doesn't throw when fed a million points with a single hole", () => {
    const data: LineDataPoint[] = Array.from({ length: 1_000_000 }, (_, i) => ({
      x: i,
      y: i === 500_000 ? null : i % 17,
    }));

    // Reproducing this needs a large push length — this hands it the same
    // size directly that tiered gives it when stacking layers.
    expect(() =>
      new SimpleDecimation<LineDataPoint>().decimate(...whole(data), 600_000),
    ).not.toThrow();
  });
});

describe("M4 columns come out in place order, with no duplicates", () => {
  /**
   * `flushInto` compares the four positions directly instead of sorting
   * (to cut allocations) — the question is whether it still preserves the
   * ascending order and dedup that sorting used to guarantee. The edge
   * case is when an extreme value is the first point or overlaps the last one.
   */
  const m4 = () => new M4Decimation<LineDataPoint>(defaultCoordinates());

  it("comes out with x in ascending order", () => {
    const data: LineDataPoint[] = Array.from({ length: 2_000 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 7) * 100,
    }));
    const out = m4().decimate(...whole(data), 40);

    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].x).toBeGreaterThan(out[i - 1].x);
    }
  });

  it("doesn't emit the same point twice even when an extreme overlaps an edge", () => {
    // Within a column, the lowest value is the first point and the highest is the last — four collapse into two.
    const data: LineDataPoint[] = Array.from({ length: 400 }, (_, i) => ({
      x: i,
      y: i,
    }));
    const out = m4().decimate(...whole(data), 20);

    expect(new Set(out.map((point) => point.x)).size).toBe(out.length);
  });
});

describe("a per-registration decimation policy also passes through the door", () => {
  /**
   * `presets.ts` guards a wiring's `maxPoints`/`pointsPerPixel` with
   * `requirePositive`, but the per-registration
   * `DecimationPolicy.pointsPerPixel` skipped that door and went straight
   * to the manager. `NaN` disables decimation entirely; `0` or `-1` turns
   * the chart into a straight line. `createDataManager(coords, policy)`
   * measures against the door a registration actually passes through.
   */
  const deps = () =>
    createPlotDeps({
      createLayers: createMemoryLayers,
      createRenderer: recordingRenderer().factory,
      createStyleReader: () => () => "",
    });

  const withPolicy = (pointsPerPixel: number) =>
    deps().createDataManager(defaultCoordinates<LineDataPoint>(), {
      pointsPerPixel,
    });

  it("rejects NaN, 0, and negative values", () => {
    expect(() => withPolicy(Number.NaN)).toThrow(ContractError);
    expect(() => withPolicy(0)).toThrow(ContractError);
    expect(() => withPolicy(-1)).toThrow(ContractError);
  });

  it("passes a positive value through unchanged", () => {
    const manager = withPolicy(2);
    manager.setData(
      Array.from({ length: 10_000 }, (_, i) => ({ x: i, y: i % 17 })),
    );

    // 100px at 2 points per pixel — a budget of 200, not the wiring's default.
    const visible = manager.getVisibleData({
      startX: 0,
      endX: 10_000,
      width: 100,
      height: 100,
    });
    expect(visible.length).toBeLessThanOrEqual(200);
    expect(visible.length).toBeGreaterThan(100);
  });
});

describe("step decimation also preserves holes", () => {
  /**
   * Calling `pickEveryNth` directly without `preservingHoles` selects by
   * index, so a hole can simply be dropped — then the hole-splitting logic
   * never fires and the line connects straight across a value that isn't
   * there. This is the picture once described as "worse than losing an
   * extreme value." The default accessor doesn't declare `gapless`, so this
   * is also the counterpart of the gapless fast path below: without the
   * declaration the window is still scanned for holes.
   */
  it("whitespace survives decimation", () => {
    const data: LineDataPoint[] = Array.from({ length: 100 }, (_, i) => ({
      x: i,
      y: i >= 41 && i <= 45 ? null : i % 13,
    }));

    const out = new SimpleDecimation<LineDataPoint>().decimate(
      ...whole(data),
      10,
    );

    expect(out.some((point) => point.y === null)).toBe(true);
  });
});

describe("an accessor that can't produce holes doesn't scan the window", () => {
  /**
   * `preservingHoles` used to call `getY` across the whole window every
   * frame just to get a single boolean. A bar series asked this question
   * even though the answer is always "no" — and since the viewport cache
   * keys on `startX`/`endX`, panning or zooming misses it every frame. This
   * measures by call count, not time — "it stopped asking" is what this fix is about.
   */
  it("doesn't call getY across the whole window for a gapless accessor", () => {
    const data: OHLC[] = Array.from({ length: 5_000 }, (_, i) => ({
      x: i,
      open: i,
      high: i + 2,
      low: i - 2,
      close: i + 1,
    }));

    let reads = 0;
    const base = new OHLCAccessor();
    const counting: CoordinateAccessor<OHLC> = {
      getX: (point) => base.getX(point),
      getY: (point) => {
        reads += 1;
        return base.getY(point);
      },
      gapless: true,
    };

    new SimpleDecimation<OHLC>(counting).decimate(...whole(data), 500);

    expect(reads).toBeLessThan(data.length); // it would be 5,000 if it had scanned the window looking for holes
  });
});

/**
 * The manager maintains hole presence incrementally — instead of
 * `preservingHoles` scanning the window every frame for a boolean, it's
 * rewritten once per mutation. What matters here isn't speed, it's that the
 * answer stays correct — a wrong `true` swallows a hole and connects the
 * line straight across a value that isn't there.
 */
describe("hole presence is rewritten on every mutation", () => {
  const line = () => defaultCoordinates<LineDataPoint>();

  const manager = (data: LineDataPoint[]) => {
    const m = new SimpleDataManager<LineDataPoint>({
      coordinates: line(),
      decimation: new SimpleDecimation<LineDataPoint>(line()),
      pointsPerPixel: 1,
    });
    m.setData(data);
    return m;
  };

  /**
   * The hole sits in the middle, off the grid — `pickEveryNth` always keeps
   * the first point, the last point, and multiples of `step`, so putting it
   * there would let the hole survive even with a wrong flag, and the test
   * would catch nothing.
   */
  const HOLE = 7;

  const dense = (count: number, holeAt = -1): LineDataPoint[] =>
    Array.from({ length: count }, (_, i) => ({
      x: i,
      y: i === holeAt ? null : i % 13,
    }));

  /** Is the hole still there in the visible data — it disappears here if the flag is wrong. */
  const visibleHoles = (m: SimpleDataManager<LineDataPoint>, end: number) =>
    m
      .getVisibleData({ startX: 0, endX: end, width: 20, height: 100 })
      .filter((point) => point.y === null).length;

  it("setData doesn't miss a hole", () => {
    expect(visibleHoles(manager(dense(300, HOLE)), 300)).toBeGreaterThan(0);
  });

  it("catches a hole that arrives via append", () => {
    const m = manager(dense(300));
    // Put the hole inside the chunk, not at its endpoint, so decimation can actually drop it.
    m.append([
      { x: 300, y: 5 },
      { x: 301, y: null },
      ...Array.from({ length: 60 }, (_, i) => ({ x: 302 + i, y: i % 7 })),
    ]);

    expect(visibleHoles(m, 400)).toBeGreaterThan(0);
  });

  it("catches a hole that arrives via prepend", () => {
    const m = manager(
      dense(300).map((point) => ({ ...point, x: point.x + 100 })),
    );
    m.prepend([
      { x: 0, y: 5 },
      { x: 1, y: null },
      ...Array.from({ length: 60 }, (_, i) => ({ x: 2 + i, y: i % 7 })),
    ]);

    expect(visibleHoles(m, 400)).toBeGreaterThan(0);
  });

  it("catches a hole carried in by an adopted head", () => {
    const m = manager(
      dense(300).map((point) => ({ ...point, x: point.x + 100 })),
    );
    m.adoptHeadRetainingTail(
      [
        { x: 0, y: 5 },
        { x: 1, y: null },
        ...Array.from({ length: 60 }, (_, i) => ({ x: 2 + i, y: i % 7 })),
      ],
      0,
    );

    expect(visibleHoles(m, 400)).toBeGreaterThan(0);
  });

  /** A hole that arrives via a tick isn't cleared at that moment because it's the last point, but it must stay uncleared once the next bar makes it interior. */
  it("catches a hole carried in by updateLast", () => {
    const m = manager(dense(300));
    m.replaceLast({ x: 299, y: null });
    m.append(Array.from({ length: 60 }, (_, i) => ({ x: 300 + i, y: i % 7 })));

    expect(visibleHoles(m, 400)).toBeGreaterThan(0);
  });

  /**
   * The safe side is to never flip back — even when a tick overwrites the
   * only hole with a real value, the flag isn't reset to "no holes"; it's
   * left as false (i.e. "not known"). The answer stays correct either way.
   */
  it("the answer stays correct even after a hole disappears", () => {
    const m = manager(dense(300, 299));
    m.replaceLast({ x: 299, y: 7 });

    expect(visibleHoles(m, 300)).toBe(0);
  });
});

describe("M4 with gaps keeps each value run's extremes (a spike in a short run was dropped)", () => {
  /**
   * Gaps split the budget across runs; a run whose share rounded below one
   * column used to keep only its two endpoints, so a spike inside it left
   * the drawing and the autoscaled y range with it.
   */
  it("keeps the spike of a run whose budget share rounds below four", () => {
    const data: LineDataPoint[] = Array.from({ length: 10_000 }, (_, i) => ({
      x: i,
      y: i % 20 === 0 ? null : i === 5010 ? 500 : i === 7013 ? -50 : 100,
    }));
    const out = new M4Decimation<LineDataPoint>().decimate(...whole(data), 1200);
    const values = out.flatMap((p) => (p.y === null ? [] : [p.y]));
    expect(Math.max(...values)).toBe(500);
    expect(Math.min(...values)).toBe(-50);
    // Still x-ascending with no point repeated.
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThan(out[i - 1].x);
  });

  it("reaches the visible y extent through the data manager", () => {
    const data: LineDataPoint[] = Array.from({ length: 10_000 }, (_, i) => ({
      x: i,
      y: i % 20 === 0 ? null : i === 5010 ? 500 : 100,
    }));
    const manager = new SimpleDataManager<LineDataPoint>({
      decimation: new M4Decimation(LINE_COORDINATES),
      coordinates: LINE_COORDINATES,
    });
    manager.setData(data);
    const visible = manager.getVisibleData({ startX: 0, endX: 9999, width: 300, height: 200 });
    expect(Math.max(...visible.flatMap((p) => (p.y === null ? [] : [p.y])))).toBe(500);
  });
});
