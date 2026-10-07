/**
 * A machine check that the renderer's font fallback and the axis label's
 * declaration are the same value. `canvas-renderer.ts` can't import the
 * axis because of layering, so it carries its own fallback — if the two
 * drift apart, the axis measures against `--chart-label-font-size`'s
 * fallback while the renderer draws with a different one, so the
 * measured width and the drawn glyphs come from different fonts and the
 * y-axis can't fit its own labels.
 */
import { describe, expect, it } from "vitest";
import { FALLBACK_FONT, noStyle } from "../../render";
import { labelFont } from "../labels";

describe("axis label fallback ↔ renderer fallback", () => {
  /**
   * In wiring where no variable resolves at all — headless, `noStyle` —
   * the font the axis builds must be the same string as the renderer's
   * fallback. The size and the family are both inside that one string, so
   * either drifting fails here.
   */
  it("should produce the renderer's fallback when nothing is set", () => {
    expect(labelFont(noStyle)).toBe(FALLBACK_FONT);
  });
});
