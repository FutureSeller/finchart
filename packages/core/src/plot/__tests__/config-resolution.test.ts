/**
 * An omitted option and an explicitly written default must be the same
 * chart. Today that promise is kept one read site at a time (`?? 0`,
 * `=== false`, `!x` scattered where each field is consumed); these guards
 * pin the promise itself, so moving the defaults to one table at the
 * config door can't quietly change what "omitted" means — and a read site
 * keeping a private default that drifts from the door's turns one of
 * these red instead of shipping as a silent split.
 *
 * The axis revert guard pins the one place where an explicit `undefined`
 * is a meaning, not an absence: patching `axis` with an undefined field
 * is the documented way back to the default.
 */
import { describe, expect, it } from "vitest";
import { testBrowserDepsWithScales } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { PLOT_CONFIG_DEFAULTS } from "../config";
import { createPlotModel } from "../model";
import type { PlotConfig } from "../types";
import { defaultConfig, mountPlot } from "./helpers";

const size = { width: 400, height: 300 };

/** Fresh points every time — a registration owns its data as given, so two charts must not share one array. */
const points = (): LineDataPoint[] => [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function mounted(config: PlotConfig) {
  const { deps, xScale } = testBrowserDepsWithScales();
  const { plot, handle } = mountPlot({
    deps,
    series: lineSeries(),
    data: points(),
    config,
  });
  plot.render();
  return { plot, handle, xScale };
}

describe("omitted option ≡ explicit default", () => {
  it("paneGap: omitted lays two panes out exactly like an explicit 0", () => {
    const omitted = mounted({ ...defaultConfig });
    omitted.plot.addPane();
    omitted.plot.render();

    const explicit = mounted({ ...defaultConfig, paneGap: 0 });
    explicit.plot.addPane();
    explicit.plot.render();

    expect(omitted.plot.mainPane.area).toEqual(explicit.plot.mainPane.area);
  });

  it("rightOffset: omitted fits the window exactly like an explicit 0", () => {
    const omitted = mounted({ ...defaultConfig });
    const explicit = mounted({ ...defaultConfig, rightOffset: 0 });

    expect(omitted.xScale.getDomain()).toEqual(explicit.xScale.getDomain());
  });

  it("shiftVisibleRangeOnNewBar: omitted treats a new bar exactly like an explicit false", () => {
    const omitted = mounted({ ...defaultConfig });
    omitted.handle.append([{ x: 150, y: 18 }]);
    omitted.plot.render();

    const explicit = mounted({
      ...defaultConfig,
      shiftVisibleRangeOnNewBar: false,
    });
    explicit.handle.append([{ x: 150, y: 18 }]);
    explicit.plot.render();

    expect(omitted.xScale.getDomain()).toEqual(explicit.xScale.getDomain());
  });

  it("showGrid: omitted draws exactly as many lines as an explicit true", () => {
    const omitted = createPlotModel({
      size,
      series: { series: lineSeries(), data: points() },
    });
    omitted.plot.render();

    const explicit = createPlotModel({
      size,
      series: { series: lineSeries(), data: points() },
      config: { showGrid: true },
    });
    explicit.plot.render();

    const lines = (model: typeof omitted) =>
      model.commands().filter((c) => c.type === "drawLine").length;
    expect(lines(omitted)).toBe(lines(explicit));
  });

  it("axis.x.showLabels: omitted claims the same axis space as an explicit true", () => {
    const omitted = createPlotModel({
      size,
      series: { series: lineSeries(), data: points() },
    });
    omitted.plot.render();

    const explicit = createPlotModel({
      size,
      series: { series: lineSeries(), data: points() },
      config: { axis: { x: { showLabels: true } } },
    });
    explicit.plot.render();

    expect(omitted.plot.mainPane.area).toEqual(explicit.plot.mainPane.area);
  });
});

describe("axis patch: explicit undefined reverts to the default", () => {
  it("brings the x labels back after they were turned off", () => {
    const model = createPlotModel({
      size,
      series: { series: lineSeries(), data: points() },
    });
    model.plot.render();
    const shown = model.plot.mainPane.area.bottom;

    model.plot.applyOptions({ axis: { x: { showLabels: false } } });
    model.plot.render();
    // The probe has teeth: hiding the labels must actually move the pane.
    expect(model.plot.mainPane.area.bottom).not.toBe(shown);

    model.plot.applyOptions({ axis: { x: { showLabels: undefined } } });
    model.plot.render();
    expect(model.plot.mainPane.area.bottom).toBe(shown);
  });
});

describe("the door resolves the whole table", () => {
  it("hands back every static default filled on a minimal chart", () => {
    const model = createPlotModel({
      size,
      series: { series: lineSeries(), data: points() },
    });

    expect(model.plot.getOptions()).toEqual(PLOT_CONFIG_DEFAULTS);
  });
});
