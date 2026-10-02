import { describe, expect, it } from "vitest";
import type { LineDataPoint } from "../../data";
import { manualScheduler, type CanvasRenderer } from "../../render";
import type { Series, SeriesContext } from "../../series";
import { strokedPaths, testBrowserDeps } from "../../__tests__/dom-fakes";
import type { StyleReader } from "../../render";
import type { DividerBoundary, DividerDragHandler } from "../dividers";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

/** A series that draws nothing — so the only line left on the canvas is the divider. */
function silentSeries(): Series<LineDataPoint> & {
  seen: SeriesContext<LineDataPoint>[];
} {
  const seen: SeriesContext<LineDataPoint>[] = [];
  return {
    seen,
    valueExtent: () => ({ min: 0, max: 100 }),
    draw(_renderer: CanvasRenderer, context: SeriesContext<LineDataPoint>) {
      seen.push(context);
    },
  };
}

function mount(vars: Record<string, string> = {}, config = {}) {
  const read: StyleReader = (name) => vars[name] ?? "";
  const deps = testBrowserDeps({ createStyleReader: () => read });
  const top = silentSeries();
  const { plot, layers } = mountPlot({
    deps,
    series: top,
    data,
    config: {
      ...defaultConfig,
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
      ...config,
    },
  });
  return { plot, layers, top };
}

describe("pane divider line", () => {
  it("should draw one line on the boundary between two panes", () => {
    const { plot, layers, top } = mount();
    const bottom = silentSeries();
    plot.addPane().addSeries({ series: bottom, data });
    plot.render();

    const paths = strokedPaths(layers.context);
    expect(paths).toHaveLength(1);

    const [line] = paths;
    const upper = top.seen.at(-1)!.area;
    const lower = bottom.seen.at(-1)!.area;
    expect(line.points).toHaveLength(2);
    expect(line.points[0].y).toBe(line.points[1].y);
    expect(line.points[0].y).toBeGreaterThanOrEqual(upper.bottom);
    expect(line.points[0].y).toBeLessThanOrEqual(lower.top);
    expect(line.points[0].x).toBe(upper.left);
    expect(line.points[1].x).toBe(upper.right);
  });

  it("should draw nothing with a single pane", () => {
    const { plot, layers } = mount();
    plot.render();

    expect(strokedPaths(layers.context)).toHaveLength(0);
  });

  it("should read the --chart-pane-divider variables", () => {
    const { plot, layers } = mount({
      "--chart-pane-divider": "#123456",
      "--chart-pane-divider-width": "2",
    });
    plot.addPane().addSeries({ series: silentSeries(), data });
    plot.render();

    const [line] = strokedPaths(layers.context);
    expect(line.color).toBe("#123456");
    expect(line.width).toBe(2);
  });

  it("should keep the line when panes are not resizable", () => {
    // Whether the boundary is drawn and whether it's draggable are separate facts — only the handle (DOM) is missing.
    const { plot, layers } = mount({}, { resizablePanes: false });
    plot.addPane().addSeries({ series: silentSeries(), data });
    plot.render();

    expect(strokedPaths(layers.context)).toHaveLength(1);
  });
});

describe("pane divider handles", () => {
  /** A divider renderer that only records what the frame asked of it. */
  function recordingDividers() {
    const calls: string[] = [];
    const rendered: DividerBoundary[][] = [];
    const read: StyleReader = () => "";
    const deps = testBrowserDeps({
      createStyleReader: () => read,
      createDividers: () => ({
        render: (boundaries) => {
          calls.push(`render:${boundaries.length}`);
          rendered.push([...boundaries]);
        },
        clear: () => {
          calls.push("clear");
        },
        destroy: () => undefined,
      }),
    });
    return { deps, calls, rendered };
  }

  function mountWith(config: object) {
    const { deps, calls, rendered } = recordingDividers();
    const { plot } = mountPlot({
      deps,
      series: silentSeries(),
      data,
      config: { ...defaultConfig, showGrid: false, ...config },
    });
    plot.addPane().addSeries({ series: silentSeries(), data });
    calls.length = 0;
    plot.render();
    return { plot, calls, rendered };
  }

  it("should place one handle between two panes", () => {
    const { calls } = mountWith({});
    expect(calls).toEqual(["render:1"]);
  });

  it("should hand each handle the upper pane's height and how far it can go", () => {
    const { plot, rendered } = mountWith({});
    const [upper, lower] = plot.panes;
    upper.applyOptions({ minHeight: 60 });
    lower.applyOptions({ minHeight: 70 });
    plot.render();

    const height = (pane: typeof upper) => pane.area.bottom - pane.area.top;
    const [boundary] = rendered.at(-1) ?? [];
    expect(boundary.value).toEqual({
      now: height(upper),
      min: 60,
      max: height(upper) + height(lower) - 70,
    });
  });

  it("should report a squeezed pair as unable to move", () => {
    const { plot, rendered } = mountWith({});
    // Shorter than both floors add up to — the panes shrink under their minimums.
    plot.setViewport({ width: 800, height: 90 });
    plot.render();
    const [upper] = plot.panes;
    const now = upper.area.bottom - upper.area.top;
    expect(now).toBeLessThan(40);
    const [boundary] = rendered.at(-1) ?? [];
    expect(boundary.value).toEqual({ now, min: now, max: now });
  });

  it("should clear the handles when panes are not resizable", () => {
    // The line stays (the test above); the handle is what goes.
    const { calls } = mountWith({ resizablePanes: false });
    expect(calls).toEqual(["clear"]);
  });

  it("should take the handles down when the option is turned off later", () => {
    const { plot, calls } = mountWith({});
    calls.length = 0;
    plot.applyOptions({ resizablePanes: false });
    plot.render();
    // applyOptions may already have drawn a frame — what matters is that no
    // frame after the change put a handle up, and at least one took them down.
    expect(calls).toContain("clear");
    expect(calls.some((call) => call.startsWith("render"))).toBe(false);
  });

  it("should take the handles down when the frame degenerates", () => {
    // A collapsing sidebar mid-transition: the frame can't be drawn, and
    // the empty-data branch already treats a leftover handle as a bug
    // (it stays in the DOM and can still be dragged). The degenerate
    // branch is the sibling exit and owes the same cleanup.
    const { plot, calls } = mountWith({});
    calls.length = 0;
    plot.setViewport({ width: 2, height: 2 });
    plot.render();
    expect(calls).toContain("clear");
    expect(calls.some((call) => call.startsWith("render"))).toBe(false);

    // And the handle comes back with the space.
    calls.length = 0;
    plot.setViewport({ width: 800, height: 600 });
    plot.render();
    expect(calls).toContain("render:1");
  });
});

describe("divider moves between frames", () => {
  function mountDragging(options: { fromSources?: boolean } = {}) {
    let drag: DividerDragHandler = () => undefined;
    /** With `fromSources`, both panes read sources that go empty when this is false — without notifying anyone. */
    let live = true;
    const source = { read: () => (live ? data : []) };
    /** Runs once, from inside the next text measurement — the consumer's wiring calling out mid-move. */
    let onMeasure: (() => void) | null = null;
    // Frames only when the test draws one — moves have to be able to land between them.
    const deps = testBrowserDeps({
      createScheduler: manualScheduler(),
      createStyleReader: () => () => "",
      createTextMeasurer: () => ({
        measure: () => {
          const hook = onMeasure;
          onMeasure = null;
          hook?.();
          return { width: 30, height: 12 };
        },
      }),
      createDividers: (_overlay, onDrag) => {
        drag = onDrag;
        return { render: () => undefined, clear: () => undefined, destroy: () => undefined };
      },
    });
    const { plot, handle } = mountPlot({
      deps,
      series: options.fromSources ? null : silentSeries(),
      data,
      config: { ...defaultConfig, showGrid: false },
    });
    if (options.fromSources) plot.mainPane.addSeries({ series: silentSeries(), input: source });
    const second = options.fromSources
      ? plot.addPane().addSeries({ series: silentSeries(), input: source })
      : plot.addPane().addSeries({ series: silentSeries(), data });
    plot.render();
    const [upper, lower] = plot.panes;
    const height = (pane: typeof upper) => pane.area.bottom - pane.area.top;
    const duringMeasure = (hook: () => void) => {
      onMeasure = hook;
    };
    return {
      plot,
      upper,
      lower,
      height,
      handles: options.fromSources ? [] : [handle, second],
      goEmpty: () => {
        live = false;
      },
      duringMeasure,
      drag: (dy: number) => drag(0, dy),
      dragAt: (index: number, dy: number) => drag(index, dy),
    };
  }

  it("should add up moves that arrive before the next frame", () => {
    const { plot, upper, lower, height, drag } = mountDragging();
    const start = height(upper);
    const total = height(upper) + height(lower);
    drag(8);
    drag(8);
    drag(-40);
    plot.render();
    expect(height(upper)).toBe(start - 24);
    expect(height(upper) + height(lower)).toBe(total);
  });

  it("should move to a limit with an infinite drag, measured from the moves before it", () => {
    const { plot, upper, lower, height, drag } = mountDragging();
    const total = height(upper) + height(lower);
    drag(-Infinity);
    plot.render();
    expect(height(upper)).toBe(upper.minHeight);

    // At the floor: a step down, then back to the floor, all before a frame.
    drag(8);
    drag(-Infinity);
    plot.render();
    expect(height(upper)).toBe(upper.minHeight);

    drag(Infinity);
    plot.render();
    expect(height(lower)).toBe(lower.minHeight);
    expect(height(upper)).toBe(total - lower.minHeight);
  });

  it("should start from the flex someone else wrote after the move", () => {
    const { plot, upper, lower, height, drag } = mountDragging();
    const start = height(upper);
    drag(40);
    // Equal shares, written between the move and the frame — the next move
    // starts from them, not from the heights the first one asked for.
    upper.applyOptions({ flex: 1 });
    lower.applyOptions({ flex: 1 });
    drag(8);
    plot.render();
    expect(height(upper)).toBe(start + 8);
  });

  it("should reach the limit when the viewport changed since the last move", () => {
    const { plot, upper, lower, height, drag } = mountDragging();
    drag(8);
    // Taller before any frame — the limit is the floor of the new layout.
    plot.setViewport({ width: 800, height: 1200 });
    drag(-Infinity);
    plot.render();
    // Flex shares laid out again — equal up to floating point.
    expect(height(upper)).toBeCloseTo(upper.minHeight, 6);
    drag(Infinity);
    plot.render();
    expect(height(lower)).toBeCloseTo(lower.minHeight, 6);
  });

  it("should measure from the panes that are there when one went away between moves", () => {
    const { plot, upper, lower, height, drag } = mountDragging();
    const third = plot.addPane();
    third.addSeries({ series: silentSeries(), data });
    plot.render();
    const a = height(upper);
    const b = height(lower);
    drag(8);
    plot.removePane(third);
    drag(8);
    plot.render();
    // The first move's share, laid out over the two panes left, plus the second move.
    const space = height(upper) + height(lower);
    expect(height(upper)).toBeCloseTo((space * (a + 8)) / (a + b) + 8, 6);
  });

  it("should ignore a move for a handle drawn between panes that are no longer adjacent", () => {
    const { plot, upper, lower, drag } = mountDragging();
    const third = plot.addPane();
    third.addSeries({ series: silentSeries(), data });
    plot.render();
    plot.removePane(lower);
    const before = [upper.flex, third.flex];

    // The handle at index 0 was drawn between `upper` and `lower`; `third` now sits there.
    drag(8);

    expect([upper.flex, third.flex]).toEqual(before);
  });

  it("should draw no frame and run no render listener for a move", () => {
    // A listener run from inside a move could change the chart again before
    // the move lands — so a move measures without drawing.
    const { plot, drag } = mountDragging();
    let frames = 0;
    plot.on("render", () => {
      frames += 1;
    });
    drag(8);
    drag(8);
    drag(-Infinity);
    expect(frames).toBe(0);
  });

  it("should ignore a move for a boundary whose lower pane is gone", () => {
    const { plot, upper, lower, drag } = mountDragging();
    const flex = upper.flex;
    plot.removePane(lower);
    expect(() => drag(8)).not.toThrow();
    expect(upper.flex).toBe(flex);
  });

  it("should write nothing when there is no picture to move in", () => {
    const { plot, upper, lower, handles, drag } = mountDragging();
    plot.render();
    const shares = () => [upper.flex, lower.flex];
    const before = shares();

    // No handle is up in any of these — a move that still arrives writes no share.
    plot.setViewport({ width: 2, height: 2 });
    drag(-Infinity);
    expect(shares()).toEqual(before);
    plot.setViewport({ width: 800, height: 600 });

    plot.applyOptions({ resizablePanes: false });
    drag(-Infinity);
    expect(shares()).toEqual(before);
    plot.applyOptions({ resizablePanes: true });

    for (const handle of handles) handle.setData([]);
    drag(-Infinity);
    expect(shares()).toEqual(before);
  });

  it("should drop a move whose measurement changed the chart under it", () => {
    const handlesOf = new Map<unknown, ReturnType<typeof mountDragging>["handles"]>();
    const cases: Array<(plot: ReturnType<typeof mountDragging>["plot"]) => void> = [
      (plot) => plot.removePane(plot.panes[1]),
      (plot) => plot.destroy(),
      (plot) => plot.setViewport({ width: 800, height: 900 }),
      (plot) => plot.applyOptions({ paneGap: 30 }),
      // The data goes — with a frame that takes the handles down, and without one.
      (plot) => {
        for (const handle of handlesOf.get(plot) ?? []) handle.setData([]);
        plot.render();
      },
      (plot) => {
        for (const handle of handlesOf.get(plot) ?? []) handle.setData([]);
      },
      (plot) => plot.panes[0].applyOptions({ minHeight: 60 }),
      (plot) => plot.setViewport({ width: 700, height: 600 }),
      // Same count, a different pane in the slot.
      (plot) => {
        plot.removePane(plot.panes[1]);
        plot.addPane().addSeries({ series: silentSeries(), data });
      },
    ];
    for (const change of cases) {
      const { plot, upper, lower, handles, duringMeasure, drag } = mountDragging();
      handlesOf.set(plot, handles);
      const before = [upper.flex, lower.flex];
      duringMeasure(() => change(plot));
      expect(() => drag(-Infinity)).not.toThrow();
      expect({ case: cases.indexOf(change), shares: [upper.flex, lower.flex] }).toEqual({ case: cases.indexOf(change), shares: before });
    }

    // A share changed from inside — the move doesn't overwrite it with
    // heights measured before the change.
    const { upper, lower, duringMeasure, drag } = mountDragging();
    duringMeasure(() => upper.applyOptions({ flex: 3 }));
    drag(-Infinity);
    expect([upper.flex, lower.flex]).toEqual([3, 1]);

    // A maximize turned on from inside — the heights measured before it no
    // longer stand, so the move is dropped and the maximize holds.
    const maximizing = mountDragging();
    maximizing.duringMeasure(() => maximizing.plot.maximizePane(maximizing.lower));
    maximizing.drag(-Infinity);
    expect(maximizing.plot.maximizedPane).toBe(maximizing.lower);
    expect([maximizing.upper.flex, maximizing.lower.flex]).toEqual([1, 1]);

    // The same, with a panes listener that throws on the way — the change
    // is committed all the same, so the move still must not overwrite it.
    const again = mountDragging();
    const off = again.plot.on("panesChange", () => {
      off();
      throw new Error("listener failed");
    });
    again.duringMeasure(() => {
      try {
        again.upper.applyOptions({ flex: 3 });
      } catch {
        // The consumer swallows it.
      }
    });
    again.drag(-Infinity);
    expect([again.upper.flex, again.lower.flex]).toEqual([3, 1]);
  });

  it("should measure from a share a data source wrote when the move read it", () => {
    const { plot, upper, lower, height, drag } = mountDragging();
    let armed = false;
    plot.mainPane.addSeries({
      series: silentSeries(),
      input: {
        read: () => {
          if (armed) {
            armed = false;
            upper.applyOptions({ flex: 3 });
          }
          return data;
        },
      },
    });
    plot.render();
    const space = height(upper) + height(lower);

    // Armed after the frame, so the read that fires it is the move's own.
    armed = true;
    drag(8);
    expect(armed).toBe(false);
    plot.render();
    // Three quarters from the share the source wrote, then the move — not
    // the move applied to the halves measured before it.
    expect(height(upper)).toBeCloseTo((space * 3) / 4 + 8, 6);
  });

  it("should write nothing once a frame too narrow to draw has taken the handles down", () => {
    const { plot, upper, lower, drag } = mountDragging();
    const before = [upper.flex, lower.flex];
    // Tall enough for both panes; the y-axis eats the whole width.
    plot.setViewport({ width: 60, height: 600 });
    plot.render();
    drag(-Infinity);
    expect([upper.flex, lower.flex]).toEqual(before);
  });

  it("should refuse a move for a handle the last frame didn't put up", () => {
    const { plot, upper, lower, dragAt } = mountDragging();
    // A third pane, not drawn yet — the boundary above it has no handle.
    const third = plot.addPane();
    third.addSeries({ series: silentSeries(), data });
    const before = [upper.flex, lower.flex, third.flex];
    dragAt(1, -Infinity);
    expect([upper.flex, lower.flex, third.flex]).toEqual(before);
    plot.render();
    dragAt(1, -Infinity);
    expect(lower.flex).not.toBe(before[1]);
  });

  it("should drop a move whose measurement drew a frame that took the handles down — with nothing notified", () => {
    const { plot, upper, lower, goEmpty, duringMeasure, drag } = mountDragging({ fromSources: true });
    const before = [upper.flex, lower.flex];
    duringMeasure(() => {
      // The sources went empty without a word; only a frame finds out.
      goEmpty();
      plot.render();
    });
    drag(-Infinity);
    expect([upper.flex, lower.flex]).toEqual(before);
  });

  it("should bring a pane with no minimum to the height its handle reports as the limit", () => {
    const { plot, upper, lower, height, drag } = mountDragging();
    upper.applyOptions({ minHeight: 0 });
    lower.applyOptions({ minHeight: 0 });
    plot.render();
    drag(-Infinity);
    plot.render();
    expect(height(upper)).toBeCloseTo(1, 6);
    drag(Infinity);
    plot.render();
    expect(height(lower)).toBeCloseTo(1, 6);
  });

  it("should do nothing for a move that arrives after destroy", () => {
    const { plot, upper, lower, drag } = mountDragging();
    const before = [upper.flex, lower.flex];
    let changes = 0;
    plot.on("panesChange", () => {
      changes += 1;
    });
    plot.destroy();
    expect(() => drag(-Infinity)).not.toThrow();
    expect([upper.flex, lower.flex]).toEqual(before);
    expect(changes).toBe(0);
  });
});

describe("a divider drag whose subscriber removes a pane mid-write", () => {
  /** Three populated panes with the divider drag captured, heights read after a render. */
  function threePanes() {
    let drag: DividerDragHandler = () => undefined;
    const deps = testBrowserDeps({
      createDividers: (_overlay, onDrag) => {
        drag = onDrag;
        return { render: () => undefined, clear: () => undefined, destroy: () => undefined };
      },
    });
    const { plot } = mountPlot({ deps, series: silentSeries(), data, config: { ...defaultConfig, showGrid: false } });
    const a = plot.addPane();
    a.addSeries({ series: silentSeries(), data });
    const b = plot.addPane();
    b.addSeries({ series: silentSeries(), data });
    plot.render();
    const height = (pane: typeof a): number => pane.area.bottom - pane.area.top;
    return { plot, a, b, height, drag: (index: number, dy: number) => drag(index, dy) };
  }

  it("gives each surviving pane its own height — not the one of the pane removed before it", () => {
    const { plot, a, b, height, drag } = threePanes();
    const bHeight = height(b);
    const aFlex = a.flex;
    plot.mainPane.subscribe((change) => {
      if (change.settings && plot.panes.includes(a)) plot.removePane(a);
    });

    drag(0, 30);

    expect(plot.panes).toEqual([plot.mainPane, b]);
    // b's share is the height b had on screen; a's shrunk height must not land on it.
    expect(b.flex).toBeCloseTo(bHeight, 6);
    // The removed pane is no longer the chart's to write.
    expect(a.flex).toBe(aFlex);
  });
});
