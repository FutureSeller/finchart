import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { createPlotModel } from "../model";
import { syncX } from "../../extensions/sync";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 50, y: 120 },
  { x: 100, y: 110 },
];

const bare = {
  showGrid: false,
  axis: { x: { showLabels: false as const }, y: { showLabels: false as const } },
};

describe("setVisibleRange (2.3)", () => {
  it("should frame the given data window", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: bare,
    });

    model.plot.setVisibleRange(20, 60);

    expect(model.plot.getState().xDomain).toEqual({ min: 20, max: 60 });
  });

  it("should wait for data like a restored state", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 }, config: bare });
    model.plot.setVisibleRange(20, 60);

    model.plot.mainPane.addSeries({ series: lineSeries(), data });

    // Once data arrives, the held window wins over a fit (the same path as H1's pending).
    expect(model.plot.getState().xDomain).toEqual({ min: 20, max: 60 });
  });
});

describe("rightOffset (2.3)", () => {
  it("should leave room after the last bar on refit", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: { ...bare, rightOffset: 10 },
    });

    expect(model.plot.getState().xDomain!.max).toBe(110);
    // A user's pan is unconstrained.
    model.plot.pan(-5);
    expect(model.plot.getState().xDomain!.max).toBe(105);
  });
});

describe("barSpacing limits (2.3)", () => {
  it("should stop zooming in at minBarSpacing... no, at maxBarSpacing", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: { ...bare, maxBarSpacing: 40 },
    });
    const width = 800 - 4 - 16; // left/right padding (no labels — zero slice)

    // Zoom in without bound — it must stop at 40px per bar.
    for (let i = 0; i < 30; i++) model.plot.zoom(2, 50);

    const { min, max } = model.plot.getState().xDomain!;
    expect(width / (max - min)).toBeLessThanOrEqual(40 + 1e-9);
  });

  it("should stop zooming out at minBarSpacing", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: { ...bare, minBarSpacing: 2 },
    });
    const width = 800 - 4 - 16;

    for (let i = 0; i < 30; i++) model.plot.zoom(0.5, 50);

    const { min, max } = model.plot.getState().xDomain!;
    expect(width / (max - min)).toBeGreaterThanOrEqual(2 - 1e-9);
  });
});

describe("syncX (2.3)", () => {
  function pair() {
    const make = () =>
      createPlotModel({
        size: { width: 800, height: 600 },
        series: { series: lineSeries(), data },
        config: bare,
      });
    return { a: make().plot, b: make().plot };
  }

  it("should mirror the window both ways without echo loops", () => {
    const { a, b } = pair();
    const release = syncX(a, b);

    a.setVisibleRange(10, 40);
    expect(b.getState().xDomain).toEqual({ min: 10, max: 40 });

    b.pan(5);
    expect(a.getState().xDomain).toEqual(b.getState().xDomain);

    release();
    a.pan(10);
    expect(a.getState().xDomain).not.toEqual(b.getState().xDomain);
  });

  it("should star-wire three plots through the hub without kickback", () => {
    const { a, b } = pair();
    const { a: c, b: d } = pair();
    const release = syncX(a, b, c, d);

    // The hub's (a) change reaches every leaf.
    a.setVisibleRange(10, 40);
    expect(b.getState().xDomain).toEqual({ min: 10, max: 40 });
    expect(c.getState().xDomain).toEqual({ min: 10, max: 40 });
    expect(d.getState().xDomain).toEqual({ min: 10, max: 40 });

    // A leaf's (c) change reaches the other leaves through the hub — each
    // strand's flag only cuts off its own echo, so it doesn't block
    // propagation through the hub.
    c.pan(5);
    const window = c.getState().xDomain;
    expect(a.getState().xDomain).toEqual(window);
    expect(b.getState().xDomain).toEqual(window);
    expect(d.getState().xDomain).toEqual(window);

    // No kickback — the origin stays put once propagation ends (an echo would push the window further).
    expect(c.getState().xDomain).toEqual(window);

    release();
    b.pan(10);
    expect(a.getState().xDomain).not.toEqual(b.getState().xDomain);
    expect(c.getState().xDomain).toEqual(window);
  });

  it("should not double-shift on new bars when every synced plot follows", () => {
    const make = () => {
      const model = createPlotModel({
        size: { width: 800, height: 600 },
        config: { ...bare, shiftVisibleRangeOnNewBar: true },
      });
      const handle = model.plot.mainPane.addSeries({
        series: lineSeries(),
        data: [...data],
      });
      return { plot: model.plot, handle };
    };
    const a = make();
    const b = make();
    syncX(a.plot, b.plot);

    const before = a.plot.getState().xDomain;
    expect(before).not.toBeNull();

    // The same minute closes — each stage receives its own new bar. The
    // first shift to arrive already pushes the other stage's window via
    // sync, so the other stage's own shift only pushes the remaining
    // distance (0) — followNewBar's live-target clamp.
    a.handle.append([{ x: 150, y: 100 }]);
    b.handle.append([{ x: 150, y: 101 }]);

    const after = a.plot.getState().xDomain;
    expect(after!.max - before!.max).toBe(50); // one new bar = 50, not double
    expect(b.plot.getState().xDomain).toEqual(after);
  });
});
