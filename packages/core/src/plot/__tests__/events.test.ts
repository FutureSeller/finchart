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
  it("should still reach later handlers when one unsubscribes itself", () => {
    const { plot, handle } = mount();
    const heard: string[] = [];

    // This is exactly the shape of an effect cleanup.
    const off = plot.on("render", () => {
      heard.push("a");
      off();
    });
    plot.on("render", () => heard.push("b"));
    plot.on("render", () => heard.push("c"));

    handle.setData(data);

    expect(heard).toEqual(["a", "b", "c"]);
  });

  it("should not run a handler subscribed during the same emit", () => {
    const { plot, handle } = mount();
    const heard: string[] = [];

    plot.on("render", () => {
      heard.push("a");
      plot.on("render", () => heard.push("late"));
    });

    handle.setData(data);
    expect(heard).toEqual(["a"]);

    // It joins starting from the next round.
    plot.render();
    expect(heard).toEqual(["a", "a", "late"]);
  });

  it("should keep the two registrations apart when the same function is added twice", () => {
    const { plot, handle } = mount();
    let calls = 0;
    const handler = () => {
      calls += 1;
    };

    const off = plot.on("render", handler);
    plot.on("render", handler);
    off();

    handle.setData(data);

    // Each disposer removes only its own registration.
    expect(calls).toBe(1);
  });

  /** A bug where registering the same function twice and calling the first disposer twice made indexOf remove the remaining registration too. */
  it("should not drop the other registration when one disposer runs twice", () => {
    const { plot, handle } = mount();
    let calls = 0;
    const handler = () => {
      calls += 1;
    };

    const off = plot.on("render", handler);
    plot.on("render", handler);
    off();
    off();

    handle.setData(data);

    expect(calls).toBe(1);
  });

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
