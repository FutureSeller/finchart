/** Tests the visible x range with no stage — just one scale and a fake data range is enough. */
import { describe, expect, it, vi } from "vitest";
import type { Range } from "../../data";
import { ContractError } from "../../primitives";
import { barIndexX, continuousX, LinearScale } from "../../scale";
import { XViewport, type XViewportOptions } from "../x-viewport";

function setup(
  options: Partial<XViewportOptions> = {},
  mapping: "continuous" | "barIndex" = "continuous",
) {
  const scale = new LinearScale();
  scale.setRange(0, 800);

  const x = (mapping === "barIndex" ? barIndexX : continuousX)(scale);
  let data: Range | null = null;
  const changes: { startX: number; endX: number }[] = [];

  const viewport = new XViewport({
    scale,
    x,
    dataRange: () => data,
    options: () => ({
      rightOffset: 0,
      shiftVisibleRangeOnNewBar: false,
      ...options,
    }),
    onChange: (visible) => changes.push(visible),
  });

  return {
    viewport,
    scale,
    x,
    changes,
    /** Announces that data has arrived. Also rebuilds the index for a bar-index mapping. */
    load(xs: number[]) {
      data = xs.length ? { min: xs[0], max: xs[xs.length - 1] } : null;
      x.rebuild?.([xs]);
    },
    domain: () => scale.getDomain(),
  };
}

describe("first fit", () => {
  it("should not fit before there is data", () => {
    const { viewport, changes } = setup();

    viewport.fit();

    expect(viewport.fitted).toBe(false);
    expect(viewport.visibleRange()).toBeNull();
    expect(changes).toHaveLength(0);
  });

  it("should fit to the data once it arrives", () => {
    const s = setup();
    s.load([10, 20, 30]);

    s.viewport.fit();

    expect(s.viewport.fitted).toBe(true);
    expect(s.viewport.visibleRange()).toEqual({ min: 10, max: 30 });
  });

  it("should leave room after the last bar when asked", () => {
    const s = setup({ rightOffset: 5 });
    s.load([10, 20, 30]);

    s.viewport.fit();

    expect(s.domain()).toEqual([10, 35]);
  });
});

describe("when a restore arrives before the data", () => {
  /** The order for URL restoration — data arrives after mount. The first data's fit must not overwrite the restored window. */
  it("should hold the restored window until data arrives", () => {
    const s = setup();

    s.viewport.restore({ min: 15, max: 25 });
    expect(s.viewport.fitted).toBe(false);
    expect(s.changes).toHaveLength(0);

    s.load([10, 20, 30]);
    s.viewport.fit();

    // The restored window won, not the fit.
    expect(s.viewport.visibleRange()).toEqual({ min: 15, max: 25 });
  });

  /** In bar-index coordinates, capturing it before the data means toDomain
   * is the identity, so the raw x — not the index — ends up baked into the domain. */
  it("should convert the restored window in index space, not before", () => {
    const s = setup({}, "barIndex");

    s.viewport.restore({ min: 200, max: 400 });
    s.load([100, 200, 300, 400, 500]);
    s.viewport.fit();

    // x 200/400 are indices 1/3. If it had captured before the data, it would have become 200~400.
    expect(s.domain()).toEqual([1, 3]);
    expect(s.viewport.visibleRange()).toEqual({ min: 200, max: 400 });
  });

  it("should apply the restore immediately when data is already there", () => {
    const s = setup();
    s.load([10, 20, 30]);

    s.viewport.restore({ min: 15, max: 25 });

    expect(s.viewport.visibleRange()).toEqual({ min: 15, max: 25 });
  });
});

describe("when a new bar arrives", () => {
  /** Only shifts if the last bar was being watched — must not drag the view along while scrolling through history. */
  function withBar(shift: boolean, watching: boolean) {
    const s = setup({ shiftVisibleRangeOnNewBar: shift });
    s.load([0, 10, 20, 30]);
    s.viewport.fit();
    s.viewport.noteData({ min: 0, max: 30 });

    if (!watching) {
      // Scrolled into the past — the right edge sits before the end of the data.
      s.viewport.setVisibleRange(0, 15);
    }

    const before = s.domain();
    s.load([0, 10, 20, 30, 40]);
    const previous = s.viewport.noteData({ min: 0, max: 40 });
    s.viewport.followNewBar(previous, { min: 0, max: 40 });

    return { before, after: s.domain() };
  }

  it("should shift the window when watching the last bar", () => {
    const { before, after } = withBar(true, true);

    expect(after[0]).toBeCloseTo(before[0] + 10);
    expect(after[1]).toBeCloseTo(before[1] + 10);
  });

  it("should not shift while scrolled into the past", () => {
    const { before, after } = withBar(true, false);

    expect(after).toEqual(before);
  });

  it("should not shift at all when the option is off", () => {
    const { before, after } = withBar(false, true);

    expect(after).toEqual(before);
  });

  it("should hand back the previous end so the caller can compare", () => {
    const s = setup();

    expect(s.viewport.noteData({ min: 0, max: 30 })).toBeNull();
    expect(s.viewport.noteData({ min: 0, max: 40 })).toBe(30);
    expect(s.viewport.noteData(null)).toBe(40);
  });
});

/**
 * The limit is set in pixels and translated into domain width —
 * minBarSpacing becomes the domain width's upper bound, and
 * maxBarSpacing becomes its lower bound. The direction flips here, so
 * they're placed side by side.
 */
describe("bar spacing limits", () => {
  it("should stop zooming out past minBarSpacing", () => {
    // 800px / 20px minimum per bar = domain width 40 is the upper bound.
    // fit (width 20) is within the limit — fit itself doesn't go through the clamp.
    const s = setup({ minBarSpacing: 20 });
    s.load([40, 60]);
    s.viewport.fit();

    s.viewport.zoom(0.01, 50);

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(40);
    // Clamped while keeping the center — zooming out must not slide off one end.
    expect((min + max) / 2).toBeCloseTo(50);
  });

  it("should stop zooming in past maxBarSpacing", () => {
    // 800px / 4px maximum per bar = domain width 200 is the lower bound.
    const s = setup({ maxBarSpacing: 4 });
    s.load([0, 200]);
    s.viewport.fit();

    s.viewport.zoom(100, 100);

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(200);
    expect((min + max) / 2).toBeCloseTo(100);
  });

  it("should leave the window alone with no limits set", () => {
    const s = setup();
    s.load([0, 100]);
    s.viewport.fit();

    s.viewport.zoom(2, 50);

    expect(s.domain()).toEqual([25, 75]);
  });

  /** The mapping declares its own default — bar-index coordinates use bars
   * as the unit, so 0.5 makes sense, but a continuous coordinate system
   * has no unit to default to. */
  it("should stop zooming out at the bar-index default of 0.5px", () => {
    const s = setup({}, "barIndex");
    s.load([0, 10, 20, 30]);
    s.viewport.fit();

    s.viewport.zoom(1e-9, 1.5);

    const [min, max] = s.domain();
    // 800px / 0.5px per bar = domain (index) width 1600 is the upper bound.
    expect(max - min).toBeCloseTo(1600);
  });

  it("should stop zooming in at the bar-index default of 200px", () => {
    const s = setup({}, "barIndex");
    s.load([0, 10, 20, 30, 40, 50, 60, 70]);
    s.viewport.fit();

    s.viewport.zoom(1e9, 3.5);

    const [min, max] = s.domain();
    // 800px / 200px per bar = domain (index) width 4 is the lower bound.
    expect(max - min).toBeCloseTo(4);
  });

  it("should let the wiring override the mapping default", () => {
    const s = setup({ minBarSpacing: 20 }, "barIndex");
    s.load([0, 10, 20, 30]);
    s.viewport.fit();

    s.viewport.zoom(1e-9, 1.5);

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(40);
  });

  it("should treat an explicit zero as no limit at all", () => {
    const s = setup({ minBarSpacing: 0 }, "barIndex");
    s.load([0, 10, 20, 30]);
    s.viewport.fit();

    s.viewport.zoom(0.0001, 1.5);

    const [min, max] = s.domain();
    // Keeps widening past the default (1600).
    expect(max - min).toBeGreaterThan(1600);
  });

  it("should not widen a narrow restored window by default", () => {
    // The reason there's no default on the zoom-in side (max) — restoring
    // a two-bar window must not silently widen it.
    const s = setup({}, "barIndex");
    s.load([100, 200, 300, 400, 500]);
    s.viewport.setVisibleRange(200, 400);

    expect(s.viewport.visibleRange()).toEqual({ min: 200, max: 400 });
  });

  /** The limit only applies to zoom — a window widened past the limit by
   * fit or restore must not have its first zoom yanked to the limit. */
  it("should fit past the limit and not yank the first zoom to it", () => {
    const s = setup({}, "barIndex");
    s.load(Array.from({ length: 2001 }, (_, i) => i * 10));

    s.viewport.fit();
    // Index 0~2000 — wider than the default upper bound (800px/0.5 = 1600), but not clipped.
    expect(s.domain()).toEqual([0, 2000]);

    // A slight zoom in — doesn't jump to the upper bound (1600), only narrows by that much.
    s.viewport.zoom(1.01, 1000);
    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(2000 / 1.01);

    // Widening again stops at the current width — it can't go back past the limit.
    s.viewport.zoom(0.5, 1000);
    const [after0, after1] = s.domain();
    expect(after1 - after0).toBeCloseTo(2000 / 1.01);
  });

  /** The clamp only cuts the width — the cursor decides the position. The
   * invariant of a zoom is that the point under the cursor doesn't move. */
  it("should stand perfectly still when zooming out at the limit", () => {
    // 800px / 20px = width 40 is the upper bound — fit (width 40) is already exactly at the limit.
    const s = setup({ minBarSpacing: 20 });
    s.load([30, 70]);
    s.viewport.fit();
    const before = s.changes.length;

    // Even with the cursor off-center, the window must not shift.
    s.viewport.zoom(0.5, 65);

    expect(s.domain()).toEqual([30, 70]);
    // Nothing changed, so there's no event either.
    expect(s.changes).toHaveLength(before);
  });

  /** The floor for zooming in is floating point — once the width drops
   * below an ulp, min and max become equal and the scale rejects it. It
   * must stop silently instead of going further. */
  it("should stop at the floating-point floor instead of throwing", () => {
    // No limit set (the continuous coordinate default) — only the
    // arithmetic floor remains. This center is a value that actually
    // threw before the guard was added (329 out of 500 scanned values threw).
    const s = setup();
    s.load([-420.41, -360.41]);
    s.viewport.fit();

    for (let i = 0; i < 400; i++) s.viewport.zoom(2, -390.1);

    const [min, max] = s.domain();
    // Doesn't collapse (the loop above doesn't throw) and stays at a valid window.
    expect(min).toBeLessThan(max);
  });

  it("should keep the cursor point fixed when the clamp cuts a zoom", () => {
    const s = setup({ minBarSpacing: 20 });
    s.load([45, 55]);
    s.viewport.fit();

    // Width 10 -> widens only up to 40 (the limit). Cursor 54 was at the
    // 90% point of the window, and it must still be at the 90% point after
    // being clamped: [54-36, 54+4].
    s.viewport.zoom(0.25, 54);

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(40);
    expect(min).toBeCloseTo(18);
    expect(max).toBeCloseTo(58);
  });
});

describe("pan and zoom", () => {
  it("should refuse a zoom factor that is not positive", () => {
    const { viewport } = setup();

    expect(() => viewport.zoom(0, 0)).toThrow(ContractError);
    expect(() => viewport.zoom(-1, 0)).toThrow(ContractError);
    expect(() => viewport.zoom(Number.NaN, 0)).toThrow(ContractError);
  });

  it("should turn drag pixels into domain movement, reversed", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();

    // A domain width of 800 spans 800px, so 1px equals 1 domain unit.
    s.viewport.panByPixels(100);

    expect(s.domain()).toEqual([-100, 700]);
  });

  it("should ignore a zero-pixel drag", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();
    const before = s.changes.length;

    s.viewport.panByPixels(0);

    expect(s.changes).toHaveLength(before);
  });

  it("should keep the pixel under the cursor while zooming", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();

    const anchored = s.scale.invert(200);
    s.viewport.zoomAtPixel(2, 200);

    expect(s.scale.invert(200)).toBeCloseTo(anchored);
  });
});

describe("notifications", () => {
  it("should announce only when the domain actually moves", () => {
    const s = setup();
    s.load([0, 100]);
    s.viewport.fit();
    const after = s.changes.length;

    s.viewport.setVisibleRange(0, 100); // the same spot
    expect(s.changes).toHaveLength(after);

    s.viewport.setVisibleRange(10, 90);
    expect(s.changes).toHaveLength(after + 1);
  });

  it("should speak in data x even in bar-index space", () => {
    const s = setup({}, "barIndex");
    s.load([100, 200, 300, 400, 500]);
    s.viewport.fit();

    // The domain is index-based, but the notification speaks in x —
    // subscribers need to be able to measure "how close to the end are we."
    expect(s.domain()).toEqual([0, 4]);
    expect(s.changes.at(-1)).toEqual({ startX: 100, endX: 500 });
  });

  it("should not announce a fit that has nothing to fit to", () => {
    const onChange = vi.fn();
    const viewport = new XViewport({
      scale: new LinearScale(),
      x: continuousX(new LinearScale()),
      dataRange: () => null,
      options: () => ({ rightOffset: 0, shiftVisibleRangeOnNewBar: false }),
      onChange,
    });

    viewport.fit();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("pan boundaries", () => {
  it("should stop a future fling with the last bar at the left edge", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();

    s.viewport.pan(10_000);

    // The last bar (800) sits at the left edge — a future margin the width of the screen remains.
    expect(s.domain()).toEqual([800, 1600]);
  });

  it("should stop a past fling with the first bar at the right edge", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();

    s.viewport.pan(-10_000);

    expect(s.domain()).toEqual([-800, 0]);
  });

  it("should let an out-of-bounds window come home but not drift further", () => {
    const s = setup();
    s.load([0, 800]);
    // A restore pointing into empty space — a shared URL can genuinely look like this.
    s.viewport.setVisibleRange(2000, 2800);

    const before = s.changes.length;
    s.viewport.pan(100); // further into empty space — blocked, no rubber-banding either
    expect(s.domain()).toEqual([2000, 2800]);
    expect(s.changes).toHaveLength(before);

    s.viewport.pan(-500); // toward the data — goes through
    expect(s.domain()).toEqual([1500, 2300]);
  });

  it("should pan freely when there is no data to bound against", () => {
    const s = setup();

    s.viewport.pan(10_000);

    expect(s.domain()).toEqual([10_000, 10_001]);
  });

  it("should bound in mapping space for bar-index coordinates", () => {
    const s = setup({}, "barIndex");
    s.load([100, 200, 300]);
    s.viewport.fit();

    s.viewport.pan(100); // by 100 bars — the last bar (index 2) only reaches the left edge

    expect(s.domain()).toEqual([2, 4]);
  });
});

describe("scrollToRealTime", () => {
  it("should keep the span and land the last bar at the right edge", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();
    s.viewport.pan(-10_000); // to the far past — [-800, 0]

    s.viewport.scrollToRealTime();

    expect(s.domain()).toEqual([0, 800]);
  });

  it("should honor rightOffset in bar-index space", () => {
    const s = setup({ rightOffset: 5 }, "barIndex");
    s.load([100, 200, 300]);
    s.viewport.fit(); // [0, 7]
    s.viewport.pan(-100); // [-7, 0]

    s.viewport.scrollToRealTime();

    expect(s.domain()).toEqual([0, 7]);
  });

  it("should preserve the zoom level, unlike fit", () => {
    const s = setup();
    s.load([0, 1000]);
    s.viewport.fit();
    s.viewport.zoom(4, 500); // zooms in to width 250
    s.viewport.pan(-10_000);

    s.viewport.scrollToRealTime();

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(250);
    expect(max).toBe(1000);
  });

  it("should do nothing without data", () => {
    const s = setup();
    const before = s.changes.length;

    s.viewport.scrollToRealTime();

    expect(s.changes).toHaveLength(before);
  });

  it("should fall back to fit before the first fit", () => {
    const s = setup();
    s.load([0, 800]);

    s.viewport.scrollToRealTime();

    expect(s.domain()).toEqual([0, 800]);
    expect(s.viewport.fitted).toBe(true);
  });
});

describe("zoom center clamp", () => {
  it("should not lose the data when zooming in anchored on the void", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();
    s.viewport.pan(10_000); // future boundary — [800, 1600], last bar at the left edge

    // Anchor on empty space (1500) and zoom in repeatedly — this used to
    // push the data off to the left until it vanished. Now the center
    // gets clamped to 800 (the last bar), so it can no longer be lost.
    for (let i = 0; i < 8; i++) s.viewport.zoom(1.5, 1500);

    const [min] = s.domain();
    expect(min).toBeLessThanOrEqual(800);
  });

  it("should keep the cursor-fixed invariant for anchors inside the data", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.fit();

    const anchored = s.scale.invert(200); // a point inside the data
    s.viewport.zoomAtPixel(2, 200);

    expect(s.scale.invert(200)).toBeCloseTo(anchored);
  });

  it("should zoom freely when there is no data to clamp against", () => {
    const s = setup();

    s.viewport.zoom(2, 5); // default domain [0,1], center is 5, outside it

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(0.5);
    expect(s.changes.length).toBeGreaterThanOrEqual(0);
  });
});
