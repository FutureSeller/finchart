import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { createPlotModel } from "../model";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

const size = { width: 800, height: 600 };

describe("createPlotModel", () => {
  /** No DOM fake, no browser — does asserting a chart in five lines actually hold up? */
  it("should assert a chart in five lines", () => {
    const model = createPlotModel({
      size,
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    const line = model.commands().find((c) => c.type === "drawLine");
    expect(line?.points).toHaveLength(data.length);
  });

  it("should include axis labels in the frame", () => {
    const model = createPlotModel({
      size,
      series: { series: lineSeries(), data },
    });

    // Labels are commands too (the canvas label path) — ticks aren't missing from a server-rendered PNG.
    const texts = model
      .commands()
      .filter((c) => c.type === "drawText")
      .map((c) => c.params.text);
    expect(texts.length).toBeGreaterThan(0);
  });

  it("should have no DOM at all", () => {
    const model = createPlotModel({ size });

    expect(model.plot.overlay).toBeNull();
  });

  it("should keep the whole plot api — pan moves the picture", () => {
    const model = createPlotModel({
      size,
      series: { series: lineSeries(), data },
    });
    const before = model.commands().find((c) => c.type === "drawLine");

    model.plot.pan(10);

    const after = model.commands().find((c) => c.type === "drawLine");
    expect(after?.points[0].x).not.toBe(before?.points[0].x);
  });

  it("should let the wiring override collaborators", () => {
    const model = createPlotModel({
      size,
      series: { series: lineSeries(), data },
      config: { axis: { y: { format: () => "####" } } },
      deps: {
        createTextMeasurer: () => ({
          measure: (text: string) => ({ width: text.length * 10, height: 10 }),
        }),
      },
    });

    // With a measurer supplied, the axis width follows the label even headless.
    model.commands();
    // "####" 40px + 12px margin -> rounds up by 8px = 56, plus padding.left 4.
    expect(model.plot.mainPane.area.left).toBe(60);
  });
});
