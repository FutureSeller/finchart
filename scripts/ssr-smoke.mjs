/**
 * Import built distribution files and produce rendering commands in Node without
 * browser globals. Run after the build to check server and worker compatibility.
 */
import assert from "node:assert/strict";

assert.equal(typeof globalThis.document, "undefined", "Test precondition: no DOM globals");

// Inspect shipped distribution files directly rather than workspace source resolution.
const { createPlotModel, lineSeries } = await import(
  new URL("packages/core/dist/index.mjs", `file://${process.cwd()}/`)
);

const model = createPlotModel({
  size: { width: 400, height: 300 },
  series: {
    series: lineSeries(),
    data: [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 15 },
    ],
  },
  config: { showGrid: false },
});

const line = model.commands().find((command) => command.type === "drawLine");
assert.ok(line, "The headless frame must contain a line command");
assert.equal(line.points.length, 3);

console.log("SSR smoke passed: imports and rendering commands work without a DOM");
