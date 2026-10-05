#!/usr/bin/env node
/**
 * The guide's table of series-data issue codes is the validator's code
 * list, rendered. `plot-contract.md` is the one page that names the codes
 * a consumer switches on, and a code in prose is the classic dead word —
 * true the day it is typed, unnoticed when the union moves. So the two are
 * held together here, at repository level, because a package test must not
 * reach into `apps/docs` (a package checkout has no guide to read —
 * `public-barrel-check` records the same rule).
 *
 * The code side is the `ISSUE_CODES` literal in `validate.ts`, which the
 * compiler already holds to the `SeriesDataIssueCode` union in both
 * directions; the doc side is every `| \`code\` |` row between the
 * `issue-codes` markers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const codePath = "packages/core/src/data/validate.ts";
const docPath = "apps/docs/guide/plot-contract.md";

const source = readFileSync(resolve(root, codePath), "utf8");
const literal = /const ISSUE_CODES = \[([\s\S]*?)\] as const/.exec(source);
if (!literal) {
  console.error(`${codePath}: could not find the ISSUE_CODES literal`);
  process.exit(1);
}
const inCode = [...literal[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();

const doc = readFileSync(resolve(root, docPath), "utf8");
const start = doc.indexOf("<!-- issue-codes:start -->");
const end = doc.indexOf("<!-- issue-codes:end -->");
if (start === -1 || end === -1 || end < start) {
  console.error(`${docPath}: the issue-codes markers are missing`);
  process.exit(1);
}
const inDoc = [...doc.slice(start, end).matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]).sort();

const missing = inCode.filter((code) => !inDoc.includes(code));
const stale = inDoc.filter((code) => !inCode.includes(code));
if (missing.length > 0 || stale.length > 0) {
  console.error(`${docPath} and ${codePath} disagree on the issue codes:`);
  for (const code of missing) console.error(`  not documented: ${code}`);
  for (const code of stale) console.error(`  documented but gone: ${code}`);
  process.exit(1);
}
console.log(`issue-codes-check: ${inCode.length} codes, table and union agree`);
