import { describe, expect, it } from "vitest";
import { priceFormat } from "../../axis";
import type { DataManagerFactory } from "../../data";
import { M4Decimation, SimpleDataManager } from "../../data";
import { LinearScale, LogScale } from "../../scale";
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

  it("widens the no-format fallback to the ruler's digits, so a sub-cent badge is not 0.00", () => {
    // With no format set the badge keeps two decimals where the ruler is
    // at least a cent, and takes as many as the local step needs below it.
    const scale = new LogScale(0.00001, 0.1, 572, 8);
    const pane = new Pane(scale, managers, {}, () =>
      resolveConfig({}).axis.y,
    );
    expect(pane.formatValue(0.00003)).toBe("0.00003");
  });

  it("gives a sub-cent badge the linear ruler's digits with no format set", () => {
    const scale = new LinearScale();
    scale.setDomain(1.2e-5, 1.3e-5);
    scale.setRange(572, 8);
    const pane = new Pane(scale, managers, {}, () => resolveConfig({}).axis.y);

    expect(pane.formatValue(1.299e-5)).toBe("0.0000130");
  });

  it("keeps two decimals with no format set where the ruler is coarser than a cent", () => {
    const scale = new LinearScale();
    scale.setDomain(100, 200);
    scale.setRange(572, 8);
    const pane = new Pane(scale, managers, {}, () => resolveConfig({}).axis.y);

    expect(pane.formatValue(123.456)).toBe("123.46");
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
      kind: "geometry-test",
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
