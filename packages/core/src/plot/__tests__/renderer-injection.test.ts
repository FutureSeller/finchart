import { describe, expect, it } from "vitest";
import { continuousX } from "../../scale";
import { fakeLayersFactory } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import type { DrawTarget, Renderer, RendererFactory } from "../../render";
import { lineSeries } from "../../series";
import { Plot } from "../plot";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, defaultSize } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A renderer with no canvas at all — that this works is exactly why DrawTarget was factored out. */
function recordingRenderer() {
  const calls: string[] = [];
  let committed = 0;

  const renderer: Renderer = {
    drawLine: () => calls.push("line"),
    drawShape: () => calls.push("shape"),
    drawText: () => calls.push("text"),
    clear: () => {
      calls.length = 0;
    },
    commit: () => {
      committed += 1;
    },
  };

  return {
    create: (() => renderer) as RendererFactory,
    calls,
    get committed() {
      return committed;
    },
  };
}

describe("renderer injection", () => {
  it("should drive a whole render through a renderer that is not a canvas", () => {
    const target = recordingRenderer();
    const factory = fakeLayersFactory();

    const plot = new Plot({
      deps: {
        ...testBrowserDeps(),
        createLayers: factory.createLayers,
        createRenderer: target.create,
        // Swapping the renderer means swapping the measurer too (text layout
        // "measuring happens in exactly one place"). Leaving the default
        // measurer in place would measure via the canvas context and break
        // the assertion below — that break is exactly why this rule exists.
        createTextMeasurer: undefined,
      },
      config: defaultConfig,
      size: defaultSize,
    });

    plot.mainPane.addSeries({ series: lineSeries(), data });

    // The grid is lines; the line series is one line plus a circle per point.
    expect(target.calls).toContain("line");
    expect(target.calls).toContain("shape");
    expect(target.committed).toBeGreaterThan(0);

    // The canvas context was never touched.
    expect(factory.created[0].context.calls).toHaveLength(0);
  });

  it("should let a series draw into a bare DrawTarget", () => {
    const drawn: string[] = [];
    const target: DrawTarget = {
      drawLine: () => drawn.push("line"),
      drawShape: () => drawn.push("shape"),
      drawText: () => drawn.push("text"),
    };

    // Draws directly onto something with neither clear nor commit.
    lineSeries().draw(target, {
      data,
      x: continuousX(stubScale()),
      yScale: { ...stubScale() },
      area: { left: 0, right: 100, top: 0, bottom: 100 },
      readStyle: () => "",
    });

    expect(drawn[0]).toBe("line");
    expect(drawn.filter((call) => call === "shape")).toHaveLength(data.length);
  });
});

/** Coordinate transformation is not this test's concern. */
function stubScale() {
  return {
    getDomain: () => [0, 100] as [number, number],
    getRange: () => [0, 100] as [number, number],
    setDomain: () => undefined,
    setRange: () => undefined,
    scale: (value: number) => value,
    invert: (value: number) => value,
  };
}
