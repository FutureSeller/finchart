/**
 * No value (whitespace) — y: null means "there is no value here."
 * Dropping the point instead would let the line stretch across the gap,
 * making it look like a value exists where there isn't one. Three places
 * must agree on this: drawing (breaks the line), measuring (doesn't
 * count it as a value), and decimation (doesn't swallow it).
 */
import { describe, expect, it } from "vitest";
import { strokedPaths } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import {
  SimpleDecimation,
  LineDataAccessor,
  LttbDecimation,
  M4Decimation,
} from "../../data";
import { DEFAULT_LINE_STYLE, lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

/** The whole window — a test convenience for the range contract: `decimate(...whole(data), threshold)`. */
const whole = <T,>(data: T[]): [T[], { start: number; end: number }] => [
  data,
  { start: 0, end: data.length },
];


const coordinates = new LineDataAccessor();

/** value, value, hole, value, value. */
const withHole: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 1, y: 12 },
  { x: 2, y: null },
  { x: 3, y: 20 },
  { x: 4, y: 22 },
];

function drawn(data: LineDataPoint[]) {
  const { plot, layers } = mountPlot({
    deps: testBrowserDeps(),
    series: lineSeries(),
    data,
    config: { ...defaultConfig, showGrid: false },
  });
  plot.render();

  return strokedPaths(layers.context).filter(
    (path) => path.width === DEFAULT_LINE_STYLE.line.width,
  );
}

describe("drawing side — the line breaks", () => {
  it("should draw one line per run of values", () => {
    const lines = drawn(withHole);

    // Drawing it as one continuous line would stretch across the gap.
    expect(lines).toHaveLength(2);
    expect(lines[0].points).toHaveLength(2);
    expect(lines[1].points).toHaveLength(2);
  });

  it("should draw one line when there is no hole", () => {
    const lines = drawn([
      { x: 0, y: 10 },
      { x: 1, y: 12 },
      { x: 2, y: 14 },
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0].points).toHaveLength(3);
  });

  it("should draw nothing for a series that is all holes", () => {
    expect(
      drawn([
        { x: 0, y: null },
        { x: 1, y: null },
      ]),
    ).toHaveLength(0);
  });
});

describe("measuring side — a hole is not a value", () => {
  it("should ignore holes in the value extent", () => {
    expect(lineSeries().valueExtent(withHole)).toEqual({ min: 10, max: 22 });
  });

  /** Treating a hole as zero would drag the value axis down to zero — the same kind of falsehood blocked for an empty series. */
  it("should not pull the axis toward zero", () => {
    const extent = lineSeries().valueExtent([
      { x: 0, y: 40_000 },
      { x: 1, y: null },
      { x: 2, y: 41_000 },
    ]);

    expect(extent).toEqual({ min: 40_000, max: 41_000 });
  });

  it("should report null when every point is a hole", () => {
    expect(
      lineSeries().valueExtent([
        { x: 0, y: null },
        { x: 1, y: null },
      ]),
    ).toBeNull();
  });
});

describe("decimation side — does not swallow the hole", () => {
  /** A large dataset with one hole in the middle. Decimation drops most of it. */
  const many = (count: number, holeAt: number): LineDataPoint[] =>
    Array.from({ length: count }, (_, i) => ({
      x: i,
      y: i === holeAt ? null : Math.sin(i / 7) * 100,
    }));

  const strategies = [
    ["M4", new M4Decimation<LineDataPoint>(coordinates)],
    ["LTTB", new LttbDecimation<LineDataPoint>(coordinates)],
    ["step", new SimpleDecimation<LineDataPoint>()],
  ] as const;

  for (const [name, strategy] of strategies) {
    it(`should keep the hole (${name})`, () => {
      const result = strategy.decimate(...whole(many(1_000, 500)), 40);

      expect(result.length).toBeLessThanOrEqual(45);
      // The hole must survive, or the line won't stay broken.
      expect(result.some((point) => point.y === null)).toBe(true);
    });

    it(`should stay sorted by x (${name})`, () => {
      const result = strategy.decimate(...whole(many(1_000, 500)), 40);
      const xs = result.map((point) => Number(point.x));

      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    });
  }

  it("should collapse a run of holes into one break", () => {
    const data: LineDataPoint[] = [
      ...Array.from({ length: 50 }, (_, i) => ({ x: i, y: i })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 50 + i, y: null })),
      ...Array.from({ length: 50 }, (_, i) => ({ x: 70 + i, y: i })),
    ];

    const result = new M4Decimation(coordinates).decimate(...whole(data), 20);
    const holes = result.filter((point) => point.y === null);

    // One break needs only one signal.
    expect(holes).toHaveLength(1);
  });
});

describe("errors at the boundary — x has nowhere to degrade to", () => {
  // DataError for an unparseable x is gone — x is a number by its type
  // now. The compiler now enforces that it can never be missing.
  it("should read a null value without complaining", () => {
    expect(coordinates.getY({ x: 0, y: null })).toBeNull();
  });
});
