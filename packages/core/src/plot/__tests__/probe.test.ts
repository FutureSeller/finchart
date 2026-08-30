import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel } from "../model";

const line: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

function mounted() {
  const model = createPlotModel({ size: { width: 800, height: 600 } });
  return model.plot.mainPane;
}

describe("Pane.probe", () => {
  it("should answer with the nearest drawn point per registration", () => {
    const pane = mounted();
    pane.addSeries({ series: lineSeries(), data: line, name: "BTC" });

    const [sample] = pane.probe(6.2);

    expect(sample.name).toBe("BTC");
    // The x of the actual plotted point, not the x that was queried.
    expect(sample.x).toBe(5);
    expect(sample.value).toBe(120);
  });

  it("should read a candle's value through its accessor — close", () => {
    const pane = mounted();
    const candles: OHLC[] = [
      { x: 0, open: 100, high: 110, low: 95, close: 105 },
      { x: 1, open: 105, high: 112, low: 101, close: 102 },
    ];
    pane.addSeries({ series: candleSeries(), data: candles, name: "price" });

    const [sample] = pane.probe(0.9);

    expect(sample.x).toBe(1);
    expect(sample.value).toBe(102);
  });

  it("should sample the derived points, not the source", () => {
    const pane = mounted();
    pane.addSeries({
      series: lineSeries(),
      data: line,
      name: "doubled",
      derive: (source: LineDataPoint[]) =>
        source.map((point) => ({ x: point.x, y: (point.y ?? 0) * 2 })),
    });

    const [sample] = pane.probe(5);

    expect(sample.value).toBe(240);
  });

  it("should skip empty registrations and keep drawing order", () => {
    const pane = mounted();
    pane.addSeries({ series: lineSeries(), data: line, name: "first" });
    pane.addSeries({ series: lineSeries(), name: "empty" });
    pane.addSeries({
      series: lineSeries(),
      data: line,
      name: "second",
      color: "#f59e0b",
    });

    const samples = pane.probe(5);

    expect(samples.map((sample) => sample.name)).toEqual(["first", "second"]);
    expect(samples[1].color).toBe("#f59e0b");
  });

  it("should report a hole as a null value at its x", () => {
    const pane = mounted();
    pane.addSeries({
      series: lineSeries(),
      data: [
        { x: 0, y: 1 },
        { x: 1, y: null },
      ],
    });

    const [sample] = pane.probe(1);

    expect(sample.x).toBe(1);
    expect(sample.value).toBeNull();
  });
});

describe("AxisOptions.ticks — the strategy owns the label", () => {
  it("should hand tick placement and labels to the strategy", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data: line },
      config: {
        showGrid: false,
        axis: {
          x: {
            ticks: {
              ticks: ({ min, max }) => [
                { value: min, label: "start" },
                { value: (min + max) / 2, label: "middle" },
              ],
            },
            // format is ignored when a strategy is present.
            format: () => "unused",
          },
          y: { showLabels: false },
        },
      },
    });

    const texts = model
      .commands()
      .filter((c) => c.type === "drawText")
      .map((c) => (c.type === "drawText" ? c.params.text : ""));
    expect(texts).toContain("start");
    expect(texts).toContain("middle");
    expect(texts).not.toContain("unused");
  });
});

describe("a point's data value span (getYRange)", () => {
  it("should carry a candle's low and high — the snap candidates", () => {
    const pane = mounted();
    pane.addSeries({
      series: candleSeries(),
      data: [{ x: 0, open: 100, high: 110, low: 95, close: 105 }],
      name: "price",
    });

    const [sample] = pane.probe(0);

    expect(sample.min).toBe(95);
    expect(sample.max).toBe(110);
    expect(sample.value).toBe(105);
  });

  it("should say null for series whose accessor has no range — a line's point is one value", () => {
    const pane = mounted();
    pane.addSeries({ series: lineSeries(), data: line, name: "BTC" });

    const [sample] = pane.probe(5);

    expect(sample.min).toBeNull();
    expect(sample.max).toBeNull();
  });
});

describe("Pane.probe — index", () => {
  it("should say where the chosen point sits so consumers can find the original bar", () => {
    const pane = mounted();
    const candles: OHLC[] = [
      { x: 0, open: 100, high: 110, low: 95, close: 105 },
      { x: 1, open: 105, high: 112, low: 101, close: 102 },
      { x: 2, open: 102, high: 108, low: 100, close: 107 },
    ];
    pane.addSeries({ series: candleSeries(), data: candles, name: "price" });

    // A consumer recovers the original via the index — the core seals off
    // the point type, so it doesn't return an OHLC, but it does give the index.
    const [sample] = pane.probe(1.9);
    expect(sample.index).toBe(2);
    expect(candles[sample.index].open).toBe(102);

    // The index always agrees with sample.x — if the two diverge, the header and tooltip disagree with each other.
    const [middle] = pane.probe(0.9);
    expect(middle.index).toBe(1);
    expect(candles[middle.index].x).toBe(middle.x);
  });

  it("should keep index in range at both ends", () => {
    const pane = mounted();
    pane.addSeries({ series: lineSeries(), data: line });

    expect(pane.probe(-100)[0].index).toBe(0);
    expect(pane.probe(1000)[0].index).toBe(line.length - 1);
  });
});
