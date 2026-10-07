// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContractError, createPlotModel } from "@finchart/core";
import { dataTable, type DataTableOptions } from "../data-table";

interface Bar {
  x: number;
  close: number;
}

const bars = (count: number): Bar[] =>
  Array.from({ length: count }, (_, i) => ({ x: i, close: 100 + i }));

let target: HTMLElement;

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
});

/** A headless chart is enough — the table only listens for frames. */
function mounted(overrides: Partial<DataTableOptions<Bar>> = {}) {
  const model = createPlotModel({ size: { width: 800, height: 600 } });
  let rows: readonly Bar[] = bars(3);
  const api = model.plot.use(
    dataTable<Bar>({
      target,
      caption: "BTC",
      rows: () => rows,
      columns: [
        { heading: "Time", text: (bar) => `t${bar.x}` },
        { heading: "Close", text: (bar) => bar.close.toFixed(1) },
      ],
      ...overrides,
    }),
  );
  const details = () => target.querySelector("details");
  const cells = () =>
    [...target.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
  return {
    plot: model.plot,
    api,
    details,
    cells,
    summary: () => target.querySelector("summary")?.textContent,
    caption: () => target.querySelector("caption")?.textContent,
    setRows: (next: readonly Bar[]) => void (rows = next),
  };
}

describe("dataTable options", () => {
  const columns = [{ heading: "Close", text: (bar: Bar) => String(bar.close) }];

  it("should refuse a target that is not a DOM element", () => {
    const options = { target: null, caption: "BTC", rows: () => [], columns };

    // A missed lookup is the common mistake — sent through Reflect.apply,
    // since the type checker would refuse the bad value.
    expect(() => Reflect.apply(dataTable, undefined, [options])).toThrow(ContractError);
  });

  it("should refuse an empty column list", () => {
    expect(() => dataTable<Bar>({ target, caption: "BTC", rows: () => [], columns: [] })).toThrow(ContractError);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])("should refuse a row limit of %s", (limit) => {
    expect(() => dataTable<Bar>({ target, caption: "BTC", rows: () => [], columns, limit })).toThrow(ContractError);
  });
});

describe("dataTable", () => {
  it("should mount a native table with column headings, caption and one row per point", () => {
    const { plot, details, cells, caption, summary } = mounted();

    expect(details()?.hasAttribute("data-chart-data")).toBe(true);
    const headings = [...target.querySelectorAll("thead th")];
    expect(headings.map((cell) => [cell.textContent, cell.getAttribute("scope")])).toEqual([
      ["Time", "col"],
      ["Close", "col"],
    ]);
    expect(caption()).toBe("BTC");
    expect(summary()).toBe("BTC data (3 of 3 latest rows)");
    expect(cells()).toEqual([
      ["t0", "100.0"],
      ["t1", "101.0"],
      ["t2", "102.0"],
    ]);
    plot.destroy();
  });

  it("should expose only the most recent rows up to the limit", () => {
    const { plot, setRows, cells, summary } = mounted({ limit: 2 });

    setRows(bars(5));
    plot.render();

    expect(cells()).toEqual([
      ["t3", "103.0"],
      ["t4", "104.0"],
    ]);
    expect(summary()).toBe("BTC data (2 of 5 latest rows)");
    plot.destroy();
  });

  it("should fall back to a generic caption when the given one is blank", () => {
    const { plot, caption } = mounted({ caption: () => "   " });

    expect(caption()).toBe("Chart data");
    plot.destroy();
  });

  it("should follow new rows on the next frame", () => {
    const { plot, setRows, cells } = mounted();

    setRows(bars(1));
    expect(cells()).toHaveLength(3);
    plot.render();

    expect(cells()).toEqual([["t0", "100.0"]]);
    plot.destroy();
  });

  it("should hold the rows still while the table is open, until its subject changes", () => {
    let symbol = "BTC";
    const { plot, setRows, details, cells, caption } = mounted({ caption: () => symbol });
    const open = details();
    if (!open) throw new Error("no table");
    open.open = true;

    // Someone reading the expanded table: a live frame must not shift it.
    setRows(bars(1));
    plot.render();
    expect(cells()).toHaveLength(3);

    // A symbol switch replaces what the table is about — that does update.
    symbol = "ETH";
    plot.render();
    expect(caption()).toBe("ETH");
    expect(cells()).toEqual([["t0", "100.0"]]);
    plot.destroy();
  });

  it("should catch up when the table is opened or closed", () => {
    const { plot, setRows, details, cells } = mounted();
    const toggled = details();
    if (!toggled) throw new Error("no table");
    toggled.open = true;
    setRows(bars(1));
    plot.render();
    expect(cells()).toHaveLength(3);

    toggled.dispatchEvent(new Event("toggle"));

    expect(cells()).toEqual([["t0", "100.0"]]);
    plot.destroy();
  });

  it("should take the table out and stop following frames on dispose", () => {
    const { plot, api, setRows, details } = mounted();
    const removed = details();

    api.dispose();
    setRows(bars(1));
    plot.render();

    expect(target.querySelector("details")).toBeNull();
    expect(removed?.querySelectorAll("tbody tr")).toHaveLength(3);
    plot.destroy();
  });
});
