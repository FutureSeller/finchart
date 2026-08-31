/** The divider drag's clamp arithmetic — no panes, just two heights and two floors. */
import { describe, expect, it } from "vitest";
import { clampDividerDrag } from "../dividers";

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
