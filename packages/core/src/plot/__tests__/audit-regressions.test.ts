import { describe, expect, it, vi } from "vitest";
import { createPlotModel } from "../model";
import { Plot } from "../plot";
import { createPlotDeps } from "../presets";
import { distributeHeights } from "../layout";
import { createMemoryLayers, noStyle, recordingRenderer } from "../../render";
import { seriesSpec } from "../../registration";
import { lineSeries } from "../../series";
import { pluginApi } from "../../primitives";

const size = { width: 400, height: 300 };

describe("audit: transaction and ownership boundaries", () => {
  it("keeps every reused sibling and comparison baseline unchanged when a later feed fails", () => {
    const { plot } = createPlotModel({ size });
    const series = lineSeries();
    const a = seriesSpec({ id: "a", series, data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] });
    const b = seriesSpec({ id: "b", series, data: [{ x: 0, y: 3 }, { x: 1, y: 4 }] });
    plot.mainPane.syncSeries([a, b]);
    const changed = vi.fn();
    plot.mainPane.subscribe(changed);
    expect(() => plot.mainPane.syncSeries([
      seriesSpec({ id: "a", series, data: [{ x: 0, y: 99 }] }),
      seriesSpec({ id: "b", series, data: [{ x: 1, y: 4 }, { x: 0, y: 3 }] }),
    ])).toThrow(/sorted/);
    expect(plot.mainPane.probe(0).map(sample => sample.value)).toEqual([1, 3]);
    expect(changed).not.toHaveBeenCalled();
    plot.mainPane.syncSeries([a, b]);
    expect(plot.mainPane.probe(0).map(sample => sample.value)).toEqual([1, 3]);
    plot.mainPane.syncSeries([seriesSpec({ id: "a", series, data: [{ x: 0, y: 99 }] }), b]);
    expect(plot.mainPane.probe(0).map(sample => sample.value)).toEqual([99, 3]);
    expect(changed).toHaveBeenCalledTimes(1);
    plot.destroy();
  });

  it("disposes an API returned after its plot or pane is destroyed during installation", () => {
    const { plot } = createPlotModel({ size });
    const pane = plot.addPane();
    const paneCleanup = vi.fn();
    const paneApi = pane.use(() => {
      plot.removePane(pane);
      return pluginApi({}, paneCleanup);
    });
    expect(paneApi.disposed).toBe(true);
    const cleanup = vi.fn();
    const api = plot.use(host => {
      host.destroy();
      return pluginApi({}, cleanup);
    });
    plot.destroy();
    expect(api.disposed).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(paneCleanup).toHaveBeenCalledTimes(1);
  });

  it("releases acquired layers and scheduler after renderer construction fails", () => {
    const destroy = vi.fn();
    const cancel = vi.fn();
    const failure = new Error("renderer failed");
    const deps = createPlotDeps({
      createLayers: (w, h) => ({ ...createMemoryLayers(w, h), destroy }),
      createRenderer: () => { throw failure; },
      createScheduler: () => ({ request() {}, cancel }),
      createStyleReader: () => noStyle,
    });
    expect(() => new Plot({ deps, size })).toThrow(failure);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the original failure and finishes rollback when one release also fails", () => {
    const destroy = vi.fn();
    const original = new Error("observer failed");
    const cleanup = new Error("disconnect failed");
    const deps = createPlotDeps({
      createLayers: (w, h) => ({ ...createMemoryLayers(w, h), destroy }),
      createRenderer: recordingRenderer().factory,
      createStyleReader: () => noStyle,
      interactions: { handlePan() {}, handleZoom() {}, handleCrosshair() {}, connect() {}, disconnect() { throw cleanup; } },
      observeSize: () => { throw original; },
    });
    let caught: unknown;
    try { new Plot({ deps, size }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) throw new Error("expected aggregate");
    expect(caught.errors).toEqual([original, cleanup]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("releases plugins installed by a collaborator before constructor failure", () => {
    const cleanup = vi.fn();
    const destroy = vi.fn();
    const deps = createPlotDeps({
      createLayers: (w, h) => ({ ...createMemoryLayers(w, h), destroy }),
      createRenderer: recordingRenderer().factory,
      createStyleReader: () => noStyle,
      interactions: {
        handlePan() {}, handleZoom() {}, handleCrosshair() {}, disconnect() {},
        connect(host) {
          if (!(host instanceof Plot)) throw new Error("expected plot");
          host.use(() => pluginApi({}, cleanup));
          throw new Error("connect failed");
        },
      },
    });
    expect(() => new Plot({ deps, size })).toThrow("connect failed");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("copies owned nested option records at patch and constructor ingress", () => {
    const { plot } = createPlotModel({ size });
    const grid = { color: "red" };
    plot.applyOptions({ style: { grid } });
    grid.color = "blue";
    expect(plot.getOptions().style?.grid?.color).toBe("red");
    const axis = { format: () => "before" };
    const pane = plot.addPane({ axis });
    axis.format = () => "after";
    expect(pane.axis.format?.(1)).toBe("before");
    plot.destroy();
  });

  it("preserves ratios when finite layout weights or floors overflow their sum", () => {
    expect(distributeHeights([{ flex: 1e308, minHeight: 0 }, { flex: 1e308, minHeight: 0 }], 100, 0)).toEqual([50, 50]);
    expect(distributeHeights([{ flex: 1, minHeight: 1e308 }, { flex: 1, minHeight: 1e308 }], 100, 0)).toEqual([50, 50]);
    expect(distributeHeights([{ flex: 1e308, minHeight: 60 }, { flex: 1e308, minHeight: 0 }], 100, 0)).toEqual([60, 40]);
  });
});
