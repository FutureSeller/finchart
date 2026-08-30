import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { lineSeries, type Series } from "../../series";
import {
  ABOVE_SERIES,
  BELOW_SERIES,
  type PaneDecoration,
  type PlotDecoration,
} from "../decoration";
import { crosshair } from "../../extensions/crosshair";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
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

  it("should order by zIndex, not registration", () => {
    const { plot, handle } = mount();
    const log: string[] = [];

    // Registered deliberately out of order — to check whether ordering actually comes from z.
    for (const [name, zIndex] of [
      ["tooltip", 500],
      ["band", -500],
      ["marker", 300],
      ["grid", -900],
    ] as const) {
      plot.addDecoration(marker(name, log) as PlotDecoration, {
        zIndex,
      });
    }

    handle.setData(data);

    expect(log).toEqual(["grid", "band", "marker", "tooltip"]);
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

  it("should keep registration order among equal z", () => {
    const { plot, handle } = mount();
    const log: string[] = [];

    for (const name of ["a", "b", "c"]) {
      plot.addDecoration(marker(name, log) as PlotDecoration, {
        zIndex: 42,
      });
    }

    handle.setData(data);

    expect(log).toEqual(["a", "b", "c"]);
  });

  it("should stop drawing a removed decoration wherever it sat", () => {
    const { plot, handle } = mount();
    const log: string[] = [];

    plot.addDecoration(marker("low", log) as PlotDecoration, {
      zIndex: -50,
    });
    const remove = plot.addDecoration(
      marker("mid", log) as PlotDecoration,
      { zIndex: 0 },
    );
    plot.addDecoration(marker("high", log) as PlotDecoration, {
      zIndex: 50,
    });

    handle.setData(data);
    // remove() schedules a render, so clear the log after removing.
    remove();
    log.length = 0;
    plot.render();

    expect(log).toEqual(["low", "high"]);
  });

  it("should keep registration order inside one z", () => {
    const { plot, handle } = mount();
    const log: string[] = [];

    for (const name of ["first", "second", "third"]) {
      plot.addDecoration(marker(name, log) as PlotDecoration, {
        zIndex: ABOVE_SERIES,
      });
    }

    handle.setData(data);

    expect(log).toEqual(["first", "second", "third"]);
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

  it("should stop drawing once the disposer runs", () => {
    const { plot, handle } = mount();
    const log: string[] = [];

    const off = plot.addDecoration(
      marker("deco", log) as PlotDecoration,
    );
    handle.setData(data);
    expect(log).toEqual(["deco"]);

    off();
    plot.render();

    expect(log).toEqual(["deco"]);
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
    let captured: {
      hasYScale: boolean;
      yTicks: number;
      xTicks: number;
      sameArea: boolean;
    } | null = null;

    plot.mainPane.addDecoration({
      draw: (_target, context) => {
        captured = {
          hasYScale: typeof context.yScale.scale === "function",
          yTicks: context.ticks.y.length,
          xTicks: context.ticks.x.length,
          sameArea: context.area === context.pane.area,
        };
      },
    } as PaneDecoration);

    handle.setData(data);

    expect(captured).not.toBeNull();
    expect(captured!.hasYScale).toBe(true);
    expect(captured!.yTicks).toBeGreaterThan(0);
    expect(captured!.xTicks).toBeGreaterThan(0);
    expect(captured!.sameArea).toBe(true);
  });

  it("should hand a plot decoration every pane and the whole area", () => {
    const { plot, handle } = mount();
    plot.addPane();

    let panes = 0;
    plot.addDecoration({
      draw: (_target, context) => {
        panes = context.panes.length;
      },
    } as PlotDecoration);

    handle.setData(data);

    expect(panes).toBe(2);
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
    const { plot, handle } = mount();
    plot.addPane();
    handle.setData(data);

    const areas = plot.panes.map((pane) => pane.area);
    expect(areas[0].bottom).toBeLessThanOrEqual(areas[1].top);
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
