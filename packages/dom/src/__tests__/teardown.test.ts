import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "@finchart/core";
import { lineSeries } from "@finchart/core";
import { browserDeps } from "../browser-deps";
import { requireOverlayElement } from "../overlay-element";
import { asFake, fakeContainer, type FakeElement } from "./fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** Every listener still attached, as "type×count" — a failure names the leak. */
function attached(element: FakeElement): string[] {
  return [...element.listeners.entries()]
    .filter(([, listeners]) => listeners.length > 0)
    .map(([type, listeners]) => `${type}×${listeners.length}`);
}

function dividersOf(overlay: FakeElement): FakeElement[] {
  return overlay.children
    .filter((child) => "data-chart-dividers" in child.attributes)
    .flatMap((root) => root.children);
}

/**
 * The whole browser wiring stood up and torn down in one piece — pointer on
 * the container, dividers and labels in the overlay, drags left mid-flight.
 * The per-collaborator suites check behavior ("stops responding"); this one
 * counts, because a leaked handler that early-returns responds to nothing
 * and stays invisible to behavior checks.
 */
describe("full teardown", () => {
  it("should leave zero listeners on every touched surface after destroy", () => {
    const container = fakeContainer();
    const deps = browserDeps()(container);
    const { plot, handle, layers } = mountPlot({
      deps,
      series: lineSeries(),
      config: {
        ...defaultConfig,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    handle.setData(data);
    plot.addPane().addSeries(lineSeries());

    // Both drags start and neither ends — destroy() lands mid-gesture, the
    // exact moment an SPA route change or React unmount would hit.
    asFake(container).dispatch("pointerdown", { clientX: 100, clientY: 50, button: 0 });
    // The overlay crosses the core contract as `unknown` — narrowed by the
    // same structural door production wiring uses.
    const overlay = asFake(
      requireOverlayElement(layers.overlay, "the fake overlay is an element"),
    );
    const [divider] = dividersOf(overlay);
    divider.dispatch("pointerdown", {
      clientY: 100,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    plot.destroy();

    expect(attached(asFake(container))).toEqual([]);
    expect(attached(asFake(container).ownerDocument)).toEqual([]);
    expect(attached(overlay.ownerDocument)).toEqual([]);
    // The overlay roots (labels, dividers) must be gone too — listeners are
    // not the only thing that leaks; detached DOM subtrees count.
    expect(overlay.children).toEqual([]);
  });
});
