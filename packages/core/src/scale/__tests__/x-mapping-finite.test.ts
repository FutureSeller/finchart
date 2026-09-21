import { expect, it } from "vitest";
import { barIndexX } from "../x-mapping";
import { LinearScale } from "../linear-scale";

it("interpolates the entire finite x interval including exact endpoints", () => {
  const mapping = barIndexX(new LinearScale(0, 1, 0, 100));
  const max = Number.MAX_VALUE;
  mapping.rebuild?.([[-max, max]]);
  expect(mapping.toDomain(0)).toBe(0.5);
  expect(mapping.fromDomain(0)).toBe(-max);
  expect(mapping.fromDomain(1)).toBe(max);
  expect(mapping.fromDomain(0.5)).toBe(0);
  expect(mapping.toPixel(0)).toBe(50);
  const scan = mapping.scanToDomain?.();
  for (const x of [-max, -max / 2, 0, max / 2, max]) {
    expect(scan?.(x)).toBe(mapping.toDomain(x));
    expect(mapping.fromDomain(mapping.toDomain(x)) / max).toBeCloseTo(x / max, 14);
  }
});

it("keeps exact mapping and scale endpoints when their magnitudes differ", () => {
  const mapping = barIndexX(new LinearScale(0, 1, 0, 100));
  mapping.rebuild?.([[-1e16, 1]]);
  expect(mapping.fromDomain(1)).toBe(1);
  expect(mapping.fromPixel(100)).toBe(1);
  expect(mapping.fromDomain(1 + Number.EPSILON)).toBe(1 + Number.EPSILON * 1e16);
  const scale = new LinearScale(-1e16, 1, 0, 100);
  expect(scale.invert(100)).toBe(1);
  expect(scale.invert(0)).toBe(-1e16);
});
