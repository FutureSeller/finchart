import { describe, expect, it } from "vitest";
import type { DataView, LineDataPoint, OHLC } from "../../data";
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
      derive: (source: DataView<LineDataPoint>) =>
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

describe("Pane.probe — rows a series describes for itself", () => {
  const candles: OHLC[] = [
    { x: 0, open: 100, high: 110, low: 95, close: 105, volume: 1200 },
    { x: 1, open: 105, high: 112, low: 101, close: 102 },
  ];

  it("carries O/H/L/C and V for a candle, V only when the bar has a volume", () => {
    const pane = mounted();
    pane.addSeries({ series: candleSeries(), data: candles, name: "price" });
    const [first] = pane.probe(0);
    expect(first.rows).toEqual([
      { label: "O", value: 100 },
      { label: "H", value: 110 },
      { label: "L", value: 95 },
      { label: "C", value: 105 },
      { label: "V", value: 1200 },
    ]);
    const [second] = pane.probe(1);
    expect(second.rows?.map((row) => row.label)).toEqual(["O", "H", "L", "C"]);
  });

  it("carries no rows for a series that does not describe itself", () => {
    const pane = mounted();
    pane.addSeries({ series: lineSeries(), data: line, name: "BTC" });
    const [sample] = pane.probe(5);
    expect(sample.rows).toBeUndefined();
  });

  it("asks the series that is registered now — after swapSeries, the new one", () => {
    const pane = mounted();
    const handle = pane.addSeries({ series: lineSeries(), data: line, name: "BTC" });
    expect(pane.probe(5)[0].rows).toBeUndefined();
    // A spread would drop the prototype's draw — attach the description to a real series.
    handle.swapSeries(
      Object.assign(lineSeries(), {
        describe: (point: LineDataPoint) => [{ label: "y²", value: point.y === null ? null : point.y * point.y }],
      }),
    );
    expect(pane.probe(5)[0].rows).toEqual([{ label: "y²", value: 14400 }]);
  });

  it("describes the output point of a derived registration, not its source", () => {
    const pane = mounted();
    pane.addSeries({
      series: candleSeries(),
      data: line,
      derive: (source: DataView<LineDataPoint>) =>
        source.map((p) => ({ x: p.x, open: p.y ?? 0, high: (p.y ?? 0) + 1, low: (p.y ?? 0) - 1, close: p.y ?? 0 })),
      name: "as candles",
    });
    const [sample] = pane.probe(5);
    expect(sample.rows?.map((row) => `${row.label}${row.value}`)).toEqual(["O120", "H121", "L119", "C120"]);
  });
});

describe("candleSeries().describe", () => {
  it("names the four prices and the volume", () => {
    const series = candleSeries();
    if (!series.describe) throw new Error("a candle describes itself");
    expect(series.describe({ x: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 7 })).toEqual([
      { label: "O", value: 1 },
      { label: "H", value: 2 },
      { label: "L", value: 0.5 },
      { label: "C", value: 1.5 },
      { label: "V", value: 7 },
    ]);
    expect(series.describe({ x: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: null })).toHaveLength(4);
  });
});
