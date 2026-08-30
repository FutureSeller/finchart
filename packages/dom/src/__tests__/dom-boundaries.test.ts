import { describe, expect, it } from "vitest";
import { createDomAxisLabels } from "../dom-labels";
import { createDomDividers } from "../dom-dividers";
import { createDomLayers } from "../dom-layers";
import { legend } from "../legend";
import { tooltip } from "../tooltip";
import { lineSeries } from "@finchart/core";
import { testBrowserDeps } from "./fakes";
import { defaultConfig, mountPlot } from "./helpers";

/**
 * An implementation that genuinely requires the DOM must report a wiring
 * error, not fall back to a silent null object. The core-side half (canvas
 * renderer, measurer) is covered by core's headless-boundaries.
 */
describe("implementations that require the DOM throw when there is none", () => {
  const noopTarget = {
    drawLine: () => undefined,
    drawShape: () => undefined,
    drawText: () => undefined,
  };

  it("createDomLayers cannot stand up without a container", () => {
    expect(() => createDomLayers(null, 800, 600)).toThrow(/headless/);
  });

  it("DOM labels cannot stand up without an overlay", () => {
    expect(() =>
      createDomAxisLabels({ overlay: null, target: noopTarget }),
    ).toThrow(/createCanvasAxisLabels/);
  });

  it("DOM dividers cannot stand up without an overlay", () => {
    expect(() => createDomDividers(null, () => undefined)).toThrow(/headless/);
  });
});

/** The options door (applyOptions) closes once disposed — the same rule as core's plugins. */
describe("applying options to a disposed extension", () => {
  it("should refuse on tooltip and legend", () => {
    const { plot } = mountPlot({
      deps: testBrowserDeps(),
      series: lineSeries(),
      config: defaultConfig,
      data: [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ],
    });
    const tip = plot.use(tooltip());
    const rows = plot.use(legend());
    tip.dispose();
    rows.dispose();

    expect(() => tip.applyOptions({ offset: 4 })).toThrow();
    expect(() => rows.applyOptions({ formatValue: String })).toThrow();
  });
});
