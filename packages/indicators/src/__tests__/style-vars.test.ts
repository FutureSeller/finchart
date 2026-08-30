/**
 * The style-variable manifest for the indicators package — the same
 * discipline as core's style-vars.test.ts.
 *
 * Indicator line colors are JS values (`options.colors`), not CSS
 * variables — the palette is knowledge that belongs to whatever builds
 * the series. That's why the only declaration here is the band.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleVars } from "@finchart/core";
import { BAND_STYLE_SPEC } from "../band-series";
import { VOLUME_PROFILE_STYLE_SPEC } from "../volume-profile";

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

describe("indicator style variables", () => {
  const mentioned = new Set(
    listSourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(VAR_PATTERN)].map(
        (match) => match[0],
      ),
    ),
  );

  it("should own exactly the declared variables", () => {
    expect(styleVars(BAND_STYLE_SPEC)).toMatchInlineSnapshot(`
      [
        "--chart-band",
      ]
    `);
    expect(styleVars(VOLUME_PROFILE_STYLE_SPEC)).toMatchInlineSnapshot(`
      [
        "--chart-profile",
        "--chart-profile-poc",
      ]
    `);
  });

  it("should mention no variable outside its specs", () => {
    const declared = new Set([
      ...styleVars(BAND_STYLE_SPEC),
      ...styleVars(VOLUME_PROFILE_STYLE_SPEC),
    ]);

    expect([...mentioned].filter((name) => !declared.has(name))).toEqual([]);
  });
});
