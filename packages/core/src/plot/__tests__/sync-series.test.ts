import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import type { CanvasRenderer } from "../../render";
import type { Series, SeriesContext } from "../../series";
import { lineSeries } from "../../series";
import { seriesSpec } from "../pane";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A series that logs the order it was drawn in. */
function fakeSeries(name: string, log: string[]): Series<LineDataPoint> {
  return {
    valueExtent: () => ({ min: 0, max: 30 }),
    draw(_renderer: CanvasRenderer, _context: SeriesContext<LineDataPoint>) {
      log.push(name);
    },
  };
}

/** A derivation that counts how many times it was computed. */
function countingDerive(calls: { n: number }) {
  return (source: LineDataPoint[]): LineDataPoint[] => {
    calls.n += 1;
    return source.map((point) => ({ x: point.x, y: point.y === null ? null : point.y * 2 }));
  };
}

/** Draws exactly once from the current state to check order — since
 * syncSeries' notify already triggers a render, clear the log first, then measure. */
function drawOrder(plot: ReturnType<typeof loaded>, log: string[]): string[] {
  log.length = 0;
  plot.render();
  return log;
}

function loaded() {
  const deps = testBrowserDeps();
  const { plot, handle } = mountPlot({ deps, series: lineSeries(), config: {
    ...defaultConfig,
    showGrid: false,
    axis: { x: { showLabels: false }, y: { showLabels: false } },
  } });
  handle.setData(data);
  return plot;
}

describe("Pane.syncSeries", () => {
  it("should draw in the order of the spec array", () => {
    const plot = loaded();
    const log: string[] = [];

    plot.mainPane.syncSeries([
      seriesSpec<LineDataPoint>({ id: "a", series: fakeSeries("a", log), data }),
      seriesSpec<LineDataPoint>({ id: "b", series: fakeSeries("b", log), data }),
    ]);

    expect(drawOrder(plot, log)).toEqual(["a", "b"]);
  });

  /** A conditional series turned on later still follows array order — when it was addSeries' push order, whatever turned on later always ended up on top. */
  it("should place a later-inserted series by array order, not insertion order", () => {
    const plot = loaded();
    const log: string[] = [];

    const a = () => seriesSpec<LineDataPoint>({ id: "a", series: fakeSeries("a", log), data });
    const b = () => seriesSpec<LineDataPoint>({ id: "b", series: fakeSeries("b", log), data });
    const c = () => seriesSpec<LineDataPoint>({ id: "c", series: fakeSeries("c", log), data });

    plot.mainPane.syncSeries([a(), c()]);
    plot.render();
    log.length = 0;

    // b was turned on late, but in the array it sits between a and c.
    plot.mainPane.syncSeries([a(), b(), c()]);

    expect(drawOrder(plot, log)).toEqual(["a", "b", "c"]);
  });

  it("should drop a series that left the spec", () => {
    const plot = loaded();
    const log: string[] = [];

    plot.mainPane.syncSeries([
      seriesSpec<LineDataPoint>({ id: "a", series: fakeSeries("a", log), data }),
      seriesSpec<LineDataPoint>({ id: "b", series: fakeSeries("b", log), data }),
    ]);
    plot.render();
    log.length = 0;

    plot.mainPane.syncSeries([
      seriesSpec<LineDataPoint>({ id: "a", series: fakeSeries("a", log), data }),
    ]);

    expect(drawOrder(plot, log)).toEqual(["a"]);
  });

  it("should reject duplicate ids", () => {
    const plot = loaded();
    const log: string[] = [];

    expect(() =>
      plot.mainPane.syncSeries([
        seriesSpec<LineDataPoint>({ id: "same", series: fakeSeries("a", log), data }),
        seriesSpec<LineDataPoint>({ id: "same", series: fakeSeries("b", log), data }),
      ]),
    ).toThrow(/same/);
  });

  it("should replace whatever addSeries put there", () => {
    const plot = loaded();
    const log: string[] = [];

    plot.mainPane.addSeries({ series: fakeSeries("imperative", log), data });
    plot.mainPane.syncSeries([
      seriesSpec<LineDataPoint>({ id: "a", series: fakeSeries("a", log), data }),
    ]);

    expect(drawOrder(plot, log)).toEqual(["a"]);
  });
});

/**
 * This is the regression wall. The derivation cache lives inside the
 * Entry closure — rebuilding the Entry on every update would wipe the
 * cache entirely and sharply increase per-frame cost.
 */
describe("Pane.syncSeries — derivation cache", () => {
  it("should not recompute when id and deriveKey are unchanged", () => {
    const plot = loaded();
    const calls = { n: 0 };
    const log: string[] = [];

    const spec = () =>
      seriesSpec({
        id: "ma",
        data,
        series: fakeSeries("ma", log),
        derive: countingDerive(calls),
        deriveKey: [20],
      });

    plot.mainPane.syncSeries([spec()]);
    plot.render();
    const afterFirst = calls.n;

    plot.mainPane.syncSeries([spec()]);
    plot.render();

    expect(afterFirst).toBe(1);
    expect(calls.n).toBe(1);
  });

  it("should recompute when deriveKey changes", () => {
    const plot = loaded();
    const calls = { n: 0 };
    const log: string[] = [];

    const spec = (period: number) =>
      seriesSpec({
        id: "ma",
        data,
        series: fakeSeries("ma", log),
        derive: countingDerive(calls),
        deriveKey: [period],
      });

    plot.mainPane.syncSeries([spec(20)]);
    plot.render();
    plot.mainPane.syncSeries([spec(50)]);
    plot.render();

    expect(calls.n).toBe(2);
  });

  /** A user must be allowed to build a fresh lineSeries on every render — the series gets swapped, but the cache survives. */
  it("should swap the series reference without losing the cache", () => {
    const plot = loaded();
    const calls = { n: 0 };
    const log: string[] = [];

    plot.mainPane.syncSeries([
      seriesSpec({
        id: "ma",
        data,
        series: fakeSeries("old", log),
        derive: countingDerive(calls),
        deriveKey: [20],
      }),
    ]);
    plot.render();
    log.length = 0;

    plot.mainPane.syncSeries([
      seriesSpec({
        id: "ma",
        data,
        series: fakeSeries("new", log),
        derive: countingDerive(calls),
        deriveKey: [20],
      }),
    ]);

    expect(drawOrder(plot, log)).toEqual(["new"]);
    expect(calls.n).toBe(1);
  });
});

describe("Pane.syncSeries — the input lane", () => {
  /** A series that counts drawn points — checks which input actually got drawn. */
  function probeSeries(seen: { points: LineDataPoint[][] }): Series<LineDataPoint> {
    return {
      valueExtent: () => ({ min: 0, max: 30 }),
      draw(_renderer: CanvasRenderer, context: SeriesContext<LineDataPoint>) {
        seen.points.push([...context.data]);
      },
    };
  }

  function sourceOf(points: LineDataPoint[]) {
    let current = points;
    return {
      read: () => current,
      set(next: LineDataPoint[]) {
        current = next;
      },
    };
  }

  it("should draw from the input source and follow its reference changes", () => {
    const plot = loaded();
    const seen = { points: [] as LineDataPoint[][] };
    const source = sourceOf([
      { x: 0, y: 1 },
      { x: 50, y: 2 },
    ]);

    plot.mainPane.syncSeries([
      seriesSpec({ id: "in", series: probeSeries(seen), input: source }),
    ]);
    plot.render();
    expect(seen.points.at(-1)?.map((p) => p.y)).toEqual([1, 2]);

    // Once the input's reference changes, the next draw pulls it in — this is Source's contract.
    source.set([
      { x: 0, y: 7 },
      { x: 50, y: 8 },
    ]);
    plot.render();
    expect(seen.points.at(-1)?.map((p) => p.y)).toEqual([7, 8]);
  });

  it("should rebuild the entry when the input identity changes", () => {
    const plot = loaded();
    const seen = { points: [] as LineDataPoint[][] };
    const series = probeSeries(seen);
    const first = sourceOf([{ x: 0, y: 1 }]);
    const second = sourceOf([{ x: 0, y: 9 }]);

    plot.mainPane.syncSeries([
      seriesSpec({ id: "in", series, input: first }),
    ]);
    plot.render();

    plot.mainPane.syncSeries([
      seriesSpec({ id: "in", series, input: second }),
    ]);
    plot.render();
    expect(seen.points.at(-1)?.map((p) => p.y)).toEqual([9]);
  });

  it("should rebuild on a data↔input mode switch instead of feeding a foreign entry", () => {
    const plot = loaded();
    const seen = { points: [] as LineDataPoint[][] };
    const series = probeSeries(seen);
    const source = sourceOf([{ x: 0, y: 5 }]);

    // Starts in data mode and switches to input mode under the same id —
    // reusing the entry would either feed the old entry (the gatekeeper
    // would throw) or the input would be ignored.
    plot.mainPane.syncSeries([
      seriesSpec<LineDataPoint>({ id: "s", series, data }),
    ]);
    plot.render();

    expect(() =>
      plot.mainPane.syncSeries([
        seriesSpec({ id: "s", series, input: source }),
      ]),
    ).not.toThrow();
    plot.render();
    expect(seen.points.at(-1)?.map((p) => p.y)).toEqual([5]);
  });
});
