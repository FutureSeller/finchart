/**
 * A collection of regression checks for defects caught during a full audit
 * of `packages/core/src/render`. This whole batch shares one character: the
 * same rule was written differently in different places, and only the spot
 * fixed last was correct.
 */
import { describe, expect, it } from "vitest";
import {
  acceptsFontShorthand,
  fakeCanvasContext,
  rejectingFont,
  type FakeCanvasContext,
} from "../../__tests__/dom-fakes";
import {
  applyColor,
  applyFont,
  CanvasRenderer,
  ColorVerdicts,
  FontVerdicts,
  FALLBACK_FONT,
} from "../canvas-renderer";
import { paintLinearGradient } from "../gradient";
import { createCanvasTextMeasurer } from "../text-measurer";
import { resolveStyle } from "../style-spec";
import type { DrawSurface } from "../types";
import { ContractError } from "../../primitives";

function renderer(width = 400, height = 300) {
  const context = fakeCanvasContext();
  const surface: DrawSurface = { width, height, context };
  return { renderer: new CanvasRenderer(surface), context, surface };
}

/** A **full** fake context with the same verdict logic as `rejectingFont` (measuring and drawing included). */
function rejectingCanvasContext(initial = "44px Inter") {
  const base = fakeCanvasContext();
  let font = initial;
  // The fake's `font` isn't configurable, so it can't be overwritten — a layer gets stacked in front of it.
  const context: FakeCanvasContext = Object.create(base);
  Object.defineProperty(context, "font", {
    get: () => font,
    set: (next: string) => {
      if (acceptsFontShorthand(next)) font = next;
      base.calls.push({ method: "set:font", args: [next] });
    },
    enumerable: true,
  });
  return context;
}

describe("drawLine inside a fallback — the replay path bypasses the door", () => {
  /**
   * The polygon guard exists for "if the same input ends up different
   * depending on the surface, that's not a contract" — but its sibling,
   * the line, was never fixed to match. The `custom` fallback path bypasses
   * `drawLine()`'s door-level two-point check entirely.
   */
  it("should not crash commit() on an empty polyline inside a fallback", () => {
    const { renderer: r, context } = renderer();

    r.drawCustom({
      name: "unknown/x",
      params: {},
      fallback: [
        { type: "drawLine", points: [], style: { width: 1, color: "#000" } },
      ],
    });

    expect(() => r.commit()).not.toThrow();
    expect(context.calls.some((call) => call.method === "stroke")).toBe(false);
  });

  it("should still draw a well-formed polyline from a fallback", () => {
    const { renderer: r, context } = renderer();

    r.drawCustom({
      name: "unknown/x",
      params: {},
      fallback: [
        {
          type: "drawLine",
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
          style: { width: 1, color: "#000" },
        },
      ],
    });
    r.commit();

    expect(context.calls.some((call) => call.method === "stroke")).toBe(true);
  });
});

describe("painter lookup — a name from the prototype chain is not a painter", () => {
  /**
   * If `painters[name]` gets read through `Object.prototype`, `"toString"`
   * looks like a painter exists — the fallback never replays and the
   * result is a silent blank; `"__proto__"` calls something that isn't a
   * function and blows up in the middle of `commit()`.
   */
  it("should replay the fallback for a name that only exists on Object.prototype", () => {
    const { renderer: r, context } = renderer();

    r.drawCustom({
      name: "toString",
      params: {},
      fallback: [
        {
          type: "drawShape",
          shape: { shape: "rect", x: 1, y: 2, width: 3, height: 4, fill: "#f00" },
        },
      ],
    });
    r.commit();

    expect(
      context.calls.find((call) => call.method === "fillRect")?.args,
    ).toEqual([1, 2, 3, 4]);
  });

  it("should not throw for a __proto__ named custom command", () => {
    const { renderer: r } = renderer();

    r.drawCustom({ name: "__proto__", params: {} });

    expect(() => r.commit()).not.toThrow();
  });
});

describe("applyColor — not everything non-string is a brush", () => {
  /**
   * `typeof x !== "string"` is also true for `undefined`, `null`, and a
   * number. The IDL coerces those to a string on the way through, so the
   * canvas silently ignores them and the previous command's color survives.
   */
  it.each([[undefined], [null], [12]])(
    "should reject %s instead of leaving the neighbour's color",
    (bad) => {
      const channels = { fillStyle: "#00ff00", strokeStyle: "" };

      applyColor(channels, "fillStyle", bad as never);

      expect(channels.fillStyle).toBe("rgba(0,0,0,0)");
    },
  );

  it("should still pass a gradient-shaped brush straight through", () => {
    const channels = { fillStyle: "" as unknown, strokeStyle: "" };
    const brush = { addColorStop: () => {} };

    applyColor(channels as never, "fillStyle", brush);

    expect(channels.fillStyle).toBe(brush);
  });
});

describe("alignment — a value that passes validation is one the anchor logic knows how to place", () => {
  /**
   * `anchorLeft`/`anchorTop` only understand six alignment values, not the
   * entire `CanvasTextAlign` set — so if `"end"` passes validation and
   * lands on the context while the box gets placed at left, the box and
   * the glyphs come apart.
   */
  it("should keep the box and the glyphs on the same anchor for an unsupported align", () => {
    const { renderer: r, context } = renderer();

    r.drawText({
      text: "0123456789",
      at: { x: 200, y: 100 },
      align: "end" as never,
      baseline: "alphabetic" as never,
      style: { font: "11px sans-serif", color: "#fff" },
      box: { fill: "#000", padding: 0 },
    });
    r.commit();

    const box = context.calls.find((call) => call.method === "fillRect");
    const align = context.calls.findLast((call) => call.method === "set:textAlign");
    const baseline = context.calls.findLast(
      (call) => call.method === "set:textBaseline",
    );

    // If the box starts at the anchor, the glyphs must start at the anchor too.
    expect(box?.args?.[0]).toBe(200);
    expect(align?.args?.[0]).toBe("left");
    expect(baseline?.args?.[0]).toBe("top");
  });
});

describe("dash array — trailing separator mixes in an extra zero", () => {
  /**
   * `"4 4 ".split(/[\s,]+/)` produces one extra empty string, and
   * `Number("")` is 0, which sails right through the finite/non-negative
   * filter. `[4,4,0]` has odd length, so the canvas doubles it up, and that
   * 0 fuses adjacent segments together, drawing a different dash pattern.
   */
  it.each([
    ["4 4 ", [4, 4]],
    [" 4 4", [4, 4]],
    ["4,4,", [4, 4]],
    ["  5,5  ", [5, 5]],
    // If even one value is unusable, it's a solid line — never drawn with a rhythm nobody asked for.
    ["4,-2,6", []],
    ["4 -4", []],
    ["4 abc 6", []],
  ])("should parse %s without a phantom zero", (dashArray, expected) => {
    const { renderer: r, context } = renderer();

    r.drawLine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { width: 1, color: "#000", dashArray },
    );
    r.commit();

    expect(
      context.calls.find((call) => call.method === "setLineDash")?.args?.[0],
    ).toEqual(expected);
  });
});

describe("font fallback ladder — the size isn't necessarily the first token", () => {
  /**
   * The canonical shape is `"600 12px Inter"`. When the unit is missing,
   * the first token is the weight — swapping that in gives
   * `"11px 12 Inter"`, which is still invalid, falls further back, and
   * takes the family down with it. That's exactly what the ladder is meant
   * to prevent.
   */
  it("should keep the family when a weight prefix precedes a unitless size", () => {
    const context = rejectingFont();

    const applied = applyFont(context, "600 12 Inter", FALLBACK_FONT);

    expect(applied).toBe("600 11px Inter");
    expect(context.font).toBe("600 11px Inter");
  });

  it("should keep the family with no prefix", () => {
    const context = rejectingFont();

    expect(applyFont(context, "12 system-ui", FALLBACK_FONT)).toBe(
      "11px system-ui",
    );
  });

  it("should fall all the way back when there is no family to save", () => {
    const context = rejectingFont();

    expect(applyFont(context, "nope", FALLBACK_FONT)).toBe(FALLBACK_FONT);
  });
});

describe("applyFont — returns the string that actually landed and remembers the verdict", () => {
  it("should report the font that actually landed", () => {
    const context = rejectingFont();

    expect(applyFont(context, "13px Inter", FALLBACK_FONT)).toBe("13px Inter");
  });

  /**
   * The read-back cache was removed for color, but font was never checked
   * the same way. The fast path only holds "when the value changed," so
   * the common case where the font stays the same (every axis label in a
   * frame shares one font) was instead falling onto the slow path.
   */
  it("should not read back the context once the verdict is known", () => {
    const verdicts = new FontVerdicts();
    let reads = 0;
    let font = "11px sans-serif";
    const context = {
      get font(): string {
        reads++;
        return font;
      },
      set font(next: string) {
        font = next;
      },
    };

    applyFont(context, "11px sans-serif", FALLBACK_FONT, verdicts);
    const warm = reads;
    applyFont(context, "11px sans-serif", FALLBACK_FONT, verdicts);

    expect(warm).toBeGreaterThan(0);
    expect(reads).toBe(warm);
    expect(context.font).toBe("11px sans-serif");
  });

  it("should remember a demotion, not just an acceptance", () => {
    const verdicts = new FontVerdicts();
    const inner = rejectingFont();
    let reads = 0;
    const context = {
      get font(): string {
        reads++;
        return inner.font;
      },
      set font(next: string) {
        inner.font = next;
      },
    };

    expect(applyFont(context, "600 12 Inter", FALLBACK_FONT, verdicts)).toBe(
      "600 11px Inter",
    );
    const warm = reads;
    context.font = "20px Other";
    expect(applyFont(context, "600 12 Inter", FALLBACK_FONT, verdicts)).toBe(
      "600 11px Inter",
    );

    // The second call answers from the remembered demotion — no probing.
    expect(warm).toBeGreaterThan(0);
    expect(reads).toBe(warm);
    expect(inner.font).toBe("600 11px Inter");
  });
});

describe("measured vs. drawn — they must agree on the font even in a demoted frame", () => {
  /**
   * If the requested string gets passed to `textHeight`, a surface with no
   * `fontBoundingBox*` returns a height based on the px of a font that
   * never actually landed — and that number becomes the box height, and
   * the axis width.
   */
  it("should size the text box from the applied font, not the requested one", () => {
    const context = rejectingCanvasContext();
    const r = new CanvasRenderer({ width: 400, height: 300, context });

    r.drawText({
      text: "42",
      at: { x: 10, y: 10 },
      align: "left",
      baseline: "top",
      // A form missing the size unit — the canvas rejects it and the ladder demotes it to "11px Inter".
      style: { font: "44 Inter", color: "#fff" },
      box: { fill: "#000", padding: 0 },
    });
    r.commit();

    const box = context.calls.find((call) => call.method === "fillRect");
    // What actually landed is 11px — this used to measure the requested string and come out at the constant fallback, 12.
    expect(box?.args?.[3]).toBe(11);
  });

  it("should agree with the measurer on a font the surface rejects", () => {
    const context = rejectingCanvasContext();
    const surface: DrawSurface = { width: 400, height: 300, context };

    expect(createCanvasTextMeasurer(surface).measure("42", "44 Inter").height).toBe(
      11,
    );
  });
});

describe("resolveStyle — anything that isn't a valid spec is a contract error", () => {
  /**
   * `styleVars` and `cssVarExpr` are guarded with `requireObject`, but
   * `resolveStyle`, which runs every frame, was left unguarded — a typo in
   * a third party's spec broke through rAF as `Cannot use 'in' operator…`.
   */
  it("should throw a ContractError, not a TypeError, for a resolved style", () => {
    expect(() => resolveStyle({ color: "#fff" }, () => "")).toThrow(
      ContractError,
    );
  });

  it("should name the offending key", () => {
    expect(() => resolveStyle({ color: "#fff" }, () => "")).toThrow(/color/);
  });
});

describe("empty value — both doors must render the same verdict", () => {
  const SPEC = { color: { css: "--c", fallback: "#16a34a" } };

  /**
   * `readVar` falls back to the default for `""`, but `coerceLeaf` passed
   * it straight through — that value then gets rejected by `applyColor`
   * and turns transparent, making the series disappear. That's the
   * opposite of falling back to the default.
   */
  it.each([[""], ["   "]])(
    "should fall back for an override of %o",
    (given) => {
      expect(resolveStyle(SPEC, () => "", { color: given }).color).toBe(
        "#16a34a",
      );
    },
  );

  it("should keep the CSS door's answer identical", () => {
    expect(resolveStyle(SPEC, () => "").color).toBe("#16a34a");
  });
});

/**
 * There wasn't a single test for the numeric branch of the override door.
 * `3` should clamp, `"60%"` should fall back, `NaN` should fall back — and
 * none of the three were mechanically checked. Reverting
 * `given != null ? coerceLeaf(given, node) : readVar(...)` to its old,
 * unvalidated form still left the suite entirely green.
 */
describe("the override door renders the same verdict as the CSS door", () => {
  const SPEC = {
    ratio: { css: "--r", fallback: 0.6, range: [0, 1] as [number, number] },
    width: { css: "--w", fallback: 1.5 },
  };

  it.each([
    [3, 1],
    [-3, 0],
    [0.25, 0.25],
    ["0.25", 0.25],
    ["60%", 0.6],
    ["0.5rem", 0.6],
    [Number.NaN, 0.6],
    [Number.POSITIVE_INFINITY, 0.6],
    [null, 0.6],
    [undefined, 0.6],
    [[4, 4], 0.6],
  ])("should coerce a ratio override of %o to %o", (given, expected) => {
    expect(
      resolveStyle(SPEC, () => "", { ratio: given as never }).ratio,
    ).toBe(expected);
  });

  it("should accept the px form the CSS door blesses", () => {
    expect(resolveStyle(SPEC, () => "", { width: "2px" as never }).width).toBe(
      2,
    );
  });
});

describe("gradient painter — the guard itself must not fail", () => {
  /**
   * `JSON.stringify(params)` threw a `TypeError` on a circular reference
   * (outside the contract's vocabulary, and it broke through `commit()`),
   * and on a large polygon the message ran past 90,000 characters.
   */
  it("should throw a ContractError for circular params", () => {
    const context = fakeCanvasContext();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => paintLinearGradient(context, circular)).toThrow(ContractError);
  });

  it("should keep the message short for a huge polygon", () => {
    const context = fakeCanvasContext();
    const points = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i }));

    try {
      paintLinearGradient(context, { points });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(200);
    }
  });
});

describe("clip boundary — survives even when a painter throws off the stack", () => {
  /**
   * `save`/`try`/`finally restore` only balances **our own** pair. A
   * painter is someone else's code, so it can leave its own pair
   * unbalanced, and that imbalance can take the frame's clip boundary with it.
   */
  it("should re-establish the clip after a painter that forgets restore", () => {
    const context = fakeCanvasContext();
    const r = new CanvasRenderer(
      { width: 400, height: 300, context },
      {
        painters: {
          "acme/leaky": (ctx) => {
            ctx.save();
            ctx.beginPath();
          },
        },
      },
    );

    r.clip({ left: 0, top: 0, right: 100, bottom: 100 });
    r.drawCustom({ name: "acme/leaky", params: {} });
    r.drawShape({ shape: "rect", x: 0, y: 0, width: 5, height: 5, fill: "#f00" });
    r.commit();

    // The clip must be re-established after the painter, so the rest of the frame's commands don't leak outside the pane — this is replayCustom's promise that "the frame's boundary survives."
    const methods = context.calls.map((call) => call.method);
    const painterMark = methods.indexOf("beginPath");
    const rect = methods.lastIndexOf("fillRect");
    expect(methods.indexOf("clip", painterMark)).toBeGreaterThan(painterMark);
    expect(methods.indexOf("clip", painterMark)).toBeLessThan(rect);
  });

  it("should re-establish the clip after a painter that over-restores", () => {
    const context = fakeCanvasContext();
    const r = new CanvasRenderer(
      { width: 400, height: 300, context },
      {
        painters: {
          "acme/greedy": (ctx) => {
            ctx.restore();
            ctx.restore();
          },
        },
      },
    );

    r.clip({ left: 0, top: 0, right: 100, bottom: 100 });
    r.drawCustom({ name: "acme/greedy", params: {} });
    r.commit();

    // The clip must be re-established after the painter here too — one extra clip call remains.
    expect(context.calls.filter((call) => call.method === "clip")).toHaveLength(
      2,
    );
  });
});

describe("ColorVerdicts — exported from the barrel", () => {
  /**
   * It sits in `applyColor`'s public signature, but with no way to name
   * it, a third-party painter had no way to opt into the cached fast path.
   */
  it("should let a third-party painter opt into the cached path", () => {
    const verdicts = new ColorVerdicts();
    let reads = 0;
    let fill = "";
    const channels = {
      get fillStyle(): string {
        reads++;
        return fill;
      },
      set fillStyle(next: string) {
        fill = next;
      },
      strokeStyle: "",
    };

    applyColor(channels, "fillStyle", "#123456", verdicts);
    const warm = reads;
    applyColor(channels, "fillStyle", "#123456", verdicts);

    expect(reads).toBe(warm);
    expect(fill).toBe("#123456");
  });
});
