import type { StyleReader } from "./style-reader";
import { ContractError, describe, requireObject } from "../primitives";

/**
 * How one CSS variable becomes a settled value. The key is the value —
 * name, fallback, and parsing method are bundled into one object, and that
 * object lives next to the series that uses it.
 *
 * The parsing method isn't spelled out separately — `fallback`'s type
 * decides it.
 */
export interface StyleVar<T extends number | string> {
  /**
   * The custom property to read. The convention is a single `--chart-*`.
   *
   * A leaf must always have this — a default with no variable isn't a leaf,
   * it's a code constant. Only what takes part in the three-tier override >
   * variable > fallback belongs in the spec.
   */
  readonly css: string;
  /** Used when there's neither a variable nor an override. */
  readonly fallback: T;
  /**
   * Numbers only. Demotes a value from CSS into this range — CSS is
   * plainly outside. So that `--chart-candle-body-ratio: 3` doesn't make
   * the body three times the slot.
   */
  readonly range?: T extends number ? readonly [number, number] : never;
}

/**
 * Style type → the declaration that produces it. A leaf is a `StyleVar`; a
 * branch is a spec again.
 *
 * Being homomorphic preserves the original optionality — a required field
 * stays required in the spec too, and only a field that can be absent
 * (`dashArray?`) can be dropped from the spec.
 *
 * Spec constants are written through `styleSpec`, not annotated with `:` —
 * annotating would collapse `typeof` into this wide type and disable
 * `StyleOverridesOf`'s derivation.
 */
export type StyleSpec<S> = {
  readonly [K in keyof S]: NonNullable<S[K]> extends number | string
    ? StyleVar<NonNullable<S[K]>>
    : StyleSpec<NonNullable<S[K]>>;
};

/**
 * Declares a spec, checked against the style it produces, with its `css`
 * names kept as literal types.
 *
 * Two things have to hold at once and neither survives alone. `satisfies
 * StyleSpec<S>` checks the shape but lets every property widen, so `css`
 * lands as `string` and a name can never be read back out of the type —
 * measured, and it is why a typo in a variable name was only ever caught by
 * scraping the source. A `const` type parameter keeps the literals but
 * checks nothing. Doing both, in that order, gives both.
 *
 * ```ts
 * export const CANDLE_STYLE_SPEC = /* @__PURE__ *\/ styleSpec({
 *   up: { css: "--chart-candle-up", fallback: "#16a34a" },
 * }) satisfies StyleSpec<CandleSeriesStyle>;
 * ```
 *
 * The `satisfies` stays **outside** the call. Checking there leaves `T`
 * already inferred, so the names survive; threading the style type through
 * the function instead needs a second call, and two calls cannot both carry
 * the purity annotation the bundler needs.
 *
 * `/* @__PURE__ *\/` is not decoration. `const X = { … }` is inert and a
 * bundler drops it unused; `const X = f({ … })` is a call it must assume
 * has effects, and every spec in the module is then retained. Measured
 * without it: the one-series consumer went from 1.4 KB to 1.9 KB.
 *
 * It returns the spec untouched — the whole function is the identity, and
 * everything it does happens in the type system.
 */
export function styleSpec<const T>(spec: T): T {
  return spec;
}

/**
 * The variable names a spec declares, as a union of literals — the type twin
 * of `styleVars(spec)`, which returns the same names at runtime. This is what
 * makes a `--chart-*` name checkable at a call site instead of at test time.
 */
export type StyleVarNamesOf<Spec> = {
  [K in keyof Spec]: Spec[K] extends { readonly css: infer Name }
    ? Name
    : StyleVarNamesOf<Spec[K]>;
}[keyof Spec];

/**
 * Back to `string`/`number` from the literal a `const` inference leaves
 * behind. A spec's *names* are worth pinning; its *values* are not — a
 * fallback of `"#16a34a"` describes one default, not the only color the slot
 * may hold, and without this a resolved style would not fit the style type it
 * was declared against.
 */
type Widen<T> = T extends string ? string : T extends number ? number : T;

/** Declaration → the style it produces. `resolveStyle`'s return type. */
export type StyleOf<Spec> = {
  [K in keyof Spec]: NonNullable<Spec[K]> extends StyleVar<infer T>
    ? Widen<T>
    : StyleOf<NonNullable<Spec[K]>>;
};

/**
 * Declaration → what can be overridden. Only accepts declared leaves.
 *
 * Why it's derived from the spec and not the style type: if the type
 * accepted a field the spec doesn't read, you'd get a silent "the type
 * accepts it but the runtime drops it" mismatch.
 */
export type StyleOverridesOf<Spec> = {
  [K in keyof Spec]?: NonNullable<Spec[K]> extends StyleVar<infer T>
    ? Widen<T>
    : StyleOverridesOf<NonNullable<Spec[K]>>;
};

/** A reader that gives nothing. `resolveStyle(spec, noStyle)` is exactly the default. */
export const noStyle: StyleReader = () => "";

/**
 * override > CSS variable > fallback. The order shows up as the code's
 * order.
 *
 * It only walks keys the spec declared — an undeclared key on the override
 * (including `__proto__`) can't get into the result, and `undefined`/`null`
 * are demoted to "no value."
 */
export function resolveStyle<Spec>(
  spec: Spec,
  read: StyleReader,
  overrides?: StyleOverridesOf<Spec>,
): StyleOf<Spec> {
  const out = {} as Record<string, unknown>;
  const over = (overrides ?? {}) as Record<string, unknown>;

  for (const key in spec) {
    const node = spec[key] as StyleVar<number | string> | object;
    const given = over[key];

    /**
     * A contract error if it isn't a spec. If a third-party extension
     * author passes a resolved style instead of a spec (`{ color: "#fff"
     * }`), or a leaf is missing its `css`, that error inside `draw()`
     * punches through rAF and leaves the canvas stuck on a partial frame.
     *
     * Why this throws instead of demoting: this is an authoring-time
     * mistake, so it reproduces deterministically on the first frame, and
     * it's the code that needs fixing, not a value. A bad shape in a value
     * that came from outside is still demoted, by `coerceLeaf`.
     */
    if (typeof node !== "object" || node === null) {
      throw new ContractError(
        `resolveStyle(spec)'s ${key} must be a leaf ({ css, fallback }) or a spec again, got ${describe(node)}`,
      );
    }

    if ("css" in node) {
      /**
       * An override goes through the same judgment. It used to be `given
       * != null ? given : readVar(...)` — for the same leaf, a value that
       * came in as a CSS variable went through the unit regex, finiteness
       * check, and `range` clamp in full, while an override went through
       * none of it. Let a `3` in with no clamp and the body becomes 5.4
       * times the slot, so candles overlap each other; let a `NaN` in and
       * `fillRect` no-ops, wiping the body out entirely.
       */
      out[key] = given != null ? coerceLeaf(given, node) : readVar(read, node);
    } else {
      out[key] = resolveStyle(node, read, given as never);
    }
  }

  return out as StyleOf<Spec>;
}

/** A bare number, or one with `px`. Both gates use the same one. */
const NUMERIC_VALUE = /^\s*[+-]?(\d+\.?\d*|\.\d+)(px)?\s*$/;

/**
 * Smooths out a leaf value that came in as an override, by the same rules
 * as `readVar`.
 *
 * A string runs `readVar`'s regex verbatim; a number only gets checked
 * against `range`. It doesn't throw — this spot is a draw path that runs
 * every frame, and the contract is that a bad value on a draw path only
 * shows up in that frame's picture. A bad value falls back, and the
 * consumer sees "what I set isn't taking."
 */
function coerceLeaf(
  given: unknown,
  node: StyleVar<number | string>,
): number | string {
  const { fallback, range } = node;
  /**
   * String leaves get judged too — looking only at number leaves would let
   * values like `dashArray: [4,4]` or `font: 12` go straight through to
   * the renderer. The value itself isn't parsed here — colors and fonts
   * are rejected by the canvas and demoted by things like `applyColor`.
   * All this checks is shape.
   *
   * An empty value is "no value" — checking only `typeof` would let `""`
   * pass through as-is, get rejected by `applyColor`, and fall to
   * transparent, making the series invisible (the opposite of falling
   * back to the default). This comes up often from an emptied `<input
   * type="color">`'s `.value`, or a partially filled theme object.
   */
  if (typeof fallback !== "number") {
    return typeof given === "string" && given.trim().length > 0
      ? given
      : fallback;
  }

  const numeric =
    typeof given === "number"
      ? given
      : typeof given === "string" && NUMERIC_VALUE.test(given)
        ? Number.parseFloat(given)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return fallback;
  if (!range) return numeric;
  return Math.min(Math.max(numeric, range[0]), range[1]);
}

/**
 * Smooths out a value that came in as a CSS variable, by the same rules as
 * `coerceLeaf`.
 *
 * There isn't a second pipeline here — since `coerceLeaf` already accepts
 * both strings and numbers, all this needs to pass along is the raw text.
 * The unit rule (a bare number or `px` only), the `range` clamp, and the
 * empty-value judgment all live in one place.
 */
function readVar(
  read: StyleReader,
  node: StyleVar<number | string>,
): number | string {
  const raw = read(node.css);
  return raw ? coerceLeaf(raw, node) : node.fallback;
}

/**
 * Every variable this spec owns (sorted). Used by manifest tests and
 * third-party extensions.
 *
 * A contract error if it isn't a spec — a bad value blows up with an error
 * that would otherwise leak our internal implementation (the `in`
 * operator) straight into the console.
 *
 * Why this throws instead of falling back: this is an authoring-time door,
 * not a draw path that runs every frame. Returning an empty array for a
 * bad spec would let a manifest test quietly pass as "zero variables."
 */
export function styleVars(spec: unknown): string[] {
  const found: string[] = [];
  requireObject(spec, "styleVars(spec)");
  collectVars(spec, found);
  return found.sort();
}

function collectVars(node: unknown, into: string[]): void {
  if (typeof node !== "object" || node === null) return;
  for (const key in node) {
    const child: unknown = Reflect.get(node, key);
    if (typeof child !== "object" || child === null) continue;
    if ("css" in child) {
      const css: unknown = Reflect.get(child, "css");
      if (typeof css === "string") into.push(css);
      continue;
    }
    collectVars(child, into);
  }
}

/**
 * For plugging into an inline DOM style — the side where the browser
 * resolves `var()` (legend, tooltip). The mechanism differs from the
 * canvas path (`resolveStyle`), but the declaration is the same spec.
 */
export function cssVarExpr(leaf: StyleVar<string>): string {
  /**
   * A contract error if it isn't a leaf. `tooltip.ts`, `legend.ts`, and
   * `dom-labels.ts` all use this for authoring DOM overlays — if a
   * third-party extension author typos their spec's leaf name
   * (`MY_SPEC.colour`), `undefined` comes in, and without a check that
   * turns into a `TypeError` inside the render path that leaks our
   * internal destructuring names.
   */
  const { css, fallback } = requireObject(leaf, "cssVarExpr(leaf)");
  if (typeof css !== "string") {
    throw new ContractError(
      `cssVarExpr(leaf)'s css must be a string — pass a spec's leaf (e.g. MY_SPEC.color), got ${describe(css)}`,
    );
  }
  return `var(${css}, ${fallback})`;
}
