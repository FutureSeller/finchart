/** kagiSeries — step corners, two widths split at breakY, the probe round trip, the declarations. */
import type { DrawCommand, OHLC } from "@finchart/core";
import { ContractError, createPlotModel, DataError, M4Decimation } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { kagi } from "../kagi";
import type { KagiPoint } from "../kagi";
import { KAGI_STYLE_SPEC, kagiSeries } from "../kagi-series";

function tick(x: number, close: number): OHLC {
  return { x, open: close, high: close, low: close, close };
}
function model() {
  return createPlotModel({
    size: { width: 800, height: 600 },
    config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
  });
}
type Line = Extract<DrawCommand, { type: "drawLine" }>;
const lines = (commands: readonly DrawCommand[]): Line[] =>
  commands.flatMap((command) => (command.type === "drawLine" ? [command] : []));

/**
 * A tape that rises 100→110 (yang), pulls back to 104 (still yang — above
 * the waist that does not exist yet… it turns yin the moment it drops
 * below the previous waist, which is 100 here, so no break), rises to 112
 * (yang: crosses the shoulder 110 — but it was already yang, so no
 * break), falls to 99 (crosses the waist 104 → yin, breakY 104).
 */
const tape = [tick(0, 100), tick(1, 110), tick(2, 104), tick(3, 112), tick(4, 99)];

describe("kagiSeries", () => {
  it("refuses non-object options", () => {
    expect(() => Reflect.apply(kagiSeries, undefined, [null])).toThrow(ContractError);
  });

  it("the data door refuses a y that is not a finite number and a breakY that is present but not finite", () => {
    const point = (y: number, breakY?: number): KagiPoint => ({ x: 0, y, closedAt: 0, tone: "up", breakY });
    const good: KagiPoint = { x: 1, y: 101, closedAt: 1, tone: "up" };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => model().plot.mainPane.addSeries({ series: kagiSeries(), data: [point(bad), good] })).toThrow(DataError);
      expect(() => model().plot.mainPane.addSeries({ series: kagiSeries(), data: [point(100, bad), good] })).toThrow(DataError);
    }
    // A missing or null y is not a gap here — a gapless series would draw it as a price — so it is refused too.
    // The bad point sits in the middle: core reads the edges itself, so only a middle point proves this door.
    const missing: unknown = { x: 1, closedAt: 1, tone: "up" };
    const nulled: unknown = { x: 1, y: null, closedAt: 1, tone: "up" };
    const last: KagiPoint = { x: 2, y: 102, closedAt: 2, tone: "up" };
    for (const bad of [missing, nulled]) {
      const pane = model().plot.mainPane;
      expect(() => Reflect.apply(pane.addSeries, pane, [{ series: kagiSeries(), data: [point(100), bad, last] }])).toThrow(DataError);
    }
    expect(() => model().plot.mainPane.addSeries({ series: kagiSeries(), data: [point(100, 100.5), good] })).not.toThrow();
  });

  it("draws a stepped line — every stroke moves only horizontally or vertically, with the corner at (new x, old y)", () => {
    const m = model();
    const handle = m.plot.mainPane.addSeries({ series: kagiSeries(), data: tape, derive: (source) => kagi(source, { reversal: 2 }) });
    m.plot.render();
    const points = handle.read();
    expect(points.map((p) => p.y)).toEqual([100, 110, 104, 112, 99]);
    const strokes = lines(m.commands());
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1];
        const b = stroke.points[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
    }
    // The whole drawn path, stroke by stroke: one x per vertex, and before each vertex its corner at (new x, old y).
    const path = strokes.flatMap((s) => s.points);
    const xs = [...new Set(path.map((p) => p.x))];
    expect(xs).toHaveLength(points.length);
    const vertexY = xs.map((x) => path.filter((p) => p.x === x).at(-1)?.y);
    expect(new Set(vertexY).size).toBe(5); // five distinct prices
    for (let i = 1; i < xs.length; i++) {
      const corner = path.findIndex((p) => p.x === xs[i] && p.y === vertexY[i - 1]);
      const vertex = path.findIndex((p) => p.x === xs[i] && p.y === vertexY[i]);
      expect(corner).toBeGreaterThan(-1);
      expect(corner).toBeLessThan(vertex);
      // The corner is the first point at the new x — the line arrives horizontally.
      expect(path.findIndex((p) => p.x === xs[i])).toBe(corner);
    }
  });

  it("strokes yang thick and yin thin, splitting the vertical stroke at breakY", () => {
    const m = model();
    m.plot.mainPane.addSeries({
      series: kagiSeries({ style: { upWidth: 5, downWidth: 1, up: "#0f0", down: "#f00" } }),
      data: tape,
      derive: (source) => kagi(source, { reversal: 2 }),
    });
    m.plot.render();
    const strokes = lines(m.commands());
    // One yang stroke over the first three segments and the top of the last, one yin stroke from the waist down.
    expect(strokes.map((s) => [s.style.width, s.style.color])).toEqual([
      [5, "#0f0"],
      [1, "#f00"],
    ]);
    const [yang, yin] = strokes;
    // The yin stroke starts where the yang one ended — at the break — and runs vertically to 99.
    expect(yin.points[0]).toEqual(yang.points[yang.points.length - 1]);
    expect(yin.points).toHaveLength(2);
    expect(yin.points[0].x).toBe(yin.points[1].x);
    // The break sits at the waist's price: the same y as the vertex at 104, which the yang stroke also passes.
    const yAt104 = yang.points[yang.points.length - 1].y;
    expect(yang.points.filter((p) => p.y === yAt104).length).toBeGreaterThanOrEqual(2);
    // The yang stroke: start, then per vertex a corner and the vertex, then the break — 1 + 3×2 + 1 (corner of the last) + 1 (break).
    expect(yang.points).toHaveLength(1 + 3 * 2 + 1 + 1);
  });

  it("a tone change without breakY splits at the corner; a lone start point draws nothing", () => {
    const m = model();
    const points: KagiPoint[] = [
      { x: 0, y: 100, closedAt: 0, tone: "down" },
      { x: 1, y: 105, closedAt: 1, tone: "down" },
      { x: 2, y: 101, closedAt: 2, tone: "up" },
    ];
    m.plot.mainPane.addSeries({ series: kagiSeries({ style: { upWidth: 4, downWidth: 2 } }), data: points });
    m.plot.render();
    const strokes = lines(m.commands());
    expect(strokes.map((s) => s.style.width)).toEqual([2, 4]);
    expect(strokes[1].points).toHaveLength(2);
    expect(strokes[1].points[0]).toEqual(strokes[0].points[strokes[0].points.length - 1]);

    const lone = model();
    lone.plot.mainPane.addSeries({ series: kagiSeries(), data: [points[0]] });
    lone.plot.render();
    expect(lines(lone.commands())).toEqual([]);
  });

  it("claims the y axis for the vertices; nothing to measure is null", () => {
    const series = kagiSeries();
    expect(series.valueExtent([])).toBeNull();
    expect(
      series.valueExtent([
        { x: 0, y: 100, closedAt: 0, tone: "up" },
        { x: 1, y: 110, closedAt: 1, tone: "up" },
        { x: 2, y: 95, closedAt: 2, tone: "down", breakY: 100 },
      ]),
    ).toEqual({ min: 95, max: 110 });
  });

  it("probe answers in ordinal x with the index of the vertex, and the accepted array agrees at that index", () => {
    // Source times are far from the ordinals, so a series reading `closedAt` for x would answer wrongly.
    const timed = tape.map((candle) => ({ ...candle, x: 1_000 + candle.x * 60_000 }));
    const m = model();
    const handle = m.plot.mainPane.addSeries({ series: kagiSeries(), data: timed, derive: (source) => kagi(source, { reversal: 2 }) });
    m.plot.render();
    expect(handle.read().map((p) => p.x)).toEqual([0, 1, 2, 3, 4]);
    for (const x of [0, 2, 4]) {
      const [sample] = m.plot.mainPane.probe(x);
      expect(sample.x).toBe(x);
      const point = handle.read()[sample.index];
      expect(point.x).toBe(x);
      expect(sample.value).toBe(point.y);
      expect(point.closedAt).toBe(1_000 + x * 60_000);
    }
    // A source time is far beyond the ordinal axis: the nearest vertex is the last one, not a time match.
    expect(m.plot.mainPane.probe(1_000)[0].x).toBe(4);
  });

  it("declares its decimation (M4 at four per pixel — one bucket per column) and gapless coordinates", () => {
    const series = kagiSeries();
    expect(series.decimation?.strategy).toBeInstanceOf(M4Decimation);
    expect(series.decimation?.pointsPerPixel).toBe(4);
    expect(series.coordinates?.gapless).toBe(true);
    expect(series.coordinates?.getY({ x: 3, y: 7, closedAt: 3, tone: "up" })).toBe(7);
  });

  it("reads the candle's colours and its own two widths", () => {
    expect(KAGI_STYLE_SPEC).toEqual({
      up: { css: "--chart-candle-up", fallback: "#16a34a" },
      down: { css: "--chart-candle-down", fallback: "#dc2626" },
      upWidth: { css: "--chart-kagi-up-width", fallback: 3 },
      downWidth: { css: "--chart-kagi-down-width", fallback: 1 },
    });
  });
});
