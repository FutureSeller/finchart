#!/usr/bin/env node
/**
 * Pack every runtime package with pnpm and validate manifests, files, source maps,
 * export targets, and peer compatibility. Use --consume to install the tarballs and run
 * ESM and CJS consumer checks.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const PACKAGES = ["core", "dom", "indicators", "react", "tools"];

const failures = [];
const fail = (pkg, what) => failures.push(`${pkg}: ${what}`);
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** npm tarball entries are prefixed with package/. */
function entriesOf(tarball) {
  return run("tar", ["-tzf", tarball])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => path.replace(/^package\//, ""));
}

/** Unpack each tarball once to avoid decompressing it separately for every file. */
const unpacked = new Map();

function unpack(tarball) {
  let dir = unpacked.get(tarball);
  if (dir === undefined) {
    dir = mkdtempSync(join(tmpdir(), "release-artifact-"));
    run("tar", ["-xzf", tarball, "-C", dir]);
    unpacked.set(tarball, dir);
  }
  return dir;
}

function fileFrom(tarball, path) {
  return readFileSync(join(unpack(tarball), "package", path), "utf8");
}

/** Collect file targets recursively from conditional export maps. */
function exportTargets(value, found = []) {
  if (typeof value === "string") {
    if (value.startsWith("./")) found.push(value.slice(2));
    return found;
  }
  if (typeof value === "object" && value !== null) {
    for (const nested of Object.values(value)) exportTargets(nested, found);
  }
  return found;
}

function checkTarball(pkg, tarball) {
  const entries = new Set(entriesOf(tarball));
  const manifestRaw = fileFrom(tarball, "package.json");
  const manifest = JSON.parse(manifestRaw);

  // The registry cannot resolve workspace: dependency protocols.
  if (manifestRaw.includes("workspace:")) {
    const leaked = [
      ...Object.entries(manifest.dependencies ?? {}),
      ...Object.entries(manifest.peerDependencies ?? {}),
    ]
      .filter(([, range]) => String(range).includes("workspace:"))
      .map(([name, range]) => `${name}@${range}`);
    fail(pkg, `Tarball contains unresolved workspace: protocols → ${leaked.join(", ")}`);
  }

  if (!entries.has("README.md")) fail(pkg, "README.md is missing; the npm page would have no readme");

  // pnpm can copy the license from the workspace root.
  // Still verify inclusion so a packaging tool change cannot silently drop it.
  if (!entries.has("LICENSE")) {
    fail(pkg, `LICENSE is missing despite declaring license: "${manifest.license}"`);
  }

  /** Every shipped source map must include the source files it references. */
  for (const entry of entries) {
    if (!entry.endsWith(".map")) continue;
    const { sources = [] } = JSON.parse(fileFrom(tarball, entry));
    const dir = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/")) : "";
    for (const source of sources) {
      const target = resolve("/", dir, source).slice(1);
      if (!entries.has(target)) {
        fail(pkg, `${entry} references ${target}, which is missing from the tarball`);
      }
    }
  }

  /**
   * Check the reverse direction too: shipped JavaScript and declarations must not
   * reference missing source maps.
   */
  for (const entry of entries) {
    if (!/\.(d\.[cm]?ts|js|mjs|cjs)$/.test(entry)) continue;
    const reference = /\/\/# sourceMappingURL=(.+?)[ \t]*$/m.exec(
      fileFrom(tarball, entry),
    );
    if (!reference) continue;
    const url = reference[1].trim();
    // Inline data maps are self-contained.
    if (url.startsWith("data:")) continue;
    const dir = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/")) : "";
    const target = resolve("/", dir, url).slice(1);
    if (!entries.has(target)) {
      fail(pkg, `${entry} references source map ${target}, which is missing from the tarball`);
    }
  }

  // Verify that every declared entrypoint is packaged.
  const targets = new Set([
    ...exportTargets(manifest.exports ?? {}),
    ...["main", "module", "types"]
      .map((field) => manifest[field])
      .filter((value) => typeof value === "string")
      .map((value) => value.replace(/^\.\//, "")),
  ]);
  for (const target of targets) {
    if (!entries.has(target)) fail(pkg, `Entrypoint ${target} is missing from the tarball`);
  }
}

/** Validate required npm metadata and URL shape. URL availability is outside this check. */
function checkMetadata(pkg, tarball) {
  const manifest = JSON.parse(fileFrom(tarball, "package.json"));

  if (typeof manifest.description !== "string" || manifest.description.length < 20) {
    fail(pkg, "description is missing or too short for npm search results");
  }
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length < 3) {
    fail(pkg, "At least three keywords are required for npm discoverability");
  }
  for (const field of ["homepage", "bugs"]) {
    const value = manifest[field];
    const url = typeof value === "string" ? value : value?.url;
    if (typeof url !== "string" || !url.startsWith("https://")) {
      fail(pkg, `${field} is not an HTTPS URL`);
    }
  }
  const repo = manifest.repository;
  // npm accepts git+https repository URLs.
  // Plain HTTPS repository URLs are accepted too.
  if (typeof repo?.url !== "string" || !/^(git\+)?https:\/\//.test(repo.url)) {
    fail(pkg, "repository.url is not an HTTPS URL");
  }
  // repository.directory points consumers to the package folder in a monorepo.
  if (typeof repo?.directory !== "string") {
    fail(pkg, "repository.directory is missing; npm would link to the repository root");
  }
}

/**
 * All runtime packages must share a version and accept each other through their actual
 * packed peer ranges.
 */
function checkLockstep(packed) {
  const versions = new Map();
  for (const { tarball } of packed) {
    const manifest = JSON.parse(fileFrom(tarball, "package.json"));
    versions.set(manifest.name, manifest.version);
  }

  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    fail(
      "lockstep",
      `Runtime packages do not share a version — ${[...versions].map(([n, v]) => `${n}@${v}`).join(" · ")}. ` +
        `Check the fixed group in .changeset/config.json`,
    );
  }

  // Validate co-released peer versions; caret ranges are narrower for 0.x.
  for (const { pkg, tarball } of packed) {
    const manifest = JSON.parse(fileFrom(tarball, "package.json"));
    for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
      const version = versions.get(dep);
      if (version === undefined) continue; // External peer, such as React.
      if (range.startsWith("workspace:")) {
        fail(pkg, `Peer ${dep} contains an unresolved workspace: protocol and cannot be installed`);
        continue;
      }
      const verdict = caretVerdict(version, range);
      if (verdict === "rejects") {
        fail(
          pkg,
          `Peer ${dep}@"${range}" rejects co-released ${dep}@${version}`,
        );
      } else if (verdict === "unknown") {
        // Report unsupported ranges as unverified rather than incompatible.
        // Extend the predicate explicitly when adopting another range syntax.
        fail(
          pkg,
          `Peer ${dep}@"${range}" uses unsupported range syntax; ` +
            `verify manually that it accepts ${dep}@${version}, ` +
            `then extend the caretVerdict truth table before adopting that syntax`,
        );
      }
    }
  }
}

/**
 * Check the peer predicate against its truth table before packing, or independently
 * with --self-test.
 */
const VERDICT_CASES = [
  // Accepted versions.
  ["0.1.0", "^0.1.0", "accepts"],
  ["0.1.5", "^0.1.0", "accepts"],
  ["1.2.3", "^1.0.0", "accepts"],
  ["0.1.0", "0.1.0", "accepts"],
  // Rejected versions, including narrow 0.x caret ranges.
  ["0.2.0", "^0.1.0", "rejects"],
  ["0.0.2", "^0.0.1", "rejects"],
  ["2.0.0", "^1.0.0", "rejects"],
  ["0.1.0", "0.2.0", "rejects"],
  // Unsupported ranges remain unknown rather than rejected.
  ["0.1.0", ">=0.1.0", "unknown"],
  ["0.1.0", "*", "unknown"],
  ["0.1.0", "^0.1", "unknown"],
  ["0.1.0-beta.1", "^0.1.0-beta.1", "unknown"],
  ["0.1.0", "^0.1.0 || ^0.2.0", "unknown"],
  ["0.1.5", "~0.1.0", "unknown"],
];

function selfTest() {
  const wrong = VERDICT_CASES.filter(
    ([version, range, expected]) => caretVerdict(version, range) !== expected,
  );
  if (wrong.length > 0) {
    for (const [version, range, expected] of wrong) {
      console.error(
        `  ${version} vs "${range}" — expected ${expected}, received ${caretVerdict(version, range)}`,
      );
    }
    console.error(`Peer predicate disagrees with ${wrong.length} truth-table cases`);
    process.exit(1);
  }
}

const EXACT = /^\d+\.\d+\.\d+$/;
const CARET = /^\^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Return accepted, rejected, or unknown for exact and caret ranges. This predicate does
 * not implement all semver syntax.
 */
function caretVerdict(version, range) {
  // Prerelease and build metadata are outside this predicate.
  // Do not approximate their semver ordering rules.
  if (!EXACT.test(version)) return "unknown";
  if (EXACT.test(range)) return version === range ? "accepts" : "rejects";

  const caret = CARET.exec(range);
  // Other range syntax, including ~, >=, *, ||, and partial versions, is unsupported.
  // Return unknown rather than claiming rejection.
  if (!caret) return "unknown";

  const [, rMajor, rMinor, rPatch] = caret.map(Number);
  const [vMajor, vMinor, vPatch] = version.split(".").map(Number);

  if (vMajor !== rMajor) return "rejects";
  if (rMajor > 0) {
    const ok = vMinor > rMinor || (vMinor === rMinor && vPatch >= rPatch);
    return ok ? "accepts" : "rejects";
  }
  // A caret range on 0.x fixes the minor version.
  if (vMinor !== rMinor) return "rejects";
  if (rMinor > 0) return vPatch >= rPatch ? "accepts" : "rejects";
  // A caret range on 0.0.x also fixes the patch version.
  return vPatch === rPatch ? "accepts" : "rejects";
}

// ---------------------------------------------------------------------------

selfTest();

// Self-test mode skips tarball packing.
if (process.argv.includes("--self-test")) {
  console.log("Peer predicate: all %d truth-table cases passed", VERDICT_CASES.length);
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), "charts-artifact-"));
let packed;

try {
  packed = PACKAGES.map((pkg) => {
    const dir = join(ROOT, "packages", pkg);
    // Use pnpm pack to replace workspace protocols with published version ranges.
    // The packaging tool is part of this contract.
    run("pnpm", ["pack", "--pack-destination", out], dir);
    /**
     * Derive the tarball filename from the manifest scope, name, and version. Default
     * mode validates tarballs; --consume additionally installs them.
     */
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const name = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
    return { pkg, tarball: join(out, name) };
  });

  for (const { pkg, tarball } of packed) checkTarball(pkg, tarball);

  checkLockstep(packed);
  for (const { pkg, tarball } of packed) checkMetadata(pkg, tarball);

  // -------------------------------------------------------------------------
  // Consumer installation requires network access.
  // -------------------------------------------------------------------------
  if (process.argv.includes("--consume")) {
    const app = join(out, "consumer");
    mkdirSync(app, { recursive: true });

    writeFileSync(
      join(app, "package.json"),
      JSON.stringify(
        {
          name: "cold-consumer",
          version: "1.0.0",
          private: true,
          type: "module",
          dependencies: {
            ...Object.fromEntries(
              packed.map(({ pkg, tarball }) => [`@finchart/${pkg}`, `file:${tarball}`]),
            ),
            // Install the React peers needed by the consumer entrypoint smoke checks.
            react: "18.3.1",
          },
        },
        null,
        2,
      ),
    );

    // Strict pnpm resolution requires dependencies to be declared.
    run("pnpm", ["install", "--ignore-workspace", "--no-lockfile"], app);

    /** Assert that rendering produces actual commands in addition to successful imports. */
    writeFileSync(
      join(app, "smoke.mjs"),
      `import { createPlotModel, lineSeries } from "@finchart/core";
import { sma } from "@finchart/indicators";
import { serializeDrawings } from "@finchart/tools";
import { browserDeps } from "@finchart/dom";
import { ChartContainer } from "@finchart/react";

const model = createPlotModel({
  size: { width: 800, height: 600 },
  series: { series: lineSeries(), data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
});
const commands = model.commands();
if (!Array.isArray(commands) || commands.length === 0) {
  throw new Error("ESM: no rendering commands");
}
if (sma([1, 2, 3], 2).length !== 3) throw new Error("Invalid indicators output");
if (!serializeDrawings([]).includes("version")) throw new Error("Invalid tools output");
// Validate the DOM and React entrypoints advertised in the README.
// Node has no DOM for mounting, so check the exported values.
// Successful imports alone do not prove the exports are usable.
if (typeof browserDeps !== "function") throw new Error("Invalid DOM entrypoint");
if (typeof ChartContainer !== "function") throw new Error("Invalid React entrypoint");
console.log("ESM passed: rendering commands = " + commands.length + "");
`,
    );

    writeFileSync(
      join(app, "smoke.cjs"),
      `const { createPlotModel, lineSeries } = require("@finchart/core");
const { browserDeps } = require("@finchart/dom");
const { ChartContainer } = require("@finchart/react");
if (typeof browserDeps !== "function") throw new Error("CJS: invalid DOM entrypoint");
if (typeof ChartContainer !== "function") throw new Error("CJS: invalid React entrypoint");
const model = createPlotModel({
  size: { width: 800, height: 600 },
  series: { series: lineSeries(), data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
});
if (model.commands().length === 0) throw new Error("CJS: no rendering commands");
console.log("CJS passed: rendering commands = " + model.commands().length + "");
`,
    );

    // An empty smoke list must not pass.
    // Installation alone does not prove that consumer code ran.
    const smokes = [
      ["smoke.mjs", "ESM"],
      ["smoke.cjs", "CJS"],
    ];
    // Require distinct ESM and CJS descriptors.
    // Two copies of the ESM descriptor do not cover CJS.
    // Validate the configured smokes against the required pair.
    const required = [
      ["smoke.mjs", "ESM"],
      ["smoke.cjs", "CJS"],
    ];
    const have = new Set(smokes.map(([file, label]) => `${file}:${label}`));
    const absent = required.filter(([file, label]) => !have.has(`${file}:${label}`));
    if (absent.length > 0 || have.size !== smokes.length) {
      throw new Error(
        `Consumer smokes must cover both ESM and CJS (found: ${[...have].join(", ") || "none"})`,
      );
    }
    for (const [file, label] of smokes) {
      try {
        process.stdout.write(run("node", [file], app));
      } catch (error) {
        fail("consumer", `${label} smoke failed — ${error.stderr || error.message}`);
      }
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
  // Clean up the cached unpacked tarballs.
  for (const dir of unpacked.values()) rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("\nRelease artifact contract violations:\n");
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}

console.log(
  `Release artifact contract passed: ${PACKAGES.length} tarballs${
    process.argv.includes("--consume") ? " + clean consumer installation and execution" : ""
  }`,
);
