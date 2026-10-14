/**
 * What PaneChange reporting exactly what changed makes possible. A report
 * that only told Plot "something changed" would make the x index get
 * fully recounted every single time. This file guards the cheap path; pane
 * options and pane notifications are covered in pane-options.test.ts and
 * panes-change.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { LineDataPoint } from "../../data";
import type { Scale, XMapping, XMappingFactory } from "../../scale";
import { continuousX } from "../../scale";
import { lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A mapping that counts how many times the index was rebuilt. Just attaches `rebuild` onto the continuous mapping. */
function countingMapping(): {
  factory: XMappingFactory;
  rebuilds: () => number;
} {
  let count = 0;

  const factory: XMappingFactory = (scale: Scale): XMapping => ({
    ...continuousX(scale),
    rebuild: () => {
      count += 1;
    },
  });

  return { factory, rebuilds: () => count };
}

function setup(panes = 0) {
  const counter = countingMapping();
  const deps = testBrowserDeps({ createXMapping: counter.factory });
  const mounted = mountPlot({
    deps,
    series: lineSeries(),
    data,
    config: { ...defaultConfig, showGrid: false },
  });

  const added = Array.from({ length: panes }, () => mounted.plot.addPane());

  return { ...mounted, ...counter, added };
}

describe("cheap path", () => {
  it("should not rebuild the x index when only options change", () => {
    const { plot, rebuilds } = setup();
    const before = rebuilds();

    plot.mainPane.applyOptions({ flex: 2, valuePadding: 0.2 });
    plot.mainPane.applyOptions({ autoScale: false });

    expect(rebuilds()).toBe(before);
  });

  it("should not rebuild the x index when a decoration is added", () => {
    const { plot, rebuilds } = setup();
    const before = rebuilds();

    plot.mainPane.addDecoration({ draw: () => undefined });

    expect(rebuilds()).toBe(before);
  });

  it("should still rebuild when the drawn points change", () => {
    const { plot, rebuilds } = setup();
    const before = rebuilds();

    plot.mainPane.addSeries({ series: lineSeries(), data });

    expect(rebuilds()).toBeGreaterThan(before);
  });

  /** Without a notification, when it shows up on screen becomes "whenever something else happens next." */
  it("should repaint on a pane decoration", () => {
    const { plot } = setup();
    const draw = vi.fn();
    const renders = vi.fn();
    const off = plot.on("render", renders);

    // No manual render — adding it must be what asks for the frame.
    plot.mainPane.addDecoration({ draw });

    expect(renders).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledTimes(1);
    off();
    plot.destroy();
  });
});
