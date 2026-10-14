/**
 * Follows the container's size — this is the core's job to do. How to
 * observe is itself injected — the core's tests run under node so there is
 * no ResizeObserver, and on the server there's nothing to observe at all.
 */
import { describe, expect, it, vi } from "vitest";
import { ContractError } from "../../primitives";
import { lineSeries } from "../../series";
import type { SizeObserver } from "../../render";
import {
  fakeContainer,
  fakeLayersFactory,
  type FakeLayers,
} from "../../__tests__/dom-fakes";
import { Plot } from "../plot";
import type { SchedulerFactory } from "../../render";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, defaultSize } from "./helpers";

/** A fake observer whose resize can be fired by hand — assembly wires the element ahead of time, and Plot only plugs in the callback. */
function fakeObserver() {
  let notify: ((width: number, height: number) => void) | null = null;
  const disconnect = vi.fn();

  const observeSize: SizeObserver = (onResize) => {
    notify = onResize;
    return disconnect;
  };

  return {
    observeSize,
    disconnect,
    get connected() {
      return notify !== null;
    },
    resize(width: number, height: number) {
      if (!notify) throw new Error("nothing is observing");
      notify(width, height);
    },
  };
}

/** A scheduler that only queues requests — since node has no rAF and runs
 * immediately by default, this lets us step by hand between scheduling
 * and drawing to observe what happens in between. */
function heldScheduler(): SchedulerFactory {
  return () => ({ request: () => undefined, cancel: () => undefined });
}

function mount(observeSize?: SizeObserver, createScheduler?: SchedulerFactory) {
  const factory = fakeLayersFactory();
  const container = fakeContainer();
  const plot = new Plot({
    deps: {
      ...testBrowserDeps(),
      createLayers: factory.createLayers,
      observeSize,
      ...(createScheduler ? { createScheduler } : {}),
    },
    config: defaultConfig,
    size: defaultSize,
  });

  const handle = plot.mainPane.addSeries({ series: lineSeries() });

  return { plot, handle, container, layers: factory.created[0] as FakeLayers };
}

describe("autoSize", () => {
  it("should connect the observer it was given", () => {
    const observer = fakeObserver();
    mount(observer.observeSize);

    expect(observer.connected).toBe(true);
  });

  it("should resize the layers when the container changes", () => {
    const observer = fakeObserver();
    const { layers } = mount(observer.observeSize);

    observer.resize(1024, 768);

    expect(layers.data.width).toBe(1024);
    expect(layers.data.height).toBe(768);
  });

  /**
   * An observer that knows the size up front reports it while the plot is
   * being built. The first frame must be drawn at that size: drawn at the
   * size the plot was built with, it shows the wrong picture until the fit.
   */
  it("should draw the first frame at a size reported while it is built", () => {
    const observeSize: SizeObserver = (onResize) => {
      onResize(1024, 768);
      return () => undefined;
    };
    const { plot, layers } = mount(observeSize, heldScheduler());
    const resized: number[][] = [];
    const original = layers.resize.bind(layers);
    layers.resize = (w: number, h: number) => {
      resized.push([w, h]);
      original(w, h);
    };

    plot.render();

    expect(resized).toEqual([[1024, 768]]);
  });

  /**
   * The default scheduler draws at once — the frame is drawn while the plot
   * is still being built.
   */
  it("should draw at a size reported while it is built, without a scheduler", () => {
    const factory = fakeLayersFactory();
    new Plot({
      deps: {
        ...testBrowserDeps(),
        createLayers: factory.createLayers,
        observeSize: (onResize) => {
          onResize(1024, 768);
          return () => undefined;
        },
      },
      config: defaultConfig,
      size: defaultSize,
    });

    const [layers] = factory.created;
    expect(layers?.data.width).toBe(1024);
    expect(layers?.data.height).toBe(768);
  });

  /**
   * A size that isn't positive and finite — zero on either axis, negative,
   * NaN or Infinity — is not a size to follow. Reported while the plot is
   * built, it must not fail the build.
   */
  it.each([
    [0, 300],
    [500, 0],
    [500, -1],
    [Number.NaN, 300],
    [Number.POSITIVE_INFINITY, 300],
    [300, Number.POSITIVE_INFINITY],
  ])("should ignore a size that is not positive and finite: %s x %s", (width, height) => {
    const observeSize: SizeObserver = (onResize) => {
      onResize(width, height);
      return () => undefined;
    };

    const { layers } = mount(observeSize);

    expect(layers.data.width).toBe(defaultSize.width);
    expect(layers.data.height).toBe(defaultSize.height);
  });

  it("should ignore a repeat of the size it already has", () => {
    const observer = fakeObserver();
    const { plot, layers } = mount(observer.observeSize);
    const renders = vi.fn();
    plot.on("render", renders);

    // ResizeObserver fires once with the current size when observation starts.
    observer.resize(layers.data.width, layers.data.height);

    expect(renders).not.toHaveBeenCalled();
  });

  it("should ignore a zero size", () => {
    const observer = fakeObserver();
    const { layers } = mount(observer.observeSize);

    // display:none delivers 0. Taking it at face value makes the scale divide by zero.
    observer.resize(0, 0);

    expect(layers.data.width).toBe(defaultSize.width);
  });

  it("should stop watching when the plot is destroyed", () => {
    const observer = fakeObserver();
    const { plot } = mount(observer.observeSize);

    plot.destroy();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("should not resize after destroy", () => {
    const observer = fakeObserver();
    const { plot, layers } = mount(observer.observeSize);
    plot.destroy();

    // A notification already queued arriving late is a normal path.
    expect(() => observer.resize(1024, 768)).not.toThrow();
    expect(layers.data.width).toBe(defaultSize.width);
  });
});

describe("flicker during resize", () => {
  /**
   * Clearing the bitmap and redrawing it must be a single task. Assigning
   * canvas.width clears the bitmap immediately; if setViewport cleared
   * right there while deferring the draw to rAF, an empty canvas would be
   * visible — and flicker — for one frame.
   */
  it("should not touch the layers before the frame is drawn", () => {
    const observer = fakeObserver();
    const { plot, handle, layers } = mount(observer.observeSize, heldScheduler());
    handle.setData([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ]);

    const resized: number[][] = [];
    const original = layers.resize.bind(layers);
    layers.resize = (w: number, h: number) => {
      resized.push([w, h]);
      original(w, h);
    };

    plot.setViewport({ width: 1024, height: 768 });

    // Not yet time to draw — clearing here leaves a blank screen until the next frame.
    expect(resized).toEqual([]);

    plot.render();

    expect(resized).toEqual([[1024, 768]]);
  });

  it("should keep the new size in state between calls, before any render", () => {
    /** State is synchronous, drawing is per-frame — even when the dimensions
     * arrive in separate calls, a second call must not roll back the first
     * using the layer's stale value. */
    const observer = fakeObserver();
    const { plot, layers } = mount(observer.observeSize, heldScheduler());

    plot.setViewport({ width: 1024 });
    plot.setViewport({ height: 768 });
    plot.render();

    expect(layers.data.width).toBe(1024);
    expect(layers.data.height).toBe(768);
  });

  /**
   * An explicit undefined means "not given," not "clear it." A merge by
   * { ...size, ...viewport } treats an explicit undefined as a value,
   * turning the cleared height into NaN; the layout then drops every frame
   * as degenerate and the chart goes blank with no throw.
   */
  it("should ignore an explicitly undefined dimension", () => {
    const observer = fakeObserver();
    const { plot, layers } = mount(observer.observeSize, heldScheduler());

    plot.setViewport({ width: 1024, height: 768 });
    plot.setViewport({ width: 640, height: undefined });
    plot.render();

    expect(layers.data.width).toBe(640);
    expect(layers.data.height).toBe(768);
  });

  describe("chokepoint 3 — setViewport's dimensions", () => {
    it("should reject a non-finite dimension", () => {
      const observer = fakeObserver();
      const { plot } = mount(observer.observeSize, heldScheduler());

      expect(() => plot.setViewport({ width: NaN })).toThrow(ContractError);
      expect(() =>
        plot.setViewport({ height: JSON.parse('{"v":1e999}').v }),
      ).toThrow(ContractError);
    });
  });
});
