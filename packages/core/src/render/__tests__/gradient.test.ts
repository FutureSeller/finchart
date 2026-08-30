/**
 * Linear gradient — the first first-class primitive to pass through the
 * custom door.
 *
 * Three things are held here.
 * - The renderer doesn't know about painters — this name is a battery the
 *   preset (browserDeps) plugs in, and a renderer without it degrades to
 *   the fallback (a flat fill of the first stop)
 * - Going through `fillLinearGradient` automatically wires in the fallback
 *   — an unfamiliar surface doesn't end up with a hole in the picture
 * - Params of the wrong shape arriving under the same name doesn't pass silently
 */
import { describe, expect, it } from "vitest";
import { fakeCanvasContext, lastFrame } from "../../__tests__/dom-fakes";
import type { DrawSurface, DrawTarget } from "../types";
import { createCanvasRenderer } from "../canvas-renderer";
import {
  fillLinearGradient,
  LINEAR_GRADIENT,
  paintLinearGradient,
} from "../gradient";
import type { LinearGradientParams } from "../gradient";

/** The same wiring browserDeps plugs in — this file's subject is the painter itself. */
function gradientRenderer(surface: DrawSurface) {
  return createCanvasRenderer(surface, {
    painters: { [LINEAR_GRADIENT]: paintLinearGradient },
  });
}

const params: LinearGradientParams = {
  points: [
    { x: 10, y: 40 },
    { x: 50, y: 20 },
    { x: 50, y: 100 },
    { x: 10, y: 100 },
  ],
  from: { x: 0, y: 8 },
  to: { x: 0, y: 100 },
  stops: [
    { offset: 0, color: "rgba(59, 130, 246, 0.35)" },
    { offset: 1, color: "rgba(59, 130, 246, 0)" },
  ],
};

function committed() {
  const context = fakeCanvasContext();
  const surface: DrawSurface = { width: 200, height: 120, context };
  const renderer = gradientRenderer(surface);

  fillLinearGradient(renderer, params);
  renderer.commit();

  return lastFrame(context);
}

describe("paintLinearGradient (the default painter)", () => {
  it("should build the gradient on the given axis with the given stops", () => {
    const frame = committed();

    const axis = frame.find((call) => call.method === "createLinearGradient");
    expect(axis?.args).toEqual([0, 8, 0, 100]);

    const stops = frame
      .filter((call) => call.method === "addColorStop")
      .map((call) => call.args);
    expect(stops).toEqual([
      [0, "rgba(59, 130, 246, 0.35)"],
      [1, "rgba(59, 130, 246, 0)"],
    ]);
  });

  it("should trace and fill the polygon", () => {
    const frame = committed();

    const moves = frame.filter(
      (call) => call.method === "moveTo" || call.method === "lineTo",
    );
    expect(moves.map((call) => call.args)).toEqual(
      params.points.map((point) => [point.x, point.y]),
    );
    expect(frame.some((call) => call.method === "fill")).toBe(true);
  });

  it("should choke on params of another shape instead of drawing nothing", () => {
    const context = fakeCanvasContext();
    const surface: DrawSurface = { width: 200, height: 120, context };
    const renderer = gradientRenderer(surface);

    renderer.drawCustom?.({ name: LINEAR_GRADIENT, params: { cells: 3 } });

    expect(() => renderer.commit()).toThrowError(/params don't match the contract/);
  });

  it("should degrade CSS-borne value errors to a flat fill, not an exception", () => {
    // A real canvas's addColorStop throws on an invalid color or an
    // out-of-range offset — asymmetric with a fillStyle assignment silently
    // ignoring one, so the painter absorbs it
    // (PRINCIPLE 16: a typo in a style variable must not kill the render loop).
    const context = fakeCanvasContext();
    context.createLinearGradient = () => ({
      addColorStop: () => {
        throw new Error("SyntaxError: not a color");
      },
    });
    const surface: DrawSurface = { width: 200, height: 120, context };
    const renderer = gradientRenderer(surface);

    fillLinearGradient(renderer, params);
    expect(() => renderer.commit()).not.toThrow();

    const frame = lastFrame(context);
    const fills = frame.filter((call) => call.method === "set:fillStyle");
    expect(fills.at(-1)?.args).toEqual(["rgba(59, 130, 246, 0.35)"]);
    expect(frame.some((call) => call.method === "fill")).toBe(true);
  });

  it("should release the clip even when a painter throws (frame isolation)", () => {
    const context = fakeCanvasContext();
    const surface: DrawSurface = { width: 200, height: 120, context };
    const renderer = gradientRenderer(surface);

    renderer.clip?.({ left: 0, top: 0, right: 100, bottom: 100 });
    renderer.drawCustom?.({ name: LINEAR_GRADIENT, params: { cells: 3 } });
    expect(() => renderer.commit()).toThrow();

    // finally doesn't swallow the exception, but it does clean up state —
    // save/restore stay paired, and the next frame starts with no leftover clip.
    const calls = context.calls;
    const saves = calls.filter((call) => call.method === "save").length;
    const restores = calls.filter((call) => call.method === "restore").length;
    expect(restores).toBe(saves);

    renderer.clear();
    fillLinearGradient(renderer, params);
    expect(() => renderer.commit()).not.toThrow();
  });
});

describe("fillLinearGradient's fallback", () => {
  it("should degrade to a flat fill on a renderer without the painter", () => {
    // The default state for a consumer with explicit wiring — without the
    // painter plugged in, the gradient name is unrecognized and the
    // fallback replays instead: a visible degradation, not silence.
    const context = fakeCanvasContext();
    const surface: DrawSurface = { width: 200, height: 120, context };
    const renderer = createCanvasRenderer(surface);

    fillLinearGradient(renderer, params);
    renderer.commit();

    const frame = lastFrame(context);
    expect(
      frame.some((call) => call.method === "createLinearGradient"),
    ).toBe(false);
    const fills = frame.filter((call) => call.method === "set:fillStyle");
    expect(fills.at(-1)?.args).toEqual(["rgba(59, 130, 246, 0.35)"]);
    expect(frame.some((call) => call.method === "fill")).toBe(true);
  });

  it("should degrade to a flat fill of the first stop on unknowing surfaces", () => {
    const drawn: unknown[] = [];
    // A surface with no drawCustom — the fallback replays using the primitive vocabulary.
    const target: DrawTarget = {
      drawLine: () => undefined,
      drawShape: (shape) => drawn.push(shape),
      drawText: () => undefined,
    };

    fillLinearGradient(target, params);

    expect(drawn).toEqual([
      {
        shape: "polygon",
        points: [...params.points],
        fill: "rgba(59, 130, 246, 0.35)",
      },
    ]);
  });
});
