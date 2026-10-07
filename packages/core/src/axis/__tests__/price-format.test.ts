import { describe, expect, it } from "vitest";
import { ContractError } from "../../primitives";
import { priceFormat } from "../price-format";

describe("priceFormat", () => {
  it("should default to two decimals with grouping", () => {
    expect(priceFormat({ locale: "en-US" })(104500.5)).toBe("104,500.50");
  });

  it("should derive precision from the tick size and snap to it", () => {
    const format = priceFormat({ minMove: 0.05, locale: "en-US" });

    expect(format(104.512)).toBe("104.50");
    expect(format(104.539)).toBe("104.55");
  });

  it("should let precision win over minMove-derived decimals", () => {
    expect(priceFormat({ minMove: 0.05, precision: 3, locale: "en-US" })(1.05)).toBe(
      "1.050",
    );
  });

  it("should shorten large numbers when compact", () => {
    expect(priceFormat({ compact: true, locale: "en-US" })(1_240_000)).toBe(
      "1.2M",
    );
  });

  it("should speak the locale", () => {
    expect(priceFormat({ compact: true, locale: "ko" })(12_000)).toBe("1.2만");
  });

  describe("tick step awareness (dogfood #3)", () => {
    it("should widen compact precision until neighbouring ticks differ", () => {
      const format = priceFormat({ compact: true, locale: "ko" });
      const step = 2_000_000;

      expect(format(104_000_000, step)).toBe("1.04억");
      expect(format(106_000_000, step)).toBe("1.06억");
      expect(format(110_000_000, step)).toBe("1.1억");
      expect(format(100_000_000, step)).toBe("1억");
    });

    it("should stay coarse when the step does not demand more", () => {
      const format = priceFormat({ compact: true, locale: "en-US" });

      expect(format(1_240_000, 200_000)).toBe("1.2M");
      expect(format(0, 200_000)).toBe("0");
    });

    it("should deepen default decimals when the step is finer", () => {
      const format = priceFormat({ locale: "en-US" });

      expect(format(1.005, 0.005)).toBe("1.005");
      expect(format(1.005)).toBe("1.01"); // unchanged from today without a step
    });

    it("should let explicit precision ignore the step", () => {
      expect(priceFormat({ precision: 0, locale: "en-US" })(1.005, 0.005)).toBe(
        "1",
      );
    });

    it("should let minMove ignore the step — the tick size is the finest distinction", () => {
      expect(
        priceFormat({ minMove: 0.05, locale: "en-US" })(104.512, 0.001),
      ).toBe("104.50");
    });
  });
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

/**
 * Intl truncates a fractional digit count without a word, so 1.5 would
 * quietly print one decimal; the helper refuses it instead.
 */
it("refuses a precision that is not a whole number of digits", () => {
  expect(() => priceFormat({ precision: 1.5 })).toThrow(ContractError);
});
