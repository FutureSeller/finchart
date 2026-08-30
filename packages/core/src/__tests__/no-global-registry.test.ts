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

export function findGlobalState(files: string[]): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((source, index) => {
        for (const { what, pattern } of RULES) {
          if (pattern.test(source)) {
            findings.push({
              file: relative(SRC, file),
              line: index + 1,
              what,
              source: source.trim(),
            });
          }
        }
      });
  }

  return findings;
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
});
