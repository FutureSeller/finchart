import type { Point } from "@finchart/core";
import { describe, expect, it } from "vitest";
import type { Drawing } from "../drawings";
import { ANCHOR_KEYS, channelParallel, pitchforkLines } from "../drawings";
import { gripAt, infiniteEndpoints } from "../hit";
import { drawOne } from "../render";
import type { DrawingSpace } from "../space";
import { drawingChart } from "./drawing-chart.fixture";

/**
 * Three-anchor kinds (parallelChannel · pitchfork) and the drafting
 * generalization that carries them: a draft confirms one anchor per click,
 * the following anchors trail the cursor, and the click boundary ("was that a
 * drag") measures from the **latest press** — the one that confirmed the last
 * anchor — not from `a`.
 */

const space: DrawingSpace = {
  area: { left: 0, right: 100, top: 0, bottom: 100 },
  xAt: (pixel) => pixel,
  pixelAtX: (x) => x,
  valueAt: (pixel) => pixel,
  pixelAtValue: (price) => price,
};

const channel: Drawing = {
  type: "parallelChannel",
  id: "ch",
  a: { x: 20, price: 20 },
  b: { x: 60, price: 40 },
  c: { x: 30, price: 50 },
};

const fork: Drawing = {
  type: "pitchfork",
  id: "pf",
  a: { x: 10, price: 50 },
  b: { x: 40, price: 20 },
  c: { x: 40, price: 80 },
};

describe("derived geometry — one formula in price space", () => {
  it("parallelChannel: the second line runs through c, parallel to a–b, over a–b's x span", () => {
    // Slope 0.5 through c=(30,50): 45 at x=20, 65 at x=60.
    expect(channelParallel(channel)).toEqual([
      { x: 20, price: 45 },
      { x: 60, price: 65 },
    ]);
  });

  it("parallelChannel: a vertical a–b shifts the parallel to c's x", () => {
    expect(
      channelParallel({ a: { x: 20, price: 20 }, b: { x: 20, price: 40 }, c: { x: 50, price: 0 } }),
    ).toEqual([
      { x: 50, price: 20 },
      { x: 50, price: 40 },
    ]);
  });

  it("pitchfork: the median leaves a through the midpoint of b–c; the tines carry the same price-space direction", () => {
    expect(pitchforkLines(fork)).toEqual([
      [{ x: 10, price: 50 }, { x: 40, price: 50 }],
      [{ x: 40, price: 20 }, { x: 70, price: 20 }],
      [{ x: 40, price: 80 }, { x: 70, price: 80 }],
    ]);
  });

  it("every kind's anchor keys are a prefix of a·b·c", () => {
    for (const keys of Object.values(ANCHOR_KEYS)) {
      expect(["a", "b", "c"].slice(0, keys.length)).toEqual([...keys]);
    }
  });
});

describe("hit vocabulary", () => {
  it("parallelChannel: both lines grab, the space between them does not, c is a handle", () => {
    expect(gripAt([channel], space, { x: 40, y: 30 })).toMatchObject({ part: "whole" });
    expect(gripAt([channel], space, { x: 40, y: 55 })).toMatchObject({ part: "whole" });
    expect(gripAt([channel], space, { x: 40, y: 42 })).toBeNull();
    expect(gripAt([channel], space, { x: 31, y: 50 })).toMatchObject({ part: "c" });
  });

  it("pitchfork: median and tines are rays past the fork, the b–c bar is a segment, nothing before a", () => {
    expect(gripAt([fork], space, { x: 80, y: 50 })).toMatchObject({ part: "whole" });
    expect(gripAt([fork], space, { x: 80, y: 20 })).toMatchObject({ part: "whole" });
    expect(gripAt([fork], space, { x: 80, y: 80 })).toMatchObject({ part: "whole" });
    expect(gripAt([fork], space, { x: 40, y: 35 })).toMatchObject({ part: "whole" });
    expect(gripAt([fork], space, { x: 2, y: 50 })).toBeNull();
    expect(gripAt([fork], space, { x: 41, y: 20 })).toMatchObject({ part: "b" });
  });
});

describe("render draws what hit-testing checks", () => {
  function linesOf(drawing: Drawing): Point[][] {
    const lines: Point[][] = [];
    const target = {
      drawLine: (points: Point[]) => {
        lines.push(points);
      },
      drawShape: () => undefined,
      drawText: () => undefined,
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
    return lines;
  }

  it("parallelChannel: a–b and the derived parallel, nothing else", () => {
    expect(linesOf(channel)).toEqual([
      [{ x: 20, y: 20 }, { x: 60, y: 40 }],
      [{ x: 20, y: 45 }, { x: 60, y: 65 }],
    ]);
  });

  it("pitchfork: three rays from the shared formula plus the b–c bar", () => {
    const lines = linesOf(fork);
    const ray = (from: Point, through: Point) => infiniteEndpoints("ray", from, through, space);
    expect(lines).toEqual([
      ray({ x: 10, y: 50 }, { x: 40, y: 50 }),
      ray({ x: 40, y: 20 }, { x: 70, y: 20 }),
      ray({ x: 40, y: 80 }, { x: 70, y: 80 }),
      [{ x: 40, y: 20 }, { x: 40, y: 80 }],
    ]);
  });
});

describe("three-anchor drafting through the real state machine", () => {
  it.each<"parallelChannel" | "pitchfork">(["parallelChannel", "pitchfork"])("%s is still drafting after two clicks", (kind) => {
    const { tools, click } = drawingChart();
    tools.begin(kind);
    click({ x: 2, price: 105 });
    click({ x: 5, price: 115 });
    expect(tools.mode()).toBe(kind);
    expect(tools.list()).toHaveLength(0);
  });

  it("the click boundary measures from the latest press — a click on b does not finish the draft", () => {
    const { tools, click } = drawingChart();
    tools.begin("parallelChannel");
    click({ x: 2, price: 105 });
    // Second click far from a: a click boundary anchored on `a` would read
    // the release as "dragged" and stamp c on top of b.
    click({ x: 8, price: 115 });
    expect(tools.mode()).toBe("parallelChannel");
    expect(tools.list()).toHaveLength(0);
  });

  it("dragging the first segment confirms b on release, and c keeps following", () => {
    const { tools, hover, click, drag } = drawingChart();
    tools.begin("parallelChannel");
    drag({ x: 2, price: 105 }, { x: 6, price: 112 });
    expect(tools.mode()).toBe("parallelChannel");
    expect(tools.list()).toHaveLength(0);

    hover({ x: 9, price: 100 });
    click({ x: 9, price: 100 });
    const [drawn] = tools.list();
    if (drawn.type !== "parallelChannel") throw new Error("expected a channel");
    expect(drawn.b.x).toBeCloseTo(6, 5);
    expect(drawn.c.x).toBeCloseTo(9, 5);
  });

  it("while b is being placed, c trails with it — the draft is always a complete drawing", () => {
    const { tools, hover, click } = drawingChart();
    tools.begin("pitchfork");
    click({ x: 2, price: 105 });
    hover({ x: 7, price: 110 });
    // Nothing is in the list yet; complete the fork and check c was
    // stamped where the last cursor position was, after b.
    click({ x: 7, price: 110 });
    click({ x: 9, price: 100 });
    const [drawn] = tools.list();
    if (drawn.type !== "pitchfork") throw new Error("expected a pitchfork");
    expect(drawn.b.x).toBeCloseTo(7, 5);
    expect(drawn.c.x).toBeCloseTo(9, 5);
  });

  it("Esc mid-draft discards a three-anchor draft", () => {
    const { tools, click, key } = drawingChart();
    tools.begin("pitchfork");
    click({ x: 2, price: 105 });
    click({ x: 5, price: 115 });
    key("Escape");
    expect(tools.mode()).toBeNull();
    expect(tools.list()).toHaveLength(0);
  });

  it("dragging c moves only c; dragging the median moves all three — and Esc restores", () => {
    const { tools, drag, press, key } = drawingChart();
    tools.add({
      type: "parallelChannel",
      a: { x: 2, price: 105 },
      b: { x: 8, price: 115 },
      c: { x: 2, price: 100 },
    });
    const [handle] = tools.handles();

    drag({ x: 2, price: 100 }, { x: 3, price: 98 });
    let read = handle.read();
    if (read.type !== "parallelChannel") throw new Error("expected a channel");
    expect(read.c.x).toBeCloseTo(3, 5);
    expect(read.a.x).toBeCloseTo(2, 5);

    // Mid-line of a–b.
    press({ x: 5, price: 110 }).moveTo({ x: 6, price: 110 });
    read = handle.read();
    if (read.type !== "parallelChannel") throw new Error("expected a channel");
    expect(read.a.x).toBeCloseTo(3, 5);
    expect(read.c.x).toBeCloseTo(4, 5);
    key("Escape");
    read = handle.read();
    if (read.type !== "parallelChannel") throw new Error("expected a channel");
    expect(read.a.x).toBeCloseTo(2, 5);
    expect(read.c.x).toBeCloseTo(3, 5);
  });

  it("handle.update patches c in place", () => {
    const { tools } = drawingChart();
    tools.add({
      type: "pitchfork",
      a: { x: 2, price: 105 },
      b: { x: 8, price: 115 },
      c: { x: 8, price: 100 },
    });
    const [handle] = tools.handles();
    const before = handle.read();
    if (before.type !== "pitchfork") throw new Error("expected a pitchfork");
    handle.update({ c: { x: 9, price: 101 } });
    expect(handle.read()).toMatchObject({ type: "pitchfork", c: { x: 9, price: 101 } });
    expect(handle.read()).toMatchObject({ a: before.a, b: before.b });
  });
});
