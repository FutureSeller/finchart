#!/usr/bin/env node
/**
 * **The indicators README's matrix is derived from the code, not typed.**
 * The README used to name eleven of twenty exports, and "which indicator
 * is safe at 20 ticks a second" could only be answered by reading the
 * source. A hand-written table would be right for one commit — the
 * package is about to double — so the table is a contract this check
 * holds against `factories.ts`:
 * 1. one row per factory (every `// --- Name ---` section's export), no
 *    row without a factory
 * 2. the tick column says what the section declares — `calcLast` or the
 *    fold builder (`foldNode(`, which writes `calcLast` for the section)
 *    is an increment, `computation(recomputing(` is a recompute that reuses;
 *    a section with neither has no tail door, and that is a failure of
 *    its own (the gate for new indicators)
 * 3. the head column (✓/—) matches `headLookback`/`calcFirst`
 * 4. the defaults column names the section's `*_DEFAULTS` — or, when the
 *    section declares none, a constant the barrel still exports — and
 *    the barrel exports it
 * 5. the needs column lists `volume` when the section calls `volumeOf(`
 *    and `anchor` when the options interface requires one. Volume has one
 *    door: a raw `.volume` in any section, or anywhere in `kernels.ts`
 *    outside `volumeOf` itself, is refused
 * 6. the barrel's other lowercase exports (the derivations and the
 *    decoration) are each named somewhere in the README
 * 7. every indicator count the docs state (extensions guide, README,
 *    naming reference) is the row count
 * 8. every factory has its `attach*` in the barrel, and the defaults a row
 *    names are `SCREAMING_SNAKE(factory)_DEFAULTS` (four older names are
 *    exempt by list)
 *
 * The code is read with comments and string literals blanked first — a
 * `// calcLast: resumes the fold` remark must not make an indicator an
 * increment. And a `.volume` read outside any section is refused: the
 * needs column can only see an indicator's own section, so that is
 * where a volume read has to live.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const factoriesPath = "packages/indicators/src/factories.ts";
const barrelPath = "packages/indicators/src/index.ts";
const readmePath = "packages/indicators/README.md";
const read = (path) => readFileSync(resolve(root, path), "utf8");
const factories = read(factoriesPath);
const barrel = read(barrelPath);
const readme = read(readmePath);
/**
 * Every place the docs state how many indicators there are — each one is a
 * sentence that goes stale on its own, so each one is held to the row count.
 */
const countedDocs = [
  { path: "apps/docs/guide/extensions.md", pattern: /(\d+) indicators/g },
  { path: readmePath, pattern: /(\d+) of them/g },
  { path: "apps/docs/reference/naming.md", pattern: /all (\d+) `attach\*` functions/g },
];
const screaming = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
/**
 * Names that predate the rule "`X_DEFAULTS` is `SCREAMING_SNAKE(factory)`".
 * Renaming them would break consumers for no behaviour; new ones get no entry.
 */
const DEFAULTS_NAME_EXEMPT = {
  bollingerBands: "BOLLINGER_DEFAULTS",
  donchianChannels: "DONCHIAN_DEFAULTS",
  keltnerChannels: "KELTNER_DEFAULTS",
  superTrend: "SUPERTREND_DEFAULTS",
};

const failures = [];

/**
 * Blanks comments and string/template literals (keeping newlines, so line
 * anchors still hold). A small state machine — enough for this file's
 * TypeScript; a `//` inside a string is a string, not a comment.
 */
function blankProse(code) {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const two = code.slice(i, i + 2);
    if (two === "/*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += code.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (two === "//") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        if (code[j] === "\\") j += 1;
        j += 1;
      }
      const stop = Math.min(j + 1, code.length);
      out += quote + code.slice(i + 1, stop - 1).replace(/[^\n]/g, " ") + (stop - 1 < code.length ? quote : "");
      i = stop;
    } else {
      out += code[i];
      i += 1;
    }
  }
  return out;
}

// --- barrel: value exports by module ---
const byModule = new Map();
for (const match of barrel.matchAll(/^export \{([^}]+)\} from "\.\/([\w-]+)";/gm)) {
  const names = match[1].split(",").map((name) => name.trim()).filter(Boolean);
  byModule.set(match[2], [...(byModule.get(match[2]) ?? []), ...names]);
}
const barrelValues = new Set([...byModule.values()].flat());
const isFactoryName = (name) => /^[a-z]/.test(name);
const factoryExports = (byModule.get("factories") ?? []).filter(isFactoryName);

// --- code: one section per indicator ---
const derived = new Map();
// Split on the raw headers first — blanking would erase them as comments — then blank each section.
const parts = factories.split(/^\/\/ --- .+ ---$/m).map(blankProse);
if (/\.volume\b/.test(parts[0])) {
  failures.push("a .volume read sits outside every indicator section — the needs column cannot see it; read volume in the indicator's own section");
}
const sections = parts.slice(1);
// The kernels file is not sectioned, so the needs column cannot see it:
// the only volume read allowed there is inside `volumeOf` itself.
const kernels = blankProse(read("packages/indicators/src/kernels.ts"));
const volumeOfAt = kernels.indexOf("export function volumeOf(");
const volumeOfEnd = volumeOfAt === -1 ? -1 : kernels.indexOf("\n}\n", volumeOfAt);
if (volumeOfAt === -1) {
  failures.push("kernels.ts has no volumeOf() — the one door a kernel reads volume through");
} else if (/\.volume\b/.test(kernels.slice(0, volumeOfAt) + kernels.slice(volumeOfEnd))) {
  failures.push("kernels.ts reads .volume outside volumeOf() — a volume read the needs column cannot see");
}
for (const section of sections) {
  const names = [...new Set([...section.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]))];
  if (names.length !== 1) {
    failures.push(`a section of ${factoriesPath} exports ${names.length} factories (${names.join(", ")}) — one indicator per section`);
    continue;
  }
  const [name] = names;
  // One door: an indicator reads volume through `volumeOf()` or not at all —
  // a raw `.volume` here would be a gap rule of its own the needs column
  // cannot vouch for.
  if (/\.volume\b/.test(section)) failures.push(`${name} reads .volume directly — read it through volumeOf()`);
  // `foldNode` may carry type arguments before its parenthesis; prose is blanked, so the bare name is the marker.
  const tick = /calcLast:|\bfoldNode\b/.test(section)
    ? "increment"
    : /computation\(recomputing\(/.test(section)
      ? "recompute + reuse"
      : null;
  if (tick === null) failures.push(`${name} declares no tail door — every indicator needs calcLast, foldNode() or recomputing()`);
  derived.set(name, {
    tick,
    // A key written as `headLookback: undefined` declares nothing — the builder leaves the door out.
    head: /headLookback:(?!\s*undefined\b)|calcFirst:/.test(section),
    defaults: section.match(/^export const (\w+_DEFAULTS)\b/m)?.[1] ?? null,
    volume: /volumeOf\(/.test(section),
    // Required means the options interface spells `anchor:` without `?`.
    anchor: [...section.matchAll(/^export interface \w+Options \{([\s\S]*?)^\}/gm)].some((m) => /^\s+anchor: /m.test(m[1])),
  });
}
for (const name of factoryExports) {
  if (!derived.has(name)) failures.push(`${name} is exported from factories but sits in no // --- section`);
}
for (const name of derived.keys()) {
  if (!factoryExports.includes(name)) failures.push(`${name} has a section but the barrel does not export it`);
}

// --- README: the matrix ---
const matrix = readme.match(/^## The matrix[^\n]*\n([\s\S]*?)(?=^## )/m);
if (!matrix) {
  failures.push(`${readmePath}: no "## The matrix" section`);
} else {
  const rows = new Map();
  // Every table line in the section is judged: the header and its rule are
  // skipped, anything else must parse as a row, and a name may appear once.
  // The matrix is the contiguous table under the "| Indicator |" header —
  // the section's later table (the exports that are not nodes) is not it.
  const lines = matrix[1].split("\n");
  const headerAt = lines.findIndex((line) => line.startsWith("| Indicator |"));
  if (headerAt === -1) failures.push(`${readmePath}: the matrix has no "| Indicator |" header`);
  const tableLines = [];
  for (let i = headerAt + 1; headerAt !== -1 && i < lines.length && lines[i].startsWith("|"); i++) tableLines.push(lines[i]);
  for (const line of tableLines) {
    if (line.startsWith("|---")) continue;
    const row = line.match(/^\| `(\w+)` \| ([^|]+?) \| (✓|—) \| (`\w+`|—) \| ([^|]+?) \|$/);
    if (!row) {
      failures.push(`matrix line does not parse as a row: ${line}`);
      continue;
    }
    if (rows.has(row[1])) failures.push(`matrix lists ${row[1]} twice`);
    rows.set(row[1], { tick: row[2], head: row[3] === "✓", defaults: row[4] === "—" ? null : row[4].slice(1, -1), needs: row[5] });
  }
  for (const [name, code] of derived) {
    const row = rows.get(name);
    if (!row) {
      failures.push(`matrix has no row for ${name}`);
      continue;
    }
    if (code.tick !== null && row.tick !== code.tick) failures.push(`${name}: tick column says "${row.tick}", code says "${code.tick}"`);
    if (row.head !== code.head) failures.push(`${name}: head door column says ${row.head ? "✓" : "—"}, code says ${code.head ? "✓" : "—"}`);
    if (code.defaults !== null && row.defaults !== code.defaults) failures.push(`${name}: defaults column says ${row.defaults ?? "—"}, the section declares ${code.defaults}`);
    if (row.defaults !== null && !barrelValues.has(row.defaults)) failures.push(`${name}: defaults column names ${row.defaults}, which the barrel does not export`);
    // The name rule is judged on the row, so a constant living outside the
    // section (Pivot's display defaults sit with the plugin) is held too.
    if (row.defaults !== null) {
      const expected = DEFAULTS_NAME_EXEMPT[name] ?? `${screaming(name)}_DEFAULTS`;
      if (row.defaults !== expected) failures.push(`${name}: defaults are named ${row.defaults}; the rule says ${expected}`);
    }
    const needs = row.needs === "—" ? [] : row.needs.split(",").map((s) => s.trim());
    const expected = [...(code.volume ? ["volume"] : []), ...(code.anchor ? ["anchor"] : [])];
    if (needs.sort().join(",") !== expected.sort().join(",")) failures.push(`${name}: needs column says "${row.needs}", code says "${expected.join(", ") || "—"}"`);
  }
  for (const name of rows.keys()) {
    if (!derived.has(name)) failures.push(`matrix row ${name} has no factory`);
  }
}

// --- README: the other exports ---
for (const [mod, names] of byModule) {
  if (["factories", "plugins", "kernels", "band-series"].includes(mod)) continue;
  for (const name of names.filter(isFactoryName)) {
    if (!readme.includes(`\`${name}\``)) failures.push(`${readmePath} never names \`${name}\` (from ${mod})`);
  }
}

// --- README: every exported *_LEVELS is named — the reference lines a pane draws are public values ---
for (const name of barrelValues) {
  if (name.endsWith("_LEVELS") && !readme.includes(`\`${name}\``)) failures.push(`${readmePath} never names \`${name}\` — every *_LEVELS the barrel exports is listed with the others`);
}

// --- docs: every count ---
for (const { path, pattern } of countedDocs) {
  const counts = [...read(path).matchAll(pattern)].map((m) => Number(m[1]));
  if (counts.length === 0) failures.push(`${path}: no indicator count to hold (${pattern})`);
  for (const count of counts) {
    if (count !== derived.size) failures.push(`${path} says ${count} indicators, factories.ts has ${derived.size}`);
  }
}

// --- every factory ships its attach* ---
for (const name of derived.keys()) {
  const attach = `attach${name[0].toUpperCase()}${name.slice(1)}`;
  if (!barrelValues.has(attach)) failures.push(`${name} has no ${attach} in the barrel — every indicator ships its plugin`);
}

if (failures.length > 0) {
  console.error(`${readmePath} ↔ ${factoriesPath}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`indicators-matrix-check: ${derived.size} rows agree with factories.ts; the other exports are named`);
