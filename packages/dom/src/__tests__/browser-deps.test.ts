// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fillLinearGradient } from "@finchart/core";
import type { DrawSurface } from "@finchart/core";
import { browserDeps, type BrowserDepsOptions } from "../browser-deps";
import { fakeCanvasContext } from "./fakes";

/**
 * The preset's battery — the renderer knows nothing about painters, and
 * browserDeps is what loads the LINEAR_GRADIENT painter. If this contract
 * breaks, a preset consumer's `fillBottom` area style and
 * `charts/linear-gradient` style get demoted to a solid color.
 */
describe("browserDeps's default renderer", () => {
  it("should ship the linear-gradient painter", () => {
    const deps = browserDeps({ pointer: false })(document.createElement("div"));

    // The shared fake has no createLinearGradient — without one it would
    // fall into the painter's error-absorption path (demotion to a solid
    // color), which is indistinguishable from "no painter." So we attach an
    // observable stub to check whether the painter actually tried to build
    // a gradient.
    const context = fakeCanvasContext();
    const gradientAxes: number[][] = [];
    context.createLinearGradient = (x0, y0, x1, y1) => {
      gradientAxes.push([x0, y0, x1, y1]);
      return { addColorStop: () => undefined };
    };
    const surface: DrawSurface = { width: 200, height: 120, context };
    const renderer = deps.createRenderer(surface);

    fillLinearGradient(renderer, {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      from: { x: 0, y: 0 },
      to: { x: 0, y: 10 },
      stops: [
        { offset: 0, color: "#3b82f6" },
        { offset: 1, color: "transparent" },
      ],
    });
    renderer.commit();

    expect(gradientAxes).toEqual([[0, 0, 0, 10]]);
  });
});

/**
 * Unlike `autoSize`, resolution observation defaults to on — following the
 * pixel ratio isn't something worth choosing about (coordinates stay in CSS
 * pixels either way). Without it, a chart that never redraws goes blurry
 * and stays that way.
 */
describe("browserDeps's resolution observation", () => {
  it("should follow the device pixel ratio by default", () => {
    const deps = browserDeps({ pointer: false })(document.createElement("div"));

    expect(deps.observeResolution).toBeDefined();
  });

  it("should not follow the container size by default", () => {
    const deps = browserDeps({ pointer: false })(document.createElement("div"));

    // The contrasting counterpart — autoSize is still opt-in.
    expect(deps.observeSize).toBeUndefined();
  });

  it("should let the consumer turn it off explicitly", () => {
    const deps = browserDeps({ pointer: false, observeResolution: undefined })(
      document.createElement("div"),
    );

    expect(deps.observeResolution).toBeUndefined();
  });
});

describe("browserDeps's layers", () => {
  const { getContext } = HTMLCanvasElement.prototype;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = getContext;
  });

  const canvasPosition = (options: BrowserDepsOptions) => {
    // jsdom has no 2D context; the layers only need one to exist.
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: () => ({ setTransform: () => undefined }),
    });
    const container = document.createElement("div");
    browserDeps({ pointer: false, ...options })(container).createLayers(100, 100);
    return container.querySelector("canvas")?.style.position;
  };

  it("should keep the canvas out of the flow whether or not the size is followed", () => {
    // The container's own CSS sizes it either way; an in-flow canvas would
    // stop a followed container from shrinking.
    expect(canvasPosition({})).toBe("absolute");
    expect(canvasPosition({ autoSize: true })).toBe("absolute");
  });
});
