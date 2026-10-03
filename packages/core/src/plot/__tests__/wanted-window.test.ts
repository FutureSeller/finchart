/**
 * A window asked for in data x that reaches past the data held — a jump to a
 * date not loaded yet — is placed by guessing (the bar index has no slot for
 * an x it doesn't hold). When the history arrives the window goes to the x
 * that was asked for, not to wherever the guess left it — until the user
 * moves the view, or the window lands inside the data.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { createPlotModel } from "../model";
import { barIndexX } from "../../scale";
import { lineSeries } from "../../series";

/** x from..to step `every`. */
const points = (from: number, to: number, every = 1): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  for (let x = from; x <= to; x += every) out.push({ x, y: 1 });
  return out;
};

function stage() {
  const model = createPlotModel({ size: { width: 800, height: 600 }, deps: { createXMapping: barIndexX } });
  // Held: one bar per x. The history older than it has one bar every 2 x —
  // a guess from the held spacing lands somewhere else.
  const handle = model.plot.mainPane.addSeries({ series: lineSeries(), data: points(100, 119) });
  return { plot: model.plot, handle };
}

describe("a window asked for past the data", () => {
  it("goes to the x asked for once the history arrives", () => {
    const { plot, handle } = stage();

    plot.setVisibleRange(50, 60);
    handle.prepend(points(20, 98, 2));

    expect(plot.getVisibleRange()).toEqual({ min: 50, max: 60 });
  });

  it("is let go once the user moves the view — the guess is theirs now", () => {
    const { plot, handle } = stage();
    plot.setVisibleRange(50, 60);
    plot.pan(1);
    const moved = plot.getVisibleRange();

    handle.prepend(points(20, 98, 2));

    // Not pulled back to 50..60.
    expect(plot.getVisibleRange()).not.toEqual({ min: 50, max: 60 });
    expect(moved).not.toBeNull();
  });

  it("stays put on a later prepend once it sits inside the data", () => {
    const { plot, handle } = stage();
    plot.setVisibleRange(105, 110);
    handle.prepend(points(20, 98, 2));

    expect(plot.getVisibleRange()).toEqual({ min: 105, max: 110 });
  });
});

describe("a window that only shows the first bar whole", () => {
  it("is not kept as a guess — a new bar still moves a window that sits at the end", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      deps: { createXMapping: barIndexX },
      config: { shiftVisibleRangeOnNewBar: true },
    });
    const handle = model.plot.mainPane.addSeries({ series: lineSeries(), data: points(100, 119) });
    // The half-bar margin a fit leaves before the first point.
    model.plot.setVisibleRange(99.5, 119.5);

    handle.append([{ x: 120, y: 1 }]);

    expect(model.plot.getVisibleRange()?.max).toBeGreaterThan(119.5);
  });
});

describe("a window asked for past the data, while bars keep arriving", () => {
  it("is still corrected when history lands after a live bar — the new bar doesn't overtake a window in the past", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      deps: { createXMapping: barIndexX },
      config: { shiftVisibleRangeOnNewBar: true },
    });
    const handle = model.plot.mainPane.addSeries({ series: lineSeries(), data: points(100, 119) });
    model.plot.setVisibleRange(50, 60);

    handle.append([{ x: 120, y: 1 }]);
    handle.prepend(points(20, 98, 2));

    expect(model.plot.getVisibleRange()).toEqual({ min: 50, max: 60 });
  });
});
