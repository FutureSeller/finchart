/**
 * Follows the resolution ratio. The old rationale ("stays blurry until a
 * resize happens") assumed a chart that has some reason to redraw, but a
 * sparkline with no axis and no input never gets that trigger. How to
 * observe is injected — the core's tests run under node, so there is no
 * matchMedia.
 */
import { describe, expect, it, vi } from "vitest";
import type { ResolutionObserver } from "../../render";
import { LinearScale } from "../../scale";
import { lineSeries } from "../../series";
import { fakeLayersFactory, testBrowserDeps } from "../../__tests__/dom-fakes";
import { Plot } from "../plot";
import { defaultConfig, defaultSize } from "./helpers";

/** A fake observer whose ratio change can be fired by hand. **It never passes the new value** — matching the contract. */
function fakeObserver() {
  let notify: (() => void) | null = null;
  const disconnect = vi.fn();

  const observeResolution: ResolutionObserver = (onChange) => {
    notify = onChange;
    return disconnect;
  };

  return {
    observeResolution,
    disconnect,
    get connected() {
      return notify !== null;
    },
    change() {
      if (!notify) throw new Error("nothing is observing");
      notify();
    },
  };
}

function mount(observeResolution?: ResolutionObserver) {
  const factory = fakeLayersFactory();
  const xScale = new LinearScale();
  const plot = new Plot({
    deps: {
      ...testBrowserDeps({ xScale }),
      createLayers: factory.createLayers,
      observeResolution,
    },
    config: defaultConfig,
    size: defaultSize,
  });

  plot.mainPane.addSeries({
    series: lineSeries(),
    data: [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
    ],
  });

  /** Number of draws. The test wiring uses an immediate scheduler, so it increments on the same line as the notification. */
  let renders = 0;
  plot.on("render", () => {
    renders += 1;
  });

  return { plot, xScale, renders: () => renders };
}

describe("resolution ratio observation", () => {
  it("should redraw when the resolution changes", () => {
    const observer = fakeObserver();
    const { renders } = mount(observer.observeResolution);

    const before = renders();
    observer.change();

    // Reading the ratio and re-sizing the backing store is the surface's
    // job — all the core needs to prove is **that it triggered a draw**.
    expect(renders()).toBe(before + 1);
  });

  it("should not move the domain", () => {
    const observer = fakeObserver();
    const { plot, xScale } = mount(observer.observeResolution);

    const domain = xScale.getDomain();
    const area = { ...plot.mainPane.area };

    observer.change();

    // It's only a request to redraw — the ratio never touches the CSS pixel coordinate system.
    expect(xScale.getDomain()).toEqual(domain);
    expect(plot.mainPane.area).toEqual(area);
  });

  it("should be inert when no observer is wired", () => {
    const { plot, renders } = mount(undefined);

    // A stage with nothing wired behaves exactly as before — there's no one to wake it.
    const before = renders();
    plot.render();

    expect(renders()).toBe(before + 1);
    expect(() => plot.destroy()).not.toThrow();
  });

  it("should release the observer on destroy", () => {
    const observer = fakeObserver();
    const { plot } = mount(observer.observeResolution);

    expect(observer.connected).toBe(true);

    plot.destroy();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("should stay silent after destroy", () => {
    const observer = fakeObserver();
    const { plot, renders } = mount(observer.observeResolution);

    plot.destroy();
    const after = renders();

    // A notification that arrives late after teardown must not draw a dead stage.
    observer.change();

    expect(renders()).toBe(after);
  });
});
