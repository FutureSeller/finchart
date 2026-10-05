#!/usr/bin/env node
/**
 * Validate fragments in public documentation links. VitePress checks page paths but not
 * fragments. The slug function matches @mdit-vue/shared bundled with VitePress 1.6.4.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Heading slug implementation from @mdit-vue/shared in VitePress 1.6.4.
// oxlint-disable-next-line no-control-regex -- Match VitePress control-character removal so heading IDs agree.
const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[̀-ͯ]/g;
const slugify = (str) =>
  str
    .normalize("NFKD")
    .replace(rCombining, "")
    .replace(rControl, "")
    .replace(rSpecial, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();

const ROOT = process.cwd();
const DOCS = "apps/docs";

/** Exclude generated TypeDoc pages, which are overwritten on each build. */
const SKIP = new Set(["node_modules", "dist", "api", ".vitepress"]);

function walk(dir) {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/** The URL path at which VitePress serves this page. */
const routeOf = (file) =>
  "/" + file.replace(`${DOCS}/`, "").replace(/\.md$/, "").replace(/\/index$/, "/");

/** Heading IDs use rendered text: remove inline code and link markup before slugging. */
const headingText = (raw) =>
  raw.replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

const files = walk(DOCS);
let checked = 0; // Internal anchors inspected by the validation loop.
const slugsOf = new Map();

for (const file of files) {
  // Comments inside fenced code blocks are not headings.
  const text = readFileSync(resolve(ROOT, file), "utf8").replace(/^```[\s\S]*?^```/gm, "");
  slugsOf.set(
    routeOf(file),
    new Set([...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slugify(headingText(m[1])))),
  );
}

const problems = [];

for (const file of files) {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const here = routeOf(file);

  for (const match of text.matchAll(/\]\(([^)\s]*#[^)\s]+)\)/g)) {
    const link = match[1];
    if (/^[a-z][\w+.-]*:/i.test(link)) continue; // External URLs are outside this check.
    checked += 1;

    const [path, hash] = link.split("#");
    const target = (
      path === ""
        ? here
        : path.startsWith("/")
          ? path
          : resolve(dirname(here), path)
    ).replace(/\.md$/, "");

    const slugs = slugsOf.get(target) ?? slugsOf.get(`${target}/`);
    if (!slugs) {
      problems.push(`${file}: ${link} — page does not exist (${target})`);
    } else if (!slugs.has(hash)) {
      problems.push(`${file}: #${hash} — heading does not exist in ${target}`);
    }
  }
}

/**
 * Apply the floor to anchors consumed by the validation loop, rather than a separate
 * discovery count.
 */
/**
 * The floor detects a collapsed scan. Adjust it explicitly in the same commit when
 * documentation consolidation legitimately reduces the count.
 */
const ANCHOR_FLOOR = 11;
if (checked < ANCHOR_FLOOR) {
  console.error(`docs-anchor-check: only ${checked} anchors checked (floor: ${ANCHOR_FLOOR}); the scan scope has collapsed`);
  process.exit(1);
}

if (problems.length > 0) {
  console.error("Documentation fragments do not point to headings:");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nUpdate inbound links when changing headings; VitePress does not validate fragments.",
  );
  process.exit(1);
}

console.log(`docs-anchor-check: all ${checked} anchors point to existing headings`);
