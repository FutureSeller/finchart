/**
 * No global registries. Once a global-registration pattern like
 * `registerIndicator` exists, it can never be removed — unused indicators
 * stay stuck in the bundle and tests end up depending on registration order.
 * The point is to stop one from being added later because it looks
 * convenient, so this is enforced as a test rather than documentation. What
 * it catches isn't a name but a shape — mutable state accumulating at module
 * level.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Rule {
  what: string;
  /** Only looks at unindented lines — that's what marks module level. */
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    what: "module-level let/var (reassignable state)",
    pattern: /^(?:export\s+)?(?:let|var)\s+\w+/,
  },
  {
    what: "module-level Map/Set (a container that accumulates)",
    pattern: /^(?:export\s+)?const\s+\w+[^=]*=\s*new\s+(?:Weak)?(?:Map|Set)\b/,
  },
];

/**
 * An empty literal at module level has no reason to exist except to be
 * filled later — that is a registry, whatever it is called. Matched over the
 * whole text rather than line by line, so `[` and `]` on separate lines are
 * still one empty literal. Like the rules above, column zero is what stands
 * for module level: formatted source indents every local, so a local only
 * matches if it is written unindented — a loud false positive, pinned below.
 */
const EMPTY_CONTAINER = /^(?:export\s+)?const\s+\w+(?:\s*:[^=\n]+)?\s*=\s*(?:\[\s*\]|\{\s*\})\s*;?[ \t]*$/gm;

/**
 * A module-level const bound to an array or object literal, or to a bare
 * object from `Object.create`. A non-empty literal is usually a constant
 * table (`const SLOTS = [1, 2, 3]`), so any of these only
 * counts once the same file is seen mutating it — directly, or through
 * plain aliases (`const alias = SLOTS`, and aliases of that alias).
 *
 * This reads lines, not scopes, so its limits are chosen to fail loudly: a
 * local of the same name that is written in place counts as a write to the
 * module-level one (a false positive the author renames away), while a
 * write the text can't see — the container handed to a function that fills
 * it, or stored inside another object — is out of reach. The detector tests below
 * pin both sides.
 */
const LITERAL_CONTAINER = /^(?:export\s+)?const\s+(\w+)(?:\s*:[^=]+)?\s*=\s*(?:[[{]|Object\.create\()/;

/** Writes into `name` in place: a mutating array method, a member/index assignment or increment, `delete`, or `Object.assign`. */
function mutationOf(name: string): RegExp {
  return new RegExp(
    [
      String.raw`\b${name}\s*\.\s*(?:push|unshift|splice|pop|shift|fill|copyWithin|sort|reverse)\s*\(`,
      String.raw`\b${name}\s*(?:\.\s*\w+|\[[^\]]*\])\s*(?:[-+*/%&|^]|\?\?|&&|\|\|)?=(?!=)`,
      String.raw`\b${name}\s*(?:\.\s*\w+|\[[^\]]*\])\s*(?:\+\+|--)`,
      String.raw`(?:\+\+|--)\s*${name}\s*(?:\.\s*\w+|\[[^\]]*\])`,
      String.raw`\bdelete\s+${name}\s*[.[]`,
      String.raw`\bObject\.assign\(\s*${name}\s*,`,
    ].join("|"),
  );
}

/**
 * Bindings that are just another name for `name` — `const alias = name;` —
 * followed through chains, so an alias of an alias is still the container.
 */
function aliasesOf(name: string, lines: string[]): string[] {
  const found = new Set<string>();
  const pending = [name];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    const alias = new RegExp(
      String.raw`\b(?:const|let|var)\s+(\w+)(?:\s*:[^=]+)?\s*=\s*${current}\s*;?\s*$`,
    );
    for (const line of lines) {
      const next = alias.exec(line)?.[1];
      if (next !== undefined && next !== name && !found.has(next)) {
        found.add(next);
        pending.push(next);
      }
    }
  }
  return [...found];
}

interface Finding {
  file: string;
  line: number;
  what: string;
  source: string;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : listSourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Every finding in one file's text — split out so the detector can be fed a string directly. */
function findInSource(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");

  lines.forEach((source, index) => {
    const at = { file, line: index + 1, source: source.trim() };
    for (const { what, pattern } of RULES) {
      if (pattern.test(source)) findings.push({ ...at, what });
    }

    const name = LITERAL_CONTAINER.exec(source)?.[1];
    if (name === undefined) return;
    const names = [name, ...aliasesOf(name, lines)];
    const written = lines.findIndex((other) =>
      names.some((each) => mutationOf(each).test(other)),
    );
    if (written !== -1) {
      findings.push({
        ...at,
        what: `module-level literal written in place (line ${written + 1})`,
      });
    }
  });

  for (const match of text.matchAll(EMPTY_CONTAINER)) {
    const line = text.slice(0, match.index).split("\n").length;
    findings.push({
      file,
      line,
      source: lines[line - 1].trim(),
      what: "module-level empty array/object (a container waiting to be filled)",
    });
  }

  return findings;
}

export function findGlobalState(files: string[]): Finding[] {
  return files.flatMap((file) => findInSource(relative(SRC, file), readFileSync(file, "utf8")));
}

describe("holds no global registry", () => {
  const files = listSourceFiles(SRC);

  it("should have found the source tree", () => {
    // If no files are found, the assertion below passes for free.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(`plot${sep}plot.ts`))).toBe(true);
  });

  it("should hold no module-level mutable state", () => {
    const findings = findGlobalState(files);

    expect(
      findings.map((f) => `${f.file}:${f.line} — ${f.what}\n    ${f.source}`),
    ).toEqual([]);
  });
});

describe("findGlobalState", () => {
  // Guards against the detector silently ending up catching nothing.
  const cases = [
    { name: "let", source: "let registry = {};" },
    { name: "export let", source: "export let cache = null;" },
    { name: "var", source: "var indicators = [];" },
    { name: "Map", source: "const indicators = new Map<string, Indicator>();" },
    { name: "export Set", source: "export const seen = new Set<string>();" },
    {
      name: "Map with a type annotation",
      source: "const overlays: Map<string, Overlay> = new Map();",
    },
  ];

  it.each(cases)("should catch $name", ({ source }) => {
    expect(RULES.some((rule) => rule.pattern.test(source))).toBe(true);
  });

  // If the rule catches things that aren't registries, it's too broad to keep.
  it.each([
    { name: "const default-value object", source: "export const DEFAULT_STYLE = {" },
    { name: "const array", source: "const SLOTS = [1, 2, 3];" },
    { name: "let inside a function", source: "  let width = 1;" },
    { name: "Map inside a function", source: "  const cache = new Map();" },
    { name: "type alias", source: "export type Registry = Map<string, X>;" },
  ])("should let $name through", ({ source }) => {
    expect(RULES.some((rule) => rule.pattern.test(source))).toBe(false);
  });

  // A const binding can't be reassigned, but its contents can — the same
  // registry, spelled without `let` or `new Map`.
  it.each([
    { name: "empty typed array", text: "const R: string[] = [];" },
    { name: "empty object", text: "export const R = {};" },
    { name: "empty array split over lines", text: "const R: string[] = [\n];" },
    {
      name: "array filled by push",
      text: "const R: string[] = [\"seed\"];\nexport function add(x: string) {\n  R.push(x);\n}",
    },
    {
      name: "object filled by index",
      text: "const R: Record<string, number> = { a: 1 };\nexport function add(k: string) {\n  R[k] = 1;\n}",
    },
    {
      name: "prototype-less object filled by key",
      text: "const R: Record<string, number> = Object.create(null);\nexport function add(k: string) {\n  R[k] = 1;\n}",
    },
    {
      name: "counter bumped in place",
      text: "const R = { count: 0 };\nexport function bump() {\n  R.count++;\n}",
    },
    {
      name: "counter bumped with a prefix operator",
      text: "const R = { count: 0 };\nexport const bump = () => --R[\"count\"];",
    },
    {
      name: "object filled by Object.assign",
      text: "const R = { a: 1 };\nexport const add = (x: object) => Object.assign(R, x);",
    },
    {
      name: "array filled through an alias",
      text: "const R = [\"seed\"];\nexport function add(x: string) {\n  const alias = R;\n  alias.push(x);\n}",
    },
    {
      name: "array filled through an alias of an alias",
      text: "const R = [\"seed\"];\nconst first = R;\nexport function add(x: string) {\n  const second = first;\n  second.push(x);\n}",
    },
    {
      // A false positive by design: a write the detector can't place in a
      // scope counts against the module-level name. Renaming the local is
      // the fix — the reverse mistake would be a registry let through.
      name: "table shadowed by a local that is written",
      text: "const R = [1];\nexport function f(R: number[]) {\n  R.push(2);\n}",
    },
    {
      // The same column-zero reading: an unindented local looks module-level.
      name: "empty local written at column zero",
      text: "export function f() {\nconst R: number[] = [];\nreturn R;\n}",
    },
  ])("should catch a module-level $name", ({ text }) => {
    expect(findInSource("x.ts", text)).not.toEqual([]);
  });

  it.each([
    { name: "a constant table only read", text: "const SLOTS = [1, 2, 3];\nexport const at = (i: number) => SLOTS[i];" },
    { name: "a defaults object compared, not written", text: "const D = { a: 1 };\nexport const same = (x: number) => D.a === x;" },
    { name: "a local array pushed inside a function", text: "export function f() {\n  const R: number[] = [];\n  R.push(1);\n}" },
  ])("should let $name through", ({ text }) => {
    expect(findInSource("x.ts", text)).toEqual([]);
  });

  // The documented blind spots: writes the text can't trace back to the
  // module-level name. Pinned so the limit stays known — if the detector
  // learns to see one, this is the test to move into the catch list.
  it.each([
    {
      name: "a container handed to a function that fills it",
      text: "const R: string[] = [\"seed\"];\nconst fill = (to: string[]) => to.push(\"x\");\nexport const add = () => fill(R);",
    },
    {
      name: "a container stored inside another object",
      text: "const R: string[] = [\"seed\"];\nconst holder = { list: R };\nexport const add = (x: string) => holder.list.push(x);",
    },
  ])("should not see $name (a known limit)", ({ text }) => {
    expect(findInSource("x.ts", text)).toEqual([]);
  });
});
