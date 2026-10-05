#!/usr/bin/env node
/**
 * Every docs page carries a `description`, so `llms.txt` stays useful.
 *
 * `vitepress-plugin-llms` regenerates `llms.txt`, `llms-full.txt` and a `.md`
 * twin of every page on each build, so none of that can go stale. Exactly one
 * input is hand-written: the `description` in a page's frontmatter, which
 * becomes the note after that page's link.
 *
 * Without it the entry is a bare `- [Theming](/guide/theme.md)` — a title an
 * agent has to open the page to interpret, which is the whole thing llms.txt
 * exists to avoid. And nothing fails when it is missing: the build stays green
 * and the file just gets quietly less useful, one page at a time. That is the
 * shape of rot this repo checks for elsewhere, so it is checked here too.
 *
 * The floor matters as much as the rule. If the glob ever stops matching, a
 * zero-page run would pass silently and report success — so a count below the
 * pages that exist today is itself a failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const DOCS = "apps/docs";

/**
 * `api/` is typedoc output — generated, gitignored, and excluded from llms.txt
 * by the plugin's own `ignoreFiles`. `.vitepress` is configuration, not pages.
 */
const SKIP = new Set(["api", ".vitepress", "dist", "node_modules", "snippets", "public"]);

function pages(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

const found = pages(DOCS);

/**
 * The home page is `layout: home` — a hero, not prose. The plugin takes the
 * site-level title and description for the llms.txt header from the VitePress
 * config, so this page needs no description of its own.
 */
const HOME = join(DOCS, "index.md");

const missing = [];
let inspected = 0; // Pages actually inspected; the home page is excluded.
for (const file of found) {
  if (file === HOME) continue;
  inspected += 1;
  const text = readFileSync(resolve(root, file), "utf8");
  const frontmatter = text.startsWith("---\n")
    ? text.slice(4, text.indexOf("\n---", 4))
    : "";
  // A key with nothing after it is the same as no key at all.
  if (!/^description:[^\S\n]*\S/m.test(frontmatter)) missing.push(file);
}

if (missing.length > 0) {
  console.error("docs pages without a `description` in frontmatter:");
  for (const file of missing) console.error(`  ${file}`);
  console.error("\nIt becomes the note after this page's link in llms.txt.");
  process.exit(1);
}

// Apply the floor to pages consumed by the validation loop.
// Discovery can remain nonempty even when frontmatter validation stops.
const FLOOR = 25;
if (inspected < FLOOR) {
  console.error(
    `llms-txt-check: only ${inspected} pages inspected — the floor is ${FLOOR}. ` +
      "The glob has stopped matching; a zero-page run would pass for free.",
  );
  process.exit(1);
}

console.log(`llms-txt-check: ${inspected} docs pages inspected, every one with a description`);
