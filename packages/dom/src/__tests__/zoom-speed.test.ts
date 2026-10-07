// @vitest-environment jsdom
/**
 * `zoomSpeed`'s domain — three ranges behave differently:
 *
 * - `> 1` — the thing the docs advertise
 * - `= 1` — nothing happens (×1 in both directions). Silent.
 * - `< 1` — direction flips (zoom-in becomes zoom-out). This can be a
 *   legitimate natural-scroll preference, so there's deliberately no guard
 *   against it.
 * - `0`, negative, `NaN` — rejected by core at the first wheel event, not at
 *   configuration time
 *
 * This test pins down that domain — leaving it as prose alone means the
 * next person reinvents the guard.
 */
import { lineSeries, type InteractionTarget, type Point } from "@finchart/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testBrowserDeps } from "./fakes";
import { mountPlot } from "./helpers";
import { PointerInteractions } from "../pointer";

function recordingTarget() {
  const pixelZooms: Array<{ factor: number; screenX: number }> = [];
  const target: InteractionTarget = {
    routeInput: () => false,
    fitDomains: () => undefined,
    click: () => undefined,
    doubleClick: () => undefined,
    contextMenu: () => undefined,
    pan: () => undefined,
    panByPixels: () => undefined,
    zoom: () => undefined,
    zoomAtPixel: (factor, screenX) => void pixelZooms.push({ factor, screenX }),
    crosshair: (_position: Point | null) => undefined,
  };
  return { target, pixelZooms };
}

let element: HTMLElement;

beforeEach(() => {
  element = document.createElement("div");
  document.body.appendChild(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  element.remove();
});

const wheel = (deltaY: number) =>
  element.dispatchEvent(
    new WheelEvent("wheel", { deltaY, clientX: 100, cancelable: true }),
  );

describe("zoomSpeed's domain", () => {
  it("below 1, direction flips — this is the docs' territory, not a guard's", () => {
    const { target, pixelZooms } = recordingTarget();
    new PointerInteractions(element, { zoomSpeed: 0.9 }).connect(target);

    wheel(-100); // conventionally zoom in
    wheel(100); // conventionally zoom out

    // The "zoom in" factor is below 1 = actually zooming out. The flip shows up directly in the value.
    expect(pixelZooms[0].factor).toBeCloseTo(0.9);
    expect(pixelZooms[1].factor).toBeCloseTo(1 / 0.9);
  });

  it("at 1, nothing happens — ×1 in both directions", () => {
    const { target, pixelZooms } = recordingTarget();
    new PointerInteractions(element, { zoomSpeed: 1 }).connect(target);

    wheel(-100);
    wheel(100);

    expect(pixelZooms.map((z) => z.factor)).toEqual([1, 1]);
  });

  it("0 passes through the wiring silently, unchanged to the first wheel event", () => {
    const { target, pixelZooms } = recordingTarget();

    // (1) The wiring succeeds silently — nobody checks at configuration time.
    expect(() =>
      new PointerInteractions(element, { zoomSpeed: 0 }).connect(target),
    ).not.toThrow();

    // (2) And the first wheel event carries that 0 through as-is.
    wheel(-100);
    expect(pixelZooms[0].factor).toBe(0);
  });

  it("control group: the default (1.1) zooms in on the same wheel event", () => {
    const { plot } = mountPlot({
      deps: testBrowserDeps(),
      series: lineSeries(),
      data: [
        { x: 0, y: 10 },
        { x: 100, y: 20 },
      ],
    });
    plot.setVisibleRange(0, 100);
    const interactions = new PointerInteractions(element);
    interactions.connect(plot);

    // jsdom swallows listener errors, so a throw can't be asserted here —
    // the window narrowing is what proves the zoom went through.
    wheel(-100);

    const range = plot.getVisibleRange();
    expect(range && range.max - range.min).toBeCloseTo(100 / 1.1);

    interactions.disconnect();
    plot.destroy();
  });
});
