import { describe, expect, it } from "vitest";
import type { CoordinateAccessor, LineDataPoint, OHLC } from "../../data";
import { OHLCAccessor } from "../../data";
import { createPlotModel } from "../../plot";
import { ContractError } from "../../primitives";
import { areaSeries } from "../area-series";
import { lineSeries } from "../line-series";

const candles: OHLC[] = [
  { x: 0, open: 10, high: 30, low: 5, close: 20 },
  { x: 1, open: 20, high: 40, low: 15, close: 35 },
  { x: 2, open: 35, high: 45, low: 25, close: 30 },
];

/** The y pixels of the first line drawn — enough to tell close from anything else. */
function lineYs(series: Parameters<typeof createPlotModel>[0]["series"]) {
  const model = createPlotModel({
    size: { width: 400, height: 300 },
    series,
    config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
  });
  const line = model.commands().find((command) => command.type === "drawLine");
  if (!line || line.type !== "drawLine") throw new Error("no line drawn");
  return { ys: line.points.map((point) => point.y), yScale: model.plot.mainPane.yScale };
}

describe("lineSeries and areaSeries take a coordinate accessor", () => {
  it("lineSeries({ coordinates }) draws candles through that accessor — the close", () => {
    const { ys, yScale } = lineYs({ series: lineSeries({ coordinates: new OHLCAccessor() }), data: candles });
    expect(ys).toEqual(candles.map((bar) => yScale.scale(bar.close)));
  });

  it("areaSeries({ coordinates }) draws candles through that accessor too", () => {
    const { ys, yScale } = lineYs({ series: areaSeries({ coordinates: new OHLCAccessor() }), data: candles });
    expect(ys).toEqual(candles.map((bar) => yScale.scale(bar.close)));
  });

  it("the accessor comes with a style — both are used", () => {
    const series = lineSeries({ coordinates: new OHLCAccessor(), style: { line: { color: "#123456" } } });
    const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series, data: candles }, config: { showGrid: false } });
    const line = model.commands().find((command) => command.type === "drawLine");
    expect(line?.type === "drawLine" ? line.style.color : null).toBe("#123456");
  });

  it("a custom accessor is read for x and y, not replaced", () => {
    interface Tick {
      x: number;
      price: number;
    }
    // x read through the accessor, not `point.x` — the chart's x range shows which one was used.
    const shifted: CoordinateAccessor<Tick> = { getX: (point) => point.x + 1000, getY: (point) => point.price };
    const data: Tick[] = [
      { x: 0, price: 5 },
      { x: 1, price: 9 },
    ];
    for (const series of [lineSeries({ coordinates: shifted }), areaSeries({ coordinates: shifted })]) {
      const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series, data }, config: { showGrid: false } });
      const range = model.plot.getState().xDomain;
      expect(range?.min).toBeGreaterThan(900);
      const line = model.commands().find((command) => command.type === "drawLine");
      expect(line?.type === "drawLine" ? line.points.map((point) => point.y) : []).toEqual(
        data.map((point) => model.plot.mainPane.yScale.scale(point.price)),
      );
    }
  });

  it("areaSeries({ coordinates, style }) fills with the given style", () => {
    const series = areaSeries({ coordinates: new OHLCAccessor(), style: { fill: "#abcdef" } });
    const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series, data: candles }, config: { showGrid: false } });
    const polygon = model.commands().find((command) => command.type === "drawShape" && command.shape.shape === "polygon");
    expect(polygon?.type === "drawShape" ? polygon.shape.fill : null).toBe("#abcdef");
  });

  it("the style-only call is unchanged", () => {
    const data: LineDataPoint[] = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ];
    const { ys, yScale } = lineYs({ series: lineSeries({ line: { width: 3 } }), data });
    expect(ys).toEqual(data.map((point) => yScale.scale(point.y ?? 0)));
    const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series: lineSeries({ line: { width: 3 } }), data }, config: { showGrid: false } });
    const line = model.commands().find((command) => command.type === "drawLine");
    expect(line?.type === "drawLine" ? line.style.width : null).toBe(3);
  });

  it("an accessor without getX/getY is refused at the door", () => {
    // @ts-expect-error — not an accessor
    expect(() => lineSeries({ coordinates: {} })).toThrow(ContractError);
    // @ts-expect-error — not an accessor
    expect(() => areaSeries({ coordinates: null })).toThrow(ContractError);
    // @ts-expect-error — getY missing
    expect(() => lineSeries({ coordinates: { getX: () => 0 } })).toThrow(ContractError);
  });

  it("a style key beside coordinates is refused — in the types and at the door", () => {
    // A variable, not a literal: a literal is already refused by the excess-property check.
    const mixed = { line: { width: 2 }, coordinates: new OHLCAccessor() };
    // @ts-expect-error — a style with a coordinates key is neither overload
    expect(() => lineSeries(mixed)).toThrow(ContractError);
    // @ts-expect-error — same for area
    expect(() => areaSeries(mixed)).toThrow(ContractError);
    // A style key reached through the prototype counts too.
    const inherited = Object.assign(Object.create({ line: { width: 2 } }), { coordinates: new OHLCAccessor() });
    expect(() => lineSeries(inherited)).toThrow(ContractError);
  });
});
