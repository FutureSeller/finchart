#!/usr/bin/env node
/**
 * Shared CSS variables must use consistent fallback values across package declarations.
 * Scan source text without introducing cross-package imports. Count floors guard
 * traversal and matching.
 */
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = process.cwd();
const PACKAGES = ["core", "dom", "indicators", "tools", "react"];

function sourcesIn(dir) {
  let entries;
  try {
    entries = readdirSync(resolve(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "node_modules") return [];
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourcesIn(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** Match flat css/fallback leaf objects. Count floors guard this structural assumption. */
const LEAF = /\{\s*css:\s*"(--chart-[a-z0-9-]+)"\s*,\s*fallback:\s*("[^"]*"|-?[\d.]+)/g;

/** CSS variable name to fallback values and their source locations. */
const declarations = new Map();
let leaves = 0;

for (const pkg of PACKAGES) {
  for (const file of sourcesIn(`packages/${pkg}/src`)) {
    const flat = readFileSync(resolve(root, file), "utf8").replace(/\s+/g, " ");
    for (const [, name, fallback] of flat.matchAll(LEAF)) {
      leaves += 1;
      const byValue = declarations.get(name) ?? new Map();
      byValue.set(fallback, [...(byValue.get(fallback) ?? []), relative(root, file)]);
      declarations.set(name, byValue);
    }
  }
}

const split = [...declarations]
  .filter(([, byValue]) => byValue.size > 1)
  .map(([name, byValue]) =>
    `${name}: ${[...byValue].map(([v, files]) => `${v} ← ${files.join(", ")}`).join(" / ")}`,
  );

if (split.length > 0) {
  console.error("Shared CSS variables have inconsistent fallback values:");
  for (const line of split) console.error(`  ${line}`);
  console.error("\nA shared CSS variable must use the same fallback everywhere it is declared.");
  process.exit(1);
}

const shared = [...declarations.values()].filter(
  (byValue) => [...byValue.values()].flat().length > 1,
).length;

const LEAF_FLOOR = 50;
const SHARED_FLOOR = 2;
if (leaves < LEAF_FLOOR || shared < SHARED_FLOOR) {
  console.error(
    `style-vars-check: ${leaves} leaves (floor: ${LEAF_FLOOR}), ${shared} shared names (floor: ${SHARED_FLOOR}); ` +
      "The scan may no longer match the leaf structure; empty coverage must not pass.",
  );
  process.exit(1);
}

console.log(`style-vars-check: ${leaves} leaves, ${shared} shared names, all with consistent fallbacks`);
