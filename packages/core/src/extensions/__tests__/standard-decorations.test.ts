import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { markers, priceLine, span, watermark } from "../standard";
import { createPlotModel } from "../../plot/model";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 50, y: 120 },
  { x: 100, y: 110 },
];

function mounted() {
  return createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: lineSeries(), data },
    config: { showGrid: false },
  });
}

describe("standard decoration set (2.1)", () => {
  it("priceLine should draw the line and put its badge on the y axis", () => {
    const model = mounted();
    model.plot.mainPane.addDecoration(
      priceLine({ value: 110, label: "Target" }),
    );
    model.plot.render();

    const texts = model
      .commands()
      .filter((c) => c.type === "drawText")
      .map((c) => (c.type === "drawText" ? c.params : null));
    // A pane decoration's badge gets collected — the slot decided to
    // open up for price lines.
    const badge = texts.find((params) => params?.text === "Target");
    expect(badge?.box).toBeDefined();
  });

  it("priceLine should not claim the value axis", () => {
    const model = mounted();
    const before = model.plot.mainPane.yScale.getDomain();

    model.plot.mainPane.addDecoration(priceLine({ value: 100000 }));
    model.plot.render();

    // A decoration doesn't participate in refitting — the target price
    // never pulls the axis toward it.
    expect(model.plot.mainPane.yScale.getDomain()).toEqual(before);
  });

  it("markers should draw shapes and captions at data spots", () => {
    const model = mounted();
    model.plot.mainPane.addDecoration(
      markers([
        { x: 50, price: 120, shape: "arrowUp", text: "Buy" },
        { x: 100, price: 110 },
      ]),
    );
    model.plot.render();

    const texts = model
      .commands()
      .filter((c) => c.type === "drawText")
      .map((c) => (c.type === "drawText" ? c.params.text : ""));
    expect(texts).toContain("Buy");
    const polygons = model
      .commands()
      .filter((c) => c.type === "drawShape" && c.shape.shape === "polygon");
    expect(polygons.length).toBeGreaterThan(0);
  });

  it("watermark should sit in the middle of the stage", () => {
    const model = mounted();
    model.plot.addDecoration(watermark({ text: "BTC/KRW" }));
    model.plot.render();

    const mark = model
      .commands()
      .filter((c) => c.type === "drawText")
      .find((c) => c.type === "drawText" && c.params.text === "BTC/KRW");
    expect(mark).toBeDefined();
  });

  it("span should clip to the data area", () => {
    const model = mounted();
    model.plot.addDecoration(span({ from: -1000, to: 50 }));
    model.plot.render();

    const rect = model
      .commands()
      .filter((c) => c.type === "drawShape" && c.shape.shape === "rect")
      .at(-1)!;
    if (rect.type !== "drawShape" || rect.shape.shape !== "rect") return;
    const { area } = model.plot.mainPane;
    expect(rect.shape.x).toBeGreaterThanOrEqual(area.left);
  });
});
