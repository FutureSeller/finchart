import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { type Marker, markers, priceLine, span, watermark } from "../standard";
import { ContractError, DataError } from "../../primitives";
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

describe("priceLine — a value that moves without remounting", () => {
  const drawnLineY = (model: ReturnType<typeof mounted>) =>
    model
      .commands()
      .filter((c) => c.type === "drawLine")
      .map((c) => (c.type === "drawLine" ? c.points[0]?.y : null))
      .filter((y): y is number => typeof y === "number");
  const badgeTexts = (model: ReturnType<typeof mounted>) =>
    model
      .commands()
      .filter((c) => c.type === "drawText")
      .map((c) => (c.type === "drawText" ? c.params.text : ""));
  const badgeYs = (model: ReturnType<typeof mounted>, text: string) =>
    model
      .commands()
      .filter((c) => c.type === "drawText" && c.params.text === text)
      .map((c) => (c.type === "drawText" ? c.params.at.y : Number.NaN));

  it("applyOptions moves the line and the badge together", () => {
    const model = mounted();
    const line = priceLine({ value: 110, label: "Target" });
    model.plot.mainPane.addDecoration(line);
    model.plot.render();
    const before = drawnLineY(model);
    expect(before).toContain(model.plot.mainPane.yScale.scale(110));

    line.applyOptions({ value: 115 });
    model.plot.render();
    const after = drawnLineY(model);
    expect(after).toContain(model.plot.mainPane.yScale.scale(115));
    expect(after).not.toContain(model.plot.mainPane.yScale.scale(110));
    // The badge still says the label and sits at the new value — it read the same state as the line.
    expect(badgeTexts(model)).toContain("Target");
    expect(badgeYs(model, "Target")).toHaveLength(1);
    expect(badgeYs(model, "Target")[0]).toBeCloseTo(model.plot.mainPane.yScale.scale(115), 6);
  });

  it("every door checks the whole option set and names itself", () => {
    const model = mounted();
    // @ts-expect-error — a string where a boolean belongs is exactly what a settings panel hands over
    expect(() => priceLine({ value: 1, badge: "false" })).toThrow(ContractError);
    const line = priceLine({ value: 110 });
    model.plot.mainPane.addDecoration(line);
    // @ts-expect-error — not a function
    expect(() => line.applyOptions({ format: "x" })).toThrow(/priceLine\.applyOptions\(patch\) format/);
    // @ts-expect-error — not a string
    expect(() => line.setOptions({ value: 1, label: 5 })).toThrow(/priceLine\.setOptions\(next\) label/);
    expect(() => line.applyOptions({ value: Number.NaN })).toThrow(/priceLine\.applyOptions\(patch\) value/);
  });

  it("checks what it keeps — a value on the prototype is not a value", () => {
    class Given {
      get value() {
        return 110;
      }
    }
    // The copy has no own `value`, so the door refuses rather than drawing NaN next frame.
    expect(() => priceLine(new Given())).toThrow(ContractError);
  });

  it("applyOptions with only a label keeps the value — the merged candidate is what is validated", () => {
    const model = mounted();
    const line = priceLine({ value: 110 });
    model.plot.mainPane.addDecoration(line);
    line.applyOptions({ label: "Stop" });
    model.plot.render();
    expect(badgeTexts(model)).toContain("Stop");
    expect(drawnLineY(model)).toContain(model.plot.mainPane.yScale.scale(110));
  });

  it("a refused patch changes nothing — line and badge keep the state they had", () => {
    const model = mounted();
    const line = priceLine({ value: 110, label: "Target" });
    model.plot.mainPane.addDecoration(line);
    expect(() => line.applyOptions({ value: Number.NaN })).toThrow(ContractError);
    expect(() => line.applyOptions({ value: Number.POSITIVE_INFINITY, label: "Gone" })).toThrow(ContractError);
    model.plot.render();
    expect(drawnLineY(model)).toContain(model.plot.mainPane.yScale.scale(110));
    expect(badgeTexts(model)).toContain("Target");
    expect(badgeTexts(model)).not.toContain("Gone");
  });

  it("setOptions replaces the options wholesale — a label not given again is gone", () => {
    const model = mounted();
    const line = priceLine({ value: 110, label: "Target" });
    model.plot.mainPane.addDecoration(line);
    line.setOptions({ value: 112 });
    model.plot.render();
    expect(badgeTexts(model)).not.toContain("Target");
    expect(drawnLineY(model)).toContain(model.plot.mainPane.yScale.scale(112));
    expect(() => line.setOptions({ value: Number.NaN })).toThrow(ContractError);
  });
});

describe("markers — items that move without remounting", () => {
  // The line series draws its own point circles — count the markers by their colour.
  const INK = "#123456";
  const circles = (model: ReturnType<typeof mounted>) =>
    model
      .commands()
      .filter((c) => c.type === "drawShape" && c.shape.shape === "circle" && c.shape.fill === INK).length;

  it("setItems redraws the new items and refuses a bad one, keeping the old", () => {
    const model = mounted();
    const dots = markers([{ x: 50, price: 110, color: INK }]);
    model.plot.mainPane.addDecoration(dots);
    model.plot.render();
    expect(circles(model)).toBe(1);

    dots.setItems([
      { x: 50, price: 110, color: INK },
      { x: 100, price: 112, color: INK },
    ]);
    model.plot.render();
    expect(circles(model)).toBe(2);

    expect(() => dots.setItems([{ x: Number.NaN, price: 1, color: INK }])).toThrow(ContractError);
    model.plot.render();
    expect(circles(model)).toBe(2);
  });

  it("keeps its own copy — a push on the caller's array after the door does not reach the frame", () => {
    const model = mounted();
    const list = [{ x: 50, price: 110, color: INK }];
    const dots = markers(list);
    model.plot.mainPane.addDecoration(dots);
    list.push({ x: 100, price: 112, color: INK });
    model.plot.render();
    expect(circles(model)).toBe(1);

    const next = [{ x: 50, price: 110, color: INK }];
    dots.setItems(next);
    next.push({ x: Number.NaN, price: 1, color: INK });
    expect(() => model.plot.render()).not.toThrow();
    expect(circles(model)).toBe(1);
  });

  it("checks every slot of what it keeps — a hole is refused, not drawn as undefined", () => {
    const model = mounted();
    const dots = markers([{ x: 50, price: 110, color: INK }]);
    model.plot.mainPane.addDecoration(dots);
    expect(() => dots.setItems(new Array<Marker>(1))).toThrow(DataError);
    expect(() => markers(new Array<Marker>(1))).toThrow(DataError);
    model.plot.render();
    expect(circles(model)).toBe(1);
  });
});
