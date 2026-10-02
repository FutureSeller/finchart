/**
 * A listener that throws reports its error, but the change it was told about
 * still finishes: the value axes fit and a frame is still requested.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeLayersFactory, testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import { manualScheduler } from "../../render";
import { lineSeries } from "../../series";
import { Plot } from "../plot";
import { defaultConfig, defaultSize } from "./helpers";

function mount() {
  const schedule = manualScheduler();
  const { deps, xScale } = testBrowserDepsWithScales();
  const plot = new Plot({
    deps: { ...deps, createLayers: fakeLayersFactory().createLayers, createScheduler: schedule },
    config: defaultConfig,
    size: defaultSize,
  });
  const scheduler = schedule.created[0];
  scheduler.flush();
  return { plot, scheduler, xScale };
}

const boom = () => {
  throw new Error("listener boom");
};

describe("a throwing listener", () => {
  it("does not stop the first data's y fit or its frame", () => {
    const { plot, scheduler } = mount();
    const handle = plot.mainPane.addSeries({ series: lineSeries() });
    scheduler.flush();
    plot.on("xDomainChange", boom);

    expect(() => handle.setData([{ x: 10, y: 100 }, { x: 11, y: 200 }])).toThrow(/listener boom/);

    const [min, max] = plot.mainPane.yScale.getDomain();
    expect(min).toBeLessThanOrEqual(100);
    expect(max).toBeGreaterThanOrEqual(200);
    expect(scheduler.pending).toBe(true);
  });

  it("does not stop the frame after a pane option change", () => {
    const { plot, scheduler } = mount();
    plot.on("panesChange", boom);

    expect(() => plot.mainPane.applyOptions({ flex: 2 })).toThrow(/listener boom/);

    expect(plot.mainPane.flex).toBe(2);
    expect(scheduler.pending).toBe(true);
  });

  it("still hands back the pane from addPane, and reports the error out of band", () => {
    const { plot, scheduler } = mount();
    plot.on("panesChange", boom);
    const later: (() => void)[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((task) => void later.push(task));

    const pane = plot.addPane();

    expect(plot.panes).toEqual([plot.mainPane, pane]);
    expect(scheduler.pending).toBe(true);
    expect(later).toHaveLength(1);
    expect(later[0]).toThrow(/listener boom/);
    vi.restoreAllMocks();
  });
});

describe("the first x fit", () => {
  it("announces its window even when it equals the scale's starting domain", () => {
    const { plot, xScale } = mount();
    const windows: [number, number][] = [];
    plot.on("xDomainChange", ({ startX, endX }) => windows.push([startX, endX]));
    const [min, max] = xScale.getDomain();

    plot.mainPane.addSeries({ series: lineSeries(), data: [{ x: min, y: 1 }, { x: max, y: 2 }] });

    expect(xScale.getDomain()).toEqual([min, max]);
    expect(windows).toEqual([[min, max]]);
  });
});
