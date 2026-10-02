import { describe, expect, it } from "vitest";
import type { DataView, LineDataPoint } from "../../data";
import { DEFAULT_LINE_STYLE, lineSeries } from "../../series";
import { createPlotModel } from "../model";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 1, y: 110 },
  { x: 2, y: 105 },
];

function mounted() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const handle = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data,
  });
  // Three points follow their feed until they fill the screen; an explicit
  // fit settles the window these tests watch.
  model.plot.fitDomains();
  return { model, handle };
}

const dataLine = (model: ReturnType<typeof mounted>["model"]) => {
  const line = model
    .commands()
    .find(
      (c) => c.type === "drawLine" && c.style.width === DEFAULT_LINE_STYLE.line.width,
    );
  if (!line || line.type !== "drawLine") throw new Error("no data line found");
  return line;
};

describe("updateLast", () => {
  it("should swap the closing bar without touching the domain", () => {
    const { model, handle } = mounted();
    model.plot.pan(0.5); // A window the user has already moved.
    const viewing = model.plot.getVisibleRange();
    const pointsBefore = dataLine(model).points.length;

    handle.updateLast({ x: 2, y: 140 });

    expect(dataLine(model).points).toHaveLength(pointsBefore);
    expect(handle.read().at(-1)).toEqual({ x: 2, y: 140 });
    // Domain unchanged — a tick must not drag the visible window along with it.
    expect(model.plot.getVisibleRange()).toEqual(viewing);
  });

  it("should open a new bar when x advances", () => {
    const { model, handle } = mounted();
    const viewing = model.plot.getVisibleRange();

    handle.updateLast({ x: 3, y: 120 });

    expect(handle.read()).toHaveLength(data.length + 1);
    expect(handle.xRange).toEqual({ min: 0, max: 3 });
    // The new bar is still off-screen — leaving the domain unchanged is the
    // default, and following it is an opt-in choice made by
    // shiftVisibleRangeOnNewBar (commit 3).
    expect(model.plot.getVisibleRange()).toEqual(viewing);
  });

  it("should refuse to rewrite the past", () => {
    const { handle } = mounted();

    expect(() => handle.updateLast({ x: 1, y: 999 })).toThrow(/setData/);
  });

  it("should re-derive a derived registration on every tick", () => {
    const { model } = mounted();
    let derived = 0;
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data,
      derive: (source: DataView<LineDataPoint>) => {
        derived++;
        return source.map((point) => ({ x: point.x, y: (point.y ?? 0) * 2 }));
      },
    });
    const runsBefore = derived;

    handle.updateLast({ x: 2, y: 200 });

    // A derivation's contract is "the whole input" — it reruns once per tick.
    expect(derived).toBe(runsBefore + 1);
    expect(handle.read().at(-1)).toEqual({ x: 2, y: 400 });
  });

  it("should be visible to computation nodes — the array identity changes", () => {
    const { handle } = mounted();
    const before = handle.read();

    handle.updateLast({ x: 2, y: 140 });

    // Source's contract: a change means a different reference — a computation node uses this to know when to recompute.
    expect(handle.read()).not.toBe(before);
  });
});

describe("incremental append/prepend", () => {
  it("should keep the viewing window when history is prepended", () => {
    const { model, handle } = mounted();
    const viewing = model.plot.getVisibleRange();

    handle.prepend([
      { x: -2, y: 90 },
      { x: -1, y: 95 },
    ]);

    expect(model.plot.getVisibleRange()).toEqual(viewing);
    expect(handle.xRange).toEqual({ min: -2, max: 2 });
  });

  it("should still refuse a chunk that breaks order at the seam", () => {
    const { handle } = mounted();

    // The check narrowed to the seam, but it didn't go away — same DataError.
    expect(() => handle.append([{ x: 1, y: 1 }])).toThrow(/continue after/);
    expect(() => handle.prepend([{ x: 5, y: 1 }])).toThrow(/end before/);
  });
});

describe("shiftVisibleRangeOnNewBar", () => {
  function streaming(shift: boolean) {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: {
        showGrid: false,
        shiftVisibleRangeOnNewBar: shift,
        axis: { x: { showLabels: false }, y: { showLabels: false } },
      },
    });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data,
    });
    model.plot.fitDomains();
    return { model, handle };
  }

  it("should follow a new bar while the last bar is on screen", () => {
    const { model, handle } = streaming(true);
    const before = model.plot.getVisibleRange()!;

    handle.updateLast({ x: 3, y: 120 });

    const after = model.plot.getVisibleRange()!;
    // The window shifted right by one bar — the width is unchanged.
    expect(after.max - after.min).toBeCloseTo(before.max - before.min, 8);
    expect(after.max).toBeCloseTo(before.max + 1, 8);
  });

  it("should stay put while scrolling the past", () => {
    const { model, handle } = streaming(true);
    // Moved into the past — the last bar is off-screen.
    model.plot.pan(-1.5);
    const viewing = model.plot.getVisibleRange();

    handle.append([{ x: 3, y: 120 }]);

    expect(model.plot.getVisibleRange()).toEqual(viewing);
  });

  it("should never move when the option is off", () => {
    const { model, handle } = streaming(false);
    const viewing = model.plot.getVisibleRange();

    handle.append([{ x: 3, y: 120 }]);

    expect(model.plot.getVisibleRange()).toEqual(viewing);
  });

  it("should not move on a same-bar tick", () => {
    const { model, handle } = streaming(true);
    const viewing = model.plot.getVisibleRange();

    handle.updateLast({ x: 2, y: 300 });

    expect(model.plot.getVisibleRange()).toEqual(viewing);
  });
});
