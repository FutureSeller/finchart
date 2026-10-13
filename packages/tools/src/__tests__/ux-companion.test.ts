import type { OHLC, Point } from "@finchart/core";
import { candleSeries } from "@finchart/core";
import { describe, expect, it, vi } from "vitest";
import type { Drawing } from "../drawings";
import { gripAt } from "../hit";
import type { DrawingSpace } from "../space";
import { drawingChart } from "./drawing-chart.fixture";

/**
 * The UX that rides along with thirteen kinds: the crosshair keeps
 * reading prices while you draw or drag, a snapped anchor shows a ring
 * so you know it stuck, a selected drawing is drawn heavier than its
 * neighbors (handles alone vanish in a crowd), and when two handles
 * collapse onto each other the nearest one wins instead of `a` always.
 */

const candles: OHLC[] = [
  { x: 0, open: 100, high: 110, low: 95, close: 105 },
  { x: 1, open: 105, high: 120, low: 101, close: 112 },
  { x: 2, open: 112, high: 118, low: 108, close: 109 },
];

function mounted(snap = false) {
  const chart = drawingChart({
    series: { series: candleSeries(), data: candles },
    tools: { snap },
  });
  const lines = () => chart.model.commands().filter((c) => c.type === "drawLine");
  return { ...chart, lines };
}

describe("the crosshair keeps reading while a gesture is in flight", () => {
  it("fires on every move while drafting", () => {
    const { model, tools, at, click, hover } = mounted();
    const seen = vi.fn();
    model.plot.on("crosshair", seen);
    tools.begin("trend");
    click({ x: 0, price: 100 });
    seen.mockClear();
    hover({ x: 1, price: 110 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].position).toEqual(at(1, 110));
  });

  it("fires on every move while dragging a drawing", () => {
    const { model, tools, press } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    const seen = vi.fn();
    model.plot.on("crosshair", seen);
    const gesture = press({ x: 1, price: 105 });
    seen.mockClear();
    gesture.moveTo({ x: 1, price: 108 });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

type Commands = ReturnType<ReturnType<typeof mounted>["lines"]>;

/** Whether a polyline ends where it began — the snap ring does; no drawing's outline here does. */
function closesOnItself(points: readonly Point[]): boolean {
  const first = points[0];
  const last = points.at(-1);
  return points.length > 2 && last !== undefined && first.x === last.x && first.y === last.y;
}

/** The centers of every closed ring (the snap marker) among `commands`. */
function rings(commands: Commands): Point[] {
  const centers: Point[] = [];
  for (const command of commands) {
    if (command.type !== "drawLine" || !closesOnItself(command.points)) continue;
    centers.push({
      x: command.points.reduce((sum, p) => sum + p.x, 0) / command.points.length,
      y: command.points.reduce((sum, p) => sum + p.y, 0) / command.points.length,
    });
  }
  return centers;
}

/** Whether a snap ring is centered near `center`. */
function ringAround(commands: Commands, center: Point): boolean {
  return rings(commands).some(
    (c) => Math.abs(c.x - center.x) < 1 && Math.abs(c.y - center.y) < 1,
  );
}

describe("a snapped anchor shows a ring", () => {
  it("draws the ring at the bar value it stuck to, and only while snapped", () => {
    const { tools, at, press, lines } = mounted(true);
    tools.begin("horizontal");
    // 3px off the close — inside the 8px radius, so the price snaps.
    const near = { px: at(1, 112).x, py: at(1, 112).y + 3 };
    const gesture = press(near);
    expect(ringAround(lines(), at(1, 112))).toBe(true);
    // Move far from any bar value — the ring goes away.
    gesture.moveTo({ px: near.px, py: at(1, 112).y + 40 });
    expect(rings(lines())).toEqual([]);
  });

  /** The ring is a marker, not part of the drawing — it keeps a thin solid stroke whatever the drawing's style. */
  it("draws the ring one pixel wide and undashed under a heavy dashed style", () => {
    const { model, tools, at, press } = drawingChart({
      series: { series: candleSeries(), data: candles },
      tools: { snap: true, style: { width: 3, dashArray: "4 2" } },
    });
    tools.begin("horizontal");
    const close = at(1, 112);
    press({ px: close.x, py: close.y + 3 });

    const ringStrokes = model
      .commands()
      .flatMap((command) =>
        command.type === "drawLine" && closesOnItself(command.points) ? [command.style] : [],
      );
    expect(ringStrokes).toHaveLength(1);
    expect(ringStrokes[0]).toMatchObject({ width: 1, dashArray: "" });
  });

  it("no ring with snapping off, and none once the drawing is placed", () => {
    const off = mounted(false);
    off.tools.begin("horizontal");
    off.press({ px: off.at(1, 112).x, py: off.at(1, 112).y + 3 });
    expect(rings(off.lines())).toEqual([]);

    const on = mounted(true);
    on.tools.begin("horizontal");
    on.click({ px: on.at(1, 112).x, py: on.at(1, 112).y + 3 });
    expect(on.tools.list()).toHaveLength(1);
    expect(rings(on.lines())).toEqual([]);
  });

  it("does not carry a placed drawing's ring over to the next tool", () => {
    const { plot, tools, at, click, lines } = mounted(true);
    tools.begin("horizontal");
    click({ px: at(1, 112).x, py: at(1, 112).y + 3 });
    expect(tools.list()).toMatchObject([{ price: 112 }]);

    tools.begin("trend");
    plot.render();
    expect(rings(lines())).toEqual([]);
  });
});

describe("a selected drawing is drawn heavier", () => {
  it("adds one pixel to the selected drawing's width and nothing else's", () => {
    const { tools, lines } = mounted();
    tools.add({ type: "horizontal", price: 105 });
    tools.add({ type: "horizontal", price: 110 });
    const [first, second] = tools.handles();
    const widths = () =>
      lines()
        .map((command) => (command.type === "drawLine" ? command.style.width : NaN))
        .slice(-2);
    const [base] = widths();

    tools.select(second);
    expect(widths()).toEqual([base, base + 1]);
    tools.select(first);
    expect(widths()).toEqual([base + 1, base]);
    tools.select(null);
    expect(widths()).toEqual([base, base]);
  });
});

describe("when handles overlap, the nearest one wins", () => {
  const space: DrawingSpace = {
    area: { left: 0, right: 100, top: 0, bottom: 100 },
    xAt: (pixel) => pixel,
    pixelAtX: (x) => x,
    valueAt: (pixel) => pixel,
    pixelAtValue: (price) => price,
  };

  it("a trend line zoomed down to a few pixels still lets you grab b", () => {
    const trend: Drawing = {
      type: "trend",
      id: "t",
      a: { x: 10, price: 10 },
      b: { x: 13, price: 10 },
    };
    expect(gripAt([trend], space, { x: 14, y: 10 })).toMatchObject({ part: "b" });
    expect(gripAt([trend], space, { x: 9, y: 10 })).toMatchObject({ part: "a" });
  });

  it("the same for a three-anchor kind's c", () => {
    const fork: Drawing = {
      type: "pitchfork",
      id: "p",
      a: { x: 10, price: 10 },
      b: { x: 12, price: 10 },
      c: { x: 14, price: 10 },
    };
    expect(gripAt([fork], space, { x: 15, y: 10 })).toMatchObject({ part: "c" });
  });

  /** Past the line's end only the handle can catch the press, so its radius alone decides. */
  it("a handle grabs from up to six pixels away and no farther", () => {
    const trend: Drawing = {
      type: "trend",
      id: "t",
      a: { x: 10, price: 10 },
      b: { x: 40, price: 10 },
    };
    expect(gripAt([trend], space, { x: 46, y: 10 })).toMatchObject({ part: "b" });
    expect(gripAt([trend], space, { x: 46.5, y: 10 })).toBeNull();
  });
});
