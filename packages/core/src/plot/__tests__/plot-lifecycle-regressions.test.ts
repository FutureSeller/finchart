/** A collection of regression checks for bugs review caught by actually measuring. */
import { describe, expect, it, vi } from "vitest";
import { createPlotModel } from "../index";
import { frameScheduler, createMemoryLayers, noStyle, recordingRenderer } from "../../render";
import { pluginApi } from "../../primitives";
import {
  addDecoration,
  emptyDecorations,
  forEachAboveSeries,
} from "../decoration";
import { lineSeries } from "../../series";
import { seriesSpec } from "../../registration";
import { priceFormat } from "../../axis/price-format";
import { Plot } from "../plot";
import { createPlotDeps } from "../presets";

const DATA = [
  { x: 0, y: 10 },
  { x: 1, y: 20 },
  { x: 2, y: 15 },
];

function stage(config: Record<string, unknown> = {}) {
  return createPlotModel({
    size: { width: 400, height: 300 },
    series: { series: lineSeries(), data: DATA },
    config,
  });
}

describe("axis.y.size leaves the data its share", () => {
  /** A bug where a y-axis size larger than the stage width squeezed the data area to zero width, permanently dropping the frame. */
  it.each([400, 500, 10_000])("should keep drawing at size %i", (size) => {
    expect(stage({ axis: { y: { size } } }).commands().length).toBeGreaterThan(0);
  });

  it("should still honor a size that fits", () => {
    const wide = stage({ axis: { y: { size: 100 } } }).commands().length;
    expect(wide).toBeGreaterThan(0);
  });
});

describe("the decoration list is not thrown off by a removal mid-visit", () => {
  it("should not skip the decoration after a self-removing one", () => {
    const list = emptyDecorations<{ draw: () => void }>();
    const seen: string[] = [];

    let offA: () => void = () => undefined;
    offA = addDecoration(
      list,
      {
        draw: () => {
          seen.push("a");
          offA();
        },
      },
      { zIndex: 10 },
    );
    addDecoration(list, { draw: () => seen.push("b") }, { zIndex: 11 });
    addDecoration(list, { draw: () => seen.push("c") }, { zIndex: 12 });

    forEachAboveSeries(list, (decoration) => decoration.draw());

    // b used to be dropped entirely — splice shifted for...of's index.
    expect(seen).toEqual(["a", "b", "c"]);
  });
});

describe("a render request made while drawing does not reopen the frame", () => {
  it("should not recurse when a decoration requests a render while drawing", () => {
    const model = stage();
    model.plot.addDecoration({
      draw: () => {
        model.plot.requestRender();
      },
    });

    // This used to throw RangeError (stack overflow) in the immediateScheduler.
    expect(() => model.plot.render()).not.toThrow();
  });
});

describe("applyState's x slice is caught at the door too", () => {
  it("should reject a zero-width xDomain at the door", () => {
    const model = createPlotModel({ size: { width: 400, height: 300 } });

    // This used to pass silently and blow up inside the consumer's first setData.
    expect(() =>
      model.plot.applyState({ xDomain: { min: 5, max: 5 } }),
    ).toThrow();
  });

  it("should reject a malformed xDomain instead of seeding NaN", () => {
    const model = createPlotModel({ size: { width: 400, height: 300 } });

    expect(() =>
      // @ts-expect-error a hand-built slice — this can arrive without going through the parser.
      model.plot.applyState({ xDomain: { min: 10 } }),
    ).toThrow();
  });

  it("should still accept a real interval", () => {
    const model = stage();
    expect(() =>
      model.plot.applyState({ xDomain: { min: 0, max: 2 } }),
    ).not.toThrow();
  });
});

describe("destroy is safe to call twice", () => {
  it("should not throw on a second destroy", () => {
    const model = stage();
    model.plot.destroy();
    expect(() => model.plot.destroy()).not.toThrow();
  });
});

describe("no xDomainChange payload is built when nobody is listening", () => {
  /** What's measured is whether the payload computation branches on whether there's a listener. */
  it("should not walk dataRange for a payload nobody wants", () => {
    const quiet = stage();
    const quietSpy = vi.spyOn(quiet.plot.mainPane, "xRange");
    quietSpy.mockClear();
    quiet.plot.pan(0.5);

    const heard = stage();
    heard.plot.on("xDomainChange", () => undefined);
    const heardSpy = vi.spyOn(heard.plot.mainPane, "xRange");
    heardSpy.mockClear();
    heard.plot.pan(0.5);

    expect(quietSpy.mock.calls.length).toBeLessThan(
      heardSpy.mock.calls.length,
    );
  });

  it("should still deliver the payload to a subscriber", () => {
    const model = stage();
    const seen: unknown[] = [];
    model.plot.on("xDomainChange", (payload) => seen.push(payload));

    model.plot.pan(0.5);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ dataRange: { min: 0, max: 2 } });
  });
});

describe("lifecycle primitives", () => {
  it("should reject an api whose dispose lives on the prototype", () => {
    class Toolbox {
      cleaned = false;
      dispose(): void {
        this.cleaned = true;
      }
    }

    // This used to pass because of `Object.hasOwn`, and its own dispose ended up shadowed.
    expect(() => pluginApi(new Toolbox(), () => undefined)).toThrow();
  });

  it("should notify once when a decoration disposer runs twice", () => {
    const model = stage();
    let renders = 0;
    model.plot.on("render", () => renders++);

    const off = model.plot.addDecoration({ draw: () => undefined });
    model.plot.render();
    renders = 0;

    off();
    off();
    off();

    expect(renders).toBe(1);
  });
});

describe("createPlotModel reads an explicit undefined as 'not given'", () => {
  it("should keep DEFAULT_PADDING when padding is explicitly undefined", () => {
    expect(() =>
      createPlotModel({
        size: { width: 400, height: 300 },
        series: { series: lineSeries(), data: DATA },
        config: { padding: undefined },
      }),
    ).not.toThrow();
  });

  it("should keep showGrid on when it is explicitly undefined", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data: DATA },
      config: { showGrid: undefined },
    });

    expect(model.plot.getOptions().showGrid).toBe(true);
  });
});

describe("Plot does not hold onto the caller's config object", () => {
  it("should ignore a mutation of the caller's config object", () => {
    const config = { showGrid: true };
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data: DATA },
      config,
    });

    config.showGrid = false;

    // applyOptions is the one and only door for changing it.
    expect(model.plot.getOptions().showGrid).toBe(true);
  });
});

describe("the numeric and shape doors share the same vocabulary as their siblings", () => {
  it("should reject a negative paneGap", () => {
    // A negative gap would make panes overlap — both the divider line and the drag handle would fall outside their bounds.
    expect(() => stage({ paneGap: -200 })).toThrow();
  });

  it("should reject a malformed setViewport argument", () => {
    const model = stage();
    // @ts-expect-error the shape a failed measurement helper would return.
    expect(() => model.plot.setViewport(null)).toThrow();
    // @ts-expect-error this used to succeed silently, changing nothing.
    expect(() => model.plot.setViewport("640")).toThrow();
  });

  it.each(["pan", "panByPixels"] as const)("should reject NaN in %s", (door) => {
    const model = stage();
    expect(() => model.plot[door](NaN)).toThrow();
  });

  it("should treat a non-finite probe as pointing at nothing", () => {
    const model = stage();
    // This used to return the first bar as a normal sample.
    expect(model.plot.mainPane.probe(NaN)).toEqual([]);
  });

  it("should absorb a NaN-sized frame instead of throwing every frame", () => {
    // Padding given on only one side — checkPlotNumbers only looks at the side it was given.
    expect(() =>
      createPlotModel({
        size: { width: 400, height: 300 },
        series: { series: lineSeries(), data: DATA },
        // @ts-expect-error partial padding isn't blocked by the type.
        config: { padding: { left: 4 } },
      }).commands(),
    ).not.toThrow();
  });
});

describe("a frame with no data leaves no stale geometry behind", () => {
  it("should drop the axis slices when everything is cleared", () => {
    const model = stage();
    model.plot.render();

    model.plot.mainPane.clearSeries();
    model.plot.render();

    // Pressing on the old y-axis slot used to still register, and once it
    // registered, autoScale turned off.
    model.plot.routeInput({
      type: "pointerdown",
      point: { x: 10, y: 150 },
      pointerId: 1,
      button: 0,
    });
    model.plot.routeInput({
      type: "pointermove",
      point: { x: 10, y: 200 },
      pointerId: 1,
    });

    expect(model.plot.mainPane.autoScale).toBe(true);
  });
});

describe("frameScheduler keeps its receiver attached", () => {
  it("should work with a view whose rAF needs a receiver", () => {
    class FrameHost {
      queue: (() => void)[] = [];
      requestAnimationFrame(callback: (time: number) => void): number {
        this.queue.push(() => callback(0));
        return this.queue.length;
      }
      cancelAnimationFrame(handle: number): void {
        this.queue.splice(handle - 1, 1);
      }
    }

    const host = new FrameHost();
    let rendered = 0;
    const scheduler = frameScheduler(host)(() => rendered++);

    // Destructuring used to detach `this`, making the first request() a TypeError.
    expect(() => scheduler.request()).not.toThrow();
    host.queue.forEach((run) => run());
    expect(rendered).toBe(1);
  });
});

/** Regression checks for four bugs that were fixed without a guard. Mutation testing confirmed each guard's discriminating power. */
describe("four fixes that had no guard", () => {
  /** Cancellation is not detachment — the same problem shows up in the core's own axis drag. */
  it("a cancelled axis drag does not let a later hover keep stretching the value axis", () => {
    const model = stage();
    const pane = model.plot.mainPane;
    model.plot.render();
    const before = pane.yScale.getDomain();
    // The value axis is the left strip (outside area.left) — there's no axis in the right margin.
    const axis = { x: 5, y: (pane.area.top + pane.area.bottom) / 2 };

    model.plot.routeInput({ type: "pointerdown", point: axis, pointerId: 1 });
    model.plot.routeInput({
      type: "pointermove",
      point: { x: axis.x, y: axis.y + 40 },
      pointerId: 1,
    });
    const dragged = pane.yScale.getDomain();
    // First confirm the drag actually grabbed the axis — if it didn't, what follows proves nothing.
    expect(dragged).not.toEqual(before);

    // The system reclaimed the pointer — per spec, no up event follows.
    model.plot.routeInput({ type: "pointercancel", point: { x: axis.x, y: axis.y + 40 }, pointerId: 1 });

    // A bare hover after releasing. This used to keep stretching the axis
    // and return `true`, swallowing the crosshair and pan along with it.
    const ate = model.plot.routeInput({
      type: "pointermove",
      point: { x: axis.x, y: axis.y + 120 },
      pointerId: 1,
    });

    expect(ate).toBe(false);
    expect(pane.yScale.getDomain()).toEqual(dragged);
  });

  /** A rejected generation must not move the baseline. */
  it("draws the same array as the node even after a generation is rejected by the input registration", () => {
    // **Preserve the leading point's identity** — rebuilding it as a new
    // object makes `tailDelta` return null and fall through to the full
    // path, and this test would never exercise the tail branch at all.
    const p0 = { x: 0, y: 1 };
    const p1 = { x: 1, y: 2 };
    const p2 = { x: 2, y: 3 };
    const p3 = { x: 3, y: 4 };
    let emitted: { x: number; y: number }[] = [p0, p1];
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data: DATA },
      config: {},
    });
    const handle = model.plot.mainPane.addSeries({
      series: lineSeries(),
      input: { read: () => emitted },
    });
    model.plot.render();

    // A generation with an unreadable point mixed in — the manager rejects it.
    emitted = [p0, p1, { x: 2, y: Number.NaN }];
    expect(() => model.plot.render()).toThrow();

    // The next generation is fine. If the baseline had moved to the
    // rejected array, only the tail would attach here and x=2 would be
    // permanently missing.
    emitted = [p0, p1, p2, p3];
    model.plot.render();

    expect(handle.read().map((point) => point.x)).toEqual([0, 1, 2, 3]);
  });

  /** A failed syncSeries leaves nothing behind. */
  it("a bad spec throwing keeps a sibling's data out too", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data: DATA },
      config: {},
    });
    const pane = model.plot.mainPane;
    pane.clearSeries();
    pane.syncSeries([
      seriesSpec({ id: "a", series: lineSeries(), data: DATA }),
    ]);

    expect(() =>
      pane.syncSeries([
        seriesSpec({
          id: "a",
          series: lineSeries(),
          data: [...DATA, { x: 3, y: 40 }],
        }),
        // An unreadable point — this spec throws at the door.
        seriesSpec({
          id: "b",
          series: lineSeries(),
          data: [{ x: 0, y: Number.NaN }],
        }),
      ]),
    ).toThrow();

    // A rejection leaves nothing behind — if `a` had taken in the new bar,
    // the index and value axis would go stale with no notification
    // (observed: a bar was drawn outside the data area). The observable
    // surface is the x mapping: if the new bar landed, that x now has an index.
    expect(model.plot.xAt(model.plot.pixelAtX(3))).toBeCloseTo(3, 6);
    expect(pane.valueExtent()?.max).toBeLessThan(40);
  });

  /** A mapping written as a class still works — createXMapping is a public extension point. */
  it("a mapping's scan-plane built from prototype methods survives", () => {
    class ClassMapping {
      constructor(private readonly scale: { scale(v: number): number; invert(p: number): number }) {}
      toPixel(x: number): number {
        return this.scale.scale(x);
      }
      fromPixel(px: number): number {
        return this.scale.invert(px);
      }
      toDomain(x: number): number {
        return x;
      }
      fromDomain(value: number): number {
        return value;
      }
      rebuild(): void {}
      scanToDomain(): (x: number) => number {
        // If `this` gets detached, this throws TypeError — the chart dies on the first frame.
        return (x) => this.toDomain(x);
      }
    }

    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data: DATA },
      config: {},
      deps: { createXMapping: (scale) => new ClassMapping(scale) },
    });

    expect(() => model.plot.render()).not.toThrow();
    expect(model.commands().length).toBeGreaterThan(0);
  });
});

/**
 * Five surfaces (axis, badge, tooltip, legend, priceLine) must all use the
 * same number of digits, but only the axis called format(value, step)
 * while the rest were only given the value, so the digit counts diverged.
 */
describe("all five surfaces use the same number of digits", () => {
  const tiny = Array.from({ length: 20 }, (_, i) => ({
    x: i,
    y: 0.00001234 + i * 0.00000001,
  }));

  function altcoinStage() {
    return createPlotModel({
      size: { width: 600, height: 400 },
      series: { series: lineSeries(), data: tiny },
      config: { axis: { y: { format: priceFormat() } } },
    });
  }

  it("a badge's digit count matches the tick label's", () => {
    const model = altcoinStage();
    model.plot.render();

    const labels = model
      .commands()
      .filter((command) => command.type === "drawText")
      .map((command) => command.params.text)
      .filter((text) => text.startsWith("0.0000"));
    expect(labels.length).toBeGreaterThan(1);

    const digitsOf = (text: string) => text.split(".")[1]?.length ?? 0;
    const badge = model.plot.mainPane.formatValue(0.00001234);

    // It used to read as "0.00" (two digits) — the price came out as zero.
    expect(digitsOf(badge)).toBe(digitsOf(labels[0]));
    expect(badge).toContain("0.00001");
  });

  it("an explicit precision cannot be beaten by the tick spacing — the user is in charge", () => {
    const model = createPlotModel({
      size: { width: 600, height: 400 },
      series: { series: lineSeries(), data: tiny },
      config: { axis: { y: { format: priceFormat({ precision: 3 }) } } },
    });
    model.plot.render();

    expect(model.plot.mainPane.formatValue(0.00001234)).toBe("0.000");
  });
});

/**
 * Delegation, not copying. The draw context used to copy the mapping via
 * a spread, so a class-based mapping reached the series with only
 * toPixel surviving.
 */
describe("the draw context's mapping does not lose its original", () => {
  class ClassMapping {
    constructor(
      private readonly scale: { scale(v: number): number; invert(p: number): number },
    ) {}
    toPixel(x: number): number {
      return this.scale.scale(this.toDomain(x));
    }
    fromPixel(px: number): number {
      return this.fromDomain(this.scale.invert(px));
    }
    toDomain(x: number): number {
      return x;
    }
    fromDomain(value: number): number {
      return value;
    }
    domainToPixel(value: number): number {
      return this.scale.scale(value);
    }
    rebuild(): void {}
    scanToDomain(): (x: number) => number {
      return (x) => this.toDomain(x);
    }
    scanToPixel(): (x: number) => number {
      const scan = this.scanToDomain();
      return (x) => this.scale.scale(scan(x));
    }
  }

  it("the x a series receives has all five doors", () => {
    const seen: string[] = [];
    const spy = {
      valueExtent: () => ({ min: 0, max: 30 }),
      draw: (_target: unknown, context: { x: Record<string, unknown> }) => {
        for (const door of [
          "toPixel",
          "fromPixel",
          "toDomain",
          "fromDomain",
          "domainToPixel",
        ]) {
          if (typeof context.x[door] !== "function") seen.push(door);
        }
        // Actually call it — if `this` was detached, this throws.
        (context.x.fromPixel as (px: number) => number)(10);
      },
    };

    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: spy as never, data: DATA },
      config: {},
      deps: { createXMapping: (scale) => new ClassMapping(scale) as never },
    });
    model.plot.render();

    // Four of them used to vanish (only `toPixel` survived) — and calling
    // fromPixel inside the render loop then threw forever.
    expect(seen).toEqual([]);
  });
});

describe("constructor rollback", () => {
  const size = { width: 400, height: 300 };

  it("releases acquired layers and scheduler after renderer construction fails", () => {
    const destroy = vi.fn();
    const cancel = vi.fn();
    const failure = new Error("renderer failed");
    const deps = createPlotDeps({
      createLayers: (w, h) => ({ ...createMemoryLayers(w, h), destroy }),
      createRenderer: () => { throw failure; },
      createScheduler: () => ({ request() {}, cancel }),
      createStyleReader: () => noStyle,
    });
    expect(() => new Plot({ deps, size })).toThrow(failure);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the original failure and finishes rollback when one release also fails", () => {
    const destroy = vi.fn();
    const original = new Error("observer failed");
    const cleanup = new Error("disconnect failed");
    const deps = createPlotDeps({
      createLayers: (w, h) => ({ ...createMemoryLayers(w, h), destroy }),
      createRenderer: recordingRenderer().factory,
      createStyleReader: () => noStyle,
      interactions: { handlePan() {}, handleZoom() {}, handleCrosshair() {}, connect() {}, disconnect() { throw cleanup; } },
      observeSize: () => { throw original; },
    });
    let caught: unknown;
    try { new Plot({ deps, size }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) throw new Error("expected aggregate");
    expect(caught.errors).toEqual([original, cleanup]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("releases plugins installed by a collaborator before constructor failure", () => {
    const cleanup = vi.fn();
    const destroy = vi.fn();
    const deps = createPlotDeps({
      createLayers: (w, h) => ({ ...createMemoryLayers(w, h), destroy }),
      createRenderer: recordingRenderer().factory,
      createStyleReader: () => noStyle,
      interactions: {
        handlePan() {}, handleZoom() {}, handleCrosshair() {}, disconnect() {},
        connect(host) {
          if (!(host instanceof Plot)) throw new Error("expected plot");
          host.use(() => pluginApi({}, cleanup));
          throw new Error("connect failed");
        },
      },
    });
    expect(() => new Plot({ deps, size })).toThrow("connect failed");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});


describe("failed decoration mounting releases its registration", () => {
  it.each(["plot", "pane"])("should let the %s render again after installation throws", (site) => {
    const model = stage();
    const host = site === "plot" ? model.plot : model.plot.mainPane;
    const kept = vi.fn();
    const bad = vi.fn(() => { throw new Error("decoration failed"); });
    host.addDecoration({ draw: kept });
    expect(() => host.addDecoration({ draw: bad })).toThrow("decoration failed");
    kept.mockClear();
    expect(() => model.plot.render()).not.toThrow();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    model.plot.destroy();
  });
});

describe("scheduler cleanup failures do not strand the plot", () => {
  it("should release plugins, panes and layers before reporting every cleanup failure", () => {
    const cancelError = new Error("cancel failed");
    const pluginError = new Error("plugin failed");
    const cancel = vi.fn(() => { throw cancelError; });
    const layersDestroyed = vi.fn();
    const paneDisposed = vi.fn();
    const plot = new Plot({
      size: { width: 400, height: 300 },
      deps: createPlotDeps({
        createLayers: (width, height) => ({ ...createMemoryLayers(width, height), destroy: layersDestroyed }),
        createRenderer: recordingRenderer().factory,
        createStyleReader: () => noStyle,
        createScheduler: () => ({ request() {}, cancel }),
      }),
    });
    plot.use(() => pluginApi({}, () => { throw pluginError; }));
    plot.mainPane.use(() => pluginApi({}, paneDisposed));
    let thrown: unknown;
    try { plot.destroy(); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(AggregateError);
    if (!(thrown instanceof AggregateError)) throw new Error("missing cleanup aggregate");
    expect(thrown.errors).toEqual([cancelError, pluginError]);
    expect(paneDisposed).toHaveBeenCalledTimes(1);
    expect(layersDestroyed).toHaveBeenCalledTimes(1);
    expect(() => plot.destroy()).not.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
