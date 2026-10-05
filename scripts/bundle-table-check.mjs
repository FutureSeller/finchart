#!/usr/bin/env node
/**
 * The "what a chart costs" table in the docs is the budget file, rendered.
 *
 * `explicit-wiring.md` is the one page that quotes bundle sizes to a
 * consumer, and a size in prose is the classic dead number — right on the day
 * it is typed, and nothing notices when the code moves under it. So the page
 * carries no sizes of its own: every row restates a `limit` from
 * `apps/examples/.size-limit.json`, and this check holds the two together.
 *
 * That file is where the consumer scenarios live because **size-limit
 * silently externalizes a package's own `peerDependencies`** (`get-config.js`
 * prepends them to `ignore`, with no way to opt out). Measured from inside
 * `packages/react`, "one chart" reports 2 KB — core and dom are peers, so the
 * engine is simply not in the number. `apps/examples` declares all five
 * packages as ordinary dependencies and has no peers of its own, so a
 * scenario measured there is what a consumer downloads.
 *
 * Three things are checked, each a different way for the table to go quietly
 * wrong:
 *
 * 1. **Every row matches a budget, in order, and there are exactly as many
 *    rows as budgets.** A scenario with no row, or a row with no scenario, is
 *    the drift this exists for.
 * 2. **The numbers inside the budget names are current.** Each name ends in
 *    `(NNNNNB measured)` — a hand-written note no other check reads. This one
 *    measures for real and compares.
 * 3. **Every scenario sits within 5% of its ceiling**, because the page says
 *    so in prose. Headroom that drifts wide turns a ceiling the reader was
 *    told to read as a size into a number that means nothing.
 *
 * Needs the packages built — the gate runs `turbo run … size` first.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const docPath = "apps/docs/guide/explicit-wiring.md";
const budgetPath = "apps/examples/.size-limit.json";
const HEADROOM = 0.05;

const doc = readFileSync(resolve(root, docPath), "utf8");
const budgets = JSON.parse(readFileSync(resolve(root, budgetPath), "utf8"));

const section = doc
  .split("<!-- bundle-budgets:start -->")[1]
  ?.split("<!-- bundle-budgets:end -->")[0];

if (!section) {
  console.error(`${docPath}: no bundle-budgets marker section`);
  process.exit(1);
}

/** Rows of the marked table, minus the header and the alignment row. */
const rows = [...section.matchAll(/^\|(.+)\|(.+)\|$/gm)]
  .map(([, label, size]) => ({ label: label.trim(), size: size.trim() }))
  .filter((row) => row.size !== "Download, gzipped" && !/^-+:?$/.test(row.size));

if (rows.length !== budgets.length) {
  console.error(
    `${docPath}: ${rows.length} table rows against ${budgets.length} budgets in ${budgetPath}. ` +
      "Every scenario the budget file measures is a row on that page, and nothing else is.",
  );
  process.exit(1);
}

/** `size-limit` prints kB base 1000, and `bytes.parse("24.5 KB")` is 24500. */
function bytesOf(limit) {
  const match = /^([\d.]+)\s*(B|KB)$/.exec(limit);
  if (!match) throw new Error(`${budgetPath}: cannot read limit "${limit}"`);
  return Number(match[1]) * (match[2] === "KB" ? 1000 : 1);
}

const mismatched = [];
for (const [index, row] of rows.entries()) {
  const limit = budgets[index].limit;
  if (row.size !== limit.replace(/\s+/g, " ")) {
    mismatched.push(`  row ${index + 1} says ${row.size} — the budget is ${limit}`);
  }
}

if (mismatched.length > 0) {
  console.error(`${docPath}: table numbers are not the budgets:`);
  for (const line of mismatched) console.error(line);
  console.error(`\nThe numbers live in ${budgetPath}. The page restates them.`);
  process.exit(1);
}

const measured = JSON.parse(
  execFileSync("npx", ["size-limit", "--json"], {
    cwd: resolve(root, "apps/examples"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);

/**
 * Require unique names and equal membership between budgets and measurements.
 * Unbudgeted measurements must not bypass headroom checks.
 */
const measuredNames = measured.map((entry) => entry.name);
const budgetNames = budgets.map((budget) => budget.name);
// Check uniqueness separately in budgets and measurements.
const twice = (names) => names.filter((name, index) => names.indexOf(name) !== index);
const duplicated = [...new Set([...twice(measuredNames), ...twice(budgetNames)])];
const unknown = measuredNames.filter((name) => !budgetNames.includes(name));
const unmeasured = budgetNames.filter((name) => !measuredNames.includes(name));
if (duplicated.length > 0 || unknown.length > 0 || unmeasured.length > 0) {
  console.error(`${budgetPath} and size-limit measurements do not have matching unique names:`);
  for (const name of duplicated) console.error(`  duplicate name: ${name}`);
  for (const name of unknown) console.error(`  measurement without a budget: ${name}`);
  for (const name of unmeasured) console.error(`  budget without a measurement: ${name}`);
  process.exit(1);
}

const stale = [];
const loose = [];
for (const entry of measured) {
  const claimed = /\((\d+)B measured\)/.exec(entry.name);
  if (!claimed) {
    stale.push(`  ${entry.name} — no "(NNNNNB measured)" in the name`);
  } else if (Number(claimed[1]) !== entry.size) {
    stale.push(`  ${entry.name} — actually ${entry.size}B`);
  }
  const ceiling = bytesOf(
    budgets.find((budget) => budget.name === entry.name)?.limit ?? "0 B",
  );
  if (ceiling > 0 && (ceiling - entry.size) / ceiling > HEADROOM) {
    loose.push(
      `  ${entry.name} — ${entry.size}B under a ${ceiling}B ceiling ` +
        `(${(((ceiling - entry.size) / ceiling) * 100).toFixed(1)}% of headroom)`,
    );
  }
}

/**
 * The package budgets carry the same hand-written "(NNNNNB measured)" note,
 * and nothing else reads it — it went stale twice in one wave. Measure each
 * package that keeps a budget file and hold the note the same way (no
 * headroom rule there: a package budget is a ceiling, not a scenario).
 */
/**
 * **Every package that keeps a budget file — found, not listed.** Three of
 * the five were missing from the hand-written list this replaces, and two of
 * those had already drifted: core's note by 33 bytes, dom's by 24. A note
 * nothing reads is a note nothing keeps, and one of core's rows is the
 * tree-shaking canary, the only thing here that catches a module-level side
 * effect — exactly the growth a stale note hides.
 *
 * A list is the wrong shape for this. It goes stale the same way the notes
 * do, and silently: a package added with a budget simply never appears.
 * Reading the directory finds one wherever pnpm's workspace puts a package —
 * one level down, a real directory — without anyone listing it.
 */
// A directory is a package when it carries a manifest. Anything else under
// `packages/` — a scratch directory, an editor's leavings — is not one and is
// not asked about; a manifest that is there but will not parse still fails,
// loudly, further down.
const packages = readdirSync(resolve(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`)
  .filter((pkg) => existsSync(resolve(root, pkg, "package.json")))
  .sort();
const budgeted = packages.filter((pkg) => existsSync(resolve(root, pkg, ".size-limit.json")));

// **Discovery must not be a way out either.** The list failed by omission;
// discovery would fail the same way if a budget file could simply go missing
// — deleted along with a package's budget, or never written for a new one —
// and the loop would shrink in silence. So every package that publishes has
// to turn up with one, and the check names any that did not. The policy is
// the repository's own: a package under `packages/` that is not `private`
// is one that publishes, and one that publishes keeps a budget.
const unbudgeted = packages
  .filter((pkg) => !JSON.parse(readFileSync(resolve(root, pkg, "package.json"), "utf8")).private)
  .filter((pkg) => !budgeted.includes(pkg));
if (unbudgeted.length > 0) {
  console.error(`bundle-table-check: a published package keeps no .size-limit.json: ${unbudgeted.join(", ")}`);
  process.exit(1);
}

for (const pkg of budgeted) {
  // Named on purpose — a budget file that is missing or will not parse fails here, loudly.
  const pkgBudgets = JSON.parse(readFileSync(resolve(root, pkg, ".size-limit.json"), "utf8"));
  const pkgMeasured = JSON.parse(
    execFileSync("npx", ["size-limit", "--json"], {
      cwd: resolve(root, pkg),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  // Apply the same uniqueness and membership checks to package measurements.
  const pkgNames = pkgMeasured.map((entry) => entry.name);
  const pkgBudgetNames = pkgBudgets.map((budget) => budget.name);
  for (const name of new Set([...twice(pkgNames), ...twice(pkgBudgetNames)])) {
    stale.push(`  ${pkg}: duplicate name — ${name}`);
  }
  for (const name of pkgNames.filter((name) => !pkgBudgetNames.includes(name))) {
    stale.push(`  ${pkg}: measurement without a budget — ${name}`);
  }
  for (const name of pkgBudgetNames.filter((name) => !pkgNames.includes(name))) {
    stale.push(`  ${pkg}: budget without a measurement — ${name}`);
  }
  for (const entry of pkgMeasured) {
    const claimed = /\((\d+)B measured\)/.exec(entry.name);
    if (!claimed) stale.push(`  ${pkg}: ${entry.name} — no "(NNNNNB measured)" in the name`);
    else if (Number(claimed[1]) !== entry.size) stale.push(`  ${pkg}: ${entry.name} — actually ${entry.size}B`);
  }
  if (pkgBudgets.length !== pkgMeasured.length) stale.push(`  ${pkg}: ${pkgBudgets.length} budgets, ${pkgMeasured.length} measured`);
}

if (stale.length > 0) {
  console.error(`${budgetPath}: the measured note in a name is out of date:`);
  for (const line of stale) console.error(line);
  process.exit(1);
}

if (loose.length > 0) {
  console.error(
    `${budgetPath}: a budget has drifted more than ${HEADROOM * 100}% above what it measures:`,
  );
  for (const line of loose) console.error(line);
  console.error(
    `\n${docPath} tells the reader every row measures within ${HEADROOM * 100}% of its number. ` +
      "Lower the ceiling, or change the sentence.",
  );
  process.exit(1);
}

console.log(
  `bundle-table-check: ${rows.length} rows, ${measured.length} budgets, ${budgeted.length} package budget files, every number live`,
);
