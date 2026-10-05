#!/usr/bin/env node
/**
 * Ensure package metadata, public prose, and site configuration point to
 * FutureSeller/finchart. Redirects can mask outdated URLs. This checks repository
 * identity, not URL availability.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const PACKAGES = ["core", "dom", "indicators", "react", "tools"];

/** The repository targeted by published links. */
const TARGET_REPO = "FutureSeller/finchart";

const failures = [];

for (const pkg of PACKAGES) {
  const path = `packages/${pkg}/package.json`;
  const manifest = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const urls = {
    "repository.url": manifest.repository?.url,
    homepage: manifest.homepage,
    "bugs.url": manifest.bugs?.url,
  };
  for (const [field, url] of Object.entries(urls)) {
    if (url !== undefined && !url.includes(TARGET_REPO)) {
      failures.push(`${path} — ${field} does not point to ${TARGET_REPO}: ${url}`);
    }
  }
}

/** Include public prose and site configuration as well as package manifests. */
/** Extract and compare both owner and repository names. */
const REPO_URL = /github\.com\/([\w.-]+)\/([\w.-]+)/g;

/** Published prose and configuration; generated API pages are excluded. */
const SKIP_DIRS = new Set(["node_modules", "dist", "api", ".git", "coverage"]);
function proseFiles(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return proseFiles(path);
    return /\.(md|ts|tsx|vue)$/.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

const SURFACES = ["apps/docs", "packages/core", "packages/dom", "packages/indicators", "packages/react", "packages/tools"];
const prose = ["README.md", "PRINCIPLES.md", ...SURFACES.flatMap((dir) => proseFiles(dir))];

/** The floor detects a collapsed scan. */
if (prose.length < 50) {
  console.error(`repo-url-check: only ${prose.length} prose files scanned; the scope has collapsed`);
  process.exit(1);
}

for (const file of prose) {
  const text = readFileSync(resolve(root, file), "utf8");
  for (const [, owner, named] of text.matchAll(REPO_URL)) {
    // A .git suffix refers to the same repository.
    const pair = `${owner}/${named.replace(/\.git$/, "")}`;
    if (pair === TARGET_REPO) continue;
    failures.push(`${file} — github.com/${pair} (→ ${TARGET_REPO})`);
  }
}

if (failures.length > 0) {
  console.error(`Published URLs do not match the target repository (${TARGET_REPO}):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}

const origin = execFileSync("git", ["remote", "get-url", "origin"], {
  cwd: root,
  encoding: "utf8",
}).trim();

console.log(
  `Published URLs match ${TARGET_REPO}: ${PACKAGES.length} packages, ${prose.length} public prose files`,
);
if (!origin.includes(TARGET_REPO)) {
  console.log(`(origin: ${origin})`);
}
