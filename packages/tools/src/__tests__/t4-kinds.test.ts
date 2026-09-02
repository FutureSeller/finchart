import type { LineDataPoint, Point, TextParams } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import {
  FIB_EXTENSION_LEVELS,
  FIB_LEVELS,
  fibExtensionLevels,
  fibExtensionPrice,
} from "../drawings";
import { gripAt } from "../hit";
import { drawOne } from "../render";
import type { DrawingSpace } from "../space";
import { drawingTools } from "../tools";

/**
 * T4 wave — fibExtension. A three-anchor Fibonacci whose levels project
 * the a→b swing from c. Its default level list and its formula are
 * deliberately **separate** from the retracement's: levels past 1 are
 * this tool's whole point, and sharing `FIB_LEVELS` would hand it a
 * retracement's screen.
 */

const space: DrawingSpace = {
  area: { left: 0, right: 100, top: 0, bottom: 100 },
  xAt: (pixel) => pixel,
  pixelAtX: (x) => x,
  valueAt: (pixel) => pixel,
  pixelAtValue: (price) => price,
};

const ext: Drawing = {
  type: "fibExtension",
  id: "fx",
  a: { x: 10, price: 10 },
  b: { x: 30, price: 30 },
  c: { x: 50, price: 20 },
  levels: [0, 1, 2],
};

describe("levels and formula — separate from the retracement", () => {
  it("has its own default levels, reaching past 1", () => {
    expect(FIB_EXTENSION_LEVELS).not.toEqual(FIB_LEVELS);
    expect(Math.max(...FIB_EXTENSION_LEVELS)).toBeGreaterThan(1);
    expect(fibExtensionLevels({ levels: undefined })).toEqual(FIB_EXTENSION_LEVELS);
    expect(fibExtensionLevels({ levels: [0, 1.5] })).toEqual([0, 1.5]);
  });

  it("projects the a→b swing from c: level 0 at c, level 1 at c + (b − a)", () => {
    expect(fibExtensionPrice(ext, 0)).toBe(20);
    expect(fibExtensionPrice(ext, 1)).toBe(40);
    expect(fibExtensionPrice(ext, 2)).toBe(60);
    // A down-swing projects downward — no clamping, no abs.
    expect(
      fibExtensionPrice(
        { a: { x: 0, price: 30 }, b: { x: 1, price: 10 }, c: { x: 2, price: 25 } },
        1.618,
      ),
    ).toBeCloseTo(25 - 20 * 1.618, 9);
  });
});

describe("hit vocabulary", () => {
  it("a level line grabs across the anchors' x span; outside the span it does not; the swing legs grab too", () => {
    // Level 1 at price 40, span x 10..50.
    expect(gripAt([ext], space, { x: 30, y: 40 })).toMatchObject({ part: "whole" });
    expect(gripAt([ext], space, { x: 70, y: 40 })).toBeNull();
    // Between levels — nothing.
    expect(gripAt([ext], space, { x: 30, y: 50 })).toBeNull();
    // On the b→c leg (midpoint (40, 25)).
    expect(gripAt([ext], space, { x: 40, y: 25 })).toMatchObject({ part: "whole" });
    expect(gripAt([ext], space, { x: 51, y: 20 })).toMatchObject({ part: "c" });
  });
});

describe("render draws what hit-testing checks", () => {
  function record(drawing: Drawing) {
    const lines: Point[][] = [];
    const texts: TextParams[] = [];
    const target = {
      drawLine: (points: Point[]) => {
        lines.push(points);
      },
      drawShape: () => undefined,
      drawText: (params: TextParams) => {
        texts.push(params);
      },
      drawCustom: () => undefined,
    };
    drawOne(
      target as never,
      space,
      { readStyle: () => "", formatValue: String, barIndexAt: (x) => x },
      drawing,
      { width: 1, color: "#000" },
      false,
    );
    return { lines, texts };
  }

  it("the swing legs plus one line and one label per level, over the anchors' x span", () => {
    const { lines, texts } = record(ext);
    expect(lines[0]).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 30 },
      { x: 50, y: 20 },
    ]);
    expect(lines.slice(1)).toEqual([
      [{ x: 10, y: 20 }, { x: 50, y: 20 }],
      [{ x: 10, y: 40 }, { x: 50, y: 40 }],
      [{ x: 10, y: 60 }, { x: 50, y: 60 }],
    ]);
    expect(texts.map((text) => text.text)).toEqual(["0.0%", "100.0%", "200.0%"]);
  });

  it("without levels it draws the extension defaults, not the retracement's", () => {
    const { lines } = record({ ...ext, levels: undefined });
    expect(lines).toHaveLength(1 + FIB_EXTENSION_LEVELS.length);
  });
});

describe("placement and editing through the real state machine", () => {
  const data: LineDataPoint[] = [
    { x: 0, y: 100 },
    { x: 5, y: 120 },
    { x: 10, y: 110 },
  ];

  function mounted() {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data },
      config: {
        showGrid: false,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    const tools = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
    const pane = model.plot.mainPane;
    const click = (x: number, price: number) => {
      const point = { x: model.plot.pixelAtX(x), y: pane.yScale.scale(price) };
      model.plot.routeInput({ type: "pointerdown", point, pointerId: 1 });
      model.plot.routeInput({ type: "pointerup", point, pointerId: 1 });
    };
    return { tools, click };
  }

  it("takes three clicks and lands without levels (the defaults)", () => {
    const { tools, click } = mounted();
    tools.begin("fibExtension");
    click(2, 105);
    click(5, 115);
    click(8, 108);
    expect(tools.mode()).toBeNull();
    const [drawn] = tools.list();
    if (drawn.type !== "fibExtension") throw new Error("expected a fibExtension");
    expect(drawn.levels).toBeUndefined();
    expect(drawn.c.x).toBeCloseTo(8, 5);
  });

  it("handle.update sets and clears levels, sorted and deduped, never clamped", () => {
    const { tools } = mounted();
    tools.add({
      type: "fibExtension",
      a: { x: 2, price: 105 },
      b: { x: 5, price: 115 },
      c: { x: 8, price: 108 },
    });
    const [handle] = tools.handles();
    handle.update({ levels: [2.618, 1, 1, -0.5] });
    expect(handle.read()).toMatchObject({ levels: [-0.5, 1, 2.618] });
    handle.update({ levels: undefined });
    expect(handle.read()).not.toHaveProperty("levels");
  });
});
