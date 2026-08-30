import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import type { InteractionHandler } from "../../interaction";
import {
  DefaultInteractionHandler,
} from "../../interaction";
import { lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function plotWith(
  interactions: InteractionHandler = new DefaultInteractionHandler(),
) {
  const deps = { ...testBrowserDeps(), interactions };
  const { plot, handle } = mountPlot({ deps, series: lineSeries(), config: {
    ...defaultConfig,
    showGrid: false,
  } });
  handle.setData(data);
  return { plot, handle, deps, interactions };
}

describe("interaction wiring", () => {
  it("should move the x domain when the handler reports a pan", () => {
    const { deps, interactions } = plotWith();
    const [before] = deps.xScale.getDomain();

    interactions.handlePan(25);

    expect(deps.xScale.getDomain()[0]).toBe(before + 25);
  });

  it("should keep the domain width while panning", () => {
    const { deps, interactions } = plotWith();
    const [min, max] = deps.xScale.getDomain();

    interactions.handlePan(-10);

    const [newMin, newMax] = deps.xScale.getDomain();
    expect(newMax - newMin).toBeCloseTo(max - min);
  });

  it("should shrink the x domain around the zoom center", () => {
    const { deps, interactions } = plotWith();
    const [min, max] = deps.xScale.getDomain();
    const center = (min + max) / 2;

    interactions.handleZoom(2, center);

    const [newMin, newMax] = deps.xScale.getDomain();
    expect(newMax - newMin).toBeCloseTo((max - min) / 2);
    expect((newMin + newMax) / 2).toBeCloseTo(center);
  });

  it("should expand the x domain when zooming out", () => {
    const { deps, interactions } = plotWith();
    const [min, max] = deps.xScale.getDomain();

    interactions.handleZoom(0.5, 0);

    const [newMin, newMax] = deps.xScale.getDomain();
    expect(newMax - newMin).toBeCloseTo((max - min) * 2);
  });

  it("should re-render after a pan", () => {
    const { plot, interactions } = plotWith();

    let renders = 0;
    plot.on("render", () => renders++);
    interactions.handlePan(5);

    expect(renders).toBe(1);
  });

  it("should not refit the domain on re-render, so pans stick", () => {
    const { plot, deps, interactions } = plotWith();

    interactions.handlePan(30);
    const panned = deps.xScale.getDomain();
    plot.render();

    expect(deps.xScale.getDomain()).toEqual(panned);
  });

  it("should refit the domain when new data arrives", () => {
    const { handle, deps, interactions } = plotWith();

    interactions.handlePan(1000);
    handle.setData(data);

    expect(deps.xScale.getDomain()).toEqual([0, 100]);
  });

  it("should emit crosshair positions", () => {
    const { plot, interactions } = plotWith();

    const seen: { x: number; y: number }[] = [];
    plot.on("crosshair", ({ position }) => seen.push(position));
    interactions.handleCrosshair({ x: 12, y: 34 });

    expect(seen).toEqual([{ x: 12, y: 34 }]);
  });

  it("should reject a non-positive zoom factor", () => {
    const { interactions } = plotWith();

    expect(() => interactions.handleZoom(0, 50)).toThrow();
    expect(() => interactions.handleZoom(-2, 50)).toThrow();
  });

  /** Turning it off means not supplying it — it used to be disabled by
   * plugging in a no-op implementation instead (the opposite of tree-shaking). */
  it("should not touch the domain when no handler is wired", () => {
    const deps = { ...testBrowserDeps(), interactions: undefined };
    const { plot } = mountPlot({ deps, series: lineSeries(), data, config: defaultConfig });
    const before = deps.xScale.getDomain();

    // There's no input path, but the API still runs fine.
    expect(() => plot.render()).not.toThrow();
    expect(deps.xScale.getDomain()).toEqual(before);
  });
});

describe("pixel to domain conversion", () => {
  /** Once a render finishes, xScale's range matches the plot area. */
  function panned(pixels: number) {
    const { plot, deps } = plotWith();
    const [beforeMin, beforeMax] = deps.xScale.getDomain();

    plot.panByPixels(pixels);

    const [afterMin, afterMax] = deps.xScale.getDomain();
    return { beforeMin, beforeMax, afterMin, afterMax, deps };
  }

  it("should show an earlier range when dragging right", () => {
    const { beforeMin, afterMin } = panned(50);

    expect(afterMin).toBeLessThan(beforeMin);
  });

  it("should show a later range when dragging left", () => {
    const { beforeMin, afterMin } = panned(-50);

    expect(afterMin).toBeGreaterThan(beforeMin);
  });

  it("should keep the domain width while dragging", () => {
    const { beforeMin, beforeMax, afterMin, afterMax } = panned(37);

    expect(afterMax - afterMin).toBeCloseTo(beforeMax - beforeMin);
  });

  it("should move one domain unit per pixel at a 1:1 scale", () => {
    const { plot, deps } = plotWith();
    // With domain 0~100 mapped onto screen 20~120, 1px equals 1 unit.
    deps.xScale.setDomain(0, 100);
    deps.xScale.setRange(20, 120);

    plot.panByPixels(-10);

    expect(deps.xScale.getDomain()).toEqual([10, 110]);
  });

  it("should ignore a zero-pixel drag", () => {
    const { plot, deps } = plotWith();
    const before = deps.xScale.getDomain();

    plot.panByPixels(0);

    expect(deps.xScale.getDomain()).toEqual(before);
  });

  it("should anchor a wheel zoom at the cursor", () => {
    const { plot, deps } = plotWith();
    deps.xScale.setDomain(0, 100);
    deps.xScale.setRange(0, 100);

    // Screen x=25 -> zoom 2x while keeping data value 25 fixed
    plot.zoomAtPixel(2, 25);

    const [min, max] = deps.xScale.getDomain();
    expect(min).toBeCloseTo(12.5);
    expect(max).toBeCloseTo(62.5);
    expect(max - min).toBeCloseTo(50);
  });

  it("should keep the cursor value fixed while zooming", () => {
    const { plot, deps } = plotWith();
    deps.xScale.setDomain(0, 100);
    deps.xScale.setRange(0, 100);
    const anchored = deps.xScale.invert(30);

    plot.zoomAtPixel(4, 30);
    deps.xScale.setRange(0, 100);

    expect(deps.xScale.invert(30)).toBeCloseTo(anchored);
  });
});
