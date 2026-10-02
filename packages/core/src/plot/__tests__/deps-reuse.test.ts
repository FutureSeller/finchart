/**
 * One wiring, many stages. A `PlotDeps` object is a description of *how* to
 * build — the same one goes to every chart on a dashboard, and React's
 * StrictMode mounts twice from the same `deps` prop. Nothing inside it may
 * be owned by one particular Plot, or the second chart ends up steering the
 * first.
 */
import { describe, expect, it } from "vitest";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

const higher: LineDataPoint[] = [
  { x: 0, y: 1000 },
  { x: 50, y: 2000 },
  { x: 100, y: 1500 },
];

describe("reusing one PlotDeps across plots", () => {
  it("should keep each plot's x viewport its own", () => {
    const deps = testBrowserDeps();
    const first = mountPlot({ deps, series: lineSeries(), data }).plot;
    const second = mountPlot({ deps, series: lineSeries(), data }).plot;
    const before = second.getVisibleRange();

    first.pan(25);

    expect(first.getVisibleRange()).not.toEqual(before);
    expect(second.getVisibleRange()).toEqual(before);
  });

  it("should keep each plot's main-pane value axis its own", () => {
    const deps = testBrowserDeps();
    const first = mountPlot({ deps, series: lineSeries(), data }).plot;
    const second = mountPlot({ deps, series: lineSeries(), data: higher }).plot;

    expect(first.mainPane.yScale).not.toBe(second.mainPane.yScale);
    // The first fit to 10~20; the second's fit to 1000~2000 must not have overwritten it.
    const [min, max] = first.mainPane.yScale.getDomain();
    expect(min).toBeLessThanOrEqual(10);
    expect(max).toBeLessThan(1000);
  });
});
