/**
 * Changing an option must not require tearing down and rebuilding. Just
 * like the stage's own applyOptions, a plugin without that door would
 * force a detach-and-reattach for a single option change — for the
 * drawing toolbox, that means erasing every line the user drew.
 */
import { describe, expect, it, vi } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries } from "../../series";
import { crosshair } from "../../extensions/crosshair";
import { emitter } from "../../primitives";
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

/** The rules for an extension's notification channel: disposal, subscriber
 * isolation, unsubscribing mid-iteration — reinvented per extension, all
 * three end up inconsistent. */
describe("emitter", () => {
  it("should stop calling a listener that unsubscribed", () => {
    const changes = emitter<number>();
    const seen: number[] = [];
    const off = changes.subscribe((n) => seen.push(n));

    changes.emit(1);
    off();
    off(); // Safe to call twice
    changes.emit(2);

    expect(seen).toEqual([1]);
  });

  it("should not skip the next listener when one unsubscribes mid-emit", () => {
    const changes = emitter<void>();
    const seen: string[] = [];

    const off = changes.subscribe(() => {
      seen.push("first");
      off();
    });
    changes.subscribe(() => seen.push("second"));

    changes.emit();

    // Iterating the original array as-is would shift the index and skip second.
    expect(seen).toEqual(["first", "second"]);
  });

  it("should call every listener even when one throws", () => {
    const changes = emitter<void>();
    const second = vi.fn();

    changes.subscribe(() => {
      throw new Error("boom");
    });
    changes.subscribe(second);

    expect(() => changes.emit()).toThrow("boom");
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("should report how many are listening", () => {
    const changes = emitter<void>();
    expect(changes.size).toBe(0);

    const off = changes.subscribe(() => {});
    expect(changes.size).toBe(1);

    off();
    expect(changes.size).toBe(0);
  });

  it("should not call listeners subscribed during the same emit", () => {
    const changes = emitter<void>();
    const late = vi.fn();

    changes.subscribe(() => changes.subscribe(late));
    changes.emit();

    // Otherwise a handler could keep growing itself forever.
    expect(late).not.toHaveBeenCalled();
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
