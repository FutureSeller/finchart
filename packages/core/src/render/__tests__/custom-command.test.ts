/**
 * An extension can emit its own drawing primitive. Growing the command set
 * is a major change (a consumer doing exhaustive checks would
 * break), and a third party shouldn't have to wait for a major release just
 * because of one gradient, so this opens the door exactly once. Four things
 * are held here.
 * - A surface that knows the name calls the painter
 * - An unfamiliar surface draws the `fallback` — no silent hole in the picture
 * - Canvas state a painter leaves behind doesn't taint the next command
 * - The primitive set (`DrawTarget`) stays unchanged
 */
import { describe, expect, it, vi } from "vitest";
import { fakeCanvasContext } from "../../__tests__/dom-fakes";
import type { DrawSurface, DrawTarget, FallbackCommand } from "../types";
import { drawCustom } from "../types";
import { createCanvasRenderer } from "../canvas-renderer";
import { recordingRenderer } from "../recording-renderer";

const HEATMAP = "acme/heatmap";

interface HeatmapParams {
  cells: number;
}

/** What a surface that doesn't know this name draws instead. */
const fallback: FallbackCommand[] = [
  {
    type: "drawShape",
    shape: { shape: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#eee" },
  },
];

const heatmap = (cells: number) => ({
  name: HEATMAP,
  params: { cells } satisfies HeatmapParams,
  fallback,
});

const surface = (): DrawSurface => ({
  width: 100,
  height: 100,
  context: fakeCanvasContext(),
});

describe("an extension's primitive", () => {
  it("should reach a renderer that knows the name", () => {
    const paint = vi.fn();
    const target = surface();
    const renderer = createCanvasRenderer(target, {
      painters: { [HEATMAP]: paint },
    });

    drawCustom(renderer, heatmap(3));
    renderer.commit();

    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint.mock.calls[0][1]).toEqual({ cells: 3 });
  });

  it("should draw the fallback when the name is unknown", () => {
    const target = surface();
    const renderer = createCanvasRenderer(target);
    const context = target.context as ReturnType<typeof fakeCanvasContext>;

    drawCustom(renderer, heatmap(3));
    renderer.commit();

    // With no painter, at least a gray rectangle gets drawn — no hole in the picture.
    expect(context.calls).toContainEqual(
      expect.objectContaining({ method: "fillRect" }),
    );
  });

  it("should draw nothing, and throw nothing, without a fallback", () => {
    const target = surface();
    const renderer = createCanvasRenderer(target);

    expect(() => {
      drawCustom(renderer, { name: "unknown/thing", params: null });
      renderer.commit();
    }).not.toThrow();
  });

  it("should replay the fallback on a target that has no drawCustom at all", () => {
    // An older, third-party renderer — it doesn't break just because this method was added.
    const drawn: string[] = [];
    const old: DrawTarget = {
      drawLine: () => drawn.push("line"),
      drawShape: () => drawn.push("shape"),
      drawText: () => drawn.push("text"),
    };

    drawCustom(old, heatmap(3));

    expect(drawn).toEqual(["shape"]);
  });

  it("should keep the command in a recording renderer instead of unfolding it", () => {
    // A replayer needs the original to draw a name it recognizes directly.
    const recorder = recordingRenderer();
    const renderer = recorder.factory(surface());

    drawCustom(renderer, heatmap(7));
    renderer.commit();

    const [command] = recorder.commands();
    expect(command).toMatchObject({
      type: "custom",
      name: HEATMAP,
      params: { cells: 7 },
    });
  });

  it("should not let a painter leak canvas state into the next command", () => {
    const target = surface();
    const context = target.context as ReturnType<typeof fakeCanvasContext>;
    const renderer = createCanvasRenderer(target, {
      painters: {
        [HEATMAP]: (ctx) => {
          ctx.fillStyle = "#ff0000";
        },
      },
    });

    drawCustom(renderer, heatmap(1));
    renderer.drawShape({
      shape: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      fill: "#0000ff",
    });
    renderer.commit();

    // Wrapped in save/restore, so a fillStyle a painter leaves behind doesn't bleed into the next command.
    expect(context.calls.filter((call) => call.method === "save")).toHaveLength(
      1,
    );
    expect(
      context.calls.filter((call) => call.method === "restore"),
    ).toHaveLength(1);
  });
});

/**
 * Purity becomes the extension's own responsibility here. `params` is
 * `unknown`, so the core doesn't inspect its contents — that type is a
 * contract between the extension and whichever renderer recognizes it. The
 * rule stays the same: the command list is the output, so it has to be
 * sendable to a worker.
 */
describe("an extension's primitive and command purity", () => {
  it("should survive structuredClone when params are plain data", () => {
    const recorder = recordingRenderer();
    const renderer = recorder.factory(surface());

    drawCustom(renderer, heatmap(3));
    renderer.commit();

    expect(() => structuredClone(recorder.commands())).not.toThrow();
  });
});

/**
 * A fallback cannot swap out someone else's clip boundary. If the replay
 * path skipped clip, an extension could escape a pane's boundary (the bug
 * the custom-command door meant to prevent, `y = -8731`) — now the type prevents it. If it
 * were only a runtime rule, every path would have to enforce it separately.
 */
describe("fallback and clip boundary", () => {
  it("should not accept a clip command in a fallback", () => {
    const clipCommand = { type: "clip" as const, area: null };

    // @ts-expect-error clip is not a FallbackCommand
    const bad: FallbackCommand = clipCommand;
    void bad;
  });

  it("should leave the frame's clip untouched while drawing a fallback", () => {
    const target = surface();
    const context = target.context as ReturnType<typeof fakeCanvasContext>;
    const renderer = createCanvasRenderer(target);

    renderer.clip?.({ left: 0, top: 0, right: 50, bottom: 50 });
    drawCustom(renderer, heatmap(1));
    renderer.drawLine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { width: 1, color: "#000" },
    );
    renderer.commit();

    // One save for the clip, one restore at the end of the frame. If a
    // restore sneaks in between, the command after the fallback leaks
    // outside the boundary.
    const order = context.calls
      .map((call) => call.method)
      .filter((method) => method === "save" || method === "restore");
    expect(order).toEqual(["save", "restore"]);
  });

  it("should stop following a fallback that contains itself", () => {
    const target = surface();
    const renderer = createCanvasRenderer(target);

    const loop: { name: string; params: null; fallback: FallbackCommand[] } = {
      name: "acme/loop",
      params: null,
      fallback: [],
    };
    loop.fallback.push({ type: "custom", ...loop });

    expect(() => {
      drawCustom(renderer, loop);
      renderer.commit();
    }).not.toThrow();
  });

  it("should stop following a self-referential fallback on a plain target", () => {
    const drawn: string[] = [];
    const plain: DrawTarget = {
      drawLine: () => drawn.push("line"),
      drawShape: () => drawn.push("shape"),
      drawText: () => drawn.push("text"),
    };

    const loop: { name: string; params: null; fallback: FallbackCommand[] } = {
      name: "acme/loop",
      params: null,
      fallback: [],
    };
    loop.fallback.push({ type: "custom", ...loop });

    expect(() => drawCustom(plain, loop)).not.toThrow();
  });
});
