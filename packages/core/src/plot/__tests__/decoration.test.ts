import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries, type Series } from "../../series";
import {
  ABOVE_SERIES,
  BELOW_SERIES,
  type PaneDecoration,
  type PaneDecorationContext,
  type PlotDecoration,
  type PlotDecorationContext,
} from "../decoration";
import { crosshair } from "../../extensions/crosshair";
import { strokedPaths, testBrowserDeps } from "../../__tests__/dom-fakes";
import { DEFAULT_PLOT_STYLE } from "../style";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A decoration that logs the order it was drawn in. */
function marker(name: string, log: string[]) {
  return {
    draw: () => {
      log.push(name);
    },
  };
}

function mount() {
  return mountPlot({
    deps: testBrowserDeps(),
    series: lineSeries(),
    config: defaultConfig,
  });
}

describe("decoration order", () => {
  it("should wrap the pane loop with plot decorations", () => {
    const { plot, handle } = mount();
    const log: string[] = [];

    plot.addDecoration(marker("plot-bg", log) as PlotDecoration, {
      zIndex: BELOW_SERIES,
    });
    plot.addDecoration(marker("plot-fg", log) as PlotDecoration, {
      zIndex: ABOVE_SERIES,
    });
    plot.mainPane.addDecoration(
      marker("pane-bg", log) as PaneDecoration,
      { zIndex: BELOW_SERIES },
    );
    plot.mainPane.addDecoration(
      marker("pane-fg", log) as PaneDecoration,
      { zIndex: ABOVE_SERIES },
    );

    handle.setData(data);

    // Plot-owned sits outermost, pane-owned sits closest to the data — a result of nesting.
    expect(log).toEqual(["plot-bg", "pane-bg", "pane-fg", "plot-fg"]);
  });

  it("should let a decoration sit between the old two slots", () => {
    // A position that used to be impossible to express — there were only two slots.
    const { plot, handle } = mount();
    const log: string[] = [];

    plot.mainPane.addDecoration(
      marker("under", log) as PaneDecoration,
      { zIndex: BELOW_SERIES },
    );
    plot.mainPane.addDecoration(
      marker("just-under", log) as PaneDecoration,
      { zIndex: -1 },
    );
    plot.mainPane.addSeries({
      series: {
        valueExtent: () => ({ min: 0, max: 30 }),
        draw: () => log.push("series"),
      },
    });

    handle.setData(data);

    expect(log).toEqual(["under", "just-under", "series"]);
  });

  it("should default to above the series", () => {
    const { plot, handle } = mount();
    const log: string[] = [];

    plot.addDecoration(marker("deco", log) as PlotDecoration);
    plot.mainPane.addSeries({
      series: {
        valueExtent: () => ({ min: 0, max: 30 }),
        draw: () => log.push("series"),
      },
    });

    handle.setData(data);

    expect(log).toEqual(["series", "deco"]);
  });

  it("should draw a pane decoration only into its own pane", () => {
    const { plot, handle } = mount();
    const seen: number[] = [];

    const second = plot.addPane({ flex: 1 });
    second.addDecoration({
      draw: (_target, { area }) => seen.push(area.top),
    } as PaneDecoration);

    handle.setData(data);

    // Receives its own slice, not the pane above it.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThan(plot.mainPane.area.top);
  });
});

describe("decoration context", () => {
  it("should hand a pane decoration its own scale and ticks", () => {
    const { plot, handle } = mount();
    const lower = plot.addPane();
    lower.addSeries({ series: lineSeries(), data });
    const seen: PaneDecorationContext[] = [];
    lower.addDecoration({ draw: (_target, context) => seen.push(context) });
    handle.setData(data);

    // A domain far from the main pane's, so the two panes' scales and ticks can't be mistaken for each other.
    lower.setValueDomain(1000, 2000);

    // The latest frame's context — earlier mutations each drew a frame too.
    const context = seen.at(-1)!;
    expect(context.pane).toBe(lower);
    expect(context.yScale).toBe(lower.yScale);
    expect(context.yScale).not.toBe(plot.mainPane.yScale);
    expect(context.yScale.getDomain()).toEqual([1000, 2000]);
    expect(context.ticks.y.length).toBeGreaterThan(0);
    for (const tick of context.ticks.y) {
      expect(tick.value).toBeGreaterThanOrEqual(1000);
      expect(tick.value).toBeLessThanOrEqual(2000);
    }
    expect(context.ticks.x.length).toBeGreaterThan(0);
    expect(context.area).toEqual(lower.area);
    plot.destroy();
  });

  it("should hand a plot decoration every pane and the whole area", () => {
    const { plot, handle } = mount();
    const lower = plot.addPane();

    const seen: PlotDecorationContext[] = [];
    plot.addDecoration({ draw: (_target, context) => seen.push(context) });

    handle.setData(data);

    expect(seen).toHaveLength(1);
    const context = seen[0]!;
    expect(context.panes).toEqual([plot.mainPane, lower]);
    // The data area spans every pane — a crosshair cuts across them all.
    const main = plot.mainPane.area;
    expect(context.area).toEqual({
      left: main.left,
      right: main.right,
      top: main.top,
      bottom: lower.area.bottom,
    });
    plot.destroy();
  });

  it("should share one reader with the series", () => {
    const { plot, handle } = mount();
    const readers: unknown[] = [];

    plot.mainPane.addDecoration({
      draw: (_target, context) => readers.push(context.readStyle),
    } as PaneDecoration);
    const spy: Series<LineDataPoint> = {
      valueExtent: () => ({ min: 0, max: 30 }),
      draw: (_target, context) => readers.push(context.readStyle),
    };

    plot.mainPane.addSeries({ series: spy });

    handle.setData(data);

    expect(readers).toHaveLength(2);
    expect(readers[0]).toBe(readers[1]);
  });
});

describe("grid as a built-in decoration", () => {
  it("should draw into every pane's own slice", () => {
    const { plot, handle, layers } = mountPlot({
      deps: testBrowserDeps(),
      series: lineSeries(),
      config: { ...defaultConfig, paneGap: 12 },
    });
    plot.addPane();
    handle.setData(data);

    const grid = strokedPaths(layers.context).filter(
      (path) => path.width === DEFAULT_PLOT_STYLE.grid.width,
    );
    for (const { area } of plot.panes) {
      // Each pane gets its own vertical lines, running top to bottom of that pane and no further.
      const verticals = grid.filter(({ points: [from, to] }) => {
        if (from.x !== to.x) return false;
        const [top, bottom] = [from.y, to.y].sort((a, b) => a - b);
        return Math.abs(top - area.top) <= 1 && Math.abs(bottom - area.bottom) <= 1;
      });
      const horizontals = grid.filter(
        ({ points: [from, to] }) =>
          from.y === to.y && from.y >= area.top - 1 && from.y <= area.bottom + 1,
      );

      expect(verticals.length).toBeGreaterThan(0);
      expect(horizontals.length).toBeGreaterThan(0);
    }
    plot.destroy();
  });

  it("should follow showGrid without re-registering", () => {
    const { plot, layers } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig, data });

    const withGrid = layers.context.calls.length;

    plot.applyOptions({ showGrid: false });
    plot.render();
    const withoutGrid = layers.context.calls.length - withGrid;

    plot.applyOptions({ showGrid: true });
    plot.render();
    const backOn = layers.context.calls.length - withGrid - withoutGrid;

    // Passed through as a function that reads the setting, so toggling it off and on leaves the registration untouched.
    expect(backOn).toBeGreaterThan(withoutGrid);
  });
});

describe("crosshair", () => {
  /** A renderer that only counts drawn lines. */
  function mountWithLines() {
    const lines: number[][] = [];
    const renderer = {
      drawLine: (points: { x: number; y: number }[]) =>
        lines.push(points.map((p) => p.x)),
      drawShape: () => undefined,
      drawText: () => undefined,
      clear: () => {
        lines.length = 0;
      },
      commit: () => undefined,
    };

    const { plot, handle } = mountPlot({ deps: { ...testBrowserDeps(), createRenderer: () => renderer }, series: lineSeries(), config: defaultConfig });

    /** A vertical line = one whose start and end x match. */
    const verticals = () => lines.filter(([a, b]) => a === b).length;

    return { plot, handle, verticals };
  }

  it("should draw nothing until the cursor arrives", () => {
    const { plot, handle, verticals } = mountWithLines();
    plot.use(crosshair({ horizontal: false }));

    handle.setData(data);
    const gridVerticals = verticals();

    plot.crosshair({ x: 400, y: 300 });
    plot.render();

    expect(verticals()).toBe(gridVerticals + 1);
  });

  it("should stop drawing once the cursor leaves every pane", () => {
    const { plot, handle, verticals } = mountWithLines();
    plot.use(crosshair({ horizontal: false }));
    handle.setData(data);

    plot.crosshair({ x: 400, y: 300 });
    plot.render();
    const withCursor = verticals();

    plot.crosshair({ x: 2, y: 2 }); // Inside the padding — not in any pane
    plot.render();

    expect(verticals()).toBe(withCursor - 1);
  });

  it("should undo both the decoration and the subscription", () => {
    const { plot, handle, verticals } = mountWithLines();
    const cursor = plot.use(crosshair({ horizontal: false }));
    handle.setData(data);

    plot.crosshair({ x: 400, y: 300 });
    plot.render();
    const withCursor = verticals();

    cursor.dispose();
    plot.crosshair({ x: 420, y: 310 });
    plot.render();

    expect(verticals()).toBe(withCursor - 1);
  });
});
