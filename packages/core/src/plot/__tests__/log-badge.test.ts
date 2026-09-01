import { describe, expect, it } from "vitest";
import { priceFormat } from "../../axis";
import type { DataManagerFactory } from "../../data";
import { M4Decimation, SimpleDataManager } from "../../data";
import { LogScale } from "../../scale";
import type { Scale, TickGeometry } from "../../scale";
import { resolveConfig } from "../config";
import { Pane } from "../pane";
import { formatOnAxis } from "../value-axis";

/**
 * The badge half of the log-ticks change: `formatOnAxis` asks the scale's
 * own geometry for the local step. The gain example is pinned with the
 * repo's real `priceFormat` — a made-up formatter here would pass no
 * matter what step arrives, and the guard would have no teeth.
 */

const managers: DataManagerFactory = (coordinates) =>
  new SimpleDataManager({
    decimation: new M4Decimation(coordinates),
    coordinates,
  });

const inheritedAxis = () =>
  resolveConfig({ axis: { y: { format: priceFormat() } } }).axis.y;

describe("badges on a log scale", () => {
  it("shows sub-cent prices the linear ruler flattened to 0.00", () => {
    // Domain [0.00001, 0.1]: the linear step is 0.01, so priceFormat's
    // two base decimals never grow and every badge reads "0.00" — the
    // price disappears. The local decade near 0.00003 is 0.00001.
    const scale = new LogScale(0.00001, 0.1, 572, 8);
    const pane = new Pane(scale, managers, {}, inheritedAxis);

    expect(pane.formatValue(0.00003)).toBe("0.00003");
  });

  it("leaves the no-format fallback alone — the split is kept knowingly", () => {
    // With no format set the badge still answers two decimals while the
    // ticks print values as-is. This change moves placement and step
    // only; unifying the default formatter would touch every chart that
    // never set one, and is deliberately a separate decision.
    const scale = new LogScale(0.00001, 0.1, 572, 8);
    const pane = new Pane(scale, managers, {}, () =>
      resolveConfig({}).axis.y,
    );
    expect(pane.formatValue(0.00003)).toBe("0.00");
  });

  it("never asks the geometry for placement", () => {
    // The badge runs on the paint pass, once per badge per frame —
    // building the whole ladder there would be an array for nothing.
    const geometry: TickGeometry = {
      values: () => {
        throw new Error("a badge must not build tick placement");
      },
      stepAt: () => 0.001,
    };
    const scale: Scale = {
      getDomain: () => [1, 100],
      getRange: () => [572, 8],
      setDomain: () => undefined,
      setRange: () => undefined,
      scale: (value) => value,
      invert: (value) => value,
      tickGeometry: () => geometry,
    };

    const label = formatOnAxis(scale, (v, step) => `${v}|${step}`, 40, 5);
    expect(label).toBe("5|0.001");
  });
});
