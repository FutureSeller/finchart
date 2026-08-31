import { describe, expect, expectTypeOf, it } from "vitest";
import { frameScheduler } from "../../render";
import { CanvasRenderer } from "../canvas-renderer";
import { createCanvasTextMeasurer } from "../text-measurer";
import type { Canvas2DContext, TextMetricsLike } from "../types";

/**
 * With the DOM type trio (container/overlay/context) now optional, an
 * implementation that genuinely needs a surface has to report a wiring
 * error, not degrade into a quiet null object. It's part of the contract
 * that the throw happens at wiring time (construction), not later — an
 * exception on the first frame would be far from its cause. The DOM half
 * (layers, labels, separators) is covered by @finchart/dom's tests.
 */
describe("an implementation that requires a surface throws where it's missing", () => {
  it("CanvasRenderer rejects a surface with no context", () => {
    expect(() => new CanvasRenderer({ width: 800, height: 600 })).toThrow(
      /recording/,
    );
  });

  it("the canvas measurer rejects a surface with no context", () => {
    expect(() => createCanvasTextMeasurer({ width: 800, height: 600 })).toThrow(
      /canvas measurer/,
    );
  });
});

/**
 * The type half of headless — the structural contract holds without any
 * global DOM types, but a real DOM object still has to be assignable to
 * it. If this drifts, a browser consumer can no longer pass in a real
 * context or window.
 */
describe("a real DOM type is assignable to the structural contract", () => {
  it("CanvasRenderingContext2D -> Canvas2DContext", () => {
    expectTypeOf<CanvasRenderingContext2D>().toExtend<Canvas2DContext>();
  });

  it("TextMetrics -> TextMetricsLike", () => {
    expectTypeOf<TextMetrics>().toExtend<TextMetricsLike>();
  });

  it("Window -> frameScheduler's view", () => {
    expectTypeOf<Window>().toExtend<
      NonNullable<Parameters<typeof frameScheduler>[0]>
    >();
  });
});
