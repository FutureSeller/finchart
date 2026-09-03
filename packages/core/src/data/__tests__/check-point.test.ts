import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../types";
import { candleSeries, histogramSeries, lineSeries } from "../../series";
import { createPlotModel } from "../../plot/model";
import { LineDataAccessor, OHLCAccessor } from "../accessors";
import { checkPoint } from "../validate";

/**
 * The tick path and the whole-array walk read one per-point body.
 * `updateLast` used to carry its own four checks (shape, readable y,
 * finite values, finite x) — a copy that could drift from
 * `scanSeriesData`. Now both call `checkPoint`, and the tick door reports
 * the bar it is actually replacing (the last index), not a made-up 0.
 */

const line: LineDataPoint[] = [
  { x: 1, y: 10 },
  { x: 2, y: 11 },
  { x: 3, y: 12 },
];

function mountedLine() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
  });
  return model.plot.mainPane.addSeries({ series: lineSeries(), data: line });
}

const bars: OHLC[] = [
  { x: 1, open: 1, high: 2, low: 0.5, close: 1.5 },
  { x: 2, open: 1.5, high: 2.5, low: 1, close: 2 },
];

function mountedCandles() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
  });
  return model.plot.mainPane.addSeries({ series: candleSeries(), data: bars });
}

function messageOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("updateLast names its door and the bar it replaces", () => {
  it("a non-object tick is rejected with the door's label and the last index", () => {
    const handle = mountedLine();
    const message = messageOf(() => handle.updateLast(null as never));
    expect(message).toContain("updateLast(point)");
    expect(message).toContain("index 2");
  });

  it("a non-finite x names the door and the last index — not a made-up index 0", () => {
    const handle = mountedLine();
    const message = messageOf(() => handle.updateLast({ x: Number.NaN, y: 1 }));
    expect(message).toContain("updateLast(point)");
    expect(message).toContain("x must be a finite number");
    expect(message).toContain("index 2");
    expect(message).not.toContain("index 0");
  });

  it("a bar with a non-finite field is rejected by the accessor at the last index — naming the door", () => {
    const handle = mountedCandles();
    const message = messageOf(() =>
      handle.updateLast({ x: 2, open: 1, high: 2, low: 1, close: Number.NaN }),
    );
    expect(message).toContain("updateLast(point)");
    expect(message).toContain("close");
    expect(message).toContain("index 1");
  });

  it("a tick that opens a new bar is judged as a tick — the door's label and its own index", () => {
    const handle = mountedCandles();
    const message = messageOf(() =>
      handle.updateLast({ x: 3, open: 1, high: 2, low: 1, close: Number.NaN }),
    );
    expect(message).toContain("updateLast(point)");
    expect(message).toContain("close");
    expect(message).toContain("index 2");
    expect(message).not.toContain("index 0");
  });

  it("a tick without a readable value is guided toward an accessor — and names the door", () => {
    const handle = mountedLine();
    const message = messageOf(() => handle.updateLast({ x: 3, value: 5 } as never));
    expect(message).toContain("updateLast(point)");
    expect(message).toContain("could not read a value");
    expect(message).toContain("index 2");
  });
});

describe("every built-in accessor names the door", () => {
  it("a histogram tick with a NaN value says updateLast(point)", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
    });
    const handle = model.plot.mainPane.addSeries({
      series: histogramSeries(),
      data: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
    });
    const message = messageOf(() => handle.updateLast({ x: 2, y: Number.NaN }));
    expect(message).toContain("updateLast(point)");
    expect(message).toContain("index 1");
  });
});

describe("checkPoint — the shared per-point body", () => {
  it("throw mode returns the finite x and throws on the first violation", () => {
    expect(checkPoint({ x: 7, y: 1 }, 0, new LineDataAccessor(), "data", null, true)).toBe(7);
    expect(() =>
      checkPoint({ x: 7, y: "1" } as never, 3, new LineDataAccessor(), "data", null, true),
    ).toThrow(/index 3/);
  });

  it("collect mode reports shape, then readable y, then finite x, then values — and returns null for a broken shape", () => {
    const seen: string[] = [];
    const report = (issue: { code: string }) => seen.push(issue.code);
    expect(checkPoint(null as never, 0, new LineDataAccessor(), "data", report, true)).toBeNull();
    expect(seen).toEqual(["not-an-object"]);

    seen.length = 0;
    const x = checkPoint({ x: Number.NaN } as never, 0, new LineDataAccessor(), "data", report, true);
    expect(Number.isNaN(x)).toBe(true);
    expect(seen).toEqual(["unreadable-y", "non-finite-x"]);

    seen.length = 0;
    checkPoint(
      { x: 1, open: 1, high: 1, low: 1, close: "1" } as never,
      0,
      new OHLCAccessor(),
      "data",
      report,
      false,
    );
    expect(seen).toEqual(["non-finite-value"]);
  });

  it("only an edge point is checked for a readable y", () => {
    const seen: string[] = [];
    const report = (issue: { code: string }) => seen.push(issue.code);
    checkPoint({ x: 1 } as never, 5, new LineDataAccessor(), "data", report, false);
    expect(seen).toEqual([]);
  });
});
