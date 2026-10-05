#!/usr/bin/env node
/**
 * Ensure the local gate includes commands from the CI check job. Omitted commands
 * require documented exemptions. Additional local checks are allowed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
/** Strip comments before checking command presence, so prose cannot satisfy a missing gate step. */
const gate = readFileSync(resolve(root, "scripts/gate.sh"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

/** Commands intentionally omitted from the local gate, with reasons. */
const EXEMPT = new Map([
  [
    "pnpm install --frozen-lockfile",
    "Dependencies must already be installed before running the local gate.",
  ],
  [
    'pnpm exec changeset status --since "$CHANGESET_BASE"',
    "CI compares a PR against its target branch; local commits do not always have a PR base. Maintainer review validates release scope.",
  ],
]);

/** Read run commands from the check job. Other CI jobs have separate responsibilities. */
function checkJobRuns(text) {
  const start = text.indexOf("\n  check:");
  if (start === -1) throw new Error("Cannot find the check job in ci.yml");
  // The next key at the same indentation ends this job.
  const rest = text.slice(start + 1);
  const nextJob = rest.search(/\n {2}[a-z][\w-]*:\n/);
  const body = nextJob === -1 ? rest : rest.slice(0, nextJob);
  return [...body.matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1].trim());
}

const missing = [];
for (const command of checkJobRuns(ci)) {
  if (EXEMPT.has(command)) continue;

  // Accept pnpm tasks included in a turbo run command.
  const viaPnpm = /^pnpm (?:run )?([\w:-]+)$/.exec(command);
  const found = viaPnpm
    ? gate.includes(command) ||
      new RegExp(`turbo run [^\\n]*\\b${viaPnpm[1]}\\b`).test(gate)
    : gate.includes(command);

  if (!found) missing.push(command);
}

if (missing.length > 0) {
  console.error("The local gate is missing CI check steps:");
  for (const command of missing) console.error(`  ${command}`);
  console.error(
    "\nAdd the steps to scripts/gate.sh or document an exemption in gate-parity-check.mjs EXEMPT.",
  );
  process.exit(1);
}

console.log(
  "Local gate and CI check job match (%d exemptions)",
  EXEMPT.size,
);
