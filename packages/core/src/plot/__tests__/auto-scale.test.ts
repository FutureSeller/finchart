/**
 * The value axis follows the visible range. The motive is accumulation,
 * not zoom — with infinite scroll, as history gets prepended the raw
 * dataset keeps growing while the visible range stays the same, so a
 * value axis fit to the whole dataset flattens out the longer it runs.
 * A derived series must be measured by the points it produced itself,
 * and those points must then be clipped to the visible range.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { LinearScale } from "../../scale";
import { lineSeries } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

/** x runs 0..99, y runs 0..990. It grows further out. */
const ramp: LineDataPoint[] = Array.from({ length: 100 }, (_, i) => ({
  x: i,
  y: i * 10,
}));

/** Inject xScale to set the visible range exactly — zoom can't hit a precise range. */
function mount(options?: { autoScale?: boolean }) {
  const xScale = new LinearScale();
  const { plot, handle } = mountPlot({ deps: testBrowserDeps({ xScale }), series: lineSeries(), config: defaultConfig });
  if (options) plot.mainPane.applyOptions(options);

  /** setData resets the domain to the full range, so call it after loading data. */
  const look = (from: number, to: number) => xScale.setDomain(from, to);

  return { plot: Object.assign(plot, { look }), handle };
}

/** The actual data range with the padding (valuePadding 0.1) removed. */
function fittedExtent(domain: readonly [number, number]) {
  const [min, max] = domain;
  const padded = (max - min) / 1.2;
  return { min: min + padded * 0.1, max: max - padded * 0.1 };
}

describe("value axis autoscale", () => {
  it("should fit the whole dataset before any zoom", () => {
    const { plot, handle } = mount();
    handle.setData(ramp);
    plot.render();

    const { min, max } = fittedExtent(plot.mainPane.yScale.getDomain());

    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(990, 5);
  });

  it("should follow the visible slice after zooming in", () => {
    const { plot, handle } = mount();
    handle.setData(ramp);
    plot.render();

    // Only look at the last 10% — y should be 900~990.
    plot.look(90, 99);
    plot.render();

    const { min, max } = fittedExtent(plot.mainPane.yScale.getDomain());

    expect(min).toBeCloseTo(900, 5);
    expect(max).toBeCloseTo(990, 5);
  });

  it("should follow the visible slice while panning", () => {
    const { plot, handle } = mount();
    handle.setData(ramp);
    plot.look(0, 9);
    plot.render();

    const front = fittedExtent(plot.mainPane.yScale.getDomain());

    plot.look(50, 59);
    plot.render();

    const middle = fittedExtent(plot.mainPane.yScale.getDomain());

    expect(front.max).toBeCloseTo(90, 5);
    expect(middle.min).toBeCloseTo(500, 5);
    expect(middle.max).toBeCloseTo(590, 5);
  });

  it("should measure a derived series by its own visible points", () => {
    // A derived series drawing half the source value. It must be clipped to the visible range.
    const { plot } = mount();
    plot.mainPane.clearSeries();
    plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp,
      derive: (source: LineDataPoint[]) =>
        source.map((point) => ({ x: point.x, y: point.y === null ? null : point.y / 2 })),
    });

    plot.look(90, 99);
    plot.render();

    const { min, max } = fittedExtent(plot.mainPane.yScale.getDomain());

    // 900~990 for the source, 450~495 for the derived series.
    expect(min).toBeCloseTo(450, 5);
    expect(max).toBeCloseTo(495, 5);
  });

  it("should union every series in the pane", () => {
    const { plot } = mount();
    plot.mainPane.clearSeries();
    plot.mainPane.addSeries({ series: lineSeries(), data: ramp });
    plot.mainPane.addSeries({
      series: lineSeries(),
      data: ramp,
      derive: (source: LineDataPoint[]) =>
        source.map((point) => ({ x: point.x, y: point.y === null ? null : point.y / 2 })),
    });

    plot.look(90, 99);
    plot.render();

    const { min, max } = fittedExtent(plot.mainPane.yScale.getDomain());

    // From the derived series' floor (450) to the source's ceiling (990).
    expect(min).toBeCloseTo(450, 5);
    expect(max).toBeCloseTo(990, 5);
  });

  it("should scale each pane by its own visible data", () => {
    const { plot, handle } = mount();
    const lower = plot.addPane();
    lower.addSeries({
      series: lineSeries(),
      data: ramp,
      derive: (source: LineDataPoint[]) =>
        source.map((point) => ({ x: point.x, y: point.y === null ? null : point.y * 100 })),
    });

    handle.setData(ramp);
    plot.look(90, 99);
    plot.render();

    const main = fittedExtent(plot.mainPane.yScale.getDomain());
    const below = fittedExtent(lower.yScale.getDomain());

    expect(main.max).toBeCloseTo(990, 5);
    expect(below.max).toBeCloseTo(99000, 5);
  });
});

describe("autoScale: false", () => {
  it("should keep fitting the whole dataset when zoomed", () => {
    const { plot, handle } = mount({ autoScale: false });
    handle.setData(ramp);
    plot.render();

    plot.look(90, 99);
    plot.render();

    const { min, max } = fittedExtent(plot.mainPane.yScale.getDomain());

    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(990, 5);
  });

  it("should not overwrite a value domain set by hand", () => {
    // This is why the flag exists — a manually set range that gets
    // overwritten every frame is unusable.
    const { plot, handle } = mount({ autoScale: false });
    handle.setData(ramp);
    plot.render();

    plot.mainPane.yScale.setDomain(-5, 5);
    plot.render();
    plot.render();

    expect(plot.mainPane.yScale.getDomain()).toEqual([-5, 5]);
  });

  it("should still fit once when a series is added", () => {
    const { plot } = mount({ autoScale: false });
    plot.mainPane.clearSeries();

    plot.mainPane.addSeries({ series: lineSeries(), data: ramp });
    plot.render();

    const { max } = fittedExtent(plot.mainPane.yScale.getDomain());

    expect(max).toBeCloseTo(990, 5);
  });
});

describe("empty data", () => {
  it("should leave the domain alone when there is nothing to fit", () => {
    const { plot } = mount();
    const before = plot.mainPane.yScale.getDomain();

    plot.render();

    expect(plot.mainPane.yScale.getDomain()).toEqual(before);
  });
});
