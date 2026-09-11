import { describe, expect, it, vi } from "vitest";
import type { FakeElement } from "./fakes";
import type { LineDataPoint } from "@finchart/core";
import { lineSeries } from "@finchart/core";
import { testBrowserDepsWithScales } from "./fakes";
import { defaultConfig, defaultSize, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function dividers(overlay: unknown): FakeElement[] {
  return (overlay as FakeElement).children
    .filter((child) => "data-chart-dividers" in child.attributes)
    .flatMap((root) => root.children);
}

function setup(config = {}, panes = 1) {
  const { deps, xScale, yScale } = testBrowserDepsWithScales();
  const { plot, handle, layers } = mountPlot({ deps, series: lineSeries(), config: {
    ...defaultConfig,
    // Only dividers are under test here — with labels off, the axis slice is 0, so padding is the boundary.
    axis: { x: { showLabels: false }, y: { showLabels: false } },
    ...config,
  } });
  handle.setData(data);

  const added = Array.from({ length: panes }, () => {
    const pane = plot.addPane();
    pane.addSeries(lineSeries());
    return pane;
  });

  return { plot, handle, xScale, yScale, layers, added };
}

/** Drags a divider by dy pixels. */
function drag(divider: FakeElement, dy: number): void {
  const document = divider.ownerDocument;

  divider.dispatch("pointerdown", {
    clientY: 100,
    stopPropagation: () => undefined,
    preventDefault: () => undefined,
  });
  document.dispatch("pointermove", { clientY: 100 + dy });
  document.dispatch("pointerup", {});
}

const heightOf = (pane: { area: { top: number; bottom: number } }) =>
  pane.area.bottom - pane.area.top;

describe("divider placement", () => {
  /**
   * The container leaves vertical touch gestures to the page; a divider is
   * dragged vertically, so it reserves the gesture on itself — allowed
   * gestures are what every element on the way down permits.
   */
  it("should keep the vertical gesture for itself", () => {
    const { plot, layers } = setup({}, 1);
    plot.render();

    for (const divider of dividers(layers.overlay)) {
      expect(divider.style.touchAction).toBe("none");
    }
  });

  it("should put one divider between each pair of panes", () => {
    const { layers } = setup({}, 2);

    expect(dividers(layers.overlay)).toHaveLength(2);
  });

  it("should have none when there is a single pane", () => {
    const { layers } = setup({}, 0);

    expect(dividers(layers.overlay)).toHaveLength(0);
  });

  it("should have none when resizing is turned off", () => {
    const { layers } = setup({ resizablePanes: false }, 2);

    expect(dividers(layers.overlay)).toHaveLength(0);
  });

  it("should sit on the boundary between its two panes", () => {
    const { plot, layers } = setup({ paneGap: 10 }, 1);
    const [divider] = dividers(layers.overlay);

    const top = Number.parseFloat(divider.style.top);
    expect(top).toBeGreaterThanOrEqual(plot.mainPane.area.bottom - 8);
    expect(top).toBeLessThanOrEqual(plot.panes[1].area.top + 8);
  });
});

describe("dragging a divider", () => {
  it("should flag the handle with data-dragging for the duration", () => {
    // :hover flickers if the pointer leaves the handle mid-drag — the attribute is what tracks state.
    const { layers } = setup({}, 1);
    const [divider] = dividers(layers.overlay);
    const document = divider.ownerDocument;

    divider.dispatch("pointerdown", {
      clientY: 100,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    expect("data-dragging" in divider.attributes).toBe(true);

    document.dispatch("pointerup", {});
    expect("data-dragging" in divider.attributes).toBe(false);
  });

  it("should sweep an in-progress drag on destroy", () => {
    // move/end are attached to document — if destroy happens mid-drag (SPA
    // routing, a React unmount), just removing the handle would leave
    // onDrag still reaching a dead plot.
    const { plot, layers } = setup({}, 1);
    const [divider] = dividers(layers.overlay);
    const document = divider.ownerDocument;

    divider.dispatch("pointerdown", {
      clientY: 100,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    plot.destroy();

    expect("data-dragging" in divider.attributes).toBe(false);
    expect(document.listeners.get("pointermove") ?? []).toHaveLength(0);
    expect(document.listeners.get("pointerup") ?? []).toHaveLength(0);
  });

  it("should keep dragging after a second pointerdown restarts the gesture", () => {
    // A second pointer landing on the handle mid-drag restarts the gesture.
    // The restart must release the old gesture BEFORE arming the new one —
    // releasing after leaves the fresh gesture with its state swept away.
    const { plot, layers } = setup({}, 1);
    const [divider] = dividers(layers.overlay);
    const document = divider.ownerDocument;
    const down = (clientY: number) =>
      divider.dispatch("pointerdown", {
        clientY,
        stopPropagation: () => undefined,
        preventDefault: () => undefined,
      });

    down(100);
    down(120); // restart mid-drag

    expect("data-dragging" in divider.attributes).toBe(true);

    const before = heightOf(plot.mainPane);
    document.dispatch("pointermove", { clientY: 140 });

    expect(heightOf(plot.mainPane)).not.toBe(before);
  });

  it("should grow the upper pane and shrink the lower one", () => {
    const { plot, layers, added } = setup({}, 1);
    const before = heightOf(plot.mainPane);

    drag(dividers(layers.overlay)[0], 60);

    expect(heightOf(plot.mainPane)).toBeCloseTo(before + 60, 0);
    expect(heightOf(added[0])).toBeCloseTo(
      defaultSize.height -
        defaultConfig.padding.top -
        defaultConfig.padding.bottom -
        (before + 60),
      0,
    );
  });

  it("should work in the other direction too", () => {
    const { plot, layers } = setup({}, 1);
    const before = heightOf(plot.mainPane);

    drag(dividers(layers.overlay)[0], -40);

    expect(heightOf(plot.mainPane)).toBeCloseTo(before - 40, 0);
  });

  it("should keep the total height unchanged", () => {
    const { plot, layers } = setup({ paneGap: 8 }, 2);
    const total = () => plot.panes.reduce((sum, p) => sum + heightOf(p), 0);
    const before = total();

    drag(dividers(layers.overlay)[0], 35);

    expect(total()).toBeCloseTo(before, 0);
  });

  it("should refuse to push a pane below its minimum", () => {
    const { layers, added } = setup({}, 1);
    added[0].applyOptions({ minHeight: 120 });

    drag(dividers(layers.overlay)[0], 5000);

    expect(heightOf(added[0])).toBeGreaterThanOrEqual(120);
  });

  it("should respect the upper pane's minimum as well", () => {
    const { plot, layers } = setup({}, 1);
    plot.mainPane.applyOptions({ minHeight: 150 });

    drag(dividers(layers.overlay)[0], -5000);

    expect(heightOf(plot.mainPane)).toBeGreaterThanOrEqual(150);
  });

  it("should leave the panes it does not touch alone", () => {
    const { plot, layers } = setup({}, 2);
    const untouched = plot.panes[2];
    const before = heightOf(untouched);

    // Only drags between the first and second panes.
    drag(dividers(layers.overlay)[0], 40);

    expect(heightOf(untouched)).toBeCloseTo(before, 0);
  });

  it("should not move the value domain", () => {
    const { yScale, layers } = setup({}, 1);
    const before = yScale.getDomain();

    drag(dividers(layers.overlay)[0], 50);

    expect(yScale.getDomain()).toEqual(before);
  });

  it("should not pan the chart", () => {
    const { xScale, layers } = setup({}, 1);
    const before = xScale.getDomain();

    drag(dividers(layers.overlay)[0], 50);

    expect(xScale.getDomain()).toEqual(before);
  });

  it("should stop the pointer reaching the pan handler", () => {
    const { layers } = setup({}, 1);
    const stopPropagation = vi.fn();

    dividers(layers.overlay)[0].dispatch("pointerdown", {
      clientY: 0,
      stopPropagation,
      preventDefault: () => undefined,
    });

    expect(stopPropagation).toHaveBeenCalled();
  });

  it("should survive the viewport shrinking after a drag", () => {
    const { plot, layers } = setup({}, 1);
    drag(dividers(layers.overlay)[0], 80);
    const ratio = heightOf(plot.mainPane) / heightOf(plot.panes[1]);

    plot.setViewport({ height: 300 });

    // The ratio holds — a drag leaves behind a ratio, not pixels.
    expect(heightOf(plot.mainPane) / heightOf(plot.panes[1])).toBeCloseTo(
      ratio,
      1,
    );
  });
});
