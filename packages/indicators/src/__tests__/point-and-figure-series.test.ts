/** pointAndFigureSeries — X's and O's per box, the pixel floor, the visible window, the doors, the probe round trip, the aggregation. */
import type { DrawCommand, DrawTarget, OHLC, Scale, Series } from "@finchart/core";
import { ContractError, continuousX, createPlotModel, DataError, LinearScale, LogScale, noStyle, OHLCAccessor } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { pointAndFigure } from "../point-and-figure";
import type { PointAndFigureColumn } from "../point-and-figure";
import { PnfAggregation, POINT_AND_FIGURE_STYLE_SPEC, pointAndFigureSeries } from "../point-and-figure-series";

function model(width = 800, height = 600, maxPoints?: number) {
  return createPlotModel({
    size: { width, height },
    config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
    deps: maxPoints === undefined ? undefined : { maxPoints },
  });
}
function column(x: number, tone: "up" | "down", low: number, high: number, box = 1): PointAndFigureColumn {
  const boxes = Math.round((high - low) / box) + 1;
  return tone === "up"
    ? { x, open: low, close: high, high, low, closedAt: x * 10, tone, boxes }
    : { x, open: high, close: low, high, low, closedAt: x * 10, tone, boxes };
}
const lines = (commands: readonly DrawCommand[]) => commands.flatMap((c) => (c.type === "drawLine" ? [c] : []));
/** Draws on a stub stage — for columns whose span no axis can fit, where the plot's own door stops first. */
function drawDirect(
  series: Series<PointAndFigureColumn>,
  data: PointAndFigureColumn[],
  domain: [number, number],
  columnsAcross = 1,
  yScale: Scale = new LinearScale(domain[0], domain[1], 600, 0),
): DrawCommand[] {
  const commands: DrawCommand[] = [];
  const target: DrawTarget = {
    drawLine: (points, style) => commands.push({ type: "drawLine", points, style }),
    drawShape: (shape) => commands.push({ type: "drawShape", shape }),
    drawText: () => undefined,
  };
  series.draw(target, {
    data,
    x: continuousX(new LinearScale(0, columnsAcross, 0, 800)),
    yScale,
    area: { left: 0, right: 800, top: 0, bottom: 600 },
    readStyle: noStyle,
  });
  return commands;
}
const rects = (commands: readonly DrawCommand[]) =>
  commands.flatMap((c) => (c.type === "drawShape" && c.shape.shape === "rect" ? [c.shape] : []));

describe("pointAndFigureSeries", () => {
  it("a fit keeps half a column at each end — the columns are drawn a slot wide", () => {
    const { plot } = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: pointAndFigureSeries({ boxSize: 1 }), data: [column(0, "up", 101, 103), column(2, "down", 100, 102)] },
    });

    expect(plot.getState().xDomain).toEqual({ min: -1, max: 3 });
  });

  it("refuses non-object options and a box that is not a positive normal number", () => {
    expect(() => Reflect.apply(pointAndFigureSeries, undefined, [null])).toThrow(ContractError);
    expect(() => Reflect.apply(pointAndFigureSeries, undefined, [{}])).toThrow(ContractError);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE]) {
      expect(() => pointAndFigureSeries({ boxSize: bad })).toThrow(ContractError);
    }
    expect(() => new PnfAggregation(0)).toThrow(ContractError);
  });

  it("the data door refuses a column whose boxes, tone or closedAt is wrong — and one whose span disagrees with the box", () => {
    const good = [column(0, "up", 101, 103), column(2, "down", 100, 102)];
    const add = (bad: unknown, boxSize = 1) => {
      const pane = model().plot.mainPane;
      return () => Reflect.apply(pane.addSeries, pane, [{ series: pointAndFigureSeries({ boxSize }), data: [good[0], bad, good[1]] }]);
    };
    const base = column(1, "up", 101, 103);
    for (const boxes of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5, 2, 4]) expect(add({ ...base, boxes })).toThrow(DataError);
    for (const tone of ["x", "UP", undefined, null]) expect(add({ ...base, tone })).toThrow(DataError);
    for (const closedAt of [Number.NaN, undefined, "3"]) expect(add({ ...base, closedAt })).toThrow(DataError);
    for (const close of [Number.NaN, null]) expect(add({ ...base, close })).toThrow(DataError);
    // The ends the tone runs between: an X column opens at its low and closes at its high, an O column the reverse.
    expect(add({ ...base, open: 999 })).toThrow(DataError);
    expect(add({ ...base, close: -999 })).toThrow(DataError);
    expect(add({ ...base, open: base.high, close: base.low })).toThrow(DataError);
    expect(add({ ...base, tone: "down" })).toThrow(DataError);
    expect(add({ ...base, tone: "down", open: base.high, close: base.low })).not.toThrow();
    // A span that runs backwards, and one whose ends are finite but 2⁴⁷ boxes or more from zero — beyond any column the transform makes.
    expect(add({ ...base, low: 103, high: 101, boxes: -1 })).toThrow(DataError);
    expect(add({ ...base, low: -1e308, high: 1e308, boxes: Number.POSITIVE_INFINITY })).toThrow(DataError);
    expect(add({ ...base, low: 0, high: 2 ** 47, boxes: 2 ** 47 + 1 })).toThrow(DataError);
    // A level whose price leaves the doubles — high 1.7e308 on a box of 1e308 is level 2, priced at infinity — is no grid
    // price (judged at the door itself: no neighbouring column fits a box of 1e308 to stand beside it).
    const huge = pointAndFigureSeries({ boxSize: 1e308 }).coordinates;
    expect(() => huge?.assertFinite?.({ ...base, low: 1e308, high: 1.7e308, boxes: 2 }, 0)).toThrow(DataError);
    expect(() => huge?.assertFinite?.({ ...base, low: 1e308, high: 1e308, open: 1e308, close: 1e308, boxes: 1 }, 0)).not.toThrow();
    // An end off the grid — 1.49 and 2.49 round to levels 1 and 2, but the transform prices those as 1 and 2 — is refused.
    expect(add({ ...base, low: 1.49, high: 2.49, boxes: 2 })).toThrow(DataError);
    expect(add({ ...base, low: 101, high: 103.0000001, boxes: 3 })).toThrow(DataError);
    // A fractional box's grid prices are whatever one multiplication gives — those are kept, a hand-typed decimal may not be.
    const tenth = pointAndFigureSeries({ boxSize: 0.1 }).coordinates;
    expect(() => tenth?.assertFinite?.({ ...base, low: 3 * 0.1, high: 5 * 0.1, open: 3 * 0.1, close: 5 * 0.1, boxes: 3 }, 0)).not.toThrow();
    // The same columns under a series told a different box: a three-box column fits neither 2 nor 0.5…
    expect(add(base, 2)).toThrow(DataError);
    expect(add(base, 0.5)).toThrow(DataError);
    expect(add(base)).not.toThrow();
    // …but a column whose ends lie on the other box's grid too — one box at 100, under a box of 1 or of 2 — fits either:
    // the door judges the ends and the span, it cannot recover the transform's option.
    const lone = model().plot.mainPane;
    expect(() => lone.addSeries({ series: pointAndFigureSeries({ boxSize: 2 }), data: [column(0, "up", 100, 100)] })).not.toThrow();
    expect(add(column(1, "up", 101, 101), 2)).toThrow(DataError);
    // A genuine column whose price difference overflows the doubles — box 1e300, levels ±1e8 — is judged level by level and kept.
    const wide = pointAndFigure([{ x: 0, open: 0, high: 0, low: 0, close: -1e308 }, { x: 1, open: 0, high: 0, low: 0, close: 1e308 }], { boxSize: 1e300 });
    expect(wide[0].boxes).toBe(2e8);
    // Judged at the door directly — a span of 2 × 10³⁰⁸ is past what any axis can fit, but the column is well-formed.
    const door = pointAndFigureSeries({ boxSize: 1e300 }).coordinates;
    expect(() => door?.assertFinite?.(wide[0], 0)).not.toThrow();
    expect(() => door?.assertFinite?.({ ...wide[0], boxes: 2e8 + 1 }, 0)).toThrow(DataError);
    // And drawn, zoomed to its top five boxes, where a difference of prices would already be infinite: five to seven X's.
    // (On a stub stage — the plot fits its axis to the whole column first, and a span of 2 × 10³⁰⁸ is past the doubles.)
    const strokes = lines(drawDirect(pointAndFigureSeries({ boxSize: 1e300 }), wide, [wide[0].high - 4.5e300, wide[0].high + 0.5e300]));
    expect(strokes.length).toBeGreaterThanOrEqual(5 * 2);
    expect(strokes.length).toBeLessThanOrEqual(7 * 2);
    expect(strokes.every((s) => s.points.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)))).toBe(true);
    // The largest box the doubles hold: the half box past its end is not a number, and the end stands in for it —
    // as a glyph, and as a bar when the columns are squeezed to two pixels each (400 across the stage).
    const max = Number.MAX_VALUE;
    const tall = [column(0, "up", max, max, max), column(1, "down", max, max, max)];
    // Drawn over 0..MAX at two columns across (a 400 px slot): the box's price is 300 px above the pane's floor
    // and its upper edge is open, so its cell is twice that distance, capped by the slot — an X 280 px tall.
    // …and through a real plot, whose fit pads the extent: the padding stops at the doubles' edge, on either axis.
    for (const log of [false, true]) {
      for (const data of [[column(0, "up", max, max, max)], [column(0, "up", 0, max, max)]]) {
        const real = model();
        if (log) real.plot.mainPane.setYScale(new LogScale());
        expect(() => real.plot.mainPane.addSeries({ series: pointAndFigureSeries({ boxSize: max }), data })).not.toThrow();
        real.plot.render();
        expect(JSON.stringify(real.commands().filter((c) => c.type === "drawLine" || c.type === "drawShape"))).not.toMatch(/null|Infinity|NaN/);
      }
    }
    const glyphs = drawDirect(pointAndFigureSeries({ boxSize: max }), tall, [0, max], 2);
    expect(glyphs.map((c) => c.type)).toEqual(["drawLine", "drawLine", "drawLine"]);
    const [xStroke] = lines(glyphs);
    expect(Math.abs(xStroke.points[1].y - xStroke.points[0].y)).toBeCloseTo(400 * 0.7);
    const bars = drawDirect(pointAndFigureSeries({ boxSize: max }), tall, [max / 2, max], 400);
    expect(bars.map((c) => c.type)).toEqual(["drawShape", "drawShape"]);
    expect(JSON.stringify([glyphs, bars])).not.toMatch(/null|Infinity|NaN/);
  });

  it("draws an X as two strokes and an O as one closed ring, one glyph per box, in the tone's colour at the stroke width", () => {
    const m = model();
    m.plot.mainPane.addSeries({
      series: pointAndFigureSeries({ boxSize: 1, style: { up: "#0f0", down: "#f00", width: 2 } }),
      data: [column(0, "up", 101, 103), column(1, "down", 100, 102)],
    });
    m.plot.render();
    const strokes = lines(m.commands());
    expect(rects(m.commands())).toEqual([]);
    const xs = strokes.filter((s) => s.style.color === "#0f0");
    const os = strokes.filter((s) => s.style.color === "#f00");
    expect(xs).toHaveLength(3 * 2);
    expect(os).toHaveLength(3);
    for (const stroke of strokes) expect(stroke.style.width).toBe(2);
    for (const stroke of xs) expect(stroke.points).toHaveLength(2);
    for (const ring of os) {
      expect(ring.points).toHaveLength(13);
      // Closed exactly — the last point is the first, not a recomputation of it.
      expect(ring.points[12]).toBe(ring.points[0]);
    }
    // The three X's sit at three distinct heights, one box apart.
    const centres = [...new Set(xs.map((s) => (s.points[0].y + s.points[1].y) / 2))].sort((a, b) => a - b);
    expect(centres).toHaveLength(3);
    expect(centres[1] - centres[0]).toBeCloseTo(centres[2] - centres[1]);
    // An X's two strokes cross: the diagonals share their centre and run opposite ways.
    const [a, b] = xs;
    expect((a.points[0].y + a.points[1].y) / 2).toBeCloseTo((b.points[0].y + b.points[1].y) / 2);
    expect(Math.sign(a.points[1].y - a.points[0].y)).toBe(-Math.sign(b.points[1].y - b.points[0].y));
  });

  it("below the pixel floor a column is one bar, not a smudge of glyphs", () => {
    const m = model(800, 600);
    // 400 boxes in 600 px: a cell is about 1.5 px high.
    m.plot.mainPane.addSeries({
      series: pointAndFigureSeries({ boxSize: 1, style: { up: "#0f0", down: "#f00" } }),
      data: [column(0, "up", 1, 400), column(1, "down", 0, 399)],
    });
    m.plot.render();
    expect(lines(m.commands())).toEqual([]);
    const bars = rects(m.commands());
    expect(bars.map((r) => r.fill)).toEqual(["#0f0", "#f00"]);
    expect(bars[1].height).toBeCloseTo(bars[0].height);
    expect(bars[0].height).toBeGreaterThan(400);
    // The O column tops out one box lower (399 against 400), so its bar starts one box height further down.
    expect(bars[1].y - bars[0].y).toBeCloseTo(bars[0].height / 400);
    expect(bars[0].width).toBeGreaterThanOrEqual(1);
    // The bar lies inside the pane, starting near its top — not hanging off the column's lower edge.
    expect(bars[0].y).toBeGreaterThanOrEqual(0);
    expect(bars[0].y).toBeLessThan(120);
    expect(bars[0].y + bars[0].height).toBeLessThanOrEqual(600);
  });

  it("zoomed into a window of a tall column, only the boxes in the pane are drawn", () => {
    const m = model(800, 600);
    m.plot.mainPane.addSeries({ series: pointAndFigureSeries({ boxSize: 1 }), data: [column(0, "up", 0, 9_999), column(1, "down", 0, 9_999)] });
    m.plot.mainPane.setValueDomain(100, 110);
    m.plot.render();
    const strokes = lines(m.commands());
    // The cells meeting the window 100..110 are the boxes 100 through 110 — eleven X's (two strokes) and eleven O's,
    // the two at the edges only partly in the pane.
    expect(strokes.length).toBe(11 * 2 + 11);
    // A column entirely above the window draws nothing.
    const far = model(800, 600);
    far.plot.mainPane.addSeries({ series: pointAndFigureSeries({ boxSize: 1 }), data: [column(0, "up", 500, 9_999)] });
    far.plot.mainPane.setValueDomain(100, 110);
    far.plot.render();
    expect(lines(far.commands())).toEqual([]);
  });

  it("on a log axis a column's boxes shrink upwards: glyphs where a cell is legible, one bar for the run below the floor", () => {
    const m = model(800, 600);
    const pane = m.plot.mainPane;
    // Counts the axis's work: a run below the floor must not measure every box it swallows.
    let scaled = 0;
    class CountingLog extends LogScale {
      override scale(value: number): number {
        scaled += 1;
        return super.scale(value);
      }
    }
    pane.setYScale(new CountingLog());
    // 5,000 boxes of 1 from 1 to 5,000: the lowest cells are tens of px on a log axis, the highest a fraction of one.
    pane.addSeries({ series: pointAndFigureSeries({ boxSize: 1, style: { up: "#0f0" } }), data: [column(0, "up", 1, 5_000)] });
    m.plot.render();
    expect(scaled).toBeLessThan(1_000);
    const strokes = lines(m.commands());
    const bars = rects(m.commands());
    expect(strokes.length).toBeGreaterThan(2);
    expect(strokes.length % 2).toBe(0);
    // Every glyph owns at least 4 px of the pane's height, so the pane bounds the count.
    expect(strokes.length / 2).toBeLessThanOrEqual(600 / 4);
    expect(bars).toHaveLength(1);
    expect(bars[0].fill).toBe("#0f0");
    // The bar sits above every glyph (screen y grows downward) and the glyphs shrink upwards.
    const glyphBottom = Math.min(...strokes.map((s) => Math.min(s.points[0].y, s.points[1].y)));
    expect(bars[0].y + bars[0].height).toBeLessThanOrEqual(glyphBottom + 1e-6);
    const sizes = strokes.filter((_, i) => i % 2 === 0).map((s) => Math.abs(s.points[1].y - s.points[0].y));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1] + 1e-9);
  });

  it("on a log axis a column crossing zero keeps its legible boxes, every stroke inside the pane, in both orientations", () => {
    // Log axis 0.1..5000 over 600 px; the column runs from −100 to 5000. A log axis folds every price at or below zero
    // onto one off-axis spot: the box holding zero is a cell of nothing — it neither turns the column into a bar nor
    // becomes a glyph reaching into the pane.
    for (const y of [new LogScale(0.1, 5_000, 600, 0), new LogScale(0.1, 5_000, 0, 600)]) {
      const drawn = drawDirect(pointAndFigureSeries({ boxSize: 1 }), [column(0, "up", -100, 5_000)], [0.1, 5_000], 1, y);
      const strokes = lines(drawn);
      expect(strokes.length).toBeGreaterThanOrEqual(10 * 2);
      expect(strokes.length).toBeLessThanOrEqual((600 / 4) * 2);
      for (const stroke of strokes) for (const pt of stroke.points) expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
      for (const stroke of strokes) for (const pt of stroke.points) expect(pt.y).toBeLessThanOrEqual(600 + 1e-6);
      const bars = rects(drawn);
      expect(bars.length).toBeGreaterThanOrEqual(1);
      expect(bars.length).toBeLessThanOrEqual(2);
      // The glyph nearest the bottom edge sits above the pane's floor by a whole glyph — the box at zero drew nothing.
      const lowest = Math.max(...strokes.flatMap((stroke) => stroke.points.map((pt) => pt.y)));
      expect(lowest).toBeLessThanOrEqual(600);
    }
    // The pane's bottom inside the zero box (0.4 of a box): the box reaches in, but its price is not placed — a bar only.
    const tight = drawDirect(pointAndFigureSeries({ boxSize: 1 }), [column(0, "up", -2, 1)], [0.4, 1.2], 1, new LogScale(0.4, 1.2, 600, 0));
    for (const stroke of lines(tight)) for (const pt of stroke.points) expect(Math.abs(pt.y - 300)).toBeLessThan(600);
    expect(lines(tight).length).toBe(2); // the one box at level 1, an X
  });

  it("a column of cells the axis places at no height at all is one bar, and the axis is not asked about every box", () => {
    // The smallest box on the widest linear axis: 2⁴⁷ − 1 boxes whose edges all land on the same pixel.
    let scaled = 0;
    class Counting extends LinearScale {
      override scale(value: number): number {
        scaled += 1;
        return super.scale(value);
      }
    }
    const box = 2 ** -1022;
    const tall: PointAndFigureColumn = { x: 0, open: box, close: (2 ** 47 - 1) * box, high: (2 ** 47 - 1) * box, low: box, closedAt: 0, tone: "up", boxes: 2 ** 47 - 1 };
    expect(() => pointAndFigureSeries({ boxSize: box }).coordinates?.assertFinite?.(tall, 0)).not.toThrow();
    // Drawn with a million boxes (the same cells of nothing): a run that measured every box would ask a million
    // times; finding the window by halving asks about twenty times per edge, and the stretch spans no pixels.
    const million: PointAndFigureColumn = { ...tall, close: 1_000_000 * box, high: 1_000_000 * box, boxes: 1_000_000 };
    const drawn = drawDirect(pointAndFigureSeries({ boxSize: box }), [million], [0, Number.MAX_VALUE], 1, new Counting(0, Number.MAX_VALUE, 600, 0));
    expect(drawn.map((c) => c.type)).toEqual(["drawShape"]);
    expect(scaled).toBeLessThan(64);
    // Columns too narrow for any glyph (2 px slots) are bars without a look at their boxes — two edges each.
    scaled = 0;
    const narrow = drawDirect(pointAndFigureSeries({ boxSize: 1 }), [column(0, "up", 0, 199), column(1, "down", 0, 199)], [-0.5, 199.5], 400, new Counting(-0.5, 199.5, 600, 0));
    expect(narrow.map((c) => c.type)).toEqual(["drawShape", "drawShape"]);
    expect(scaled).toBe(4);
    // A narrow column wholly outside the window draws nothing — not a one-pixel sliver at the pane's edge.
    const outside = drawDirect(pointAndFigureSeries({ boxSize: 1 }), [column(0, "up", 500, 600), column(1, "down", 500, 600)], [0, 100], 400);
    expect(outside).toEqual([]);
    // Prices far outside a small manual window scale to pixels past the doubles: the bars are the part inside the
    // pane, finite, still two calls per column — and a wide column's glyphs near zero are finite too.
    const far = 1e293;
    const span = column(0, "up", -1e14 * far, 1e14 * far, far);
    scaled = 0;
    const clipped = drawDirect(pointAndFigureSeries({ boxSize: far }), [span, { ...column(1, "down", -1e14 * far, 1e14 * far, far) }], [-1, 1], 400, new Counting(-1, 1, 600, 0));
    expect(clipped.map((c) => c.type)).toEqual(["drawShape", "drawShape"]);
    expect(scaled).toBe(4);
    for (const bar of rects(clipped)) {
      expect(bar.y).toBeGreaterThanOrEqual(-1);
      expect(bar.y + bar.height).toBeLessThanOrEqual(601);
      expect(bar.height).toBeGreaterThanOrEqual(600);
    }
    const wideOpen = drawDirect(pointAndFigureSeries({ boxSize: far }), [span], [-1, 1]);
    expect(wideOpen.length).toBeGreaterThan(0);
    expect(JSON.stringify(wideOpen)).not.toMatch(/null|Infinity|NaN/);
    // A column of more boxes than a 32-bit index holds is still found and halved — in safe integers.
    scaled = 0;
    const huge: PointAndFigureColumn = { ...tall, close: (2 ** 33 + 1) * box, high: (2 ** 33 + 1) * box, boxes: 2 ** 33 + 1 };
    const drawnHuge = drawDirect(pointAndFigureSeries({ boxSize: box }), [huge], [0, Number.MAX_VALUE], 1, new Counting(0, Number.MAX_VALUE, 600, 0));
    expect(drawnHuge.map((c) => c.type)).toEqual(["drawShape"]);
    expect(scaled).toBeLessThan(100);
  });

  it("on a log axis fitted automatically, a column crossing zero stands on its lowest box above zero", () => {
    for (const [low, invert] of [[-100, false], [-100, true], [0, false]] as const) {
      const m = model();
      const pane = m.plot.mainPane;
      pane.setYScale(new LogScale());
      if (invert) pane.applyOptions({ invert: true });
      pane.addSeries({ series: pointAndFigureSeries({ boxSize: 1 }), data: [column(0, "up", low, 5_000)] });
      m.plot.render();
      const [min] = pane.yScale.getDomain();
      expect(min).toBeGreaterThan(0);
      expect(min).toBeLessThanOrEqual(1);
      // Level 1 is inside the pane: every stroke lies within it, either way up.
      const strokes = lines(m.commands());
      expect(strokes.length).toBeGreaterThan(0);
      for (const stroke of strokes) for (const pt of stroke.points) expect(pt.y).toBeGreaterThanOrEqual(0);
      for (const stroke of strokes) for (const pt of stroke.points) expect(pt.y).toBeLessThanOrEqual(600);
    }
    // The accessor's answer itself: a column above zero stands on its low, one below zero entirely has no floor.
    const door = pointAndFigureSeries({ boxSize: 1 }).coordinates;
    expect(door?.getPositiveFloor?.(column(0, "up", 3, 5))).toBe(3);
    expect(door?.getPositiveFloor?.(column(0, "up", -100, 5_000))).toBe(1);
    expect(door?.getPositiveFloor?.(column(0, "down", -5, 0))).toBeNull();
    expect(door?.getPositiveFloor?.(column(0, "down", -5, -1))).toBeNull();
  });

  it("on an inverted pane the floor bar still spans the column", () => {
    const m = model(800, 600);
    const pane = m.plot.mainPane;
    pane.applyOptions({ invert: true });
    pane.addSeries({ series: pointAndFigureSeries({ boxSize: 1 }), data: [column(0, "up", 1, 400), column(1, "down", 0, 399)] });
    m.plot.render();
    const bars = rects(m.commands());
    expect(bars).toHaveLength(2);
    expect(bars[0].height).toBeGreaterThan(400);
    expect(bars[1].height).toBeCloseTo(bars[0].height);
    // Inverted: the O column's lower top (399) now ends one box height further *up*, and both bars stay inside the pane.
    expect(bars[0].y - bars[1].y).toBeCloseTo(bars[0].height / 400);
    for (const bar of bars) {
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.height).toBeLessThanOrEqual(600);
    }
    expect(bars[1].y).toBeLessThan(120);
  });

  it("claims the y axis half a box beyond the lowest and highest box; nothing to measure is null; the double range is the limit", () => {
    expect(pointAndFigureSeries({ boxSize: 1 }).valueExtent([])).toBeNull();
    const max = Number.MAX_VALUE;
    expect(pointAndFigureSeries({ boxSize: max }).valueExtent([column(0, "up", max, max, max)])).toEqual({ min: max / 2, max });
    expect(pointAndFigureSeries({ boxSize: 1 }).valueExtent([column(0, "up", 101, 103), column(1, "down", 100, 102)])).toEqual({ min: 99.5, max: 103.5 });
    expect(pointAndFigureSeries({ boxSize: 0.5 }).valueExtent([column(0, "up", 101, 103, 0.5)])).toEqual({ min: 100.75, max: 103.25 });
    expect(pointAndFigureSeries({ boxSize: 1 }).valueExtent([column(0, "up", 101, 101)])).toEqual({ min: 100.5, max: 101.5 });
  });

  it("a tape goes through derive and comes out as glyphs; probe answers in ordinal x with the column's close and low..high", () => {
    const tick = (x: number, close: number): OHLC => ({ x, open: close, high: close + 0.2, low: close - 0.2, close });
    const tape = [tick(1_000, 100), tick(1_060, 101), tick(1_120, 104), tick(1_180, 101), tick(1_240, 99), tick(1_300, 102)];
    const m = model();
    const handle = m.plot.mainPane.addSeries({
      series: pointAndFigureSeries({ boxSize: 1 }),
      data: tape,
      derive: (source) => pointAndFigure(source, { boxSize: 1, reversal: 2 }),
    });
    m.plot.render();
    const columns = handle.read();
    expect(columns.map((c) => [c.tone, c.low, c.high])).toEqual([
      ["up", 101, 104],
      ["down", 99, 103],
      ["up", 100, 102],
    ]);
    expect(lines(m.commands())).toHaveLength(4 * 2 + 5 + 3 * 2);
    for (const x of [0, 1, 2]) {
      const [sample] = m.plot.mainPane.probe(x);
      expect(sample.x).toBe(x);
      const c = columns[sample.index];
      expect(c.x).toBe(x);
      expect(sample.value).toBe(c.close);
      expect([sample.min, sample.max]).toEqual([c.low, c.high]);
    }
    // A fractional box priced from far levels still passes the door — the span is judged by rounding.
    const fine = model();
    expect(() =>
      fine.plot.mainPane.addSeries({
        series: pointAndFigureSeries({ boxSize: 0.1 }),
        data: [tick(0, 2 ** 40), tick(1, 2 ** 40 + 819.5), tick(2, 2 ** 40)],
        derive: (source) => pointAndFigure(source, { boxSize: 0.1 }),
      }),
    ).not.toThrow();
  });

  it("declares the candle's accessor and its own aggregation at one column per pixel", () => {
    const series = pointAndFigureSeries({ boxSize: 1 });
    expect(series.coordinates).toBeInstanceOf(OHLCAccessor);
    expect(series.decimation?.strategy).toBeInstanceOf(PnfAggregation);
    expect(series.decimation?.pointsPerPixel).toBe(1);
  });

  it("the aggregation merges a bucket into one column spanning its boxes — first x, last tone and closedAt, open and close at the tone's ends, boxes the span — and passes an unfilled budget through", () => {
    const data = [column(0, "up", 101, 103), column(1, "down", 99, 102), column(2, "up", 100, 105), column(3, "down", 97, 104)];
    const strategy = new PnfAggregation(1);
    expect(strategy.decimate(data, { start: 0, end: 4 }, 4)).toBe(data);
    expect(strategy.decimate(data, { start: 1, end: 3 }, 4)).toEqual(data.slice(1, 3));
    const merged = strategy.decimate(data, { start: 0, end: 4 }, 2);
    expect(merged).toEqual([
      { x: 0, open: 103, close: 99, high: 103, low: 99, closedAt: 10, tone: "down", boxes: 5 },
      { x: 2, open: 105, close: 97, high: 105, low: 97, closedAt: 30, tone: "down", boxes: 9 },
    ]);
    // A merged column passes the door a column passes.
    const door = pointAndFigureSeries({ boxSize: 1 }).coordinates;
    for (const [index, column] of merged.entries()) expect(() => door?.assertFinite?.(column, index)).not.toThrow();
    // A fractional budget: 4 columns into 3 buckets is 1 + 1 + 2, not 2 + 2 with one bucket empty.
    expect(strategy.decimate(data, { start: 0, end: 4 }, 3).map((c) => c.x)).toEqual([0, 1, 2]);
  });

  it("a merged column that reaches the glyph path draws its span, not the boxes it swallowed", () => {
    // Eight overlapping three-box columns under a budget of two: two merged columns, 99..103 and 100..105.
    const data = [
      column(0, "up", 101, 103), column(1, "down", 99, 102), column(2, "up", 100, 103), column(3, "down", 99, 102),
      column(4, "up", 101, 103), column(5, "down", 100, 105), column(6, "up", 101, 103), column(7, "down", 100, 104),
    ];
    const m = model(800, 600, 2);
    m.plot.mainPane.addSeries({ series: pointAndFigureSeries({ boxSize: 1, style: { up: "#0f0", down: "#f00" } }), data });
    m.plot.render();
    const strokes = lines(m.commands());
    // Both merged columns end on a down column: O rings, 5 + 6 of them.
    expect(strokes.map((s) => s.style.color)).toEqual(Array(11).fill("#f00"));
    expect(strokes.every((s) => s.points.length === 13)).toBe(true);
  });

  it("assumes only that the axis is monotone: a legible stretch between two illegible ones is drawn, a flat stretch is a bar", () => {
    // A monotone axis whose spacing is not one-way: the middle tenth of the domain takes four fifths of the pane.
    class Bulge extends LinearScale {
      override scale(value: number): number {
        const [d0, d1] = this.getDomain();
        const [r0, r1] = this.getRange();
        const t = (value - d0) / (d1 - d0);
        const eased = t < 0.45 ? t * (0.1 / 0.45) : t < 0.55 ? 0.1 + (t - 0.45) * (0.8 / 0.1) : 0.9 + (t - 0.55) * (0.1 / 0.45);
        return r0 + eased * (r1 - r0);
      }
    }
    const bulged = drawDirect(pointAndFigureSeries({ boxSize: 1 }), [column(0, "up", 0, 99)], [-0.5, 99.5], 1, new Bulge(-0.5, 99.5, 600, 0));
    const xs = lines(bulged);
    // Ten boxes of 48 px in the middle, ninety of about 1.3 px at the ends: ten X's between two bars.
    expect(xs.length).toBe(10 * 2);
    expect(rects(bulged)).toHaveLength(2);
    for (const stroke of xs) for (const pt of stroke.points) expect(Math.abs(pt.y - 300)).toBeLessThan(300);

    // A monotone axis that is flat below 50 — every price under it lands on one pixel, as a log axis folds
    // prices at or below zero: the boxes there, and the one whose lower edge is in the flat, are a bar.
    class Flat extends LinearScale {
      override scale(value: number): number {
        return super.scale(Math.max(value, 50));
      }
    }
    const flat = drawDirect(pointAndFigureSeries({ boxSize: 1 }), [column(0, "up", 0, 99)], [-0.5, 99.5], 1, new Flat(-0.5, 99.5, 600, 0));
    const glyphs = lines(flat);
    expect(glyphs.length).toBeGreaterThan(0);
    const floorY = new Flat(-0.5, 99.5, 600, 0).scale(50);
    for (const stroke of glyphs) for (const pt of stroke.points) expect(pt.y).toBeLessThanOrEqual(floorY + 1e-9);
    expect(rects(flat)).toHaveLength(1);

    // A signed domain of 10⁵³ on a box near 10³⁹: the column at the pane's top edge is found in pixel space, no tolerance.
    const box = 7.603099179531055e38;
    const level = Math.round(1.0291271891216979e53 / box);
    const top = column(0, "up", (level - 999) * box, level * box, box);
    const wide = drawDirect(pointAndFigureSeries({ boxSize: box }), [top], [-1.0681467164161323e53, 1.0291271891216979e53]);
    expect(wide.length).toBeGreaterThan(0);
    expect(JSON.stringify(wide)).not.toMatch(/null|Infinity|NaN/);
  });

  it("reads the candle's colours and its own width", () => {
    expect(POINT_AND_FIGURE_STYLE_SPEC).toEqual({
      up: { css: "--chart-candle-up", fallback: "#16a34a" },
      down: { css: "--chart-candle-down", fallback: "#dc2626" },
      width: { css: "--chart-pnf-width", fallback: 1 },
    });
  });
});
