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
  let values: number[] = [];
  const changes: { startX: number; endX: number }[] = [];

  const viewport = new XViewport({
    scale,
    x,
    dataRange: () => data,
    xValues: () => [values],
    options: () => ({
      rightOffset: 0,
      shiftVisibleRangeOnNewBar: false,
      preserveLiveRightEdgeOnZoomOut: false,
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
      values = xs;
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

  it("should fit to the data once it arrives, half a bar past each end", () => {
    const s = setup();
    s.load([10, 20, 30]);

    s.viewport.fit();

    expect(s.viewport.fitted).toBe(true);
    // The bars are 10 apart — 5 of margin keeps the edge candles whole.
    expect(s.viewport.visibleRange()).toEqual({ min: 5, max: 35 });
  });

  it("should leave room after the last bar when asked", () => {
    const s = setup({ rightOffset: 5 });
    s.load([10, 20, 30]);

    s.viewport.fit();

    // The offset adds on top of the half bar.
    expect(s.domain()).toEqual([5, 40]);
  });
});

describe("when a window is set before the data", () => {
  /** Set at mount, before the data arrives — the first data's fit must not overwrite the chosen window. */
  it("should hold the window until data arrives", () => {
    const s = setup();

    s.viewport.setVisibleRange(15, 25);
    expect(s.viewport.fitted).toBe(false);
    expect(s.changes).toHaveLength(0);

    s.load([10, 20, 30]);
    s.viewport.fit();

    // The held window won, not the fit.
    expect(s.viewport.visibleRange()).toEqual({ min: 15, max: 25 });
  });

  /** In bar-index coordinates, capturing it before the data means toDomain
   * is the identity, so the raw x — not the index — ends up baked into the domain. */
  it("should convert the held window in index space, not before", () => {
    const s = setup({}, "barIndex");

    s.viewport.setVisibleRange(200, 400);
    s.load([100, 200, 300, 400, 500]);
    s.viewport.fit();

    // x 200/400 are indices 1/3. If it had captured before the data, it would have become 200~400.
    expect(s.domain()).toEqual([1, 3]);
    expect(s.viewport.visibleRange()).toEqual({ min: 200, max: 400 });
  });

  it("should apply the window immediately when data is already there", () => {
    const s = setup();
    s.load([10, 20, 30]);

    s.viewport.setVisibleRange(15, 25);

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
    s.viewport.fit(); // [-50, 150]

    s.viewport.zoom(2, 50);

    expect(s.domain()).toEqual([0, 100]);
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

  it("should not widen a narrow chosen window by default", () => {
    // The reason there's no default on the zoom-in side (max) — restoring
    // a two-bar window must not silently widen it.
    const s = setup({}, "barIndex");
    s.load([100, 200, 300, 400, 500]);
    s.viewport.setVisibleRange(200, 400);

    expect(s.viewport.visibleRange()).toEqual({ min: 200, max: 400 });
  });

  /** The limit only applies to zoom — a window widened past the limit by
   * fit or setVisibleRange must not have its first zoom yanked to the limit. */
  it("should fit past the limit and not yank the first zoom to it", () => {
    const s = setup({}, "barIndex");
    s.load(Array.from({ length: 2001 }, (_, i) => i * 10));

    s.viewport.fit();
    // Index 0~2000 plus half a bar each side — wider than the default upper bound (800px/0.5 = 1600), but not clipped.
    expect(s.domain()).toEqual([-0.5, 2000.5]);

    // A slight zoom in — doesn't jump to the upper bound (1600), only narrows by that much.
    s.viewport.zoom(1.01, 1000);
    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(2001 / 1.01);

    // Widening again stops at the current width — it can't go back past the limit.
    s.viewport.zoom(0.5, 1000);
    const [after0, after1] = s.domain();
    expect(after1 - after0).toBeCloseTo(2001 / 1.01);
  });

  /** The clamp only cuts the width — the cursor decides the position. The
   * invariant of a zoom is that the point under the cursor doesn't move. */
  it("should stand perfectly still when zooming out at the limit", () => {
    // 800px / 20px = width 40 is the upper bound — fit ([30, 70] with its half bars) is already exactly at the limit.
    const s = setup({ minBarSpacing: 20 });
    s.load([40, 60]);
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
    s.viewport.fit(); // [40, 60]

    // Width 20 -> widens only up to 40 (the limit). Cursor 54 was at the
    // 70% point of the window, and it must still be at the 70% point after
    // being clamped: [54-28, 54+12].
    s.viewport.zoom(0.25, 54);

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(40);
    expect(min).toBeCloseTo(26);
    expect(max).toBeCloseTo(66);
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
    s.viewport.setVisibleRange(0, 800);

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

describe("optional live right edge on zoom-out", () => {
  const bars = Array.from({ length: 120 }, (_, index) => index);

  it("keeps the existing right margin while zooming out with the latest bar in view", () => {
    const s = setup({ rightOffset: 5, preserveLiveRightEdgeOnZoomOut: true }, "barIndex");
    s.load(bars);
    s.viewport.fit();
    const [, right] = s.domain();

    s.viewport.zoom(0.5, 60);
    expect(s.domain()[1]).toBe(right);
    s.viewport.zoom(0.5, 60);
    expect(s.domain()[1]).toBe(right);

    s.viewport.pan(3);
    const [, chosenRight] = s.domain();
    s.viewport.zoom(0.5, 60);
    expect(s.domain()[1]).toBe(chosenRight);
  });

  it("keeps cursor-anchored zoom for a historical window and for zoom-in", () => {
    const s = setup({ preserveLiveRightEdgeOnZoomOut: true }, "barIndex");
    s.load(bars);
    s.viewport.setVisibleRange(20, 40);

    s.viewport.zoom(0.5, 30);
    expect(s.domain()).toEqual([10, 50]);

    s.viewport.scrollToRealTime();
    const anchor = s.scale.invert(200);
    s.viewport.zoomAtPixel(2, 200);
    expect(s.scale.invert(200)).toBeCloseTo(anchor);
  });

  it("does not change the default cursor-anchored zoom-out", () => {
    const s = setup({ rightOffset: 5 }, "barIndex");
    s.load(bars);
    s.viewport.fit();
    const [, right] = s.domain();

    s.viewport.zoom(0.5, 60);
    expect(s.domain()[1]).toBeGreaterThan(right);
  });

  it("does not move at the bar-spacing zoom-out limit", () => {
    const s = setup({ minBarSpacing: 20, preserveLiveRightEdgeOnZoomOut: true });
    s.load([40, 60]);
    s.viewport.fit();
    const before = s.changes.length;

    s.viewport.zoom(0.5, 65);

    expect(s.domain()).toEqual([30, 70]);
    expect(s.changes).toHaveLength(before);
  });
});

describe("notifications", () => {
  it("should announce only when the domain actually moves", () => {
    const s = setup();
    s.load([0, 100]);
    s.viewport.fit();
    const after = s.changes.length;

    s.viewport.setVisibleRange(-50, 150); // the same spot
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
    // Half an index past each end is half a bar's x.
    expect(s.domain()).toEqual([-0.5, 4.5]);
    expect(s.changes.at(-1)).toEqual({ startX: 50, endX: 550 });
  });

  it("should not announce a fit that has nothing to fit to", () => {
    const onChange = vi.fn();
    const viewport = new XViewport({
      scale: new LinearScale(),
      x: continuousX(new LinearScale()),
      dataRange: () => null,
      xValues: () => [],
      options: () => ({ rightOffset: 0, shiftVisibleRangeOnNewBar: false, preserveLiveRightEdgeOnZoomOut: false }),
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
    s.viewport.setVisibleRange(0, 800);

    s.viewport.pan(10_000);

    // The last bar (800) sits at the left edge — a future margin the width of the screen remains.
    expect(s.domain()).toEqual([800, 1600]);
  });

  it("should stop a past fling with the first bar at the right edge", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.setVisibleRange(0, 800);

    s.viewport.pan(-10_000);

    expect(s.domain()).toEqual([-800, 0]);
  });

  it("should let an out-of-bounds window come home but not drift further", () => {
    const s = setup();
    s.load([0, 800]);
    // A window pointing into empty space — set by hand, or by a jump to a date the data does not reach.
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
    s.viewport.fit(); // [-0.5, 2.5]

    s.viewport.pan(100); // by 100 bars — the last bar (index 2) only reaches the left edge

    expect(s.domain()).toEqual([2, 5]);
  });
});

describe("scrollToRealTime", () => {
  it("should keep the span and land the last bar half a bar inside the right edge", () => {
    const s = setup();
    s.load([0, 800]);
    s.viewport.setVisibleRange(0, 800);
    s.viewport.pan(-10_000); // to the far past — [-800, 0]

    s.viewport.scrollToRealTime();

    // The bars are 800 apart: the live end is 800 + 400.
    expect(s.domain()).toEqual([400, 1200]);
  });

  it("should honor rightOffset in bar-index space", () => {
    const s = setup({ rightOffset: 5 }, "barIndex");
    s.load([100, 200, 300]);
    s.viewport.fit(); // [-0.5, 7.5] — half a bar, then the offset
    s.viewport.pan(-100); // [-8, 0]

    s.viewport.scrollToRealTime();

    expect(s.domain()).toEqual([-0.5, 7.5]);
  });

  it("should preserve the zoom level, unlike fit", () => {
    const s = setup();
    s.load([0, 1000]);
    s.viewport.fit(); // [-500, 1500]
    s.viewport.zoom(4, 500); // zooms in to width 500
    s.viewport.pan(-10_000);

    s.viewport.scrollToRealTime();

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(500);
    expect(max).toBe(1500);
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

    expect(s.domain()).toEqual([-400, 1200]);
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

  it("should zoom freely when there is no data to clamp against", () => {
    const s = setup();

    s.viewport.zoom(2, 5); // default domain [0,1], center is 5, outside it

    const [min, max] = s.domain();
    expect(max - min).toBeCloseTo(0.5);
  });
});

describe("when a window set before the data misses it", () => {
  /** A window chosen before the data, on data that never reaches it. */
  it("should fall back to the ordinary fit — the same window a fresh fit gives, right offset and all", () => {
    const held = setup({ rightOffset: 2 });
    held.viewport.setVisibleRange(100, 200);
    held.load([10, 20, 30]);
    held.viewport.fit();

    const fresh = setup({ rightOffset: 2 });
    fresh.load([10, 20, 30]);
    fresh.viewport.fit();

    expect(held.viewport.visibleRange()).toEqual(fresh.viewport.visibleRange());
    expect(held.changes).toEqual(fresh.changes);
  });

  it("should do the same under bar-index coordinates", () => {
    const held = setup({}, "barIndex");
    held.viewport.setVisibleRange(100, 200);
    held.load([10, 20, 30]);
    held.viewport.fit();

    const fresh = setup({}, "barIndex");
    fresh.load([10, 20, 30]);
    fresh.viewport.fit();

    expect(held.domain()).toEqual(fresh.domain());
  });

  it("should fall back for a window wholly before the data too", () => {
    const held = setup();
    held.viewport.setVisibleRange(-50, 5);
    held.load([10, 20, 30]);
    held.viewport.fit();

    const fresh = setup();
    fresh.load([10, 20, 30]);
    fresh.viewport.fit();

    expect(held.viewport.visibleRange()).toEqual(fresh.viewport.visibleRange());
  });

  it("should keep a window that overlaps the data, even partly", () => {
    const s = setup();
    s.viewport.setVisibleRange(25, 40);
    s.load([10, 20, 30]);
    s.viewport.fit();
    expect(s.viewport.visibleRange()).toEqual({ min: 25, max: 40 });
  });

  it("should keep a window that touches the data at an endpoint — either end", () => {
    const right = setup();
    right.viewport.setVisibleRange(30, 50);
    right.load([10, 20, 30]);
    right.viewport.fit();
    expect(right.viewport.visibleRange()).toEqual({ min: 30, max: 50 });

    const left = setup();
    left.viewport.setVisibleRange(-5, 10);
    left.load([10, 20, 30]);
    left.viewport.fit();
    expect(left.viewport.visibleRange()).toEqual({ min: -5, max: 10 });
  });

  it("should hold the window through empty data — only data can say whether it misses", () => {
    const s = setup();
    s.viewport.setVisibleRange(15, 25);
    s.load([]);
    s.viewport.fit();
    s.load([]);
    s.viewport.fit();
    expect(s.changes).toHaveLength(0);

    s.load([10, 20, 30]);
    s.viewport.fit();
    expect(s.viewport.visibleRange()).toEqual({ min: 15, max: 25 });
  });
});
