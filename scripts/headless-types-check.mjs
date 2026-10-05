/**
 * Compile built core declarations with ES2022, no DOM library, strict checking, and
 * skipLibCheck disabled. The DOM global allowlist is empty. Configuration lives in
 * headless-types-check.tsconfig.json.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ALLOWED_GLOBALS = new Set([]);

const repoRoot = process.cwd();
/**
 * Resolve from the repository root so the adjacent config's `files` entries
 * (`../packages/...`) point at this checkout's built declarations.
 */
const tsconfig = resolve(repoRoot, "scripts/headless-types-check.tsconfig.json");

/**
 * The subject has to exist. `files` naming a file that is not there makes tsc
 * report `error TS6053: File not found` — which carries no `(line,col)`, so
 * the parser below skipped it and the check passed over nothing. It did:
 * renaming the declaration output to `.d.mts` left this config pointing at a
 * path that no longer existed, and the gate stayed green.
 */
const subjects = JSON.parse(readFileSync(tsconfig, "utf8")).files ?? [];
const missing = subjects.filter(
  (file) => !existsSync(resolve(dirname(tsconfig), file)),
);
if (subjects.length === 0 || missing.length > 0) {
  console.error(
    "Headless type smoke: no files to check; " +
      (subjects.length === 0 ? "tsconfig files is empty" : missing.join(", ")),
  );
  process.exit(1);
}

const result = spawnSync("pnpm", ["exec", "tsc", "-p", tsconfig], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (result.error) {
  console.error("Cannot run tsc:", result.error.message);
  process.exit(1);
}

// A nonzero compiler exit must fail even when no TypeScript diagnostic was parsed.
// Executable, configuration, or signal failures can produce no diagnostic lines.
// Do not treat missing diagnostics as successful compilation.
if (result.status !== 0 && !/error TS\d+:/.test(`${result.stdout}\n${result.stderr}`)) {
  console.error(`tsc exited with code ${result.status} without diagnostic lines:`);
  console.error(`${result.stdout}\n${result.stderr}`.trim() || "  (no output)");
  process.exit(1);
}

// `dist/plot/plot.d.ts(42,17): error TS2304: Cannot find name 'HTMLElement'.`
const errorLine = /^(.+\(\d+,\d+\)): error TS(\d+): (.*)$/;

let allowedHits = 0;
const offenders = [];

for (const line of `${result.stdout}\n${result.stderr}`.split("\n")) {
  const match = errorLine.exec(line.trimEnd());
  if (!match) {
    // A tsc error with no position (config errors, TS6053) is still an error.
    if (/error TS\d+:/.test(line)) offenders.push(`  ${line.trimEnd()}`);
    continue;
  }

  const [, , code, message] = match;
  const name = /^Cannot find name '([^']+)'/.exec(message)?.[1];
  if (code === "2304" && name && ALLOWED_GLOBALS.has(name)) {
    allowedHits += 1;
    continue;
  }
  offenders.push(`  ${line.trimEnd()}`);
}

if (offenders.length > 0) {
  console.error(
    `Headless type smoke failed: allowlist (${[...ALLOWED_GLOBALS].join(", ")}); ${offenders.length} errors outside it:`,
  );
  for (const offender of offenders) console.error(offender);
  process.exit(1);
}

console.log(
  `Headless type smoke passed: no DOM globals in public core types (${allowedHits} allowlisted diagnostics)`,
);
