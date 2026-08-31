import { describe, expect, it } from "vitest";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataView,
  DecimationStrategy,
  LineDataPoint,
} from "../../data";
import { LttbDecimation, SimpleDataManager } from "../../data";
import { lineSeries, type Series } from "../../series";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 25, y: 20 },
  { x: 50, y: 15 },
  { x: 75, y: 30 },
  { x: 100, y: 25 },
];

const double = (source: DataView<LineDataPoint>): LineDataPoint[] =>
  source.map((point) => ({ x: point.x, y: point.y === null ? null : point.y * 2 }));

describe("pane subscription", () => {
  it("should let more than one listener hear a change", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig, data });

    // Plot is already listening to one. A second subscriber must not push out the first.
    const heard: string[] = [];
    plot.mainPane.subscribe(() => heard.push("a"));
    plot.mainPane.subscribe(() => heard.push("b"));

    let rendered = 0;
    plot.on("render", () => rendered++);

    plot.mainPane.addSeries(lineSeries());

    expect(heard).toEqual(["a", "b"]);
    expect(rendered).toBe(1); // Plot's own subscription is still alive too
  });

  it("should stop calling a listener after its disposer runs", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig, data });

    let calls = 0;
    const off = plot.mainPane.subscribe(() => calls++);

    plot.mainPane.applyOptions({ flex: 2 });
    off();
    plot.mainPane.applyOptions({ flex: 3 });

    expect(calls).toBe(1);
  });

  /** subscribe is a public contract, so a handler someone else attached
   * can throw — the stage's own onPaneChange must not die along with it. */
  it("should still reach the other listeners when one throws", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig, data });

    const heard: string[] = [];
    plot.mainPane.subscribe(() => {
      throw new Error("someone else's extension threw");
    });
    plot.mainPane.subscribe(() => heard.push("after"));

    // It doesn't swallow the error — it calls everyone first, then throws.
    expect(() => plot.mainPane.applyOptions({ flex: 2 })).toThrow(
      "someone else's extension threw",
    );
    expect(heard).toEqual(["after"]);
  });

  it("should keep the two registrations apart when the same function subscribes twice", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig, data });

    let calls = 0;
    const listener = () => {
      calls += 1;
    };

    const off = plot.mainPane.subscribe(listener);
    plot.mainPane.subscribe(listener);
    // Calling it twice removes only its own registration once — the other one keeps listening.
    off();
    off();

    plot.mainPane.applyOptions({ flex: 2 });

    expect(calls).toBe(1);
  });

  it("should stop redrawing for a pane that was removed", () => {
    const { plot } = mountPlot({ deps: testBrowserDeps(), series: lineSeries(), config: defaultConfig, data });

    const pane = plot.addPane();
    plot.removePane(pane);

    let rendered = 0;
    plot.on("render", () => rendered++);

    // A removed pane no longer wakes up Plot.
    pane.addSeries(lineSeries());

    expect(rendered).toBe(0);
  });
});

describe("each registration gets its own manager", () => {
  /** Counts how many were built, and with what coordinates. */
  function spyFactory() {
    const built: Array<CoordinateAccessor<BaseDataPoint>> = [];

    const createDecimation = <P extends BaseDataPoint>(
      coordinates: CoordinateAccessor<P>,
    ): DecimationStrategy<P> => {
      built.push(coordinates as CoordinateAccessor<BaseDataPoint>);
      return new LttbDecimation<P>(coordinates);
    };

    return { createDecimation, built };
  }

  it("should build the derived manager with the same policy as the source", () => {
    const spy = spyFactory();
    const deps = testBrowserDeps({ createDecimation: spy.createDecimation });
    const { plot } = mountPlot({ deps, series: lineSeries(), config: defaultConfig, data });
    const before = spy.built.length;

    plot.mainPane.addSeries({ series: lineSeries(), derive: double });

    // The derived series went through the same factory — it used to build SimpleDecimation directly.
    expect(spy.built).toHaveLength(before + 1);
  });

  it("should build one for a series without derive too", () => {
    // **It used to not build one.** A non-derived series used what Plot had
    // already sliced, so there were two decimation paths. Now there's one.
    const spy = spyFactory();
    const deps = testBrowserDeps({ createDecimation: spy.createDecimation });
    const { plot } = mountPlot({ deps, series: lineSeries(), config: defaultConfig, data });
    const before = spy.built.length;

    plot.mainPane.addSeries(lineSeries());

    expect(spy.built).toHaveLength(before + 1);
  });

  it("should honour maxPoints for derived points too", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ x: i, y: i % 7 }));
    const seen: DataView<LineDataPoint>[] = [];

    const deps = testBrowserDeps({ maxPoints: 10 });
    const { plot } = mountPlot({ deps, series: lineSeries(), config: defaultConfig, data: many });
    const spy: Series<LineDataPoint> = {
      valueExtent: () => ({ min: 0, max: 20 }),
      draw: (_target, context) => seen.push(context.data),
    };

    plot.mainPane.addSeries({ series: spy, derive: double });
    plot.render();

    // The cap applies to derived points too. The default of 1000 used to just pass through.
    expect(seen.at(-1)!.length).toBeLessThanOrEqual(11);
  });

  it("should reuse the source policy through createDataManager", () => {
    const deps = testBrowserDeps();
    const manager = deps.createDataManager(
      new (class {
        getX = (point: LineDataPoint) => Number(point.x);
        getY = (point: LineDataPoint) => point.y;
      })(),
    );

    expect(manager).toBeInstanceOf(SimpleDataManager);
  });
});
