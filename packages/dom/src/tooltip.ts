import type { ConfigurablePluginApi, CrosshairPayload, FormatSource, OverlayHost, PlotEventSource, Plugin, StyleSpec, XCoordinates } from "@finchart/core";
import { ContractError, cssVarExpr, pluginApi, styleSpec } from "@finchart/core";
import { requireOverlayElement } from "./overlay-element";
import { type RowFormat, sampleText } from "./sample-text";

export interface TooltipOptions {
  /** The header's x format. Defaults to the plot's — `axis.x.format`, else the tick strategy's own (`timeTicks` labels in its zone and language), else the rounded number. */
  formatX?: (x: number) => string;
  /** Row value format. Defaults to that pane's y notation (`pane.formatValue`). */
  formatValue?: (value: number) => string;
  /**
   * The format for a row a series describes for itself (`Series.describe`
   * — a candle's O/H/L/C/V), given the row's label and sample, so a volume
   * can read differently from a price: `(value, { label }) => label === "V"
   * ? … : …`. Absent, such rows read through `formatValue` like any value.
   */
  formatRow?: RowFormat;
  /** Gap from cursor to the box (px). Default 12. */
  offset?: number;
}

/** CSS variables owned by the tooltip. Same DOM path as the legend. */
export const TOOLTIP_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  fontSize: { css: "--chart-label-font-size", fallback: "11px" },
  fontFamily: { css: "--chart-label-font-family", fallback: "inherit" },
  back: { css: "--chart-tooltip-back", fallback: "rgba(15, 23, 42, 0.85)" },
  color: { css: "--chart-tooltip", fallback: "#f8fafc" },
}) satisfies StyleSpec<{
  fontSize: string;
  fontFamily: string;
  back: string;
  color: string;
}>;

/**
 * Follows the cursor and shows the series values at that x.
 *
 * DOM — this is the case that needs rich styling and text selection, at a
 * count of one. The ingredients are all existing contracts: the
 * `crosshair` event (position, data x, pane) + `Pane.probe` (values) +
 * overlay.
 *
 * ```ts
 * const tip = plot.use(tooltip({ formatX: dateLabel }));
 * tip.dispose();
 * ```
 *
 * Can't be installed on a headless chart (no overlay) — installation
 * throws.
 */
export function tooltip(
  options: TooltipOptions = {},
): Plugin<
  OverlayHost & PlotEventSource & FormatSource & XCoordinates,
  ConfigurablePluginApi<TooltipOptions>
> {
  return (plot) => {
    const overlay = requireOverlayElement(
      plot.overlay,
      "The tooltip requires a DOM overlay — a headless chart uses probe directly instead",
    );

    /** Holds options as one object — keeps the mutation point from scattering → `applyOptions` */
    let current: TooltipOptions = { ...options };
    // The default notation is the axis's — x by the chart's ruler, values by that pane's.
    const formatX = (x: number) => (current.formatX ?? plot.formatX)(x);
    const offset = () => current.offset ?? 12;

    const document = overlay.ownerDocument;
    const box = document.createElement("div");
    box.setAttribute("data-chart-tooltip", "");
    box.style.position = "absolute";
    box.style.display = "none";
    box.style.pointerEvents = "none";
    box.style.whiteSpace = "nowrap";
    box.style.padding = "6px 8px";
    box.style.borderRadius = "4px";
    box.style.fontSize = cssVarExpr(TOOLTIP_STYLE_SPEC.fontSize);
    box.style.fontFamily = cssVarExpr(TOOLTIP_STYLE_SPEC.fontFamily);
    box.style.background = cssVarExpr(TOOLTIP_STYLE_SPEC.back);
    box.style.color = cssVarExpr(TOOLTIP_STYLE_SPEC.color);
    overlay.appendChild(box);

    /**
     * The last cursor location — re-queried here when a render arrives.
     *
     * Subscribing to crosshair alone leaves stale values after a symbol
     * switch (setData) — the cursor hasn't moved but the data has. Same
     * judgment call as the legend: data and series changes arrive via
     * render. The pane held is the payload's own — if that pane
     * disappears, probe comes back empty and the box disappears too. The x
     * is read again from the cursor's pixel: a keyboard pan or a live feed
     * moves the view under a still pointer, and the crosshair line follows
     * the pixel, so the rows must too.
     */
    let last: CrosshairPayload | null = null;
    /**
     * The box's size for the text it was last measured with. Measuring is a
     * forced layout, and a live feed re-renders under a still pointer with
     * the same rows every tick.
     */
    let measured = { text: "", width: 0, height: 0 };

    const refresh = (): void => {
      // Outside a pane (margin, gap) there's nothing to show.
      // A registration drawn for the eye (a band fill, a marker row) is not read out.
      const samples = last?.pane
        ? last.pane.probe(plot.xAt(last.position.x)).filter((sample) => sample.readout !== false)
        : [];
      if (!last?.pane || samples.length === 0) {
        box.style.display = "none";
        return;
      }
      const { position, pane } = last;

      // Built with textContent only — the name is a string from outside,
      // so innerHTML would be an injection path. Same rule as DOM labels.
      const header = document.createElement("div");
      header.style.opacity = "0.7";
      header.textContent = formatX(samples[0].x);

      const formatValue = (value: number) => (current.formatValue ?? pane.formatValue)(value);
      const formatRow: RowFormat = current.formatRow ?? ((value) => formatValue(value));
      const rows = samples.map((sample) => {
        const row = document.createElement("div");
        if (sample.color) {
          const dot = document.createElement("span");
          dot.style.color = sample.color;
          dot.textContent = "● ";
          row.appendChild(dot);
        }
        row.appendChild(document.createTextNode(sampleText(sample, formatValue, formatRow, ": ")));
        return row;
      });
      box.replaceChildren(header, ...rows);

      box.style.display = "block";
      const text = box.textContent;
      if (text !== measured.text) measured = { text, width: box.offsetWidth, height: box.offsetHeight };
      // Flips to the other side of the cursor where the box, measured once
      // it holds its rows, would cross the pane's right or bottom edge — the
      // drawn chart's, not the container's, which can be larger.
      const gap = offset();
      const { width, height } = measured;
      const left = position.x + gap + width > pane.area.right ? position.x - gap - width : position.x + gap;
      const top = position.y + gap + height > pane.area.bottom ? position.y - gap - height : position.y + gap;
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    };

    const offCrosshair = plot.on("crosshair", (payload) => {
      last = payload;
      refresh();
    });
    const offRender = plot.on("render", refresh);

    const api = pluginApi(
      {
        applyOptions(patch: Partial<TooltipOptions>) {
          if (api.disposed) {
            throw new ContractError("cannot set options on a disposed tooltip");
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
