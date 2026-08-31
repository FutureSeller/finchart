/** The value axis rules with no pane — two scales and a range are enough. */
import { describe, expect, it } from "vitest";
import { ContractError } from "../../primitives";
import { LinearScale, LogScale } from "../../scale";
import { fitScale, formatOnAxis, replantScale } from "../value-axis";

const noHints = { minPositive: () => null };

describe("replantScale", () => {
  it("should carry the current window onto the new axis when it fits", () => {
    const current = new LinearScale();
    current.setDomain(10, 300);
    const next = new LinearScale();

    replantScale(next, current, { min: 50, max: 60 }, 0.1, noHints);

    expect(next.getDomain()).toEqual([10, 300]);
  });

  it("should refit to the data when the window falls outside the new axis", () => {
    // A linear window with additive padding can dip below zero — a log
    // axis refuses that, and the toggle must not throw for it.
    const current = new LinearScale();
    current.setDomain(-19, 329);
    const next = new LogScale();

    replantScale(next, current, { min: 10, max: 300 }, 0, noHints);

    const [min, max] = next.getDomain();
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(300);
  });

  it("should leave the new axis's default in place when there is no data", () => {
    const current = new LinearScale();
    current.setDomain(-19, 329);
    const next = new LogScale();
    const before = next.getDomain();

    expect(() => replantScale(next, current, null, 0.1, noHints)).not.toThrow();
    expect(next.getDomain()).toEqual(before);
  });

  it("should not swallow anything but a contract violation", () => {
    const current = new LinearScale();
    const broken = new LinearScale();
    broken.setDomain = () => {
      throw new TypeError("someone else's bug");
    };
    expect(() => replantScale(broken, current, null, 0.1, noHints)).toThrow(
      TypeError,
    );
  });
});

describe("fitScale", () => {
  it("should pad the extent through the scale's own rule", () => {
    const scale = new LinearScale();
    fitScale(scale, { min: 0, max: 100 }, 0.1, noHints);
    const [min, max] = scale.getDomain();
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(100);
  });
});

describe("formatOnAxis", () => {
  it("should hand the formatter the tick step of the current domain and range", () => {
    const scale = new LinearScale();
    scale.setDomain(0, 100);
    scale.setRange(0, 500);
    const seen: (number | undefined)[] = [];

    const text = formatOnAxis(
      scale,
      (value, step) => {
        seen.push(step);
        return `${value}`;
      },
      undefined,
      42,
    );

    expect(text).toBe("42");
    expect(seen[0]).toBeGreaterThan(0);
  });

  it("should reject a scale that is not one at the door", () => {
    expect(() => replantScale({} as never, new LinearScale(), null, 0, noHints)).toThrow(
      ContractError,
    );
  });
});
