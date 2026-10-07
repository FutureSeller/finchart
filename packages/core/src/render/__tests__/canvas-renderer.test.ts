import { describe, expect, it } from "vitest";
import {
  fakeCanvasContext,
  rejectingFont,
  strokedPaths,
  type FakeCanvasContext,
} from "../../__tests__/dom-fakes";
import {
  applyColor,
  applyFont,
  CanvasRenderer,
  ColorVerdicts,
  FALLBACK_FONT,
  type CanvasBrush,
  type CanvasColorChannels,
} from "../canvas-renderer";
import type {
  CanvasGradientLike,
  DrawSurface,
} from "../types";

function renderer(width = 400, height = 300) {
  const context = fakeCanvasContext();
  const surface: DrawSurface = { width, height, context };
  return { renderer: new CanvasRenderer(surface), context };
}

describe("CanvasRenderer", () => {
  it("should take its size from the surface", () => {
    const { renderer: r } = renderer(640, 480);

    expect(r.width).toBe(640);
    expect(r.height).toBe(480);
  });

  it("should not touch the context until commit", () => {
    const { renderer: r, context } = renderer();

    r.drawLine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { width: 2, color: "#f00" },
    );

    expect(context.calls).toHaveLength(0);
  });

  it("should clear the surface before replaying", () => {
    const { renderer: r, context } = renderer();

    r.commit();

    expect(context.calls[0]).toEqual({
      method: "clearRect",
      args: [0, 0, 400, 300],
    });
  });

  it("should replay a polyline with its style", () => {
    const { renderer: r, context } = renderer();

    r.drawLine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 30, y: 5 },
      ],
      { width: 2, color: "#123456" },
    );
    r.commit();

    expect(strokedPaths(context)).toEqual([
      {
        width: 2,
        color: "#123456",
        dash: [],
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
          { x: 30, y: 5 },
        ],
      },
    ]);
  });

  it("should translate a dash array into setLineDash", () => {
    const { renderer: r, context } = renderer();

    r.drawLine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { width: 0.5, color: "#eee", dashArray: "5,5" },
    );
    r.commit();

    expect(strokedPaths(context)[0].dash).toEqual([5, 5]);
  });

  /**
   * A canvas ignores a zero, negative or non-numeric `lineWidth` and keeps
   * the previous command's width, so such a line must reach the context
   * as a positive hairline nobody can see — not as itself, and not at a
   * visible default either.
   */
  it.each([
    ["zero", 0],
    ["negative", -3],
    ["NaN", Number.NaN],
  ])("should hide a line whose width is %s", (_label, width) => {
    const { renderer: r, context } = renderer();

    r.drawLine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { width, color: "#123456" },
    );
    r.commit();

    const [path] = strokedPaths(context);
    expect(path.width).toBeGreaterThan(0);
    expect(path.width).toBeLessThan(0.01);
  });

  it("should replay a circle with the given fill", () => {
    const { renderer: r, context } = renderer();

    r.drawShape({ shape: "circle", cx: 5, cy: 6, r: 3, fill: "#0f0" });
    r.commit();

    const arc = context.calls.find((c) => c.method === "arc");
    expect(arc?.args).toEqual([5, 6, 3, 0, Math.PI * 2]);
    expect(
      context.calls.some(
        (c) => c.method === "set:fillStyle" && c.args[0] === "#0f0",
      ),
    ).toBe(true);
  });

  it("should replay a rect", () => {
    const { renderer: r, context } = renderer();

    r.drawShape({
      shape: "rect",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      fill: "#00f",
    });
    r.commit();

    const rect = context.calls.find((c) => c.method === "fillRect");
    expect(rect?.args).toEqual([1, 2, 3, 4]);
  });

  it("should close a polygon path", () => {
    const { renderer: r, context } = renderer();

    r.drawShape({
      shape: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      fill: "#abc",
    });
    r.commit();

    expect(context.calls.some((c) => c.method === "closePath")).toBe(true);
  });

  it("should drop queued commands on clear", () => {
    const { renderer: r, context } = renderer();

    r.drawLine(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      { width: 1, color: "#000" },
    );
    r.clear();
    r.commit();

    expect(strokedPaths(context)).toHaveLength(0);
  });
});

/**
 * A clip boundary prevents drawing outright — it doesn't draw first and
 * erase after. Order is everything: only what's drawn after
 * `save` -> `rect` -> `clip` gets cut, and `restore` undoes that. If the
 * replay side breaks this pairing, the next frame draws inside someone
 * else's boundary.
 */
describe("clip", () => {
  const area = { left: 10, top: 20, right: 110, bottom: 220 };

  function methodsOf(context: FakeCanvasContext): string[] {
    return context.calls.map((call) => call.method);
  }

  it("should fence a region with save/rect/clip", () => {
    const context = fakeCanvasContext();
    const renderer = new CanvasRenderer({ width: 200, height: 300, context });

    renderer.clip(area);
    renderer.drawLine(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      { width: 1, color: "#000" },
    );
    renderer.commit();

    const methods = methodsOf(context);
    expect(methods.indexOf("save")).toBeLessThan(methods.indexOf("rect"));
    expect(methods.indexOf("rect")).toBeLessThan(methods.indexOf("clip"));
    // The drawing happens only after the boundary is in place.
    expect(methods.indexOf("clip")).toBeLessThan(methods.lastIndexOf("stroke"));

    const rect = context.calls.find((call) => call.method === "rect");
    expect(rect?.args).toEqual([10, 20, 100, 200]);
  });

  it("should release the fence at the end of a frame", () => {
    const context = fakeCanvasContext();
    const renderer = new CanvasRenderer({ width: 200, height: 300, context });

    renderer.clip(area);
    renderer.commit();

    const methods = methodsOf(context);
    expect(methods.filter((m) => m === "save")).toHaveLength(1);
    expect(methods.filter((m) => m === "restore")).toHaveLength(1);
    expect(methods.lastIndexOf("restore")).toBeGreaterThan(
      methods.lastIndexOf("clip"),
    );
  });

  /** A canvas clip is an intersection, so stacking one on top only narrows it further. Instead it releases and re-fences. */
  it("should swap one fence for another instead of nesting them", () => {
    const context = fakeCanvasContext();
    const renderer = new CanvasRenderer({ width: 200, height: 300, context });

    renderer.clip(area);
    renderer.clip({ left: 0, top: 0, right: 200, bottom: 300 });
    renderer.commit();

    const methods = methodsOf(context);
    expect(methods.filter((m) => m === "save")).toHaveLength(2);
    expect(methods.filter((m) => m === "restore")).toHaveLength(2);
    // The first restore comes before the second save — a swap, not nesting.
    expect(methods.indexOf("restore")).toBeLessThan(methods.lastIndexOf("save"));
  });

  it("should take null as a release", () => {
    const context = fakeCanvasContext();
    const renderer = new CanvasRenderer({ width: 200, height: 300, context });

    renderer.clip(area);
    renderer.clip(null);
    renderer.commit();

    expect(methodsOf(context).filter((m) => m === "save")).toHaveLength(1);
    expect(methodsOf(context).filter((m) => m === "restore")).toHaveLength(1);
  });

  it("should do nothing for a release with no fence standing", () => {
    const context = fakeCanvasContext();
    const renderer = new CanvasRenderer({ width: 200, height: 300, context });

    renderer.clip(null);
    renderer.commit();

    expect(methodsOf(context)).not.toContain("restore");
  });

  /**
   * A polygon that can't form a face must not kill commit — `replayShape`
   * read `points[0]` without checking it, so an empty array became a raw
   * `TypeError`. If that escapes rAF, the canvas freezes permanently on a
   * partial frame.
   *
   * The path to reach this is in a consumer's hands: `fillLinearGradient`
   * falls back to a polygon on a surface with no painter plugged in, and an
   * area series with no points in the visible range produces zero points.
   * The painter side (`gradient.ts`) silently skips `points.length < 3`, so
   * the same input was ending up differently depending on the surface.
   */
  it.each([
    ["empty array", []],
    ["one point", [{ x: 1, y: 2 }]],
    ["two points", [{ x: 1, y: 2 }, { x: 3, y: 4 }]],
  ])("should skip a polygon that cannot be a face (%s)", (_label, points) => {
    const { renderer: r, context } = renderer();

    r.drawShape({ shape: "polygon", points, fill: "red" });

    expect(() => r.commit()).not.toThrow();
    expect(methodsOf(context)).not.toContain("fill");
  });
});

/**
 * `applyFont` — feeding it the same value back-to-back is what's under
 * test. The existing test only checked "does one call succeed without
 * throwing," but where this function actually lives is a frame loop
 * drawing a dozen-odd axis labels with the same font in a row — if the
 * fallback ladder uses the previous value to judge success, every call
 * after the first misreads success as a rejection.
 */
describe("applyFont — repeated calls", () => {
  /** The shape of a consumer using `--chart-label-font-size: 12` (missing the unit). */
  const BROKEN = "12 Inter";

  it("should keep the family across consecutive calls", () => {
    const context = rejectingFont();
    const seen: string[] = [];

    for (let i = 0; i < 4; i += 1) {
      applyFont(context, BROKEN, FALLBACK_FONT);
      seen.push(context.font);
    }

    // Size falls back to the default, but the family has to survive, and all four calls must agree — no flicker.
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toContain("Inter");
  });

  it("should stay put when the same valid font is applied repeatedly", () => {
    const context = rejectingFont("11px sans-serif");

    applyFont(context, "16px Inter", FALLBACK_FONT);
    expect(context.font).toBe("16px Inter");

    // The second and third calls must give the same value too — this is the spot that used to make the measurer wobble.
    applyFont(context, "16px Inter", FALLBACK_FONT);
    expect(context.font).toBe("16px Inter");
    applyFont(context, "16px Inter", FALLBACK_FONT);
    expect(context.font).toBe("16px Inter");
  });

  it("should fall back for a value with no family to save", () => {
    const context = rejectingFont();

    applyFont(context, "nope", FALLBACK_FONT);

    expect(context.font).toBe(FALLBACK_FONT);
  });
});

/**
 * Caching a verdict must not weaken value validation. Reading the value
 * back cost a lot of frame time, so it's cached to check each value only
 * once — but if the second call onward skips validation and just assigns
 * the value, the old bug returns: a rejected color gets painted with
 * whatever color the previous command left behind. So what's checked here
 * isn't "is it fast" but "does the second call also come out transparent."
 */
describe("applyColor — verdict cache", () => {
  /** Like a real canvas, accepts only colors it recognizes and silently ignores the rest — the value gets normalized. */
  function rejectingColors(): CanvasColorChannels {
    const normalize = (value: CanvasBrush): CanvasBrush | null => {
      // Gradients and patterns are objects — a real canvas also accepts them as-is, with no parsing.
      if (typeof value !== "string") return value;
      const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
        value.trim(),
      );
      if (hex) {
        const [r, g, b] = hex.slice(1).map((part) => parseInt(part, 16));
        return `rgb(${r}, ${g}, ${b})`;
      }
      if (/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(value.trim())) {
        return "rgba(0, 0, 0, 0)";
      }
      return null;
    };

    let held: CanvasBrush = "rgb(100, 116, 139)"; // axis-label gray — "the neighbor's color"
    return {
      get fillStyle(): CanvasBrush {
        return held;
      },
      set fillStyle(next: CanvasBrush) {
        const normalized = normalize(next);
        if (normalized !== null) held = normalized;
      },
      get strokeStyle(): CanvasBrush {
        return held;
      },
      set strokeStyle(next: CanvasBrush) {
        this.fillStyle = next;
      },
    };
  }

  const TRANSPARENT = "rgba(0, 0, 0, 0)";

  it("should keep rejecting a bad color on every repeat", () => {
    const context = rejectingColors();
    const verdicts = new ColorVerdicts();

    applyColor(context, "fillStyle", "#00ff00", verdicts);
    expect(context.fillStyle).toBe("rgb(0, 255, 0)");

    // First rejection — the read-back path renders the verdict.
    applyColor(context, "fillStyle", "nope", verdicts);
    expect(context.fillStyle).toBe(TRANSPARENT);

    // Second rejection — the cache path. If the neighbor's green shows up here, the cache skipped validation.
    applyColor(context, "fillStyle", "#00ff00", verdicts);
    applyColor(context, "fillStyle", "nope", verdicts);
    expect(context.fillStyle).toBe(TRANSPARENT);
  });

  it("should keep painting a good color on every repeat", () => {
    const context = rejectingColors();
    const verdicts = new ColorVerdicts();

    for (let i = 0; i < 3; i++) {
      applyColor(context, "fillStyle", "#ff0000", verdicts);
      expect(context.fillStyle).toBe("rgb(255, 0, 0)");
      // Interleaving a different color in between keeps "it didn't change" from tainting the verdict.
      applyColor(context, "fillStyle", "#0000ff", verdicts);
    }
  });

  /** A call that doesn't pass a cache (`gradient.ts`) must still be correct — it's just slower. */
  it("should reject without a cache too", () => {
    const context = rejectingColors();

    applyColor(context, "fillStyle", "#00ff00");
    applyColor(context, "fillStyle", "nope");

    expect(context.fillStyle).toBe(TRANSPARENT);
  });

  /**
   * A gradient is an object — it never goes through parsing, so it can't
   * be rejected, and it can't be cached under a string key either. If the
   * cache swallowed that branch, a face that should be filled wouldn't be.
   */
  it("should pass a non-string brush straight through", () => {
    const context = rejectingColors();
    const verdicts = new ColorVerdicts();
    const gradient: CanvasGradientLike = { addColorStop: () => {} };

    applyColor(context, "fillStyle", gradient, verdicts);

    expect(context.fillStyle).toBe(gradient);
  });
});
