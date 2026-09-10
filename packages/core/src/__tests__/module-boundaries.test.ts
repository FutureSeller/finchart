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

function collectCrossModuleImports(): CrossModuleImport[] {
  const imports: CrossModuleImport[] = [];

  for (const file of listSourceFiles(SRC)) {
    const from = moduleOf(file);
    // Root files are the surface layer — aggregation over every module is
    // their whole job, so the direction rules below don't apply to them.
    // Membership in that layer is guarded separately (the last test).
    if (from.endsWith(".ts")) continue;

    const source = readFileSync(file, "utf8");
    const specifiers = source.matchAll(/from\s+["'](\.[^"']+)["']/g);

    for (const [, specifier] of specifiers) {
      const to = moduleOf(resolve(dirname(file), specifier));
      if (to !== from) {
        imports.push({ from, to, file: relative(SRC, file) });
      }
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
