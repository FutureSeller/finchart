/**
 * Changing an option must not require tearing down and rebuilding. Just
 * like the stage's own applyOptions, a plugin without that door would
 * force a detach-and-reattach for a single option change — for the
 * drawing toolbox, that means erasing every line the user drew.
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { crosshair } from "../../extensions/crosshair";
import { createPlotModel } from "../model";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

const mount = () =>
  createPlotModel({
    size: { width: 600, height: 400 },
    config: { showGrid: false },
    series: { series: lineSeries(), data },
  });

/** The line count for this frame. This is where the crosshair turning on and off shows up. */
const lineCount = (model: ReturnType<typeof mount>): number =>
  model.commands().filter((command) => command.type === "drawLine").length;

describe("crosshair.applyOptions", () => {
  it("should stop drawing a line that was turned off", () => {
    const model = mount();
    const cursor = model.plot.use(crosshair());

    model.plot.crosshair({ x: 300, y: 200 });
    model.plot.render();
    const both = lineCount(model);

    cursor.applyOptions({ horizontal: false });
    model.plot.render();

    expect(lineCount(model)).toBe(both - 1);
  });

  it("should keep the cursor it was already following", () => {
    // Rebuilding would lose the cursor state, so nothing would be drawn
    // until the mouse moves again. This is the exact point where it
    // diverges from a plain option change.
    const model = mount();
    const cursor = model.plot.use(crosshair());
    model.plot.crosshair({ x: 300, y: 200 });

    cursor.applyOptions({ style: { color: "#ff0000", width: 2 } });
    model.plot.render();

    const drawn = model
      .commands()
      .filter((command) => command.type === "drawLine");
    expect(drawn.some((command) => command.style.color === "#ff0000")).toBe(
      true,
    );
  });

  it("should stay installed and not pile up dead plugins", () => {
    const model = mount();
    const cursor = model.plot.use(crosshair());
    const inspect = model.plot as unknown as { plugins: readonly unknown[] };

    for (let i = 0; i < 200; i++) {
      cursor.applyOptions({ format: { x: (x) => String(i + x) } });
    }

    expect(cursor.disposed).toBe(false);
    expect(inspect.plugins).toHaveLength(1);
  });

  it("should change the badge label through the formatter", () => {
    const model = mount();
    const cursor = model.plot.use(crosshair({ vertical: true }));
    model.plot.crosshair({ x: 300, y: 200 });

    cursor.applyOptions({ format: { x: () => "PINNED" } });
    model.plot.render();

    const texts = model
      .commands()
      .filter((command) => command.type === "drawText")
      .map((command) => command.params.text);
    expect(texts).toContain("PINNED");
  });
});

/**
 * Whether the core's own extensions actually honor what the contract
 * promises. PluginApi.disposed's "block calls after cleanup" used to be
 * upheld only by @finchart/tools — a contract nobody honors isn't a contract.
 */
describe("giving options to a disposed extension", () => {
  it("should refuse on crosshair", () => {
    const model = mount();
    const cursor = model.plot.use(crosshair());
    cursor.dispose();

    expect(() => cursor.applyOptions({ horizontal: false })).toThrow();
  });

});

/** The merge rule is one level deep, and it behaves the same across extensions. */
describe("one-level merge", () => {
  it("should replace a nested option wholesale", () => {
    const model = mount();
    const cursor = model.plot.use(crosshair());
    model.plot.crosshair({ x: 300, y: 200 });

    cursor.applyOptions({ format: { x: () => "X-FORMAT" } });
    cursor.applyOptions({ format: { y: () => "Y-FORMAT" } });
    model.plot.render();

    const texts = model
      .commands()
      .filter((command) => command.type === "drawText")
      .map((command) => command.params.text);

    // It's a wholesale replace — the x format is gone after the second patch.
    expect(texts).toContain("Y-FORMAT");
    expect(texts).not.toContain("X-FORMAT");
  });

  it("should reset a key given as undefined", () => {
    const model = mount();
    const cursor = model.plot.use(crosshair());
    model.plot.crosshair({ x: 300, y: 200 });

    cursor.applyOptions({ format: { x: () => "PINNED" } });
    cursor.applyOptions({ format: undefined });
    model.plot.render();

    const texts = model
      .commands()
      .filter((command) => command.type === "drawText")
      .map((command) => command.params.text);
    expect(texts).not.toContain("PINNED");
  });
});
