import type { ConfigurablePluginApi, DataProbe, OverlayHost, PaneHost, PlotEventSource, Plugin, StyleSpec, ValueCoordinates, ValueFormatSource } from "@finchart/core";
import { ContractError, cssVarExpr, pluginApi, styleSpec } from "@finchart/core";
import { requireOverlayElement } from "./overlay-element";
import { type RowFormat, sampleText } from "./sample-text";

/**
 * What the legend requires from a pane — knowing its position and being
 * able to query values is enough.
 *
 * This used to be the `Pane` (class) type, but every pane a consumer
 * actually gets their hands on is a `PaneApi`, so that was an option with no
 * real value to pass.
 */
export type LegendPane = ValueCoordinates & DataProbe & ValueFormatSource;

export interface LegendOptions {
  /** Which pane's series. Defaults to mainPane. */
  pane?: LegendPane;
  /** Value format. Defaults to that pane's y notation (`pane.formatValue`). */
  formatValue?: (value: number) => string;
  /** The format for a row a series describes for itself (a candle's O/H/L/C/V) — see `tooltip`'s `formatRow`. Absent, such rows read through `formatValue`. */
  formatRow?: RowFormat;
}

/**
 * CSS variables owned by the legend. Because it's the DOM path, the browser
 * resolves them via var() — only the declaration format matches the canvas
 * side.
 */
export const LEGEND_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  fontSize: { css: "--chart-label-font-size", fallback: "11px" },
  fontFamily: { css: "--chart-label-font-family", fallback: "inherit" },
  color: { css: "--chart-legend", fallback: "#334155" },
}) satisfies StyleSpec<{ fontSize: string; fontFamily: string; color: string }>;

/**
 * Shows series names, colors, and values in the pane's top-left corner.
 *
 * Values follow the cursor — with no cursor (outside the chart), it shows
 * the last point's value. That's the trading-chart convention. The
 * ingredients are the same as the tooltip's: the crosshair event +
 * `Pane.probe` + overlay. The list is re-queried on every render — series
 * being added or removed is learned from the `render` event.
 *
 * Registrations with no name are skipped — a row with nothing to call it is
 * just noise.
 */
export function legend(
  options: LegendOptions = {},
): Plugin<
  OverlayHost & PaneHost & PlotEventSource,
  ConfigurablePluginApi<Omit<LegendOptions, "pane">>
> {
  return (plot) => {
    const overlay = requireOverlayElement(
      plot.overlay,
      "The legend requires a DOM overlay — a headless chart uses probe directly instead",
    );

    // pane can't be changed — moving it is a rebuild, so it's excluded from
    // the `applyOptions` patch.
    const pane = options.pane ?? plot.mainPane;
    let current: Omit<LegendOptions, "pane"> = {
      formatValue: options.formatValue,
      formatRow: options.formatRow,
    };
    // The default notation is the pane's own — ticks and legend are measured by the same ruler.
    const formatValue = (value: number) => (current.formatValue ?? pane.formatValue)(value);
    const formatRow: RowFormat = (value, row) =>
      current.formatRow ? current.formatRow(value, row) : formatValue(value);

    const document = overlay.ownerDocument;
    const box = document.createElement("div");
    box.setAttribute("data-chart-legend", "");
    box.style.position = "absolute";
    box.style.pointerEvents = "none";
    box.style.whiteSpace = "nowrap";
    box.style.padding = "4px 6px";
    box.style.fontSize = cssVarExpr(LEGEND_STYLE_SPEC.fontSize);
    box.style.fontFamily = cssVarExpr(LEGEND_STYLE_SPEC.fontFamily);
    box.style.color = cssVarExpr(LEGEND_STYLE_SPEC.color);
    overlay.appendChild(box);

    /** The cursor's data x. When null, shows the last value. */
    let cursorX: number | null = null;

    const refresh = (): void => {
      box.style.left = `${pane.area.left + 8}px`;
      box.style.top = `${pane.area.top + 6}px`;

      const at = cursorX ?? pane.xRange()?.max ?? null;
      const samples = at === null ? [] : pane.probe(at);

      const rows = samples
        .filter((sample) => sample.name !== null)
        .map((sample) => {
          const row = document.createElement("div");
          if (sample.color) {
            const dot = document.createElement("span");
            dot.style.color = sample.color;
            dot.textContent = "● ";
            row.appendChild(dot);
          }
          row.appendChild(document.createTextNode(sampleText(sample, formatValue, formatRow, " ")));
          return row;
        });

      box.replaceChildren(...rows);
    };

    const offCrosshair = plot.on("crosshair", (payload) => {
      cursorX = payload?.pane ? payload.x : null;
      refresh();
    });
    // Data and series changes arrive via render — the list and the last value both refresh there.
    const offRender = plot.on("render", refresh);
    refresh();

    const api = pluginApi(
      {
        applyOptions(patch: Partial<Omit<LegendOptions, "pane">>) {
          if (api.disposed) {
            throw new ContractError("cannot set options on a disposed legend");
          }
          // Merges only one layer deep → `ConfigurablePluginApi`
          current = { ...current, ...patch };
          refresh();
        },
      },
      () => {
        offCrosshair();
        offRender();
        box.remove();
      },
    );

    return api;
  };
}
