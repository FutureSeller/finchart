/**
 * A slot with no value is a gap — in any series, anywhere in the array.
 * Separate from the contract that `y: null` means whitespace, when an
 * exchange row is missing `close` and `y` arrives as a key that isn't
 * there at all (`undefined`), a hole check that only looked at
 * `y === null` used to let it pass as a non-gap value — the line bridged
 * the hole instead of breaking at it.
 *
 * The data door can't catch this — `assertReadableValue` only looks at
 * `data[0]` and `data[last]` to stay O(1), so a missing value in the
 * middle has to be treated as a gap by the drawing side. Building the
 * input with `JSON.parse` is the point — a literal object can't mimic an
 * untyped entry point (an exchange response, an `any[]`).
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import type { Series } from "../types";
import { createPlotModel } from "../../plot";
import { areaSeries } from "../area-series";
import { baselineSeries } from "../baseline-series";
import { histogramSeries } from "../histogram-series";
import { lineSeries } from "../line-series";

/** Shaped like an exchange response passed straight through — row 3 has no value. */
function feedWithMissingValue(): LineDataPoint[] {
  return JSON.parse(
    '[{"x":0,"y":10},{"x":1,"y":20},{"x":2},{"x":3,"y":15},{"x":4,"y":25}]',
  );
}

/** The same slot with the consumer explicitly nulling it out — the two must mean the same thing. */
function feedWithExplicitNull(): LineDataPoint[] {
  return JSON.parse(
    '[{"x":0,"y":10},{"x":1,"y":20},{"x":2,"y":null},{"x":3,"y":15},{"x":4,"y":25}]',
  );
}

function commandsFor(series: Series<LineDataPoint>, data: LineDataPoint[]) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series, data },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  return model.commands();
}

/** Every coordinate carried by a command — if even one is non-finite, the canvas silently swallows it. */
function coordinatesOf(commands: ReturnType<typeof commandsFor>): number[] {
  const found: number[] = [];
  for (const command of commands) {
    if (command.type === "drawLine") {
      for (const point of command.points) found.push(point.x, point.y);
    }
    if (command.type === "drawShape" && command.shape.shape === "polygon") {
      for (const point of command.shape.points) found.push(point.x, point.y);
    }
    if (command.type === "drawShape" && command.shape.shape === "rect") {
      const { x, y, width, height } = command.shape;
      found.push(x, y, width, height);
    }
  }
  return found;
}

describe("a missing value — a missing key and an explicit null must be equivalent", () => {
  const cases = [
    ["lineSeries", () => lineSeries()],
    ["areaSeries", () => areaSeries()],
    ["baselineSeries", () => baselineSeries({ baseline: 15 })],
    ["histogramSeries", () => histogramSeries()],
  ] as const;

  it.each(cases)("should never emit a non-finite coordinate (%s)", (
    _label,
    make,
  ) => {
    const coordinates = coordinatesOf(
      commandsFor(make(), feedWithMissingValue()),
    );

    expect(coordinates.length).toBeGreaterThan(0);
    expect(coordinates.every(Number.isFinite)).toBe(true);
  });

  it.each(cases)("should treat a missing key like an explicit null (%s)", (
    _label,
    make,
  ) => {
    const missing = commandsFor(make(), feedWithMissingValue());
    const explicit = commandsFor(make(), feedWithExplicitNull());

    expect(missing).toEqual(explicit);
  });

  /**
   * The line must break — bridging it would show a missing value as if
   * it existed. One hole splits five points into two, so there are two
   * `drawLine`s.
   */
  it("should split the line at the hole instead of bridging it", () => {
    const lines = commandsFor(lineSeries(), feedWithMissingValue()).filter(
      (command) => command.type === "drawLine",
    );

    expect(lines).toHaveLength(2);
    expect(lines[0].points).toHaveLength(2);
    expect(lines[1].points).toHaveLength(2);
  });
});

/**
 * A gap doesn't end at drawing — reading and decimation follow the same
 * rule.
 *
 * - Reading: `SeriesSample.value` is declared `number | null`, but if the
 *   accessor lets its raw value through and `undefined` leaks out, a
 *   consumer's formatter that trusts an `=== null` branch throws on the
 *   missing bar.
 * - Decimation: if the default strategy only checks `=== null`, it
 *   swallows a keyless hole — at a scale of 100k bars decimation is
 *   always on, so it fires before drawing does.
 */
describe("a gap is still a gap in the read path and the decimation path", () => {
  it("should report a missing value as null, not undefined", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data: feedWithMissingValue() },
      config: { showGrid: false },
    });

    const samples = model.plot.mainPane.probe(2);
    const value = samples[0]?.value;

    // If it's `undefined`, a consumer's `=== null` branch misses and the
    // formatter throws.
    expect(value).toBeNull();
  });

  it("should decimate a missing key exactly like an explicit null", async () => {
    const { LineDataAccessor, M4Decimation, SimpleDataManager } = await import(
      "../../data"
    );

    /** Ten holes in the middle of 200 points — a scale where decimation
     *  is guaranteed to kick in (200 → 112). */
    const rows = (hole: "missing" | "null") =>
      Array.from({ length: 200 }, (_, x) =>
        x >= 50 && x < 60
          ? hole === "missing"
            ? { x }
            : { x, y: null }
          : { x, y: 100 + (x % 7) },
      );

    const decimated = (hole: "missing" | "null") => {
      const coordinates = new LineDataAccessor();
      const manager = new SimpleDataManager<LineDataPoint>({
        decimation: new M4Decimation(coordinates),
        coordinates,
      });
      manager.setData(JSON.parse(JSON.stringify(rows(hole))));
      return manager
        .getVisibleData({ startX: 0, endX: 200, width: 40, height: 100 })
        .map((point) => ({ x: point.x, gap: point.y === null || point.y === undefined }));
    };

    // The two must produce the same picture — if the check only looks at
    // `=== null`, a keyless hole won't split a run, and the two feeds end
    // up with different point sets.
    expect(decimated("missing")).toEqual(decimated("null"));
  });
});
