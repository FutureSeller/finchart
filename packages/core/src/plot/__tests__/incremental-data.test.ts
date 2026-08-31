import { describe, expect, it } from "vitest";
import { strokedPaths } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import { DEFAULT_LINE_STYLE, lineSeries } from "../../series";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

/** x runs from `from` (inclusive) to `to` (exclusive). */
function pointsIn(from: number, to: number): LineDataPoint[] {
  return Array.from({ length: to - from }, (_, i) => ({
    x: from + i,
    y: (from + i) % 13,
  }));
}

function loaded() {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot, handle, layers } = mountPlot({ deps, series: lineSeries(), config: {
    ...defaultConfig,
    showGrid: false,
  } });
  handle.setData(pointsIn(0, 100));
  return { plot, handle, xScale, yScale, layers };
}

describe("prepend", () => {
  it("should keep the visible window where it was", () => {
    const { plot, handle, xScale } = loaded();
    plot.pan(-20);
    const viewing = xScale.getDomain();

    handle.prepend(pointsIn(-50, 0));

    expect(xScale.getDomain()).toEqual(viewing);
  });

  it("should keep the value domain steady", () => {
    const { handle, yScale } = loaded();
    const before = yScale.getDomain();

    handle.prepend(pointsIn(-50, 0));

    expect(yScale.getDomain()).toEqual(before);
  });

  it("should put the older points in front", () => {
    const { handle } = loaded();

    handle.prepend(pointsIn(-50, 0));

    // The handle reports its own range — the stage doesn't know the data.
    expect(handle.xRange).toEqual({ min: -50, max: 99 });
  });

  it("should make the new points reachable by panning", () => {
    const { plot, handle, xScale, layers } = loaded();
    handle.prepend(pointsIn(-50, 0));

    // Move into the newly prepended range
    xScale.setDomain(-40, -10);
    plot.render();

    const drawn = strokedPaths(layers.context).find(
      (p) => p.width === DEFAULT_LINE_STYLE.line.width,
    );
    expect(drawn?.points.length).toBeGreaterThan(1);
  });

  it("should ignore an empty page", () => {
    const { handle, xScale } = loaded();
    const before = xScale.getDomain();

    handle.prepend([]);

    expect(handle.xRange).toEqual({ min: 0, max: 99 });
    expect(xScale.getDomain()).toEqual(before);
  });

  it("should re-render so the caller sees the new data", () => {
    const { plot, handle } = loaded();

    let renders = 0;
    plot.on("render", () => renders++);
    handle.prepend(pointsIn(-50, 0));

    expect(renders).toBe(1);
  });

  it("should accumulate across repeated pages", () => {
    const { handle } = loaded();

    handle.prepend(pointsIn(-40, 0));
    handle.prepend(pointsIn(-80, -40));

    expect(handle.xRange).toEqual({ min: -80, max: 99 });
  });
});

describe("append", () => {
  it("should keep the visible window where it was", () => {
    const { plot, handle, xScale } = loaded();
    plot.pan(10);
    const viewing = xScale.getDomain();

    handle.append(pointsIn(100, 150));

    expect(xScale.getDomain()).toEqual(viewing);
  });

  it("should put the newer points at the end", () => {
    const { handle } = loaded();

    handle.append(pointsIn(100, 150));

    expect(handle.xRange).toEqual({ min: 0, max: 149 });
  });

  it("should ignore an empty page", () => {
    const { handle } = loaded();

    handle.append([]);

    expect(handle.xRange).toEqual({ min: 0, max: 99 });
  });
});

describe("setData vs incremental", () => {
  it("should refit the window on setData", () => {
    const { plot, handle, xScale } = loaded();
    plot.pan(-20);

    handle.setData(pointsIn(-50, 100));

    // A new dataset, so it snaps back to showing everything.
    expect(xScale.getDomain()).toEqual([-50, 99]);
  });

  it("should let fitDomains restore the full view after prepending", () => {
    const { plot, handle, xScale } = loaded();
    handle.prepend(pointsIn(-50, 0));

    plot.fitDomains();

    expect(xScale.getDomain()).toEqual([-50, 99]);
  });
});
