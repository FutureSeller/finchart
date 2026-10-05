#!/usr/bin/env node
/**
 * Published entrypoints must enumerate exports explicitly. Wildcard exports can expose
 * internal helpers accidentally. This repository check spans multiple packages.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const ENTRYPOINTS = {
  core: ["src/index.ts", "src/headless.ts", "src/authoring.ts"],
  dom: ["src/index.ts"],
  indicators: ["src/index.ts"],
  react: ["src/index.ts"],
  tools: ["src/index.ts"],
};

/**
 * Match statements at line starts so comments mentioning wildcard exports do not
 * trigger the rule.
 */
const REEXPORT_ALL = /^export\s+(type\s+)?\*/m;

const failures = [];

for (const [pkg, entries] of Object.entries(ENTRYPOINTS)) {
  for (const entry of entries) {
    const path = `packages/${pkg}/${entry}`;
    const source = readFileSync(resolve(root, path), "utf8");
    const match = REEXPORT_ALL.exec(source);
    if (match) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${path}:${line} — ${match[0].trim()}...`);
    }
  }
}

if (failures.length > 0) {
  console.error("\nPublic barrels contain wildcard exports:\n");
  for (const line of failures) console.error(`  ✗ ${line}`);
  console.error(
    "\n`export *` can publish internal helpers added to a module index.",
  );
  console.error("Enumerate exported names so public API changes are explicit.\n");
  process.exit(1);
}

console.log(`Explicit public exports checked for ${Object.keys(ENTRYPOINTS).length} packages`);
