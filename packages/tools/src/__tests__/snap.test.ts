import { mountDrawingStage } from "./drawing-stage.fixture";
import type { OHLC, SeriesSample } from "@finchart/core";
import { candleSeries, createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { barSampleAt } from "../snap";
import { drawingTools } from "../tools";

/**
 * Snap (magnet) -- coordinates are aimed in screen pixels, because the
 * offset a user perceives is also measured in pixels.
 */

const candles: OHLC[] = [
  { x: 0, open: 100, high: 110, low: 95, close: 105 },
  { x: 1, open: 105, high: 120, low: 101, close: 112 },
  { x: 2, open: 112, high: 118, low: 108, close: 109 },
];

function mounted(snapOptions: { snap?: boolean; snapRadius?: number } = {}) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: candleSeries(), data: candles },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const tools = model.plot.mainPane.use(
    drawingTools({ plot: model.plot, ...snapOptions }),
  );
  const pane = model.plot.mainPane;

  const pixelOf = (x: number, price: number) => ({
    x: model.plot.pixelAtX(x),
    y: pane.yScale.scale(price),
  });

  const route = (
    type: "pointerdown" | "pointermove" | "pointerup",
    point: { x: number; y: number },
  ) => model.plot.routeInput({ type, point, pointerId: 1 });

  return { model, tools, pane, pixelOf, route };
}

describe("drawing snap", () => {
  it("should snap a horizontal line to the wick high from 3px away", () => {
    const { tools, pixelOf, route } = mounted({ snap: true });
    tools.begin("horizontal");

    const at = pixelOf(1, 120); // high 120
    route("pointerdown", { x: at.x, y: at.y - 3 });
    route("pointerup", { x: at.x, y: at.y - 3 });

    const [line] = tools.list();
    if (line.type !== "horizontal") throw new Error("unexpected");
    expect(line.price).toBe(120); // exactly -- this is where a "510,000-won mismatch" would die
  });

  it("should stay free beyond the radius", () => {
    const { tools, pixelOf, route } = mounted({ snap: true });
    tools.begin("horizontal");

    const at = pixelOf(1, 120);
    route("pointerdown", { x: at.x, y: at.y - 30 });
    route("pointerup", { x: at.x, y: at.y - 30 });

    const [line] = tools.list();
    if (line.type !== "horizontal") throw new Error("unexpected");
    expect(line.price).not.toBe(120);
  });

  it("should be off by default — free placement is the baseline", () => {
    const { tools, pixelOf, route } = mounted();
    tools.begin("horizontal");

    const at = pixelOf(1, 120);
    route("pointerdown", { x: at.x, y: at.y - 3 });
    route("pointerup", { x: at.x, y: at.y - 3 });

    const [line] = tools.list();
    if (line.type !== "horizontal") throw new Error("unexpected");
    expect(line.price).not.toBe(120);
  });

  it("should snap a trend anchor to the bar point — x and price together", () => {
    const { tools, pixelOf, route } = mounted({ snap: true });
    tools.begin("trend");

    const a = pixelOf(1, 120);
    route("pointerdown", { x: a.x + 2, y: a.y - 3 }); // Euclidean sqrt(13) < 8
    route("pointermove", { x: a.x + 120, y: a.y + 90 });
    route("pointerup", { x: a.x + 120, y: a.y + 90 });

    const [trend] = tools.list();
    if (trend.type !== "trend") throw new Error("unexpected");
    expect(trend.a.x).toBe(1);
    expect(trend.a.price).toBe(120);
  });

  it("should toggle at runtime via setSnap", () => {
    const { model, tools, pixelOf, route } = mounted();
    tools.setSnap(true);
    expect(tools.snapping()).toBe(true);
    tools.begin("horizontal");

    const at = pixelOf(2, 118);
    route("pointerdown", { x: at.x, y: at.y - 3 });
    route("pointerup", { x: at.x, y: at.y - 3 });

    const [line] = tools.list();
    if (line.type !== "horizontal") throw new Error("unexpected");
    expect(line.price).toBe(118);

    // And back off — the same 3px aim now stays where the pointer is.
    tools.setSnap(false);
    expect(tools.snapping()).toBe(false);
    tools.begin("horizontal");
    route("pointerdown", { x: at.x, y: at.y - 3 });
    route("pointerup", { x: at.x, y: at.y - 3 });

    const [, free] = tools.list();
    if (free.type !== "horizontal") throw new Error("unexpected");
    expect(free.price).not.toBe(118);
    model.plot.destroy();
  });
});

describe("drag snap", () => {
  it("should snap an anchor drag — the anchor lands on the value, not the fingertip", () => {
    const { tools, pixelOf, route } = mounted({ snap: true });
    tools.add({
      type: "trend",
      a: { x: 0, price: 100 },
      b: { x: 2, price: 100 },
    });

    // Grab the b anchor (on its handle) and drag it 3px beside the high of 120.
    const b = pixelOf(2, 100);
    const target = pixelOf(1, 120);
    route("pointerdown", { x: b.x, y: b.y });
    route("pointermove", { x: target.x + 2, y: target.y - 3 });
    route("pointerup", { x: target.x + 2, y: target.y - 3 });

    const [trend] = tools.list();
    if (trend.type !== "trend") throw new Error("unexpected");
    expect(trend.b.x).toBe(1);
    expect(trend.b.price).toBe(120);
    expect(trend.a).toEqual({ x: 0, price: 100 }); // a is unchanged
  });

  it("should not snap a whole-drawing move — relative placement survives", () => {
    const { tools, pane, pixelOf, route } = mounted({ snap: true });
    tools.add({
      type: "trend",
      a: { x: 0, price: 100 },
      b: { x: 2, price: 106 },
    });

    // Grab the middle of the line and drag the whole thing -- it doesn't
    // snap even when the destination lands near the high (120).
    const middle = {
      x: (pixelOf(0, 100).x + pixelOf(2, 106).x) / 2,
      y: (pixelOf(0, 100).y + pixelOf(2, 106).y) / 2,
    };
    route("pointerdown", middle);
    route("pointermove", { x: middle.x, y: middle.y - 40 });
    route("pointerup", { x: middle.x, y: middle.y - 40 });

    const [trend] = tools.list();
    if (trend.type !== "trend") throw new Error("unexpected");
    // Relative placement is preserved -- the price gap between the two
    // anchors stays the same.
    const gapBefore = 106 - 100;
    expect(trend.b.price - trend.a.price).toBeCloseTo(gapBefore, 8);
    // It's a free 40px move, not a snap to a value.
    const expected = pane.yScale.invert(pixelOf(0, 100).y - 40);
    expect(trend.a.price).toBeCloseTo(expected, 8);
  });
});

describe("the bar at an x — one rule for snapping and the bar measure", () => {
  const sample = (over: Partial<SeriesSample>): SeriesSample => ({
    series: "s",
    name: null,
    color: null,
    x: 1,
    value: null,
    min: null,
    max: null,
    index: 0,
    ...over,
  });

  it("skips a registration sitting on a gap and takes the first one with a value", () => {
    const gap = sample({ series: "gap", index: 7 });
    const bar = sample({ series: "bar", value: 100, index: 3 });
    expect(barSampleAt([gap, bar])).toBe(bar);
    // A span-only point (a candle's low/high with no close) still counts.
    const spanOnly = sample({ series: "span", min: 90, max: 110, index: 5 });
    expect(barSampleAt([gap, spanOnly])).toBe(spanOnly);
  });

  it("answers null when every registration is on a gap", () => {
    expect(barSampleAt([sample({}), sample({ index: 2 })])).toBeNull();
    expect(barSampleAt([])).toBeNull();
  });

  it("counts a bar measure drawn on a real pane by bar index, not by x", () => {
    // Bars every 10 x, so x and bar index part ways: x 0..20 is two bars.
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: {
        series: candleSeries(),
        data: candles.map((candle, index) => ({ ...candle, x: index * 10 })),
      },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
    tools.add({ type: "barMeasure", a: { x: 0, price: 100 }, b: { x: 20, price: 110 } });

    const labels = model
      .commands()
      .flatMap((command) => (command.type === "drawText" ? [command.params.text] : []));
    expect(labels).toContain("2 bars");
    model.plot.destroy();
  });
});

it('does not complete a stationary click merely because the first anchor snapped', () => {
  const { api, route, setSamples } = mountDrawingStage();
  api.setSnap(true);
  setSamples([{ series: lineSeries(), name: null, color: null, x: 50, value: 56, min: null, max: null, index: 0 }]);
  api.begin('trend');
  route('pointerdown', 50, 50); route('pointerup', 50, 50);
  expect(api.list()).toEqual([]);
  expect(api.mode()).toBe('trend');
  route('pointerdown', 80, 80); route('pointerup', 80, 80);
  expect(api.list()).toHaveLength(1);
  api.dispose();
});
