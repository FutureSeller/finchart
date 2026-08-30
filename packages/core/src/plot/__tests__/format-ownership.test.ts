import { describe, expect, it } from "vitest";
import type { AxisLabelsInput } from "../../axis";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { crosshair } from "../../extensions/crosshair";
import { priceLine } from "../../extensions/standard";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

/**
 * Format ownership — a single axis format drives the default display for
 * the crosshair badge, the priceLine badge, the legend, and the tooltip.
 * Each surface used to reinvent its own toFixed(2), so for sub-cent
 * instruments only the axis label was correct and everything else showed
 * "0.00".
 */

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function labelSpy() {
  const seen: AxisLabelsInput[] = [];

  return {
    seen,
    createAxisLabels: () => ({
      render: (input: AxisLabelsInput) => {
        seen.push(input);
      },
      clear: () => undefined,
      destroy: () => undefined,
    }),
  };
}

const config = {
  ...defaultConfig,
  axis: {
    x: { format: (v: number) => `X${v.toFixed(0)}` },
    y: { format: (v: number) => `₩${v.toFixed(4)}` },
  },
};

describe("format ownership", () => {
  it("should drive both crosshair badges from the axis formats", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { plot, handle } = mountPlot({ deps, series: lineSeries(), config });
    handle.setData(data);
    plot.use(crosshair());

    const { area } = plot.mainPane;
    plot.crosshair({
      x: (area.left + area.right) / 2,
      y: (area.top + area.bottom) / 2,
    });
    plot.render();

    const { badges } = spy.seen.at(-1)!;
    expect(badges[0].label).toBe("X50");
    expect(badges[1].label.startsWith("₩")).toBe(true);
  });

  it("should drive the priceLine badge from the pane's format", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { plot, handle } = mountPlot({ deps, series: lineSeries(), config });
    handle.setData(data);

    plot.mainPane.addDecoration(priceLine({ value: 15 }));
    plot.render();

    const { badges } = spy.seen.at(-1)!;
    expect(badges.map((entry) => entry.label)).toContain("₩15.0000");
  });

  it("should let the pane's own format win over the stage default", () => {
    const { plot } = mountPlot({
      deps: testBrowserDeps(),
      series: lineSeries(),
      config,
      data,
    });

    // Inherits the stage default (config.axis.y.format).
    expect(plot.mainPane.formatValue(1.5)).toBe("₩1.5000");

    // The pane's own axis.format wins — y belongs to the pane.
    const pane = plot.addPane({
      axis: { format: (v: number) => `${v.toFixed(0)}%` },
    });
    expect(pane.formatValue(42.4)).toBe("42%");
  });

  it("should keep the decoration option as an override", () => {
    const spy = labelSpy();
    const deps = testBrowserDeps({ createAxisLabels: spy.createAxisLabels });
    const { plot, handle } = mountPlot({ deps, series: lineSeries(), config });
    handle.setData(data);
    plot.use(crosshair({ format: { y: (v) => `override:${v.toFixed(0)}` } }));

    const { area } = plot.mainPane;
    plot.crosshair({
      x: (area.left + area.right) / 2,
      y: (area.top + area.bottom) / 2,
    });
    plot.render();

    const { badges } = spy.seen.at(-1)!;
    // x still shows the axis format; only y is overridden by the decoration option.
    expect(badges[0].label).toBe("X50");
    expect(badges[1].label.startsWith("override:")).toBe(true);
  });

  it("should fall back to the shared defaults when the axis says nothing", () => {
    const { plot } = mountPlot({
      deps: testBrowserDeps(),
      series: lineSeries(),
      data,
    });

    expect(plot.mainPane.formatValue(1.005)).toBe("1.00");
    expect(plot.formatX(49.6)).toBe("50");
  });
});
