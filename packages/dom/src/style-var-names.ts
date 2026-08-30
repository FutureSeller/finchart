/**
 * Every `--chart-*` the shell declares, as a union of literal types — the
 * counterpart to `@finchart/core`'s `StyleVarName`, covering what this
 * package draws itself.
 *
 * Only the legend and the tooltip. Axis labels read `AXIS_LABEL_SPEC`, which
 * belongs to the core because the core paints them onto the canvas too, and
 * so their names arrive through `StyleVarName`.
 *
 * A theme spanning both packages unions the two:
 *
 * ```ts
 * type ChartVar = StyleVarName | ShellStyleVarName;
 * const dark: Partial<Record<ChartVar, string>> = { … };
 * ```
 *
 * Type-only, like its counterpart — nothing here reaches JavaScript.
 */
import type { StyleVarNamesOf } from "@finchart/core";

import type { LEGEND_STYLE_SPEC } from "./legend";
import type { TOOLTIP_STYLE_SPEC } from "./tooltip";

export type ShellStyleVarName =
  | StyleVarNamesOf<typeof LEGEND_STYLE_SPEC>
  | StyleVarNamesOf<typeof TOOLTIP_STYLE_SPEC>;
