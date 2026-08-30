import { drawGrid } from "../axis";
import type { LineStyle } from "../render";
import { resolveStyle } from "../render";
import type { PaneDecoration } from "./decoration";
import { PLOT_STYLE_SPEC } from "./style";

export interface GridSettings {
  show: boolean;
  /** Overrides the CSS variable / default only for the fields given here. */
  overrides?: Partial<LineStyle>;
}

/**
 * Draws guide lines at tick positions. A built-in decoration Plot mounts
 * once per pane.
 *
 * It doesn't compute ticks itself — it reads them from the context. If the
 * grid and the labels each computed their own, they'd eventually drift apart.
 * Settings come in as a function to read, not a value — `applyOptions` can
 * change them at any time, and a plain value would need re-registering on
 * every change.
 */
export function gridDecoration(settings: () => GridSettings): PaneDecoration {
  return {
    draw(target, { ticks, area, readStyle }) {
      const { show, overrides } = settings();
      if (!show) return;

      const style = resolveStyle(PLOT_STYLE_SPEC, readStyle, {
        grid: overrides,
      });

      drawGrid(target, {
        verticals: ticks.x.map((tick) => tick.position),
        horizontals: ticks.y.map((tick) => tick.position),
        area,
        style: style.grid,
      });
    },
  };
}
