/** The divider drag's clamp arithmetic — no panes, just two heights and two floors. */
import { describe, expect, it } from "vitest";
import { clampDividerDrag, dividerRange } from "../dividers";

describe("clampDividerDrag", () => {
  const upper = { height: 300, minHeight: 40 };
  const lower = { height: 300, minHeight: 40 };

  it("should pass a small drag through unchanged", () => {
    expect(clampDividerDrag(10, upper, lower)).toBe(10);
    expect(clampDividerDrag(-10, upper, lower)).toBe(-10);
  });

  it("should stop at the lower pane's floor when dragging down", () => {
    expect(clampDividerDrag(500, upper, lower)).toBe(260);
  });

  it("should stop at the upper pane's floor when dragging up", () => {
    expect(clampDividerDrag(-500, upper, lower)).toBe(-260);
  });

  it("should not move at all when both panes already sit under their floors", () => {
    // Ordinary input when the container is shorter than the floors add up
    // to — a sign flip here once moved the boundary against the gesture.
    const squeezed = { height: 32, minHeight: 40 };
    expect(clampDividerDrag(-1, squeezed, squeezed)).toBe(0);
    expect(clampDividerDrag(1, squeezed, squeezed)).toBe(0);
  });

  it("should only block the direction that makes a breach worse", () => {
    const squeezed = { height: 32, minHeight: 40 };
    const roomy = { height: 300, minHeight: 40 };
    // The upper pane is under its floor: it can grow (drag down), not shrink.
    expect(clampDividerDrag(100, squeezed, roomy)).toBe(100);
    expect(clampDividerDrag(-100, squeezed, roomy)).toBe(0);
  });
});

describe("dividerRange", () => {
  it("should span from the upper pane's floor to the lower pane's floor", () => {
    const upper = { height: 300, minHeight: 40 };
    const lower = { height: 200, minHeight: 50 };
    expect(dividerRange(upper, lower)).toEqual({ now: 300, min: 40, max: 450 });
  });

  it("should collapse to the current height when both panes sit under their floors", () => {
    const squeezed = { height: 32, minHeight: 40 };
    expect(dividerRange(squeezed, squeezed)).toEqual({ now: 32, min: 32, max: 32 });
  });

  it("should only open the direction that doesn't make a breach worse", () => {
    const squeezed = { height: 32, minHeight: 40 };
    const roomy = { height: 300, minHeight: 40 };
    expect(dividerRange(squeezed, roomy)).toEqual({ now: 32, min: 32, max: 292 });
    expect(dividerRange(roomy, squeezed)).toEqual({ now: 300, min: 40, max: 300 });
  });

  it("should end exactly where the clamp stops a drag", () => {
    const cases = [
      [{ height: 300, minHeight: 40 }, { height: 200, minHeight: 50 }],
      [{ height: 32, minHeight: 40 }, { height: 32, minHeight: 40 }],
      [{ height: 32, minHeight: 40 }, { height: 300, minHeight: 40 }],
      [{ height: 300, minHeight: 40 }, { height: 32, minHeight: 40 }],
    ];
    for (const [upper, lower] of cases) {
      const range = dividerRange(upper, lower);
      expect(upper.height + clampDividerDrag(-1e6, upper, lower)).toBe(range.min);
      expect(upper.height + clampDividerDrag(1e6, upper, lower)).toBe(range.max);
    }
  });

  it("should never offer a height the layout won't lay out — a zero minimum floors at one pixel", () => {
    const upper = { height: 300, minHeight: 0 };
    const lower = { height: 200, minHeight: 0 };
    expect(dividerRange(upper, lower)).toEqual({ now: 300, min: 1, max: 499 });
    expect(upper.height + clampDividerDrag(-1e6, upper, lower)).toBe(1);
    expect(upper.height + clampDividerDrag(1e6, upper, lower)).toBe(499);
  });
});
