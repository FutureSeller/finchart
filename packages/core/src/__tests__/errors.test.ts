/**
 * Is the classification of what gets thrown actually respected? The line
 * that divides them isn't "where did it come from" but "can a consumer catch
 * it by type" -> `primitives/errors.ts`
 */
import { describe, expect, it } from "vitest";
import { ContractError, DataError, RenderError } from "../primitives";
import { LinearScale, LogScale } from "../scale";
import { lineSeries } from "../series";
import { createCanvasRenderer } from "../render";
import { createPlotModel } from "../plot";
import { fakeCanvasContext } from "./dom-fakes";

const size = { width: 400, height: 300 };

describe("DataError — a value that came in from outside", () => {
  it("should mark data that breaks the sort contract", () => {
    const model = createPlotModel({ size });
    const handle = model.plot.mainPane.addSeries(lineSeries());

    expect(() =>
      handle.setData([
        { x: 10, y: 1 },
        { x: 0, y: 2 },
      ]),
    ).toThrow(DataError);
  });
});

describe("ContractError — the caller used the API wrong", () => {
  it("should mark a zoom factor that is not positive", () => {
    const { plot } = createPlotModel({ size });

    expect(() => plot.zoom(0, 50)).toThrow(ContractError);
    expect(() => plot.zoom(-1, 50)).toThrow(ContractError);
  });

  it("should mark removing the pane that cannot go", () => {
    const { plot } = createPlotModel({ size });

    expect(() => plot.removePane(plot.mainPane)).toThrow(ContractError);
  });

  it("should mark a duplicate series id", () => {
    const { plot } = createPlotModel({ size });
    const spec = { id: "same", series: lineSeries(), toEntry: () => undefined };

    expect(() =>
      plot.mainPane.syncSeries([
        spec as never,
        spec as never,
      ]),
    ).toThrow(ContractError);
  });

  it("should mark data pushed into a registration that owns none", () => {
    const { plot } = createPlotModel({ size });
    const source = { read: () => [{ x: 0, y: 1 }] };
    const handle = plot.mainPane.addSeries({
      series: lineSeries(),
      input: source,
    });

    expect(() => handle.setData([{ x: 0, y: 1 }])).toThrow(ContractError);
  });

  it("should mark a collapsed scale domain or range", () => {
    expect(() => new LinearScale(100, 100, 0, 800)).toThrow(ContractError);
    expect(() => new LinearScale(0, 100, 800, 800)).toThrow(ContractError);
    expect(() => new LogScale(0, 100, 0, 800)).toThrow(ContractError);
  });

  it("should mark a line with fewer than two points", () => {
    const renderer = createCanvasRenderer({
      width: 10,
      height: 10,
      context: fakeCanvasContext(),
    });

    expect(() =>
      renderer.drawLine([{ x: 0, y: 0 }], { width: 1, color: "#000" }),
    ).toThrow(ContractError);
  });
});

describe("RenderError — the wiring is wrong", () => {
  it("should mark asking a headless stage for pixels", () => {
    const { plot } = createPlotModel({ size });

    expect(() => plot.takeScreenshot()).toThrow(RenderError);
  });

  /** Even for the same renderer, a wiring problem (no context) and a call
   * problem (a single point) are different kinds of failure. */
  it("should mark a canvas renderer wired to a surface with no context", () => {
    expect(() => createCanvasRenderer({ width: 10, height: 10 })).toThrow(
      RenderError,
    );
  });
});
