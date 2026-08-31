/**
 * The config handed to the constructor is **read, not kept.** `PlotBuilder`
 * hands over its own fields and stays alive afterward; a host may keep a
 * config object around and tweak it for the next chart. Neither must reach
 * into a chart that's already mounted — `applyOptions` is the one door,
 * and it's the one that schedules a render and emits change.
 *
 * The top level was already copied. The nested objects (`padding`,
 * `axis.x`/`axis.y`, `style.grid`) weren't, and `padding` is read on every
 * layout — so `config.padding.left = 0` after mounting silently moved the
 * plot area with no render scheduled.
 */
import { describe, expect, it } from "vitest";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** Fresh nested objects every time, so a mutation here can only leak through aliasing. */
const ownConfig = () => ({
  padding: { top: 20, right: 20, bottom: 20, left: 20 },
  showGrid: true,
  axis: { x: { showLabels: true }, y: { showLabels: true } },
  style: { grid: { color: "#123456" } },
});

describe("constructor config ownership", () => {
  it("should not move the plot area when the caller edits padding afterward", () => {
    const config = ownConfig();
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data, config });
    plot.render();
    const before = plot.mainPane.area.left;

    config.padding.left = 200;
    plot.render();

    expect(plot.mainPane.area.left).toBe(before);
    expect(plot.getOptions().padding.left).toBe(20);
  });

  it("should not see later edits to axis or grid style", () => {
    const config = ownConfig();
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data, config });

    if (config.axis?.x) config.axis.x.showLabels = false;
    if (config.style?.grid) config.style.grid.color = "#000000";

    expect(plot.getOptions().axis?.x?.showLabels).toBe(true);
    expect(plot.getOptions().style?.grid?.color).toBe("#123456");
  });
});
