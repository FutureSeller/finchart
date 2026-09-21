import { expect, it } from "vitest";
import { Axis } from "../axis";
import { priceFormat } from "../price-format";
import { LinearScale } from "../../scale";

it.each([[1, 1 + 1e-14], [-Number.MAX_VALUE, Number.MAX_VALUE]])("keeps finite distinct ticks across [%s,%s]", (min, max) => {
  const ticks = new Axis(new LinearScale(min, max, 0, 1000), "horizontal", {}).getTicks();
  expect(ticks.length).toBeGreaterThan(2);
  expect(ticks.length).toBeLessThan(1000);
  expect(ticks.every(t => Number.isFinite(t.value) && t.value >= min && t.value <= max)).toBe(true);
  expect(ticks.every((t, i) => i === 0 || t.value > ticks[i - 1].value)).toBe(true);
  expect(ticks.every((t, i) => i === 0 || t.position > ticks[i - 1].position)).toBe(true);
});

it("formats distinct sub-nanounit ticks through both precision inference doors", () => {
  const explicit = priceFormat({ minMove: 1e-9, locale: "en-US" });
  expect(explicit(1e-9)).toBe("0.000000001");
  expect(explicit(2e-9)).toBe("0.000000002");
  const automatic = priceFormat({ locale: "en-US" });
  expect(automatic(1e-9, 1e-9)).toBe("0.000000001");
  expect(automatic(2e-9, 1e-9)).toBe("0.000000002");
});

it("uses scientific labels beyond Intl's decimal limit and preserves finite snapping", () => {
  const format = priceFormat({ minMove: 1e-310, locale: "en-US" });
  expect(format(1)).not.toContain("∞");
  expect(format(1e-310)).not.toBe(format(2e-310));
  const automatic = priceFormat({ locale: "en-US" });
  expect(automatic(1e-310, 1e-310)).not.toBe(automatic(2e-310, 1e-310));
  expect(priceFormat({ minMove: 1e308, locale: "en-US" })(Number.MAX_VALUE)).not.toContain("∞");
});

it("does not lose a positive tick interval to subnormal underflow", () => {
  const min = Number.MIN_VALUE;
  const ticks = new Axis(new LinearScale(min, min * 2, 0, 1000), "horizontal", {}).getTicks();
  expect(ticks.map(t => t.value)).toEqual([min, min * 2]);
  expect(ticks.map(t => t.position)).toEqual([0, 1000]);
});
