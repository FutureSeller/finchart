/**
 * Verifies that the "test chart output directly" example in the READMEs
 * actually passes — by running the README's own code block, not a hand
 * copy of it. A copy only proves the copy; edit the README and a copy
 * stays green.
 *
 * `showGrid` defaults to `true`, and the grid also emits as `drawLine` —
 * even with 5 data points, if grid lines get mixed in, the first
 * `drawLine` is a 2-point grid line instead of the series, and the
 * example's claim breaks. That's why `showGrid: false` has to be in the
 * example. A `.types.ts` that only checks types isn't enough — this
 * assertion has to actually pass.
 *
 * The block runs through `new Function`, so it has to stay plain
 * JavaScript once its imports are dropped — a type annotation added to the
 * README snippet fails this test, which is the cue to keep the example
 * copy-pasteable into either language.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../data";
import type { PlotModel } from "../plot";
import { createPlotModel } from "../plot";
import { lineSeries } from "../series";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The first fenced code block in `file` that builds a model, with its
 * import lines dropped — the names they bring in are handed over by the
 * runner instead.
 */
function snippetOf(file: string): string {
  const text = readFileSync(resolve(REPO, file), "utf8");
  const block = [...text.matchAll(/```ts\n([\s\S]*?)```/g)]
    .map(([, body]) => body)
    .find((body) => body.includes("createPlotModel("));
  if (block === undefined) throw new Error(`${file} has no createPlotModel example`);
  return block
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n");
}

/**
 * Runs a README snippet with the free names it assumes (`size`, `data`,
 * and `expect` for the one that asserts), and hands back the model it
 * built.
 */
function run(file: string, data: LineDataPoint[]): PlotModel {
  let built: PlotModel | undefined;
  const capture = (options: Parameters<typeof createPlotModel>[0]) => {
    built = createPlotModel(options);
    return built;
  };
  const size = { width: 800, height: 600 };

  new Function("createPlotModel", "lineSeries", "size", "data", "expect", snippetOf(file))(
    capture,
    lineSeries,
    size,
    data,
    expect,
  );

  if (built === undefined) throw new Error(`${file}'s example never built a model`);
  return built;
}

describe("README proof — the example runs as written", () => {
  const data: LineDataPoint[] = [
    { x: 0, y: 10 },
    { x: 1, y: 20 },
    { x: 2, y: 15 },
    { x: 3, y: 25 },
    { x: 4, y: 18 },
  ];

  it.each(["README.md", "packages/core/README.md"])(
    "should hold in %s — the first drawLine is the series",
    (file) => {
      const model = run(file, data);

      const [line] = model.commands().filter((c) => c.type === "drawLine");
      expect(line.points).toHaveLength(data.length);
      model.plot.destroy();
    },
  );

  /** Nails down why the grid can't be left on — `showGrid: false` is not fluff. */
  it("should show why the grid has to be off", () => {
    const withGrid = createPlotModel({
      size: { width: 800, height: 600 },
      series: { series: lineSeries(), data: data.slice(0, 3) },
    });

    const lines = withGrid.commands().filter((c) => c.type === "drawLine");

    // The grid line comes before the series — this is what find() picks up.
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].points).not.toHaveLength(3);
    withGrid.plot.destroy();
  });
});
