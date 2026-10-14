/**
 * Freezes the set of style variables.
 *
 * A typo in a CSS variable key falls back to the default value silently —
 * in the node test environment the reader always returns "", so a typo
 * can't be told apart from the real thing. So this turns the names
 * themselves into data: scrape every
 * `--chart-*` the source mentions and pin it into a snapshot, and a typo
 * shows up as a two-line diff (`--chart-lien-width` appears,
 * `--chart-line-width` disappears).
 *
 * A refactor must leave this snapshot unchanged — a change to it means a
 * variable was added or removed, and that fact must show up in the diff.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { styleVars } from "../render";
import { NUMERIC_VALUE } from "../render/style-spec";
import { AXIS_LABEL_SPEC } from "../axis/labels";
import { PLOT_STYLE_SPEC } from "../plot/style";
import {
  CROSSHAIR_BADGE_SPEC,
  CROSSHAIR_STYLE_SPEC,
} from "../extensions/crosshair";
import {
  MARKER_STYLE_SPEC,
  PRICE_LINE_SPEC,
  SPAN_SPEC,
  WATERMARK_SPEC,
} from "../extensions/standard";
import { AREA_STYLE_SPEC } from "../series/area-series";
import { BAR_STYLE_SPEC } from "../series/bar-series";
import { BASELINE_STYLE_SPEC } from "../series/baseline-series";
import { CANDLE_STYLE_SPEC } from "../series/candle-series";
import { HISTOGRAM_STYLE_SPEC } from "../series/histogram-series";
import { LINE_STYLE_SPEC } from "../series/line-series";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every spec in the core — a new spec has to be registered here. Forget it,
 * and that spec's variables get caught by the cross-check test below as
 * "undeclared literals" (a structure that closes the loop on itself).
 */
const SPECS = {
  AXIS_LABEL_SPEC,
  PLOT_STYLE_SPEC,
  CROSSHAIR_STYLE_SPEC,
  CROSSHAIR_BADGE_SPEC,
  PRICE_LINE_SPEC,
  MARKER_STYLE_SPEC,
  WATERMARK_SPEC,
  SPAN_SPEC,
  LINE_STYLE_SPEC,
  AREA_STYLE_SPEC,
  BAR_STYLE_SPEC,
  BASELINE_STYLE_SPEC,
  CANDLE_STYLE_SPEC,
  HISTOGRAM_STYLE_SPEC,
} as const;

/** The two font variables are a shared exception, read by the DOM, canvas, and marker alike. */
const SHARED_VARS = new Set([
  "--chart-label-font-family",
  "--chart-label-font-size",
]);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : listSourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

const VAR_PATTERN = /--chart-[a-z0-9-]+/g;

export function collectStyleVars(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(VAR_PATTERN)) {
      const uses = found.get(match[0]) ?? [];
      uses.push(relative(SRC, file));
      found.set(match[0], uses);
    }
  }

  return found;
}

/**
 * Every file that could assign a `--chart-*` — docs, demos, the README.
 *
 * Derived from the tree, not a hand-written list. `node_modules`, `dist`,
 * and build output are skipped — what is in there is not a sentence we
 * wrote.
 */
function cssBearingFiles(root: string): string[] {
  const SKIP = new Set([
    "node_modules",
    "dist",
    ".git",
    ".tmp",
    ".claude",
    ".turbo",
    "coverage",
    "test-results",
    ".vitepress",
    // typedoc output (a local build leaves hundreds of files here that a
    // clean CI checkout lacks, so the two would scan different sets while
    // both stay green).
    "api",
  ]);
  const KEEP = /\.(md|css|html|vue)$/;
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = resolve(dir, name);
      // Developer docs are not a consumer CSS surface; apps/docs is.
      if (full === resolve(root, "docs")) continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!KEEP.test(name)) continue;
      found.push(relative(root, full));
    }
  };

  walk(root);
  return found;
}

describe("the set of style variables", () => {
  // Core's own source only. The shell keeps its own manifest
  // (@finchart/dom's style-vars.test.ts) and the repo-wide half — the frozen
  // union across packages, one fallback per shared variable, the demo apps —
  // lives in scripts/style-vars-check.mjs, which reads text.
  const files = listSourceFiles(SRC);
  const vars = collectStyleVars(files);

  /**
   * Every `--chart-*` any package declares, read as text.
   *
   * The two repo-wide checks below judge what docs and demos assign, and
   * that verdict has to know the whole manifest — a variable owned by the
   * shell is not a typo just because the core does not declare it. Reading
   * the other packages as text keeps that knowledge here without an import:
   * scraping does not put their sources into core's compile, and
   * `scripts/package-boundary-check.mjs` refuses the import that would.
   */
  const OTHER_PACKAGES = ["dom", "tools", "indicators", "react"];
  const repoVars = new Set(vars.keys());
  for (const pkg of OTHER_PACKAGES) {
    for (const name of collectStyleVars(
      listSourceFiles(resolve(SRC, `../../${pkg}/src`)),
    ).keys()) {
      repoVars.add(name);
    }
  }

  it("should have found the source tree", () => {
    // If no files are found, the assertion below passes for free.
    expect(files.length).toBeGreaterThan(20);
    expect(vars.size).toBeGreaterThan(10);
  });

  it("should match the frozen set of css variables", () => {
    expect([...vars.keys()].sort()).toMatchInlineSnapshot(`
      [
        "--chart-area",
        "--chart-area-bottom",
        "--chart-area-line",
        "--chart-area-line-dash",
        "--chart-area-line-width",
        "--chart-bar-down",
        "--chart-bar-line-width",
        "--chart-bar-tick-ratio",
        "--chart-bar-up",
        "--chart-baseline-bottom",
        "--chart-baseline-bottom-fill",
        "--chart-baseline-line-width",
        "--chart-baseline-top",
        "--chart-baseline-top-fill",
        "--chart-candle-body-ratio",
        "--chart-candle-down",
        "--chart-candle-up",
        "--chart-candle-wick-width",
        "--chart-crosshair",
        "--chart-crosshair-badge",
        "--chart-crosshair-badge-back",
        "--chart-crosshair-dash",
        "--chart-crosshair-width",
        "--chart-grid",
        "--chart-grid-dash",
        "--chart-grid-width",
        "--chart-histogram",
        "--chart-histogram-bar-ratio",
        "--chart-histogram-down",
        "--chart-histogram-up",
        "--chart-label",
        "--chart-label-font-family",
        "--chart-label-font-size",
        "--chart-line",
        "--chart-line-dash",
        "--chart-line-width",
        "--chart-marker",
        "--chart-pane-divider",
        "--chart-pane-divider-width",
        "--chart-point",
        "--chart-point-radius",
        "--chart-price-line",
        "--chart-price-line-dash",
        "--chart-price-line-width",
        "--chart-span",
        "--chart-watermark",
      ]
    `);
  });

  it("should declare in specs exactly what the source mentions", () => {
    // Spec declarations and source literals must be the same set. A
    // literal with no declaration is an ad-hoc read that never went
    // through a spec; a declaration with no literal means the SPECS
    // registration was forgotten.
    const declared = new Set(
      Object.values(SPECS).flatMap((spec) => styleVars(spec)),
    );

    expect([...declared].sort()).toEqual([...vars.keys()].sort());
  });

  it("should let no two specs own the same variable", () => {
    const owners = new Map<string, string[]>();
    for (const [name, spec] of Object.entries(SPECS)) {
      for (const cssVar of styleVars(spec)) {
        owners.set(cssVar, [...(owners.get(cssVar) ?? []), name]);
      }
    }

    const conflicts = [...owners]
      .filter(([cssVar, specs]) => specs.length > 1 && !SHARED_VARS.has(cssVar))
      .map(([cssVar, specs]) => `${cssVar} ← ${specs.join(", ")}`);

    expect(conflicts).toEqual([]);
  });

  /**
   * **Sharing is allowed, but the fallback has to match too.**
   *
   * The assertion above allows more than one owner. Without this check a
   * shared variable such as `--chart-label-font-family` could default to
   * `inherit` for axis, tooltip and legend but `sans-serif` for the marker,
   * and in an app using a company font only the marker's text would miss
   * the page font, while `apps/docs/guide/theme.md` says the family
   * defaults to `inherit` and follows the page font when nothing is set.
   *
   * Such a split differs in the **value**, not the name, so the name checks
   * above pass it. A shared variable looks like one token to a consumer, so
   * its default has to be one value too.
   */
  it("should give a shared variable one fallback", () => {
    const fallbacks = new Map<string, Map<string, string[]>>();

    const walk = (node: object, specName: string): void => {
      for (const value of Object.values(node)) {
        if (typeof value !== "object" || value === null) continue;
        if ("css" in value) {
          const { css, fallback } = value as { css: string; fallback: string };
          if (!SHARED_VARS.has(css)) continue;
          const byValue = fallbacks.get(css) ?? new Map<string, string[]>();
          byValue.set(fallback, [...(byValue.get(fallback) ?? []), specName]);
          fallbacks.set(css, byValue);
          continue;
        }
        walk(value, specName);
      }
    };

    for (const [name, spec] of Object.entries(SPECS)) walk(spec, name);

    const split = [...fallbacks]
      .filter(([, byValue]) => byValue.size > 1)
      .map(([cssVar, byValue]) => {
        const shown = [...byValue]
          .map(([fallback, specs]) => `${fallback} ← ${specs.join(", ")}`)
          .join(" / ");
        return `${cssVar}: ${shown}`;
      });

    expect(split).toEqual([]);
  });

  /**
   * **The suffix rule, checked by machine.**
   *
   * `apps/docs/guide/theme.md` documents the variables in a table whose
   * names follow a rule: `-width` is a px scalar, `-ratio` is unitless 0..1
   * (clamped outside that range), everything else is color, dash, or font.
   * Every numeric leaf in core's specs must end in `-width`, `-radius`, or
   * `-ratio`, and every `-ratio` must have `range: [0,1]`, so a numeric leaf
   * named like a color token fails here instead of in a reader's stylesheet.
   */
  it("should keep every numeric leaf's name matching its unit rule", () => {
    const NUMERIC_SUFFIX = /-(width|radius|ratio)$/;
    const wrong: string[] = [];

    const walk = (node: object, path: string) => {
      if ("css" in node) {
        const { css, fallback, range } = node as {
          css: string;
          fallback: unknown;
          range?: readonly [number, number];
        };
        const numeric = typeof fallback === "number";
        if (numeric !== NUMERIC_SUFFIX.test(css)) {
          wrong.push(
            `${path} — ${css} is ${numeric ? "a numeric leaf but does not end in -width|radius|ratio" : "named with a numeric suffix but its leaf is not a number"}`,
          );
        }
        if (css.endsWith("-ratio") && (range?.[0] !== 0 || range?.[1] !== 1)) {
          wrong.push(`${path} — ${css} should be unitless 0..1 but its range is ${JSON.stringify(range)}`);
        }
        return;
      }
      for (const key in node) {
        walk((node as Record<string, object>)[key], `${path}.${key}`);
      }
    };

    for (const [name, spec] of Object.entries(SPECS)) walk(spec, name);
    expect(wrong).toEqual([]);
  });

  it("should never use css as a group name", () => {
    // "css" in node is the leaf/branch discriminator — if a group is ever
    // named css, resolveStyle mistakes the group for a leaf.
    const check = (node: object, path: string) => {
      if ("css" in node) {
        expect
          .soft(typeof (node as { css: unknown }).css, path)
          .toBe("string");
        return;
      }
      for (const key in node) {
        check((node as Record<string, object>)[key], `${path}.${key}`);
      }
    };

    for (const [name, spec] of Object.entries(SPECS)) check(spec, name);
  });

  /**
   * **Does the assigned value match the leaf's type?**
   *
   * The checks above read only core's declarations (names and fallbacks),
   * never what a stylesheet assigns. A numeric leaf such as
   * `--chart-candle-wick-width` (`wickWidth`, fallback 1) could still be
   * assigned a color in any palette, the one in `apps/docs/guide/theme.md`
   * included, and since `parseFloat("#64748b")` is NaN, the value would
   * **silently drop back to the fallback of 1**: the line would do nothing.
   *
   * What gets checked against are ```` ```css ```` blocks in docs/demos
   * and `--chart-x: v` assignments in CSS files. **Markdown tables are not
   * parsed** — the table formatting is ours to define, so a parser for it
   * would go stale when we change it, but `--x: v` is CSS syntax we cannot
   * change.
   */
  it("should assign values that match the leaf type", () => {
    const numericVars = new Set<string>();
    const collect = (node: object): void => {
      for (const value of Object.values(node)) {
        if (typeof value !== "object" || value === null) continue;
        if ("css" in value) {
          const leaf = value as { css: string; fallback: unknown };
          if (typeof leaf.fallback === "number") numericVars.add(leaf.css);
          continue;
        }
        collect(value);
      }
    };
    for (const spec of Object.values(SPECS)) collect(spec);

    /**
     * **Numeric-ness knowledge also belongs to all five packages** —
     * otherwise `--chart-drawing-width: bold` passes, because that leaf
     * belongs to tools and sits outside core's SPECS traversal. Derived
     * from text instead of an import, so as not to cross a module boundary
     * — a `css: "--chart-…" … fallback: <number>` leaf.
     */
    const LEAF = /css:\s*["'](--chart-[a-z0-9-]+)["'][^{}]*?fallback:\s*-?[\d.]+/g;
    for (const pkg of OTHER_PACKAGES) {
      for (const file of listSourceFiles(resolve(SRC, `../../${pkg}/src`))) {
        const flat = readFileSync(file, "utf8").replace(/\s+/g, " ");
        for (const [, name] of flat.matchAll(LEAF)) numericVars.add(name);
      }
    }

    // If this is 0, this check guards nothing.
    expect(numericVars.size).toBeGreaterThan(5);

    // Markdown shows assignments as inline code: a backtick may open the
    // value, and one ends it.
    const ASSIGNMENT = /(--chart-[a-z0-9-]+)\s*:\s*`?([^;{}\n`]+)/g;
    const ROOT = resolve(SRC, "../../..");
    /**
     * **Takes the target list out of human hands.** A hand-kept list can
     * miss a file such as the root `README.md`, and then a typo'd token, a
     * type-mismatched assignment, or a nonexistent API planted in it leaves
     * every machine in the repo green. A surface no machine watches keeps
     * whatever mistake the next edit plants.
     *
     * And the root README is the GitHub landing page — the first thing a
     * consumer copies and pastes.
     */
    const sources = cssBearingFiles(ROOT);
    // Include user guides; developer docs must not affect this check.
    expect(sources).toContain("apps/docs/guide/theme.md");
    expect(sources.some((file) => /^(?:\.tmp|\.claude|docs)\//.test(file))).toBe(false);
    // Detect an empty scan or accidental inclusion of generated API output.
    expect(sources.length).toBeGreaterThan(15);
    expect(sources.length).toBeLessThan(200);

    /**
     * **A typo'd token bites.** Skipping a name that is not in
     * `numericVars` with `continue` would let a `--chart-*` assignment that
     * does not exist (a typo, an old name) stay silent forever. The set of
     * known names is derived from all five packages' sources — not a
     * hand-written list.
     */
    const known = repoVars;

    const wrong: string[] = [];
    const judge = (relPath: string, name: string, raw: string): void => {
      if (!known.has(name)) {
        wrong.push(`${relPath}: ${name} (a token not in this repo — a typo?)`);
        return;
      }
      if (!numericVars.has(name)) return;
      const value = raw.trim();
      // The resolver's own rule — anything else falls back at draw time.
      if (!NUMERIC_VALUE.test(value)) {
        wrong.push(`${relPath}: ${name}: ${value} (this is a numeric leaf)`);
      }
    };

    for (const relPath of sources) {
      const text = readFileSync(resolve(ROOT, relPath), "utf8");
      for (const [, name, raw] of text.matchAll(ASSIGNMENT)) {
        judge(relPath, name, raw);
      }
    }

    /**
     * **A JS assignment goes through the same door** (looking only at the
     * CSS regex would leave `setProperty("--chart-…", …)` outside it).
     * Scrapes ts/tsx across the app sources.
     */
    const SET_PROPERTY = /setProperty\(\s*["'](--chart-[a-z0-9-]+)["']\s*,\s*["']?([^)"']+)/g;
    const appsRoot = resolve(ROOT, "apps");
    const walkTs = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (name === "node_modules" || name === "dist" || name === "api")
          return [];
        const full = resolve(dir, name);
        if (statSync(full).isDirectory()) return walkTs(full);
        return /\.(ts|tsx)$/.test(name) ? [full] : [];
      });
    for (const full of walkTs(appsRoot)) {
      const text = readFileSync(full, "utf8");
      for (const [, name, raw] of text.matchAll(SET_PROPERTY)) {
        judge(relative(ROOT, full), name, raw);
      }
    }

    expect(wrong, "assigned a non-numeric value to a numeric leaf, or assigned a token that does not exist").toEqual([]);
  });

  it("should find every variable the demo apps set", () => {
    // If a flagship example sets a variable nobody reads, it silently
    // becomes dead code (indicator colors are JS values, so a `--chart-*`
    // an app sets for one is read by nothing).
    // The scan roots are every directory under apps/, apps/docs included,
    // derived rather than hand-written so a new demo cannot be left out.
    const APPS = resolve(SRC, "../../../apps");
    const SCAN_ROOTS = readdirSync(APPS)
      .filter((name) => statSync(resolve(APPS, name)).isDirectory())
      .map((name) => resolve(APPS, name));
    const externals = new Set([
      "--chart-band",
      "--chart-profile",
      "--chart-profile-poc",
      "--chart-drawing",
      "--chart-drawing-width",
      "--chart-drawing-dash",
      "--chart-drawing-label",
    ]);

    const used = new Set<string>();
    const scan = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === ".vitepress") {
          continue;
        }
        const path = resolve(dir, entry);
        if (statSync(path).isDirectory()) scan(path);
        else if (/\.(ts|tsx|html|css|md)$/.test(entry)) {
          for (const match of readFileSync(path, "utf8").matchAll(VAR_PATTERN)) {
            used.add(match[0]);
          }
        }
      }
    };
    for (const root of SCAN_ROOTS) scan(root);

    expect(used.size).toBeGreaterThan(5); // if the scan comes back empty, the check below passes for free
    expect(
      [...used].filter((name) => !repoVars.has(name) && !externals.has(name)),
      "a variable an example sets but nothing reads",
    ).toEqual([]);
  });

  /**
   * The theming guide's table is the consumer's list. The scan above holds
   * one direction — a variable the guide names but nothing reads. This is
   * the other: a variable the source declares that the guide never
   * mentions. The table's rows are not parsed (their shape is ours to
   * change); the guide is read as one bag of names.
   */
  it("should mention every declared variable in the theming guide", () => {
    const guide = readFileSync(
      resolve(SRC, "../../../apps/docs/guide/theme.md"),
      "utf8",
    );
    const mentioned = new Set([...guide.matchAll(VAR_PATTERN)].map((m) => m[0]));

    expect(mentioned.size).toBeGreaterThan(20); // an empty read would pass the check below for free
    expect(
      [...repoVars].filter((name) => !mentioned.has(name)).sort(),
      "a variable the source declares but the theming guide never mentions",
    ).toEqual([]);
  });

  /**
   * `style-var-names.ts` turns these specs into the `StyleVarName` union a
   * consumer types a theme against. It lists them by hand — a union cannot be
   * built by iterating an object — so a spec added without a line there
   * silently drops out of the type, and a consumer setting that variable gets
   * told it does not exist. This reads the file as text and holds the two
   * lists together.
   */
  it("should name every spec in the exported union", () => {
    const union = readFileSync(resolve(SRC, "style-var-names.ts"), "utf8");
    const missing = Object.keys(SPECS).filter(
      (name) => !union.includes(`typeof ${name}`),
    );

    expect(missing, "declared here but absent from StyleVarName").toEqual([]);
  });

  it("should follow the --chart-* naming convention", () => {
    // A name outside the pattern (uppercase, underscore) never gets
    // caught in the first place, so what is caught here must equal the
    // count of every literal prefixed with "--chart".
    const loose = /--chart[a-zA-Z0-9_-]*/g;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(loose)) {
        // A glob notation in a comment (--chart-*) is not a name.
        if (text[match.index + match[0].length] === "*") continue;

        expect
          .soft(match[0], `${match[0]} in ${relative(SRC, file)}`)
          .toMatch(/^--chart-[a-z0-9-]+$/);
      }
    }
  });
});
