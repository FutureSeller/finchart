/**
 * `readout: false` — a registration drawn for the eye (a band fill, a
 * marker row) that readouts such as a tooltip or legend should not list.
 * The sample still comes back from `probe`: snapping and the crosshair
 * magnet read samples, and a helper series is still a thing under the
 * cursor. The flag rides the sample only when it is `false`, so code that
 * builds samples itself keeps compiling.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../../data";
import { ContractError } from "../../primitives";
import { candleSeries, lineSeries } from "../../series";
import { createPlotModel } from "../model";

const line: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
];
const candles: OHLC[] = [
  { x: 0, open: 100, high: 110, low: 95, close: 105 },
  { x: 5, open: 105, high: 112, low: 101, close: 102 },
];

const pane = () => createPlotModel({ size: { width: 800, height: 600 } }).plot.mainPane;

describe("readout: false", () => {
  it("rides the sample from every registration path — plain, derived and input", () => {
    const target = pane();
    target.addSeries({ series: lineSeries(), data: line, readout: false });
    target.addSeries({
      series: lineSeries(),
      data: candles,
      derive: (view) => view.map((bar) => ({ x: bar.x, y: bar.close })),
      readout: false,
    });
    target.addSeries({ series: lineSeries(), input: { read: () => line }, readout: false });

    const samples = target.probe(5);
    expect(samples).toHaveLength(3);
    expect(samples.map((sample) => sample.readout)).toEqual([false, false, false]);
  });

  it("is absent from the sample when the registration doesn't say false", () => {
    const target = pane();
    target.addSeries({ series: lineSeries(), data: line, name: "BTC" });
    target.addSeries({ series: lineSeries(), data: line, readout: true });

    for (const sample of target.probe(5)) expect("readout" in sample).toBe(false);
  });

  it("survives swapSeries — it belongs to the registration, not the series", () => {
    const target = pane();
    const handle = target.addSeries({ series: candleSeries(), data: candles, readout: false });
    handle.swapSeries(lineSeries({ coordinates: { getX: (bar: OHLC) => bar.x, getY: (bar: OHLC) => bar.close } }));
    expect(target.probe(5)[0].readout).toBe(false);
  });

  it("is refused at the door when it isn't a boolean", () => {
    const target = pane();
    // @ts-expect-error — a readout flag is a boolean
    expect(() => target.addSeries({ series: lineSeries(), data: line, readout: "no" })).toThrow(ContractError);
  });
});
