import { describe, expect, it } from "vitest";
import { fakeLayersFactory } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { Plot } from "../plot";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { manualScheduler } from "../scheduler";
import { defaultConfig, defaultSize } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A Plot whose frame is advanced by hand. renders is the number of actual draws. */
function mountScheduled() {
  const schedule = manualScheduler();
  const factory = fakeLayersFactory();

  const plot = new Plot({
    deps: {
      ...testBrowserDeps(),
      createLayers: factory.createLayers,
      createScheduler: schedule,
    },
    config: defaultConfig,
    size: defaultSize,
  });

  const handle = plot.mainPane.addSeries({ series: lineSeries() });

  let renders = 0;
  plot.on("render", () => renders++);

  return {
    plot,
    handle,
    scheduler: schedule.created[0],
    frame: () => schedule.created[0].flush(),
    get renders() {
      return renders;
    },
  };
}

describe("render scheduling", () => {
  it("should not draw until the frame arrives", () => {
    const chart = mountScheduled();

    chart.handle.setData(data);
    expect(chart.renders).toBe(0);

    chart.frame();
    expect(chart.renders).toBe(1);
  });

  it("should collapse a burst of pans into one render", () => {
    const chart = mountScheduled();
    chart.handle.setData(data);
    chart.frame();

    // As many as a high-polling-rate pointer would push into one frame.
    for (let i = 0; i < 12; i++) chart.plot.panByPixels(3);

    expect(chart.renders).toBe(1); // still just the earlier frame's
    chart.frame();
    expect(chart.renders).toBe(2);
  });

  it("should collapse composition mounting many series into one render", () => {
    const chart = mountScheduled();
    chart.handle.setData(data);
    chart.frame();

    // Four <ChartSeries> instances, each registering from its own effect.
    const pane = chart.plot.addPane();
    for (let i = 0; i < 4; i++) pane.addSeries(lineSeries());

    chart.frame();
    expect(chart.renders).toBe(2); // 5 changes, but only one more render
  });

  it("should drop the pending frame when render is called directly", () => {
    const chart = mountScheduled();

    chart.handle.setData(data);
    chart.plot.render();

    expect(chart.renders).toBe(1);
    expect(chart.scheduler.pending).toBe(false);

    chart.frame();
    expect(chart.renders).toBe(1);
  });

  it("should cancel a pending frame on destroy", () => {
    const chart = mountScheduled();

    chart.handle.setData(data);
    chart.plot.destroy();

    expect(chart.scheduler.pending).toBe(false);
    chart.frame();
    expect(chart.renders).toBe(0);
  });
});
