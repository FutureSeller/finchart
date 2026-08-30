import { describe, expect, it } from "vitest";
import { createMemoryLayers } from "../memory-layers";
import { recordingRenderer } from "../recording-renderer";

const line = { width: 1, color: "#000" };

describe("recordingRenderer", () => {
  it("should expose a frame only after commit", () => {
    const recorder = recordingRenderer();
    const renderer = recorder.factory(createMemoryLayers(800, 600).data);

    renderer.drawLine(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      line,
    );

    expect(recorder.commands()).toEqual([]);
    renderer.commit();
    expect(recorder.commands()).toHaveLength(1);
  });

  it("should keep the last frame when the next one is cleared", () => {
    const recorder = recordingRenderer();
    const renderer = recorder.factory(createMemoryLayers(800, 600).data);

    renderer.drawShape({ shape: "circle", cx: 1, cy: 2, r: 3, fill: "#000" });
    renderer.commit();
    // Even if the next frame gets built up and discarded, the screen (the last frame) is unaffected.
    renderer.drawShape({ shape: "circle", cx: 9, cy: 9, r: 9, fill: "#fff" });
    renderer.clear();

    expect(recorder.commands()).toHaveLength(1);
  });
});

describe("createMemoryLayers", () => {
  it("should have no DOM and no canvas", () => {
    const layers = createMemoryLayers(800, 600);

    expect(layers.overlay).toBeNull();
    expect(layers.data.context).toBeUndefined();
  });

  it("should track size through resize", () => {
    const layers = createMemoryLayers(800, 600);

    layers.resize(400, 300);

    expect(layers.data.width).toBe(400);
    expect(layers.data.height).toBe(300);
  });
});

/**
 * `PlotDeps` is meant to be shared — as with a row of sparklines, one common
 * use is to build a surface per row while hoisting deps out. Sharing a
 * single recorder means the moment `Plot.render()` opens with `clear()`,
 * whatever frame another surface was building gets discarded.
 */
describe("each surface gets its own recorder", () => {
  it("doesn't discard one surface's frame when another opens mid-build", () => {
    const recorder = recordingRenderer();
    const a = recorder.factory(createMemoryLayers(800, 600).data);
    const b = recorder.factory(createMemoryLayers(800, 600).data);

    a.drawText({
      text: "A",
      at: { x: 0, y: 0 },
      style: { font: "11px sans-serif", color: "#000" },
      align: "left",
      baseline: "top",
    });

    // B opens its own frame — what A was building doesn't belong to B.
    b.clear();
    a.commit();

    expect(recorder.commands()).toHaveLength(1);
  });
});
