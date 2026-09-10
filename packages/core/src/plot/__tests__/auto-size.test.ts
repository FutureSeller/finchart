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
  it("should not observe anything when no observer is wired", () => {
    // "Not given, not done" — no null-object stand-in.
    const { layers } = mount();

    expect(layers.data.width).toBe(defaultSize.width);
  });

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
   * canvas.width clears the bitmap immediately; setViewport used to clear
   * right there while deferring the draw to rAF, so an empty canvas was
   * visible — and flickered — for one frame.
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
   * An explicit undefined means "not given," not "clear it." The previous
   * implementation used { ...size, ...viewport }, and the spread treated
   * an explicit undefined as a value, turning the cleared height into NaN
   * that then leaked into the scale range.
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
