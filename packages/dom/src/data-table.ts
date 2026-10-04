import type { PlotEventSource, Plugin, PluginApi } from "@finchart/core";
import { ContractError, teardown } from "@finchart/core";
import { isElementLike } from "./overlay-element";

export interface DataTableColumn<T> {
  heading: string;
  text: (row: T) => string;
}

export interface DataTableOptions<T> {
  /** Mount outside the chart element so a chart with role="img" cannot hide the table's semantics. */
  target: HTMLElement;
  caption: string | (() => string);
  rows: () => readonly T[];
  columns: readonly DataTableColumn<T>[];
  /** Most recent rows to expose. Defaults to 100; use a larger bounded value when needed. */
  limit?: number;
}

/**
 * A native, navigable table for chart data. The chart canvas stays the visual
 * view; this opt-in sibling lets screen-reader users inspect exact values.
 * Rows are refreshed after a frame when the source view identity changes.
 */
export function dataTable<T>(options: DataTableOptions<T>): Plugin<PlotEventSource, PluginApi> {
  if (!isElementLike(options.target)) throw new ContractError("dataTable: target must be a DOM element");
  if (options.columns.length === 0) throw new ContractError("dataTable: at least one column is required");
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new ContractError("dataTable: limit must be a positive safe integer");
  }

  return (plot) => {
    const document = options.target.ownerDocument;
    const details = document.createElement("details");
    details.setAttribute("data-chart-data", "");
    const summary = document.createElement("summary");
    const table = document.createElement("table");
    const caption = document.createElement("caption");
    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    for (const column of options.columns) {
      const cell = document.createElement("th");
      cell.setAttribute("scope", "col");
      cell.textContent = column.heading;
      headingRow.appendChild(cell);
    }
    head.appendChild(headingRow);
    const body = document.createElement("tbody");
    table.append(caption, head, body);
    details.append(summary, table);
    options.target.appendChild(details);

    let previousRows: readonly T[] | null = null;
    let previousCaption = "";
    const refresh = (force = false): void => {
      const rows = options.rows();
      const title = (typeof options.caption === "function" ? options.caption() : options.caption).trim() || "Chart data";
      // Keep the DOM stable while someone is reading the expanded table.
      // A caption change (for example, a symbol switch) replaces its subject
      // and must still update immediately.
      if (details.open && title === previousCaption && !force) return;
      if (!force && rows === previousRows && title === previousCaption) return;
      previousRows = rows;
      previousCaption = title;
      caption.textContent = title;
      const start = Math.max(0, rows.length - limit);
      summary.textContent = `${title} data (${rows.length - start} of ${rows.length} latest rows)`;
      const children: HTMLTableRowElement[] = [];
      for (let i = start; i < rows.length; i++) {
        const tr = document.createElement("tr");
        for (const column of options.columns) {
          const td = document.createElement("td");
          td.textContent = column.text(rows[i]);
          tr.appendChild(td);
        }
        children.push(tr);
      }
      body.replaceChildren(...children);
    };
    const onToggle = (): void => refresh(true);
    details.addEventListener("toggle", onToggle);
    const off = plot.on("render", () => refresh());
    refresh();
    return teardown(() => {
      off();
      details.removeEventListener("toggle", onToggle);
      details.remove();
    });
  };
}
