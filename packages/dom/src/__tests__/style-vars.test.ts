/**
 * The style-variable manifest for the shell — the same discipline as the
 * other packages' style-vars tests.
 *
 * The shell declares only what it draws itself: the legend and the tooltip,
 * both DOM boxes. Axis labels read `AXIS_LABEL_SPEC`, which belongs to the
 * core because the core draws them onto the canvas too.
 *
 * This file used to live inside core's test, which reached over here with
 * `../../../dom/src/legend` to get at the two specs. That import put dom's
 * sources into core's compile and broke CI the day the builder started
 * emptying `dist` before writing it. `scripts/package-boundary-check.mjs`
 * now refuses that shape, and the repo-wide half of the manifest — the
 * frozen union, one fallback per shared variable, the demo apps — moved to
 * `scripts/style-vars-check.mjs`, which reads text and needs no import at
 * all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleVars } from "@finchart/core";

import { LEGEND_STYLE_SPEC } from "../legend";
import { TOOLTIP_STYLE_SPEC } from "../tooltip";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VAR_PATTERN = /--chart-[a-z0-9-]+/g;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : listSourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("shell style variables", () => {
  const files = listSourceFiles(SRC);
  const mentioned = new Set(
    files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(VAR_PATTERN)].map(
        (match) => match[0],
      ),
    ),
  );

  it("should have found the source tree", () => {
    // With no files the two assertions below would pass over nothing.
    expect(files.length).toBeGreaterThan(10);
    expect(mentioned.size).toBeGreaterThan(3);
  });

  it("should own exactly the declared variables", () => {
    expect(styleVars(LEGEND_STYLE_SPEC)).toMatchInlineSnapshot(`
      [
        "--chart-label-font-family",
        "--chart-label-font-size",
        "--chart-legend",
      ]
    `);
    expect(styleVars(TOOLTIP_STYLE_SPEC)).toMatchInlineSnapshot(`
      [
        "--chart-label-font-family",
        "--chart-label-font-size",
        "--chart-tooltip",
        "--chart-tooltip-back",
      ]
    `);
  });

  /**
   * `style-var-names.ts` turns these specs into `ShellStyleVarName`. The
   * union lists specs by hand, so a spec added here without a line there
   * silently drops its names from the type — the same drift core's test
   * guards for its own union.
   */
  it("should name every spec in the exported union", () => {
    const union = readFileSync(resolve(SRC, "style-var-names.ts"), "utf8");
    const missing = ["LEGEND_STYLE_SPEC", "TOOLTIP_STYLE_SPEC"].filter(
      (name) => !union.includes(`typeof ${name}`),
    );

    expect(missing, "declared here but absent from ShellStyleVarName").toEqual([]);
  });

  it("should mention no variable outside its specs", () => {
    const declared = new Set([
      ...styleVars(LEGEND_STYLE_SPEC),
      ...styleVars(TOOLTIP_STYLE_SPEC),
    ]);

    expect([...mentioned].filter((name) => !declared.has(name))).toEqual([]);
  });
});
