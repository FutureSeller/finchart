import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A module may only import layers below itself — this prevents circular dependencies. */
const ALLOWED_DEPENDENCIES: Record<string, readonly string[]> = {
  primitives: [],
  // Calendar arithmetic, one wall clock at a time. A leaf of its own
  // because both of its readers — the axis's boundaries and the data's bar
  // starts — sit in layers that cannot read each other.
  time: ["primitives"],
  data: ["primitives", "time"],
  scale: ["primitives"],
  render: ["primitives"],
  interaction: ["primitives"],
  // The grid draws from a LineStyle it receives — it only uses render's types
  // and knows nothing about the renderer itself.
  axis: ["primitives", "time", "scale", "render"],
  // A series only knows how to draw itself — grid, axis, and interaction
  // belong to Plot, and a series knows nothing about them.
  series: ["primitives", "data", "scale", "render"],
  // A registration closes a series over its own data manager — the bridge
  // between the two, and it knows nothing about panes or the stage.
  registration: ["primitives", "data", "scale", "render", "series"],
  plot: ["primitives", "data", "scale", "render", "axis", "interaction", "series", "registration"],
  // Built-in extensions aren't a component of the stage — they're a layer
  // **above** it. They consume only capability and plugin contracts, on the
  // same footing as tools and indicators. Since plot's allowlist doesn't
  // include extensions, the reverse direction (plot -> extensions) is
  // automatically blocked.
  extensions: ["primitives", "data", "scale", "render", "axis", "plot"],
};

interface CrossModuleImport {
  from: string;
  to: string;
  file: string;
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

function moduleOf(path: string): string {
  return relative(SRC, path).split(sep)[0];
}

/**
 * Every relative specifier one file pulls in: `import … from` / `export …
 * from`, a bare side-effect `import "…"`, and a dynamic `import("…")`. A
 * side-effect or dynamic import still runs the other module's code, so it
 * crosses the boundary just as much.
 *
 * This reads text, not a syntax tree, so its limits are deliberate and
 * pinned by the detector tests below: a dynamic import whose first argument is
 * not a plain quoted literal can't be resolved at all, so it is reported as
 * `computed` and fails the rules rather than slipping past them; and import-
 * shaped text inside a comment or a string counts as an import — a loud
 * false positive, never a silent miss.
 */
function importsIn(source: string): { specifiers: string[]; computed: number } {
  // Whitespace or block comments — both may sit between `import` and its path.
  const gap = String.raw`(?:\s|\/\*[\s\S]*?\*\/)*`;
  const literal = new RegExp(
    String.raw`(?:\bfrom|\bimport${gap}(?:\(${gap})?)${gap}["'](\.[^"']+)["']`,
    "g",
  );
  // The lookahead takes the gap itself, so backing off a space can't turn
  // a quoted path into a "computed" one.
  const computed = new RegExp(
    String.raw`\bimport${gap}\((?!${gap}["'][^"'\`$]*["']${gap}[,)])`,
    "g",
  );
  return {
    specifiers: [...source.matchAll(literal)].map(([, specifier]) => specifier),
    computed: [...source.matchAll(computed)].length,
  };
}

/** Stands in for the target of an import whose path can't be read. */
const COMPUTED = "<computed import path>";

function collectCrossModuleImports(): CrossModuleImport[] {
  const imports: CrossModuleImport[] = [];

  for (const file of listSourceFiles(SRC)) {
    const from = moduleOf(file);
    // Root files are the surface layer — aggregation over every module is
    // their whole job, so the direction rules below don't apply to them.
    // Membership in that layer is guarded separately (the last test).
    if (from.endsWith(".ts")) continue;

    const { specifiers, computed } = importsIn(readFileSync(file, "utf8"));

    for (const specifier of specifiers) {
      const to = moduleOf(resolve(dirname(file), specifier));
      if (to !== from) {
        imports.push({ from, to, file: relative(SRC, file) });
      }
    }
    for (let i = 0; i < computed; i++) {
      imports.push({ from, to: COMPUTED, file: relative(SRC, file) });
    }
  }

  return imports;
}

describe("module boundaries", () => {
  const crossModuleImports = collectCrossModuleImports();

  it("should find cross-module imports to check", () => {
    expect(crossModuleImports.length).toBeGreaterThan(0);
  });

  it("should only import from allowed lower layers", () => {
    const violations = crossModuleImports
      .filter(({ from, to }) => !ALLOWED_DEPENDENCIES[from]?.includes(to))
      .map(({ file, to }) => `${file} -> ${to}`);

    expect(violations).toEqual([]);
  });

  it("should never let a lower layer import plot", () => {
    // extensions is the only exception — being a layer above the stage, knowing about plot is part of its definition.
    const violations = crossModuleImports
      .filter(({ from, to }) => to === "plot" && from !== "plot" && from !== "extensions")
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });

  it("should cover every module directory with a rule", () => {
    const moduleDirs = readdirSync(SRC).filter((entry) =>
      statSync(resolve(SRC, entry)).isDirectory(),
    );

    const uncovered = moduleDirs.filter(
      (dir) => dir !== "__tests__" && !(dir in ALLOWED_DEPENDENCIES),
    );

    expect(uncovered).toEqual([]);
  });

  /**
   * The root of `src` is the surface layer: the explicit public entry points
   * may import from any module, because aggregating the package is their job.
   * That freedom has to stay small and deliberate — a file dropped at the root silently
   * escapes every direction rule above, which is how the type-name union
   * landed there unguarded in the first place. So membership is pinned, and
   * the union file (unlike the barrel, which re-exports values) must never
   * leave the type level: an `import` without `type` there would put every
   * spec module into any bundle that touches it.
   */
  it("should keep the surface layer to explicit entry points and the name union", () => {
    const rootFiles = readdirSync(SRC).filter((entry) => entry.endsWith(".ts"));
    expect(rootFiles.sort()).toEqual([
      "authoring.ts",
      "headless.ts",
      "index.ts",
      "style-var-names.ts",
    ]);

    const union = readFileSync(resolve(SRC, "style-var-names.ts"), "utf8");
    const runtimeImports = [...union.matchAll(/^import (?!type )/gm)];
    expect(runtimeImports).toEqual([]);
  });
});

describe("importsIn", () => {
  it.each([
    { name: "a static import", source: 'import { Pane } from "../plot/pane";', expected: ["../plot/pane"] },
    { name: "a type import", source: 'import type { Pane } from "../plot/pane";', expected: ["../plot/pane"] },
    { name: "a re-export", source: 'export * from "../plot";', expected: ["../plot"] },
    { name: "a side-effect import", source: 'import "../plot/pane";', expected: ["../plot/pane"] },
    { name: "a dynamic import", source: 'const m = await import("../plot/pane");', expected: ["../plot/pane"] },
    { name: "a dynamic import with spaces", source: 'const m = await import( "../plot/pane" );', expected: ["../plot/pane"] },
    { name: "a side-effect import behind a comment", source: 'import /* why */ "../plot/pane";', expected: ["../plot/pane"] },
    { name: "a dynamic import behind a comment", source: 'const m = await import(/* lazy */ "../plot/pane");', expected: ["../plot/pane"] },
    {
      name: "a dynamic import with options",
      source: 'const m = await import("../plot/pane", { with: { type: "json" } });',
      expected: ["../plot/pane"],
    },
  ])("should read $name", ({ source, expected }) => {
    expect(importsIn(source)).toEqual({ specifiers: expected, computed: 0 });
  });

  it.each([
    { name: "a template path", source: "const m = await import(`../plot/${name}`);" },
    { name: "a variable path", source: "const m = await import(path);" },
    { name: "a concatenated path", source: 'const m = await import("../plot/" + name);' },
  ])("should report $name as computed, never let it through", ({ source }) => {
    expect(importsIn(source).computed).toBe(1);
  });

  // The documented false positive: the detector reads text, so import-shaped
  // text counts even where it can't run. Loud on purpose — the reverse would
  // let a real import hide.
  it.each([
    { name: "a comment", source: '// import "../plot/pane";' },
    { name: "a string", source: 'const hint = \'import("../plot/pane")\';' },
  ])("should count import-shaped text in $name as an import", ({ source }) => {
    expect(importsIn(source).specifiers).toEqual(["../plot/pane"]);
  });

  it("should take no relative path from a package import", () => {
    expect(importsIn('import { describe } from "vitest";')).toEqual({ specifiers: [], computed: 0 });
  });
});
