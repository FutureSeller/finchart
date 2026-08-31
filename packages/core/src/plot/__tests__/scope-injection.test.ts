/**
 * A chart can live under a consumer-owned scope (`PlotOptions.scope`) — the
 * page disposes one scope and every chart under it is destroyed. The chart
 * never keeps the scope; it only registers its own destroy, so ownership
 * stays with the consumer.
 */
import { describe, expect, it } from "vitest";
import { createScope } from "../../primitives";
import { fakeLayersFactory } from "../../__tests__/dom-fakes";
import { M4Decimation, SimpleDataManager } from "../../data";
import type { CoordinateAccessor, LineDataPoint } from "../../data";
import { createCanvasRenderer, noStyle } from "../../render";
import { LinearScale } from "../../scale";
import { lineSeries } from "../../series";
import { Plot } from "../plot";
import type { PlotDeps } from "../types";
import { defaultConfig, defaultSize } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 100, y: 15 },
];

function mount(scope?: ReturnType<typeof createScope>) {
  const factory = fakeLayersFactory();
  const deps: PlotDeps = {
    xScale: () => new LinearScale(),
    mainPaneYScale: () => new LinearScale(),
    createDataManager: <T extends { x: number }>(
      coordinates: CoordinateAccessor<T>,
    ) =>
      new SimpleDataManager<T>({
        coordinates,
        decimation: new M4Decimation(coordinates),
      }),
    createLayers: factory.createLayers,
    createRenderer: createCanvasRenderer,
    createStyleReader: () => noStyle,
  };

  const plot = new Plot({
    deps,
    config: { ...defaultConfig, showGrid: false },
    size: defaultSize,
    scope,
  });
  plot.mainPane.addSeries({ series: lineSeries(), data });

  return { plot, layers: factory.created[0] };
}

describe("PlotOptions.scope", () => {
  it("should destroy the chart when the parent scope is disposed", () => {
    const scope = createScope();
    const { plot, layers } = mount(scope);

    scope.dispose();

    expect(layers.destroyed).toBe(true);
    // Fully destroyed, not just released — a second destroy is a no-op.
    expect(() => plot.destroy()).not.toThrow();
  });

  it("should own several charts under one scope", () => {
    const scope = createScope();
    const first = mount(scope);
    const second = mount(scope);

    scope.dispose();

    expect(first.layers.destroyed).toBe(true);
    expect(second.layers.destroyed).toBe(true);
  });

  it("should let an early self-destroy leave the parent nothing to do", () => {
    const scope = createScope();
    const { plot, layers } = mount(scope);

    plot.destroy();
    expect(layers.destroyed).toBe(true);

    expect(() => scope.dispose()).not.toThrow();
  });

  it("should destroy on the spot when mounted into a disposed scope", () => {
    const scope = createScope();
    scope.dispose();

    const { layers } = mount(scope);

    // A closed scope runs late registrations immediately — a chart born
    // under a dead lifetime must not live unowned.
    expect(layers.destroyed).toBe(true);
  });

  it("should still tear down by itself with no scope given", () => {
    const { plot, layers } = mount();

    plot.destroy();

    expect(layers.destroyed).toBe(true);
  });
});
