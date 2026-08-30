/**
 * Compile-time lock: `StyleVarName` is a union of the real names, not
 * `string`.
 *
 * The whole point of deriving the union is that a misspelt variable fails to
 * compile. Both directions are pinned here. The misspelt key under
 * `@ts-expect-error` proves a wrong name is rejected — and if the union ever
 * degrades to `string` (say, a spec loses its `const` inference), that
 * directive turns unused and the type check fails the other way.
 *
 * Never imported at runtime — this file exists for `type-check` only.
 */
import type { StyleVarName } from "../style-var-names";

export const themed: Partial<Record<StyleVarName, string>> = {
  "--chart-candle-up": "#22c55e",
  "--chart-grid": "#1e293b",
  // @ts-expect-error — a misspelt name must not type
  "--chart-candle-upp": "#f87171",
};
