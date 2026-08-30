/**
 * Compile-time lock: `ShellStyleVarName` is a union of the real names, not
 * `string` — the shell's counterpart to core's lock, and the same two-way
 * pin: the misspelt key must be rejected, and if the union ever widens the
 * directive turns unused and fails the other way.
 *
 * Never imported at runtime — this file exists for `type-check` only.
 */
import type { ShellStyleVarName } from "../style-var-names";

export const themed: Partial<Record<ShellStyleVarName, string>> = {
  "--chart-tooltip-back": "#0f172a",
  // @ts-expect-error — a misspelt name must not type
  "--chart-tooltipp": "#f8fafc",
};
