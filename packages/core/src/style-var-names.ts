/**
 * Every `--chart-*` the core declares, as a union of literal types.
 *
 * A style key is a string, so a typo in one is invisible — the reader finds
 * nothing and the leaf quietly takes its fallback. That is why the
 * repository scrapes its own sources to catch a misspelt variable. Scraping
 * catches ours. It cannot catch a consumer's:
 *
 * ```ts
 * const dark: Partial<Record<StyleVarName, string>> = { … };
 * ```
 *
 * A misspelt key there is now a compile error that suggests the real name.
 * (No example of one is written out: this file is scraped for `--chart-*`
 * literals like every other, and a fake name in a comment would read as a
 * real declaration — which is how that check earned its keep here.)
 *
 * Nothing here is written by hand. `styleSpec` keeps each `css` as a literal
 * type and `StyleVarNamesOf` reads them back out, so this file is the list of
 * specs and nothing else — a name can only enter or leave by being declared
 * or undeclared in the spec that owns it.
 *
 * **Type-only, deliberately.** Every import is `import type`, so nothing here
 * survives into JavaScript and no spec is retained by being listed. A value
 * that referenced all fourteen would pull all fourteen into every bundle.
 *
 * The shell, the indicators and the drawing tools declare their own on top of
 * these — `@finchart/dom`'s `ShellStyleVarName`, and `StyleVarNamesOf<typeof
 * BAND_STYLE_SPEC>` or `StyleVarNamesOf<typeof DRAWING_STYLE_SPEC>` for the two
 * packages whose specs are public already. Each package owns its own names;
 * a theme that spans packages unions them.
 *
 * `__tests__/style-vars.test.ts` holds this file to the same set of specs it
 * checks, so a spec added without a line here fails there.
 */
import type { AXIS_LABEL_SPEC } from "./axis/labels";
import type {
  CROSSHAIR_BADGE_SPEC,
  CROSSHAIR_STYLE_SPEC,
} from "./extensions/crosshair";
import type {
  MARKER_STYLE_SPEC,
  PRICE_LINE_SPEC,
  SPAN_SPEC,
  WATERMARK_SPEC,
} from "./extensions/standard";
import type { PLOT_STYLE_SPEC } from "./plot/style";
import type { StyleVarNamesOf } from "./render";
import type { AREA_STYLE_SPEC } from "./series/area-series";
import type { BAR_STYLE_SPEC } from "./series/bar-series";
import type { BASELINE_STYLE_SPEC } from "./series/baseline-series";
import type { CANDLE_STYLE_SPEC } from "./series/candle-series";
import type { HISTOGRAM_STYLE_SPEC } from "./series/histogram-series";
import type { LINE_STYLE_SPEC } from "./series/line-series";

export type StyleVarName =
  | StyleVarNamesOf<typeof AXIS_LABEL_SPEC>
  | StyleVarNamesOf<typeof PLOT_STYLE_SPEC>
  | StyleVarNamesOf<typeof CROSSHAIR_STYLE_SPEC>
  | StyleVarNamesOf<typeof CROSSHAIR_BADGE_SPEC>
  | StyleVarNamesOf<typeof PRICE_LINE_SPEC>
  | StyleVarNamesOf<typeof MARKER_STYLE_SPEC>
  | StyleVarNamesOf<typeof WATERMARK_SPEC>
  | StyleVarNamesOf<typeof SPAN_SPEC>
  | StyleVarNamesOf<typeof LINE_STYLE_SPEC>
  | StyleVarNamesOf<typeof AREA_STYLE_SPEC>
  | StyleVarNamesOf<typeof BAR_STYLE_SPEC>
  | StyleVarNamesOf<typeof BASELINE_STYLE_SPEC>
  | StyleVarNamesOf<typeof CANDLE_STYLE_SPEC>
  | StyleVarNamesOf<typeof HISTOGRAM_STYLE_SPEC>;
