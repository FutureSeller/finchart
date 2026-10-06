import { barIndexX, candleSeries, createPlotModel, manualScheduler } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { focusRecent } from "../stage";

describe("initial example view", () => {
  it("waits for browser-style deferred layout at 492px and applies zoom only once", () => {
    const scheduler = manualScheduler();
    const data = Array.from({ length: 300 }, (_, i) => ({
      x: i * 60_000, open: 100, high: 110, low: 90, close: 105,
    }));
    const model = createPlotModel({
      size: { width: 492, height: 844 },
      deps: { createXMapping: barIndexX, createScheduler: scheduler },
    });
    model.plot.mainPane.addSeries({ series: candleSeries(), data });
    const area = model.plot.mainPane.area;
    expect(area.right - area.left).toBe(0);
    const before = model.plot.getVisibleRange();
    focusRecent(model.plot, data);
    expect(model.plot.getVisibleRange()).toEqual(before);
    scheduler.created[0].flush();
    const visible = model.plot.getVisibleRange()!;
    const bars = (visible.max - visible.min) / 60_000;
    expect(bars).toBeGreaterThan(30);
    expect(bars).toBeLessThan(65);
    model.plot.setVisibleRange(data[10].x, data[90].x);
    const userView = model.plot.getVisibleRange();
    scheduler.created[0].flush();
    expect(model.plot.getVisibleRange()).toEqual(userView);
    model.plot.destroy();
  });

  for (const indexed of [false, true]) {
    it(`opens recent candles at readable spacing (${indexed ? "bar index" : "continuous"})`, () => {
      const data = Array.from({ length: 300 }, (_, i) => ({
        x: i * 60_000, open: 100, high: 110, low: 90, close: 105,
      }));
      const model = createPlotModel({
        size: { width: 320, height: 400 },
        deps: indexed ? { createXMapping: barIndexX } : {},
      });
      const handle = model.plot.mainPane.addSeries({ series: candleSeries(), data });
      focusRecent(model.plot, data);
      const range = model.plot.getVisibleRange()!;
      expect(range.max - range.min).toBeLessThan(40 * 60_000);
      expect(range.min).toBeGreaterThan(data[250].x);
      expect(range.max).toBeGreaterThanOrEqual(data.at(-1)!.x);
      expect(handle.read()).toHaveLength(300);
      model.plot.fitDomains();
      expect(model.plot.getVisibleRange()!.min).toBeLessThanOrEqual(data[0].x);
      model.plot.destroy();
    });
  }
});
