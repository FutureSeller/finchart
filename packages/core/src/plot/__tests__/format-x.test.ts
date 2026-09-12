import { describe, expect, it } from "vitest";
import { timeTicks } from "../../axis";
import { createPlotModel } from "../model";

/**
 * `Plot.formatX` is the one function every decoration reads for an x
 * label — the crosshair badge, the tooltip header, a pane decoration's
 * context. It resolves in this order: the consumer's `axis.x.format`, then
 * what the tick strategy offers (`timeTicks` knows the zone and the
 * language already), then the rounded number.
 */
describe("Plot.formatX", () => {
  const at = Date.parse("2026-09-12T02:15:07Z");
  const expected = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(at);

  it("falls back to the tick strategy's format when no axis format is given", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { axis: { x: { ticks: timeTicks({ timeZone: "Asia/Seoul", locale: "en-US" }) } } },
    });
    expect(model.plot.formatX(at)).toBe(expected);
  });

  it("lets an explicit axis format win over the strategy's", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: {
        axis: { x: { ticks: timeTicks({ timeZone: "Asia/Seoul", locale: "en-US" }), format: (x) => `#${x}` } },
      },
    });
    expect(model.plot.formatX(at)).toBe(`#${at}`);
  });

  it("follows a strategy applied later through applyOptions, and a zone change with it", () => {
    const model = createPlotModel({ size: { width: 800, height: 600 } });
    expect(model.plot.formatX(at)).not.toBe(expected);
    model.plot.applyOptions({ axis: { x: { ticks: timeTicks({ timeZone: "Asia/Seoul", locale: "en-US" }) } } });
    expect(model.plot.formatX(at)).toBe(expected);
    model.plot.applyOptions({ axis: { x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) } } });
    expect(model.plot.formatX(at)).not.toBe(expected);
  });

  it("stays the rounded number for a strategy without a format", () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      config: { axis: { x: { ticks: { ticks: () => [] } } } },
    });
    const plain = createPlotModel({ size: { width: 800, height: 600 } });
    expect(model.plot.formatX(1234.5678)).toBe(plain.plot.formatX(1234.5678));
  });
});
