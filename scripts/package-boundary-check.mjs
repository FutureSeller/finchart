#!/usr/bin/env node
/**
 * No relative import may leave the workspace it is written in.
 *
 * `module-boundaries.test.ts` guards the direction between modules *inside*
 * core. Nothing guarded the direction between packages, and one import had
 * been reaching across for a while: `core/src/__tests__/style-vars.test.ts`
 * imported `../../../dom/src/legend`. It compiled, it passed, and it looked
 * like an implementation detail of a test.
 *
 * It was not. It put dom's sources into core's compile, which made core's
 * type-check depend on core's `dist` existing — a dependency the package
 * graph does not have and turbo therefore did not order. CI went red the day
 * the builder changed to one that empties `dist` before writing it.
 *
 * A `package.json` dependency is a declaration a machine can read: pnpm links
 * it, turbo orders it, `publint` checks it ships. A `../../../` is none of
 * those — it is the same edge, drawn where nothing is looking.
 *
 * The floor matters as much as the rule. If the walk ever stops finding
 * files, zero crossings would pass for free and this would report success
 * over an empty set.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = process.cwd();
const WORKSPACE_GLOBS = ["packages", "apps"];
const STANDALONE = ["e2e"];
const SKIP = new Set([
  "node_modules",
  "dist",
  ".turbo",
  "coverage",
  "test-results",
  ".vitepress",
  "api",
]);
const SOURCE = /\.(ts|tsx|mts|cts)$/;
/** `from "…"`, `import("…")`, and `vi.mock("…")` all take a specifier. */
const RELATIVE = /(?:from|import|require|vi\.mock)\s*\(?\s*["'](\.{1,2}\/[^"']*)["']/g;

function workspaces() {
  const found = [];
  for (const group of WORKSPACE_GLOBS) {
    let entries;
    try {
      entries = readdirSync(resolve(root, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) found.push(resolve(root, group, entry.name));
    }
  }
  for (const name of STANDALONE) {
    const path = resolve(root, name);
    try {
      if (statSync(path).isDirectory()) found.push(path);
    } catch {
      // Not every checkout has every standalone workspace.
    }
  }
  return found;
}

function sourcesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourcesIn(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

const crossings = [];
let scanned = 0;
let seen = 0;

for (const workspace of workspaces()) {
  for (const file of sourcesIn(workspace)) {
    scanned += 1;
    const text = readFileSync(file, "utf8");
    for (const [, specifier] of text.matchAll(RELATIVE)) {
      seen += 1; // Relative imports inspected by the validation loop.
      const target = resolve(file, "..", specifier);
      if (target === workspace || target.startsWith(`${workspace}/`)) continue;
      crossings.push(
        `${relative(root, file)}\n      → ${specifier}   (${relative(root, target)})`,
      );
    }
  }
}

if (crossings.length > 0) {
  console.error("Relative imports cross package boundaries:");
  for (const crossing of crossings) console.error(`  ${crossing}`);
  console.error(
    "\nDeclare cross-package dependencies in package.json and import them by package name;" +
      " this lets pnpm link packages and turbo order tasks.",
  );
  process.exit(1);
}

// The walk covers packages/*, apps/* and e2e in this checkout.
/**
 * Independent floors guard source traversal and import matching. A broken regex can
 * scan many files without validating any imports.
 */
/**
 * Adjust floors explicitly for legitimate package reorganizations. They detect
 * collapsed scans rather than measure code quality.
 */
const IMPORT_FLOOR = 800;
if (seen < IMPORT_FLOOR) {
  console.error(
    `package-boundary-check: only ${seen} relative imports inspected; the floor is ${IMPORT_FLOOR}. ` +
      "A broken import regex can scan files without validating imports.",
  );
  process.exit(1);
}

const FLOOR = 300;
if (scanned < FLOOR) {
  console.error(
    `package-boundary-check: only ${scanned} source files scanned; the floor is ${FLOOR}. ` +
      "An incomplete traversal must not pass silently.",
  );
  process.exit(1);
}

console.log(`Package boundaries checked: ${scanned} source files, ${seen} relative imports, no violations`);
