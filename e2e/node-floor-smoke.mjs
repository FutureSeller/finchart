/**
 * What a consumer on the declared Node floor (`engines.node >=20.19`) does
 * first, run against the built packages — CI runs it on that floor after
 * building on the repository's own Node.
 *
 * 1. Import the headless core from its dist and draw a frame with no DOM.
 * 2. Resolve every package's manifest by name (`<name>/package.json`), from
 *    inside the package so the published `exports` map answers — tooling
 *    asks for manifests this way, and an `exports` map that does not list
 *    it makes Node refuse with ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * Run from the repository root: `node e2e/node-floor-smoke.mjs`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const root = `file://${process.cwd()}/`;

assert.equal(typeof globalThis.document, "undefined", "no DOM on this path");
const { createPlotModel, lineSeries } = await import(new URL("packages/core/dist/index.mjs", root));
const model = createPlotModel({
  size: { width: 400, height: 300 },
  series: { series: lineSeries(), data: [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 15 }] },
  config: { showGrid: false },
});
const line = model.commands().find((command) => command.type === "drawLine");
assert.ok(line, "a headless frame draws the line");
assert.equal(line.points.length, 3);

const packages = ["core", "dom", "react", "tools", "indicators"];
for (const dir of packages) {
  const manifest = new URL(`packages/${dir}/package.json`, root);
  const { name } = JSON.parse(readFileSync(manifest, "utf8"));
  const resolved = createRequire(manifest).resolve(`${name}/package.json`);
  assert.equal(resolved, manifest.pathname, `${name}/package.json resolves to its own manifest`);
}

console.log(`node floor smoke (${process.version}): headless frame drawn, ${packages.length} manifests resolve`);
