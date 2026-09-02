/**
 * Style variable manifest for the drawing tools — the same discipline as
 * the core's style-vars.test.ts. This is the first concrete proof of the
 * contract that a third-party extension runs the same test in its own
 * package.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleVars } from "@finchart/core";
import { DRAWING_LABEL_SPEC } from "../render";
import { DRAWING_STYLE_SPEC } from "../tools";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VAR_PATTERN = /--chart-[a-z0-9-]+/g;

/** Variables owned by the core — read-only here. */
const CORE_OWNED = new Set(["--chart-label-font-family"]);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : listSourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("drawing tools style variables", () => {
  const mentioned = new Set(
    listSourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(VAR_PATTERN)].map(
        (match) => match[0],
      ),
    ),
  );

  it("should own exactly the declared drawing variables", () => {
    expect(
      [...styleVars(DRAWING_STYLE_SPEC), ...styleVars(DRAWING_LABEL_SPEC)].sort(),
    ).toMatchInlineSnapshot(`
      [
        "--chart-drawing",
        "--chart-drawing-dash",
        "--chart-drawing-label",
        "--chart-drawing-width",
      ]
    `);
  });

  it("should mention no variable outside its specs", () => {
    const declared = new Set([
      ...styleVars(DRAWING_STYLE_SPEC),
      ...styleVars(DRAWING_LABEL_SPEC),
      ...CORE_OWNED,
    ]);

    expect([...mentioned].filter((name) => !declared.has(name))).toEqual([]);
  });
});
