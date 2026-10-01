import { describe, expect, it } from "vitest";
import type { DataView, LineDataPoint } from "../../data";
import type { CanvasRenderer } from "../../render";
import type { Series, SeriesContext } from "../../series";
import { lineSeries } from "../../series";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

/** x runs 0..99, y equals x. */
const points = (from: number, to: number): LineDataPoint[] =>
  Array.from({ length: to - from }, (_, i) => ({ x: from + i, y: from + i }));

/** A series that captures the data it received when drawing. */
function spySeries(): Series<LineDataPoint> & {
  seen: DataView<LineDataPoint>[];
  extents: DataView<LineDataPoint>[];
} {
  const seen: DataView<LineDataPoint>[] = [];
  const extents: DataView<LineDataPoint>[] = [];

  return {
    seen,
    extents,
    valueExtent(data) {
      extents.push(data);
      const values = data.map((point) => point.y ?? 0);
      return values.length === 0
        ? { min: 0, max: 0 }
        : { min: Math.min(...values), max: Math.max(...values) };
    },
    draw(_renderer: CanvasRenderer, context: SeriesContext<LineDataPoint>) {
      seen.push(context.data);
    },
  };
}

/** The source that feeds every derivation. Every registration gets this — the data belongs to the registration. */
const source = points(0, 100);

function loaded() {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot, handle, layers } = mountPlot({
    deps,
    series: lineSeries(),
    data: source,
    config: {
      ...defaultConfig,
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  return { plot, handle, xScale, yScale, layers };
}

describe("derive", () => {
  it("should receive the whole source, not the visible window", () => {
    const { plot, xScale } = loaded();
    const sources: DataView<LineDataPoint>[] = [];

    plot.mainPane.addSeries({
      series: spySeries(),
      data: source,
      derive: (input) => {
        sources.push(input);
        return [...input];
      },
    });

    xScale.setDomain(40, 60);
    plot.render();

    expect(sources.at(-1)).toHaveLength(100);
  });

  it("should draw what derive returned", () => {
    const { plot } = loaded();
    const series = spySeries();

    plot.mainPane.addSeries({
      series,
      data: source,
      derive: (input) => input.map((p) => ({ x: p.x, y: p.y === null ? null : p.y * 2 })),
    });
    plot.render();

    const drawn = series.seen.at(-1)!;
    expect(drawn.length).toBeGreaterThan(0);
    for (const point of drawn) expect(point.y).toBe(Number(point.x) * 2);
  });

  it("should size the value domain from the derived values", () => {
    const { plot, yScale } = loaded();

    plot.mainPane.clearSeries();
    plot.mainPane.addSeries({
      series: spySeries(),
      data: source,
      derive: (input) => input.map((p) => ({ x: p.x, y: 1000 })),
    });
    plot.fitDomains();

    const [min, max] = yScale.getDomain();
    expect(min).toBeLessThanOrEqual(1000);
    expect(max).toBeGreaterThanOrEqual(1000);
  });

  it("should still clip the derived points to the visible window", () => {
    const { plot, xScale } = loaded();
    const series = spySeries();

    plot.mainPane.addSeries({ series, data: source, derive: (input) => [...input] });

    xScale.setDomain(40, 60);
    plot.render();

    // The window, plus the one neighbour on each side that carries the
    // line out to the plot edges.
    expect(series.seen.at(-1)!.map((point) => Number(point.x))).toEqual(
      Array.from({ length: 23 }, (_, i) => 39 + i),
    );
  });

  it("should not recompute while the source is unchanged", () => {
    const { plot } = loaded();
    let runs = 0;

    plot.mainPane.addSeries({
      series: spySeries(),
      data: source,
      derive: (input) => {
        runs++;
        return [...input];
      },
    });

    const after = runs;
    plot.render();
    plot.render();

    expect(runs).toBe(after);
  });

  it("should recompute once the source changes", () => {
    const { plot } = loaded();
    let runs = 0;

    // A derived series has its own data too — chain onto it through that handle.
    const derived = plot.mainPane.addSeries({
      series: spySeries(),
      data: source,
      derive: (input) => {
        runs++;
        return [...input];
      },
    });
    const before = runs;

    derived.append(points(100, 110));

    expect(runs).toBeGreaterThan(before);
  });

  it("should fill in the lookback once older data arrives", () => {
    const { plot } = loaded();
    const series = spySeries();

    // An indicator that only produces a value once the first 5 points exist.
    const derived = plot.mainPane.addSeries({
      series,
      data: source,
      derive: (input) =>
        input.flatMap((point, index) =>
          index < 5 ? [] : [{ x: point.x, y: point.y }],
        ),
    });
    plot.render();
    const firstBefore = Number(series.seen.at(-1)![0].x);

    derived.prepend(points(-50, 0));
    plot.render();

    // History was prepended, so the leading range that used to have no value can now be drawn.
    expect(Number(series.seen.at(-1)![0].x)).toBeLessThan(firstBefore);
  });
});

describe("series without derive", () => {
  it("should keep receiving the visible window", () => {
    const { plot, xScale } = loaded();
    const series = spySeries();

    plot.mainPane.addSeries({ series, data: source });
    xScale.setDomain(40, 60);
    plot.render();

    // The window, plus the one neighbour on each side that carries the
    // line out to the plot edges.
    expect(series.seen.at(-1)!.map((point) => Number(point.x))).toEqual(
      Array.from({ length: 23 }, (_, i) => 39 + i),
    );
  });

  it("should get the full data for its extent, as before", () => {
    const { plot } = loaded();
    const series = spySeries();

    plot.mainPane.addSeries({ series, data: source });
    plot.fitDomains();

    expect(series.extents.at(-1)).toHaveLength(100);
  });
});
