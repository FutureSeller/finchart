import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 1 },
  { x: 10, y: 2 },
];

const mount = () =>
  mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig });

describe("event subscription", () => {
  // The channel's own semantics (self-unsubscribe mid-emit, late joiners,
  // duplicate registrations) are pinned in event-channel.test.ts. These
  // only check that Plot.on is wired to it.
  it("should be safe to unsubscribe twice", () => {
    const { plot, handle } = mount();
    let calls = 0;

    const off = plot.on("render", () => calls++);
    const other = plot.on("render", () => calls++);

    off();
    off();

    handle.setData(data);
    other();

    expect(calls).toBe(1);
  });

  it("should keep handlers of different events apart", () => {
    const { plot, handle } = mount();
    const heard: string[] = [];

    plot.on("render", () => heard.push("render"));
    plot.on("xDomainChange", () => heard.push("domain"));
    plot.on("crosshair", () => heard.push("crosshair"));

    handle.setData(data);
    plot.crosshair({ x: 100, y: 100 });

    expect(heard).toEqual(["domain", "render", "crosshair"]);
  });

  it("should drop every handler on destroy", () => {
    const { plot, handle } = mount();
    let calls = 0;

    plot.on("render", () => calls++);
    handle.setData(data);
    expect(calls).toBe(1);

    plot.destroy();
    plot.render();

    expect(calls).toBe(1);
  });
});

describe("after destroy", () => {
  it("should ignore render and every mutation", () => {
    const { plot, handle, layers } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig, data });

    plot.destroy();
    const quiet = layers.context.calls.length;

    plot.render();
    handle.setData(data);
    plot.pan(10);
    plot.applyOptions({ showGrid: false });

    // It doesn't touch the torn-down layers again. It doesn't throw either
    // — a handler arriving late mid-unmount calling it is a normal path.
    expect(layers.context.calls.length).toBe(quiet);
  });
});


/**
 * **The crosshair can be nowhere.** `crosshair(null)` is the door for the
 * pointer leaving: subscribers get `null` once, and a tooltip or legend
 * holding the last value lets go of it.
 */
describe("crosshair(null)", () => {
  it("emits null to every subscriber", () => {
    const { plot } = mount();
    const heard: unknown[] = [];
    plot.on("crosshair", (payload) => heard.push(payload));

    plot.crosshair({ x: 100, y: 100 });
    plot.crosshair(null);

    expect(heard).toHaveLength(2);
    expect(heard[0]).not.toBeNull();
    expect(heard[1]).toBeNull();
  });

  /**
   * Said once. Every emitter passes through this door — the pointer
   * interactions, a drawing tool, a consumer — and a browser tells one
   * departure twice (`pointercancel`, then `pointerleave`). A position in
   * between makes the next `null` a new departure.
   */
  it("says null once until a position is heard again", () => {
    const { plot } = mount();
    const heard: unknown[] = [];
    plot.on("crosshair", (payload) => heard.push(payload));

    plot.crosshair(null);
    plot.crosshair(null);
    plot.crosshair({ x: 100, y: 100 });
    plot.crosshair(null);
    plot.crosshair(null);

    expect(heard.map((payload) => payload === null)).toEqual([true, false, true]);
  });

  it("does not count a refused position as a position", () => {
    const { plot } = mount();
    const heard: unknown[] = [];
    plot.on("crosshair", (payload) => heard.push(payload));

    plot.crosshair(null);
    expect(() => plot.crosshair({ x: Number.NaN, y: 0 })).toThrow();
    plot.crosshair(null);

    expect(heard).toEqual([null]);
  });
});
