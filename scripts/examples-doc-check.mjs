#!/usr/bin/env node
/**
 * **The docs gallery mirrors the example modules — by machine.**
 * `apps/docs/examples/<case>.md` renders the module's `description` live,
 * but its heading and `index.md`'s link text are hand copies of the
 * module's `title`. When the oscillators case was rewritten, the page and
 * the index kept the old title — and seven other pages had drifted long
 * before. Each page's heading and the index's link are held to the
 * module's exported `title`, and the sidebar entry in `.vitepress/config.ts`
 * to the title's head — the part before " — ". (The front-matter `description` is a
 * different text on purpose — the one-line summary the page metadata and
 * llms.txt carry — so it is not a mirror and is not checked here.)
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const failures = [];

const pages = readdirSync(resolve(root, "apps/docs/examples"))
  .filter((file) => file.endsWith(".md") && file !== "index.md")
  .map((file) => file.replace(/\.md$/, ""));
const index = read("apps/docs/examples/index.md");
// The sidebar is the fourth copy: its label is the title's head (the part
// before " — "), so a case renamed in its module renames its sidebar entry.
const sidebar = read("apps/docs/.vitepress/config.ts");

/**
 * The module's exported string — a double-quoted, single-quoted or backtick literal (no
 * interpolation).
 */
function literal(source, name) {
  const match = source.match(
    new RegExp(`export const ${name} =\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|\`((?:[^\`\\\\$]|\\\\.)*)\`)`),
  );
  if (!match) return null;
  const raw = match[1] ?? match[2] ?? match[3];
  return raw.replace(/\\(.)/g, "$1");
}

for (const page of pages) {
  const modulePath = `apps/examples/src/cases/${page}.ts`;
  let module;
  try {
    module = read(modulePath);
  } catch {
    failures.push(`${page}.md has no example module at ${modulePath}`);
    continue;
  }
  const title = literal(module, "title");
  if (title === null) {
    failures.push(`${modulePath} must export \`title\` as a string literal`);
    continue;
  }
  const doc = read(`apps/docs/examples/${page}.md`);
  const headings = [...doc.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
  if (headings.length !== 1) failures.push(`${page}.md has ${headings.length} top-level headings — a page is one example, one title`);
  const heading = headings[0] ?? null;
  if (heading !== title) failures.push(`${page}.md heading is "${heading}", the module's title is "${title}"`);
  if (!index.includes(`[${title}](/examples/${page})`)) failures.push(`index.md does not link ${page} as "${title}"`);
  const head = title.split(" — ")[0];
  const entry = sidebar.match(new RegExp(`\\{ text: "([^"]+)", link: "/examples/${page}" \\}`));
  if (!entry) failures.push(`the sidebar (.vitepress/config.ts) has no entry for /examples/${page}`);
  else if (entry[1] !== head) failures.push(`sidebar labels ${page} "${entry[1]}"; the title's head is "${head}"`);
}

if (failures.length > 0) {
  console.error("apps/docs/examples ↔ apps/examples/src/cases:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`examples-doc-check: ${pages.length} pages carry their module's title — heading, index and sidebar`);
