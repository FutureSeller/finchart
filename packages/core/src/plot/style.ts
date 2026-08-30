import type { Padding } from "../primitives";
import type { LineStyle, StyleSpec } from "../render";
import { noStyle, resolveStyle } from "../render";
import { styleSpec } from "../render/style-spec";

/**
 * Default outer margin, pure padding only. Label space is the axis slice's
 * job, not this. `right` is bigger because the last x label, center-aligned,
 * sticks out halfway past the plot area. The builder and the headless entry
 * point (`createPlotModel`) need to share this value, or their default
 * drawings would drift apart.
 */
export const DEFAULT_PADDING: Padding = {
  top: 8,
  right: 16,
  bottom: 4,
  left: 4,
};

export interface PlotStyle {
  grid: LineStyle;
  paneDivider: LineStyle;
}

/** CSS variables Plot owns — the grid and the pane divider lines. */
export const PLOT_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  grid: {
    width: { css: "--chart-grid-width", fallback: 0.5 },
    color: { css: "--chart-grid", fallback: "#e5e7eb" },
    dashArray: { css: "--chart-grid-dash", fallback: "5,5" },
  },
  /**
   * The line between panes. The DOM divider handle is just a transparent
   * hit area that swaps the cursor, so this canvas line is what makes the
   * boundary **visible** (and what shows up in screenshots). Its default is
   * thicker and darker than the grid's — a boundary is structure, not a
   * guide line.
   */
  paneDivider: {
    width: { css: "--chart-pane-divider-width", fallback: 1 },
    color: { css: "--chart-pane-divider", fallback: "#d1d5db" },
  },
}) satisfies StyleSpec<PlotStyle>;

/** When there's neither a CSS variable nor an override. */
export const DEFAULT_PLOT_STYLE: PlotStyle = /* @__PURE__ */ resolveStyle(
  PLOT_STYLE_SPEC,
  noStyle,
);

