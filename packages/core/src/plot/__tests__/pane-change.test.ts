/**
 * What PaneChange reporting exactly what changed makes possible. It used
 * to only tell Plot "something changed," so the x index got fully
 * recounted every single time. Three things to guarantee: encapsulation,
 * a cheap path, and a single notification channel.
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

describe("pane state fields", () => {
  it("should route every write through applyOptions", () => {
    const { plot } = setup();
    const pane = plot.mainPane;

    // Reading is open.
    expect(pane.flex).toBe(1);
    expect(pane.autoScale).toBe(true);
    expect(pane.minHeight).toBe(40);
    expect(pane.invert).toBe(false);

    pane.applyOptions({ flex: 3, autoScale: false, minHeight: 80, invert: true });

    expect(pane.flex).toBe(3);
    expect(pane.autoScale).toBe(false);
    expect(pane.minHeight).toBe(80);
    expect(pane.invert).toBe(true);
  });

  /** Axis settings merge field by field — giving just one leaves the rest in place. */
  it("should merge axis options field by field", () => {
    const { plot } = setup();

    plot.mainPane.applyOptions({ axis: { showLabels: false } });
    plot.mainPane.applyOptions({ axis: { minTickSpacing: 30 } });

    expect(plot.mainPane.axis).toEqual({
      showLabels: false,
      minTickSpacing: 30,
    });
  });
});

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

    plot.mainPane.addDecoration({ draw });
    plot.render();

    expect(draw).toHaveBeenCalled();
  });
});

describe("state notifications", () => {
  /** Every pane's flex is rewritten, but only one notification fires — this runs on every pointermove, so firing once per pane would be wasted work. */
  it("should coalesce one state change per resize", () => {
    const { plot, added } = setup(2);
    const seen = vi.fn();
    plot.on("stateChange", seen);

    // The same thing a divider drag triggers — rewrites every flex.
    plot.applyState({
      panes: plot.panes.map((pane) => ({ flex: pane.flex + 1, autoScale: true })),
    });

    expect(added).toHaveLength(2);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("should not announce state on data alone", () => {
    const { plot, handle } = setup();
    // A short history follows its feed until it fills the screen; an explicit fit settles the window.
    plot.fitDomains();
    const seen = vi.fn();
    plot.on("stateChange", seen);

    handle.append([{ x: 150, y: 25 }]);

    expect(seen).not.toHaveBeenCalled();
  });
});
