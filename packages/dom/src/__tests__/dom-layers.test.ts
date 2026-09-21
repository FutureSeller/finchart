// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderError } from "@finchart/core";
import { createDomLayers } from "../dom-layers";
import { requireOverlayElement } from "../overlay-element";
import type { Canvas2DContext, ChartLayers } from "@finchart/core";

/** `ChartLayers.overlay` is unknown — narrow it through the same door a consumer would. */
function overlayOf(layers: ChartLayers): HTMLElement {
  return requireOverlayElement(layers.overlay, "test: no overlay");
}

/**
 * jsdom doesn't provide a 2D context. What's under test is DOM structure,
 * style, and lifecycle, not canvas drawing, so only `getContext` is
 * stubbed and everything else runs the real path unchanged.
 */
function stubContext(context: Canvas2DContext | null) {
  return vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
}

let transforms: number[][] = [];

function makeContext(): Canvas2DContext {
  transforms = [];
  return {
    setTransform: (...args: number[]) => transforms.push(args),
  } as unknown as Canvas2DContext;
}

let fakeContext: Canvas2DContext;

/** jsdom's default DPR is 1, so it's swapped in directly. */
function setDevicePixelRatio(ratio: number) {
  Object.defineProperty(window, "devicePixelRatio", {
    value: ratio,
    configurable: true,
  });
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  fakeContext = makeContext();
  stubContext(fakeContext);
  setDevicePixelRatio(1);
});

afterEach(() => {
  vi.restoreAllMocks();
  container.remove();
});

function canvasOf(element: HTMLElement) {
  return element.querySelector("canvas");
}

describe("createDomLayers", () => {
  it("should append a canvas and an overlay", () => {
    createDomLayers(container, 800, 600);

    expect(container.children).toHaveLength(2);
    expect(canvasOf(container)).not.toBeNull();
  });

  it("should size the canvas to the requested dimensions", () => {
    createDomLayers(container, 640, 480);

    const canvas = canvasOf(container);
    expect(canvas?.width).toBe(640);
    expect(canvas?.height).toBe(480);
  });

  it("should expose the canvas size through the data surface", () => {
    const layers = createDomLayers(container, 640, 480);

    expect(layers.data.width).toBe(640);
    expect(layers.data.height).toBe(480);
  });

  it("should stack the layers on top of each other", () => {
    const layers = createDomLayers(container, 800, 600);
    const canvas = canvasOf(container)!;

    expect(container.style.position).toBe("relative");
    expect(canvas.style.position).toBe("absolute");
    expect(overlayOf(layers).style.position).toBe("absolute");
  });

  it("should not override a container position the caller already set", () => {
    container.style.position = "fixed";

    createDomLayers(container, 800, 600);

    expect(container.style.position).toBe("fixed");
  });

  it("should let pointer events through the overlay", () => {
    const layers = createDomLayers(container, 800, 600);

    // If the overlay swallowed events, pan/zoom would be blocked.
    expect(overlayOf(layers).style.pointerEvents).toBe("none");
  });

  it("should put the overlay above the canvas in DOM order", () => {
    const layers = createDomLayers(container, 800, 600);

    expect(container.children[0].tagName).toBe("CANVAS");
    expect(container.children[1]).toBe(layers.overlay);
  });

  it("should resize the real canvas element", () => {
    const layers = createDomLayers(container, 800, 600);

    layers.resize(400, 300);

    const canvas = canvasOf(container)!;
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(layers.data.width).toBe(400);
  });

  it("should hand back the acquired 2d context", () => {
    const layers = createDomLayers(container, 800, 600);

    expect(layers.data.context).toBe(fakeContext);
  });

  it("should wear the cursor on the canvas, not the container", () => {
    const layers = createDomLayers(container, 800, 600);
    const canvas = container.querySelector("canvas")!;

    layers.setCursor?.("grabbing");
    expect(canvas.style.cursor).toBe("grabbing");
    expect(container.style.cursor).toBe("");

    layers.setCursor?.(null);
    expect(canvas.style.cursor).toBe("");
  });

  it("should remove both layers on destroy", () => {
    const layers = createDomLayers(container, 800, 600);

    layers.destroy();

    expect(container.children).toHaveLength(0);
  });

  it("should leave sibling nodes alone on destroy", () => {
    const annotation = document.createElement("span");
    container.appendChild(annotation);

    const layers = createDomLayers(container, 800, 600);
    layers.destroy();

    expect(container.children).toHaveLength(1);
    expect(container.children[0]).toBe(annotation);
  });

  it("should throw a RenderError when no 2d context is available", () => {
    vi.restoreAllMocks();
    stubContext(null);

    expect(() => createDomLayers(container, 800, 600)).toThrow(RenderError);
  });
});

describe("screen density", () => {
  it("should size the backing store in physical pixels", () => {
    setDevicePixelRatio(2);

    createDomLayers(container, 800, 600);

    const canvas = canvasOf(container)!;
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
  });

  it("should keep the CSS box at the logical size", () => {
    setDevicePixelRatio(2);

    createDomLayers(container, 800, 600);

    const canvas = canvasOf(container)!;
    expect(canvas.style.width).toBe("800px");
    expect(canvas.style.height).toBe("600px");
  });

  it("should still report the logical size to the chart", () => {
    setDevicePixelRatio(3);

    const layers = createDomLayers(container, 800, 600);

    // Layout, overlay, and pointer are all in CSS pixels — leaking physical
    // pixels here would throw axis labels and dividers entirely out of sync.
    expect(layers.data.width).toBe(800);
    expect(layers.data.height).toBe(600);
  });

  it("should push the ratio into the context transform", () => {
    setDevicePixelRatio(2);

    createDomLayers(container, 800, 600);

    expect(transforms.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it("should re-apply the transform after a resize", () => {
    setDevicePixelRatio(2);
    const layers = createDomLayers(container, 800, 600);

    layers.resize(400, 300);

    // Assigning canvas.width wipes context state, so the transform has to be reapplied.
    expect(transforms.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
    expect(canvasOf(container)!.width).toBe(800);
    expect(layers.data.width).toBe(400);
  });

  it("should change nothing on an ordinary display", () => {
    setDevicePixelRatio(1);

    const layers = createDomLayers(container, 800, 600);

    expect(canvasOf(container)!.width).toBe(800);
    expect(layers.data.width).toBe(800);
  });
});

describe("the backing store is only reacquired when it needs to be", () => {
  /**
   * `canvas.width` wipes the bitmap even when set to the same value. Plot
   * calls `resize` on every frame, so without a guard here the screen would
   * be cleared every single frame. Whether `setTransform` was called is the
   * evidence of whether it was reacquired.
   */
  it("should do nothing when the size has not changed", () => {
    const layers = createDomLayers(container, 400, 300);
    transforms.length = 0;

    layers.resize(400, 300);
    layers.resize(400, 300);

    expect(transforms).toEqual([]);
  });

  it("should resize when the size actually changes", () => {
    const layers = createDomLayers(container, 400, 300);
    transforms.length = 0;

    layers.resize(500, 300);

    expect(transforms).toHaveLength(1);
    expect(layers.data.width).toBe(500);
  });

  it("should follow a devicePixelRatio change at the same size", () => {
    // Moving the window to a different monitor changes only the ratio, size stays the same.
    const layers = createDomLayers(container, 400, 300);
    transforms.length = 0;

    setDevicePixelRatio(3);
    layers.resize(400, 300);

    expect(transforms).toEqual([[3, 0, 0, 3, 0, 0]]);
  });
});

it("does not publish children or change container style when context acquisition fails", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  expect(() => createDomLayers(container, 100, 100)).toThrow(/2D context/);
  expect(container.childElementCount).toBe(0);
  expect(container.style.position).toBe("");
});

it("does not publish children when backing store initialization throws", () => {
  fakeContext.setTransform = () => { throw new Error("transform failed"); };
  expect(() => createDomLayers(container, 100, 100)).toThrow(/transform failed/);
  expect(container.childElementCount).toBe(0);
});
