/**
 * The type contract for StyleSpec. Compiling is the assertion (this isn't
 * `.test.ts`, so vitest doesn't pick it up — only tsc looks at it, the same
 * idiom as public-surface.types.ts).
 *
 * (3) matters in particular: "tidying up" a spec with `:` instead of
 * `satisfies` silently defeats `StyleOverridesOf`'s inference. This file is
 * the only thing guarding against that.
 */
import type { StyleOf, StyleOverridesOf, StyleSpec, StyleVar } from "../style-spec";

interface FakeStyle {
  line: { width: number; color: string; dashArray?: string };
  fill: string;
}

// (1) A required field is required in the spec too — an empty spec can't lie about producing a style.
// @ts-expect-error: line and fill are missing
export const EMPTY: StyleSpec<FakeStyle> = {};

export const PARTIAL: StyleSpec<FakeStyle> = {
  // @ts-expect-error: line.color is missing
  line: { width: { css: "--chart-fake-width", fallback: 2 } },
  fill: { css: "--chart-fake-fill", fallback: "#222222" },
};

// An optional field (dashArray?) is optional in the spec too — omit it and it's absent from the result too.
export const SPEC = {
  line: {
    width: { css: "--chart-fake-width", fallback: 2 },
    color: { css: "--chart-fake", fallback: "#111111" },
  },
  fill: { css: "--chart-fake-fill", fallback: "#222222" },
} satisfies StyleSpec<FakeStyle>;

// (2) Only a declared leaf can be overridden — dashArray, which the spec
// doesn't read, isn't accepted by the type either. There's no spot where
// "the type accepts it but the runtime discards it."
export type Overrides = StyleOverridesOf<typeof SPEC>;

export const ok: Overrides = { line: { width: 3 } };

// @ts-expect-error: SPEC doesn't declare dashArray
export const dropped: Overrides = { line: { dashArray: "4,4" } };

// (3) With a `:` annotation, typeof collapses to the wide type and (2)
// breaks — the fact that the line below compiles is the justification for
// the "write a spec with satisfies" rule.
export const ANNOTATED: StyleSpec<FakeStyle> = SPEC;
export type LeakyOverrides = StyleOverridesOf<typeof ANNOTATED>;
export const leaks: LeakyOverrides = { line: { dashArray: "4,4" } };

// (4) The resolved result is derived from the declaration — an undeclared leaf is absent from the result type too.
export type Resolved = StyleOf<typeof SPEC>;
export const resolved: Resolved = {
  line: { width: 2, color: "#111111" },
  fill: "#222222",
};
// @ts-expect-error: dashArray is absent from the result
export const phantom: string = resolved.line.dashArray;

// (5) The fallback's type determines the parsing — something like boolean can't be a leaf.
// @ts-expect-error: only number | string can be a leaf
export const BAD_LEAF: StyleVar<boolean> = { css: "--chart-fake-flag", fallback: true };

