import { describe, expect, it } from "vitest";
import { LineDataAccessor, OHLCAccessor } from "../accessors";

describe("LineDataAccessor", () => {
  const accessor = new LineDataAccessor();

  it("should read x directly — x is a number by type", () => {
    expect(accessor.getX({ x: 5, y: 1 })).toBe(5);
  });

  it("should read y directly", () => {
    expect(accessor.getY({ x: 0, y: 9 })).toBe(9);
  });
});

describe("OHLCAccessor", () => {
  const accessor = new OHLCAccessor();
  const candle = { x: 3, open: 1, high: 9, low: 0, close: 4 };

  it("should read x directly — x is a number by type", () => {
    expect(accessor.getX(candle)).toBe(3);
  });

  it("should use close as the representative y", () => {
    expect(accessor.getY(candle)).toBe(4);
  });
});
