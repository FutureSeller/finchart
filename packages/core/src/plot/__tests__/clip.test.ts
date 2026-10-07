/**
 * Drawing never leaks outside its own slot. The bug: when a manual value
 * range was narrower than the data, a line would stretch beyond its pane
 * and cover the pane below — invisible only because the value axis
 * happened to follow the data in the default wiring. Clipping doesn't
 * change coordinates — a command can still carry an off-screen y, it's
 * just not drawn when replayed. Cropping is the job of whoever handed out
 * the slot, not whoever draws.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import type { PlotArea } from "../../primitives";
import type { DrawCommand } from "../../render";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel } from "../model";

const size = { width: 600, height: 400 };

const line = (points: [number, number][]): LineDataPoint[] =>
  points.map(([x, y]) => ({ x, y }));

/** The boundary **in effect at that moment** for each command. Matches what the replay side does. */
function underClip(
  commands: readonly DrawCommand[],
): { command: DrawCommand; clip: PlotArea | null }[] {
  const out: { command: DrawCommand; clip: PlotArea | null }[] = [];
  let clip: PlotArea | null = null;

  for (const command of commands) {
    if (command.type === "clip") {
      clip = command.area;
      continue;
    }
    out.push({ command, clip });
  }

  return out;
}

const clipAreas = (commands: readonly DrawCommand[]): (PlotArea | null)[] =>
  commands
    .filter((c) => c.type === "clip")
    .map((c) => (c as { area: PlotArea | null }).area);

/** Drawing (lines/shapes) that went out with no boundary. Text is excluded — it's an axis label. */
function unbounded(commands: readonly DrawCommand[]): DrawCommand[] {
  return underClip(commands)
    .filter(({ command, clip }) => command.type !== "drawText" && clip === null)
    .map(({ command }) => command);
}

/** How far a command reaches vertically, `[top, bottom]`. Text has none — it's an axis label. */
function verticalExtent(command: DrawCommand): [number, number] | null {
  const span = (ys: number[]): [number, number] => [Math.min(...ys), Math.max(...ys)];
  if (command.type === "drawLine") return span(command.points.map((p) => p.y));
  if (command.type !== "drawShape") return null;
  const shape = command.shape;
  if (shape.shape === "rect") return span([shape.y, shape.y + shape.height]);
  if (shape.shape === "circle") return [shape.cy - shape.r, shape.cy + shape.r];
  return span(shape.points.map((p) => p.y));
}

describe("every mark is drawn within a boundary", () => {
  it("should bound every mark to its own pane when the value domain is narrower than the data", () => {
    const model = createPlotModel({ size });
    const main = model.plot.mainPane;
    const lower = model.plot.addPane();
    main.addSeries({ series: lineSeries(), data: line([[0, 0], [1, 50], [2, 100]]) });
    lower.addSeries({
      series: candleSeries(),
      data: [
        { x: 0, open: 100, high: 101, low: 99, close: 100 },
        { x: 1, open: 100, high: 200, low: 1, close: 100 },
        { x: 2, open: 100, high: 101, low: 99, close: 100 },
      ],
    });
    // Both panes show a window narrower than their data — the line and the
    // middle candle's wick land far outside the whole data area.
    main.setValueDomain(40, 60);
    lower.setValueDomain(99, 101);
    model.plot.render();

    const commands = model.commands();
    expect(unbounded(commands)).toEqual([]);

    // The coordinates are still off-screen. Not drawing them is the
    // boundary's job — and the boundary is the pane's own slice, not the
    // data area that spans both panes.
    const data = clipAreas(commands)[0]!;
    const escaping = underClip(commands).filter(({ command }) => {
      const extent = verticalExtent(command);
      return extent !== null && (extent[0] < data.top || extent[1] > data.bottom);
    });
    const clips = escaping.map(({ clip }) => clip);
    expect(clips).toContainEqual(main.area);
    expect(clips).toContainEqual(lower.area);
    for (const clip of clips) expect([main.area, lower.area]).toContainEqual(clip);
    model.plot.destroy();
  });

  it("should bound the lower pane to its own slice", () => {
    const model = createPlotModel({ size });
    const lower = model.plot.addPane();
    model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: line([[0, 10], [2, 20]]),
    });
    lower.addSeries({ series: lineSeries(), data: line([[0, 0], [1, 500], [2, 0]]) });
    lower.setValueDomain(0, 10);
    model.plot.render();

    expect(unbounded(model.commands())).toEqual([]);

    const areas = clipAreas(model.commands());
    expect(areas).toContainEqual(lower.area);
    expect(areas).toContainEqual(model.plot.mainPane.area);
    // The two slots are actually different — if they matched, this test would guard nothing.
    expect(lower.area.top).toBeGreaterThanOrEqual(model.plot.mainPane.area.bottom);
  });
});

describe("boundary ordering", () => {
  function rendered() {
    const model = createPlotModel({ size });
    const lower = model.plot.addPane();
    model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: line([[0, 1], [1, 2]]),
    });
    lower.addSeries({ series: lineSeries(), data: line([[0, 5], [1, 6]]) });
    model.plot.render();
    return { model, lower, commands: model.commands() };
  }

  it("should release the clip before the axis labels", () => {
    const { commands } = rendered();
    const lastClip = commands.findLastIndex((c) => c.type === "clip");
    const firstLabel = commands.findIndex((c) => c.type === "drawText");

    // Axis labels are drawn on the axis slice — a lingering boundary would clip them off.
    expect((commands[lastClip] as { area: PlotArea | null }).area).toBeNull();
    expect(firstLabel).toBeGreaterThan(lastClip);
  });

  it("should hand plot decorations the whole data area", () => {
    const { model, lower, commands } = rendered();
    const first = clipAreas(commands)[0]!;

    // The data area spans all panes, not just one — a crosshair cuts across them.
    expect(first.top).toBeLessThanOrEqual(model.plot.mainPane.area.top);
    expect(first.bottom).toBeGreaterThanOrEqual(lower.area.bottom);
    expect(first).not.toEqual(model.plot.mainPane.area);
  });
});
