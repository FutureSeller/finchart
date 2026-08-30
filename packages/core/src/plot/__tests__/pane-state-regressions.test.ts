/** A collection of regression checks for bugs caught in review. One describe block per fix. */
import { describe, expect, it, vi } from "vitest";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import type { LineDataPoint } from "../../data";
import { ContractError, DataError } from "../../primitives";
import { LinearScale, LogScale } from "../../scale";
import { lineSeries } from "../../series";
import type { InputEvent } from "../../interaction";
import { axisDragConsumer } from "../axis-drag";
import type { DividerDragHandler } from "../dividers";
import { createPlotModel } from "../model";
import { defaultConfig, mountPlot } from "./helpers";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 1, y: 130 },
  { x: 2, y: 160 },
];

function mount(config = defaultConfig) {
  return mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data, config });
}

/** The current frame's y-axis strip x coordinate (left by default). */
function yStripX(plot: { mainPane: { area: { left: number } } }): number {
  return plot.mainPane.area.left - 2;
}

/** Drags the y-axis strip vertically. */
function dragYAxis(
  plot: {
    routeInput(event: InputEvent): boolean;
    mainPane: { area: { left: number; top: number; bottom: number } };
  },
  x = yStripX(plot),
): void {
  const middle = (plot.mainPane.area.top + plot.mainPane.area.bottom) / 2;
  plot.routeInput({ type: "pointerdown", point: { x, y: middle }, pointerId: 1 });
  plot.routeInput({
    type: "pointermove",
    point: { x, y: middle + 40 },
    pointerId: 1,
  });
  plot.routeInput({ type: "pointerup", point: { x, y: middle + 40 }, pointerId: 1 });
}

describe("an inverted pane's ticks land on the same side as the data", () => {
  /**
   * If a tick's position doesn't reflect the inversion, the label is drawn
   * mirror-imaged. Verified through the draw commands — asking only the
   * scale always agrees with itself and would miss it.
   */
  function labelYs(invert: boolean): Map<string, number> {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    model.plot.mainPane.applyOptions({ invert });
    model.plot.render();

    const found = new Map<string, number>();
    for (const command of model.commands()) {
      if (command.type !== "drawText") continue;
      found.set(command.params.text, command.params.at.y);
    }
    return found;
  }

  it("with invert: true, labels stand in the same direction as the values", () => {
    const labels = labelYs(true);
    const low = labels.get("100");
    const high = labels.get("160");

    expect(low).toBeDefined();
    expect(high).toBeDefined();
    // Inverted means the smaller value sits higher (smaller y).
    expect(low!).toBeLessThan(high!);
  });

  it("with invert: false, the larger value sits higher", () => {
    const labels = labelYs(false);
    expect(labels.get("160")!).toBeLessThan(labels.get("100")!);
  });

  it("a label's y equals that value's pixelAtValue", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    model.plot.mainPane.applyOptions({ invert: true });
    model.plot.render();

    let labelY: number | undefined;
    for (const command of model.commands()) {
      if (command.type !== "drawText") continue;
      if (command.params.text === "100") labelY = command.params.at.y;
    }
    expect(labelY).toBeDefined();

    // Axis labels are vertically centered, so the tick's y is the label's y.
    expect(labelY).toBeCloseTo(model.plot.mainPane.pixelAtValue(100), 6);
  });
});

describe("a y-axis drag stops at the range the scale can't accept", () => {
  function dragConsumer(scale: LinearScale | LogScale) {
    const pane = {
      yScale: scale,
      setValueDomain: (min: number, max: number) => scale.setDomain(min, max),
    };
    return axisDragConsumer({
      slices: () => ({
        y: { left: 0, right: 40, top: 0, bottom: 300 },
        x: null,
        data: { left: 40, right: 400, top: 0, bottom: 300 },
      }),
      // This consumer only uses two things from the pane — `ValueAxisTarget`.
      paneAt: () => pane,
      zoomAroundCenter: () => undefined,
      requestRender: () => undefined,
      claimCursor: () => () => undefined,
    });
  }

  /** A bug where dragging a LogScale pane downward tried to push the domain to <= 0 and threw. */
  it("dragging a log axis downward does not throw", () => {
    const scale = new LogScale(100, 200, 300, 0);
    const consumer = dragConsumer(scale);
    consumer.handle({ type: "pointerdown", point: { x: 20, y: 150 }, pointerId: 1 });

    expect(() => {
      for (let i = 1; i <= 200; i += 1) {
        consumer.handle({
          type: "pointermove",
          point: { x: 20, y: 150 + i * 10 },
          pointerId: 1,
        });
      }
    }).not.toThrow();

    const [min] = scale.getDomain();
    expect(min).toBeGreaterThan(0);
  });

  it("still moves within a range the scale can accept", () => {
    const scale = new LinearScale(100, 200, 300, 0);
    const consumer = dragConsumer(scale);
    consumer.handle({ type: "pointerdown", point: { x: 20, y: 150 }, pointerId: 1 });
    consumer.handle({ type: "pointermove", point: { x: 20, y: 170 }, pointerId: 1 });

    const [min, max] = scale.getDomain();
    expect(max - min).toBeGreaterThan(100);
  });
});

describe("removePane removes its own pane even when cleanup re-enters", () => {
  /** detach() can run dispose synchronously and recursively call removePane
   * — a bug where a captured index pointed into a list that had already shifted. */
  it("an extension's dispose removing an earlier pane leaves no zombie", () => {
    const { plot } = mount();
    const a = plot.addPane();
    const b = plot.addPane();

    b.use(() => ({
      dispose: () => plot.removePane(a),
      disposed: false,
    }));

    plot.removePane(b);

    expect(plot.panes).toHaveLength(1);
    expect(plot.panes).not.toContain(b);
    expect(plot.panes).not.toContain(a);
  });
});


describe("coalesceState notifies the mirror even when it throws", () => {
  it("stateChange fires even when applyState throws partway through", () => {
    const { plot } = mount();
    const seen = vi.fn();
    plot.on("stateChange", seen);

    expect(() =>
      plot.applyState({
        panes: [{ flex: 7, autoScale: false, valueDomain: { min: 5, max: 5 } }],
      }),
    ).toThrow(ContractError);

    // flex was already applied — stateChange must report it.
    expect(plot.mainPane.flex).toBe(7);
    expect(seen).toHaveBeenCalled();
  });
});

describe("a divider drag's clamp limit does not flip sign", () => {
  /**
   * If the container is shorter than the sum of the minHeights, normal
   * input can leave both panes below their own minimum — a bug where the
   * clamp limit's sign flipped regardless of dy, moving opposite to the
   * gesture.
   */
  function draggable(height: number, minHeight: number) {
    let onDrag: DividerDragHandler = () => undefined;
    const deps = testBrowserDeps({
      createDividers: (_overlay, handler) => {
        onDrag = handler;
        return { render: () => undefined, clear: () => undefined, destroy: () => undefined };
      },
    });

    const { plot } = mountPlot({
      deps,
      series: lineSeries(),
      data,
      config: { ...defaultConfig, showGrid: false },
      size: { width: 400, height },
    });
    plot.mainPane.applyOptions({ minHeight });
    plot.addPane({ minHeight });
    plot.render();

    const heights = (): number[] =>
      plot.panes.map((pane) => pane.area.bottom - pane.area.top);

    return { plot, drag: (dy: number) => onDrag(0, dy), heights };
  }

  it("pushes in neither direction when both are already below minimum", () => {
    // The container (120) is shorter than the combined minimum (800) — both are below minimum.
    const { drag, heights } = draggable(120, 400);
    const before = heights();
    expect(before[0]).toBeLessThan(400);
    expect(before[1]).toBeLessThan(400);

    drag(-1);
    expect(heights()).toEqual(before);

    drag(+1);
    expect(heights()).toEqual(before);
  });

  it("moves in the direction of the gesture when there's slack", () => {
    const { drag, heights } = draggable(600, 20);
    const before = heights();

    drag(+30);
    const after = heights();

    // Dragging downward grows the top and shrinks the bottom by the same amount.
    expect(after[0]).toBeCloseTo(before[0] + 30, 6);
    expect(after[1]).toBeCloseTo(before[1] - 30, 6);
  });

  it("dragging upward shrinks the top — not the reverse", () => {
    const { drag, heights } = draggable(600, 20);
    const before = heights();

    drag(-30);
    const after = heights();

    expect(after[0]).toBeLessThan(before[0]);
  });
});

describe("a destroyed stage stops building panes", () => {
  it("addPane after destroy throws", () => {
    const { plot } = mount();
    plot.destroy();

    expect(() => plot.addPane()).toThrow(ContractError);
  });
});

describe("a detached handle cannot move the stage", () => {
  it("setData after dispose throws", () => {
    const { plot, handle } = mount();
    plot.setVisibleRange(0, 1);
    handle.dispose();

    expect(() => handle.setData([{ x: 9, y: 9 }])).toThrow(ContractError);
    expect(() => handle.append([{ x: 9, y: 9 }])).toThrow(ContractError);
    expect(() => handle.updateLast({ x: 9, y: 9 })).toThrow(ContractError);
  });

  it("the same holds for a handle evicted by syncSeries", () => {
    const { plot } = mount();
    const extra = plot.mainPane.addSeries({
      series: lineSeries(),
      data: [{ x: 0, y: 1 }],
    });
    expect(extra.read()).toHaveLength(1);

    // Owns the whole list — what addSeries attached gets pushed out here.
    plot.mainPane.syncSeries([]);

    expect(() => extra.append([{ x: 1, y: 2 }])).toThrow(ContractError);
  });

  it("dispose is safe to call twice", () => {
    const { handle } = mount();
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
  });

  /** A throwing contract only holds up if it can be checked in advance — a place to branch without try/catch is needed. */
  it("asking via attached tells you without throwing", () => {
    const { handle } = mount();
    expect(handle.attached).toBe(true);

    handle.dispose();
    expect(handle.attached).toBe(false);

    // Checking first and branching away triggers nothing.
    expect(() => {
      if (handle.attached) handle.updateLast({ x: 9, y: 9 });
    }).not.toThrow();
  });

  it("an evicted handle's attached is false too — a way to confirm a removal you never called", () => {
    const { plot } = mount();
    const extra = plot.mainPane.addSeries({
      series: lineSeries(),
      data: [{ x: 0, y: 1 }],
    });
    expect(extra.attached).toBe(true);

    plot.mainPane.syncSeries([]);
    expect(extra.attached).toBe(false);
  });

  it("read/xRange are still safe after detaching", () => {
    const { handle } = mount();
    handle.dispose();

    expect(() => handle.read()).not.toThrow();
    expect(() => handle.xRange).not.toThrow();
  });

  /**
   * The boundary for "ask" and the boundary for "throw" differ. When a
   * whole pane is dropped, the registration is still alive but attached
   * is false — yet a write that arrives late mid-unmount is a normal path
   * and must not throw.
   */
  it("attached is false once a pane is dropped — even while the registration is alive", () => {
    const { plot } = mount();
    const pane = plot.addPane();
    const owned = pane.addSeries({ series: lineSeries(), data: [{ x: 0, y: 1 }] });
    expect(owned.attached).toBe(true);

    plot.removePane(pane);
    expect(owned.attached).toBe(false);
  });

  it("a write after the stage goes down does not throw — this is the unmount path", () => {
    const { plot } = mount();
    const pane = plot.addPane();
    const owned = pane.addSeries({ series: lineSeries(), data: [{ x: 0, y: 1 }] });
    plot.removePane(pane);

    expect(() => owned.append([{ x: 1, y: 2 }])).not.toThrow();
  });

  it("the same holds after destroy — reports false, but does not throw", () => {
    const { plot, handle } = mount();
    plot.destroy();

    expect(handle.attached).toBe(false);
    expect(() => handle.updateLast({ x: 2, y: 9 })).not.toThrow();
  });
});

describe("applyOptions treats an explicit undefined as not given", () => {
  it("showGrid: undefined does not clear the setting", () => {
    const { plot } = mount({ ...defaultConfig, showGrid: true });
    plot.applyOptions({ showGrid: undefined });

    expect(plot.getOptions().showGrid).toBe(true);
  });

  /** A padding patch should change only the side it gives, but a spread used to overwrite the rest with undefined, leaking NaN. */
  it("even one side of padding coming in as undefined leaves the rest intact", () => {
    const { plot } = mount();

    expect(() => plot.applyOptions({ padding: { left: undefined } })).not.toThrow();
    expect(plot.getOptions().padding.left).toBe(defaultConfig.padding.left);
  });

  it("a given value changes as expected", () => {
    const { plot } = mount({ ...defaultConfig, showGrid: true });
    plot.applyOptions({ showGrid: false });

    expect(plot.getOptions().showGrid).toBe(false);
  });
});

describe("a computation node's output passes through the data door too", () => {
  it("reading back something other than an array is a DataError", () => {
    const { plot } = mount();
    let broken = false;
    const source = {
      read: () => (broken ? (undefined as never) : [{ x: 0, y: 1 }]),
    };

    plot.mainPane.addSeries({ series: lineSeries(), input: source });
    plot.render();

    broken = true;
    expect(() => plot.render()).toThrow(DataError);
  });
});

describe("x-axis size never exceeds the pane's budget", () => {
  /** Verified through the draw commands — if a frame is dropped, area
   * keeps its previous value, so an assertion on area alone would pass
   * even when the chart is actually empty. */
  function commandsWith(size: number): number {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    model.plot.render();

    model.plot.applyOptions({ axis: { x: { size } } });
    model.plot.render();

    return model.commands().length;
  }

  it("a huge size does not permanently empty the chart", () => {
    expect(commandsWith(5000)).toBeGreaterThan(0);
  });

  it("stays non-empty even at a size exactly equal to the area's height", () => {
    // The edge case where clamping to min(size, height) made the budget exactly 0.
    expect(commandsWith(300)).toBeGreaterThan(0);
  });

  it("a negative size does not push the pane off the canvas", () => {
    const { plot } = mount();
    plot.applyOptions({ axis: { x: { size: -100 } } });
    plot.render();

    expect(plot.mainPane.area.bottom).toBeLessThanOrEqual(600);
  });
});

describe("even an empty array throws on a detached handle", () => {
  it("append([])/prepend([]) do not silently pass", () => {
    const { handle } = mount();
    handle.dispose();

    expect(() => handle.append([])).toThrow(ContractError);
    expect(() => handle.prepend([])).toThrow(ContractError);
  });
});

describe("coalesceState's notification does not obscure the cause", () => {
  /** A bug where emitting from a finally block let a subscriber's exception replace the original one. */
  it("the cause survives even when a stateChange subscriber throws too", () => {
    const { plot } = mount();
    plot.on("stateChange", () => {
      throw new Error("subscriber threw");
    });

    let caught: unknown = null;
    try {
      plot.applyState({
        panes: [{ flex: 7, autoScale: false, valueDomain: { min: 5, max: 5 } }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const errors = caught instanceof AggregateError ? caught.errors : [];
    expect(errors[0]).toBeInstanceOf(ContractError);
    expect(plot.mainPane.flex).toBe(7);
  });
});

describe("points that had been missed", () => {
  /**
   * If an option is only read once at install time, axisDrag becomes a
   * lie — building it turned off means it can never be turned on. An
   * assertion that just reads the option back would pass even with dead
   * wiring, so this actually drags to check.
   */
  it("axisDrag can be turned on later — verified by actually dragging", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data },
      config: { showGrid: false, axisDrag: false },
    });
    model.plot.render();

    // While it's off, dragging on the axis does not move the value axis.
    dragYAxis(model.plot);
    expect(model.plot.mainPane.autoScale).toBe(true);

    model.plot.applyOptions({ axisDrag: true });
    model.plot.render();
    dragYAxis(model.plot);

    // Manually setting a value range turns off autoScale.
    expect(model.plot.mainPane.autoScale).toBe(false);
  });

  /** If a degenerate frame doesn't clear its slices, a vanished axis slot keeps being judged "on the axis." */
  it("an old axis slot no longer registers after a degenerate frame", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    model.plot.render();
    const strip = yStripX(model.plot);

    // The data area becomes zero width, so the frame is dropped.
    model.plot.setViewport({ width: 3, height: 300 });
    model.plot.render();

    // Touching the old axis slot should now do nothing.
    dragYAxis(model.plot, strip);
    expect(model.plot.mainPane.autoScale).toBe(true);
  });

  /**
   * A pane that got no slot has EMPTY_AREA (0,0,0,0), and since contains
   * treats its boundary as inclusive, (0,0) fell inside it and could
   * intercept the cursor.
   */
  it("a pane with no slot does not intercept the cursor", () => {
    const model = createPlotModel({
      // A width where the data area is zero-width, so the frame gets dropped.
      size: { width: 3, height: 300 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    model.plot.render();
    expect(model.plot.mainPane.area.right).toBe(0);

    const seen: Array<unknown> = [];
    model.plot.on("crosshair", (payload) => seen.push(payload.pane));
    model.plot.crosshair({ x: 0, y: 0 });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeNull();
  });

  it("pane.axis is a copy — editing it from outside leaves the stage untouched", () => {
    const { plot } = mount();
    const axis = plot.mainPane.axis;
    Reflect.set(axis, "showLabels", false);

    expect(plot.mainPane.axis.showLabels).not.toBe(false);
  });

  it("plot.panes is a copy — mutating what you pull out doesn't give the stage's own list", () => {
    const { plot } = mount();
    plot.addPane();
    const panes = plot.panes;
    expect(panes).toHaveLength(2);

    // Mangling the returned list leaves the stage's own list untouched.
    Reflect.apply(Array.prototype.splice, panes, [0, 2]);
    expect(plot.panes).toHaveLength(2);
  });

  /** A bug where, before any data arrived, it sat pending and blew up inside the first setData. */
  it("setVisibleRange is caught at the door", () => {
    const { plot } = mount();

    expect(() => plot.setVisibleRange(Number.NaN, 10)).toThrow(ContractError);
    expect(() => plot.setVisibleRange(10, 10)).toThrow(ContractError);
    expect(() => plot.setVisibleRange(5, 1)).toThrow(ContractError);
  });

  /** NaN makes a comparator inconsistent, silently scrambling the order — caught at the door. */
  it("a series' zIndex passes through the same door as addDecoration", () => {
    const { plot } = mount();

    expect(() =>
      plot.mainPane.addSeries({
        series: lineSeries(),
        data: [{ x: 0, y: 1 }],
        zIndex: Number.NaN,
      }),
    ).toThrow(ContractError);
  });

  /** A bug where format: undefined erased the stage-wide display, splitting tick and badge formatting apart — omitting it should fall back to Plot's default. */
  it("undefined on a pane's axis does not erase the stage-wide display", () => {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data },
      config: {
        showGrid: false,
        axis: { y: { format: (value: number) => `$${value.toFixed(0)}` } },
      },
    });
    model.plot.mainPane.applyOptions({ axis: { format: undefined } });
    model.plot.render();

    const texts = model
      .commands()
      .filter((command) => command.type === "drawText")
      .map((command) => command.params.text);

    expect(texts.some((text) => text.startsWith("$"))).toBe(true);
  });
});

describe("a collapsed pane and a pane with labels off are different", () => {
  /** Attaches one badge to that pane and counts, from the draw commands, whether it actually landed on the axis strip. */
  function badgeCount(paneAxis: { showLabels?: boolean }, flex: number): number {
    const model = createPlotModel({
      size: { width: 400, height: 300 },
      series: { series: lineSeries(), data },
      config: { showGrid: false },
    });
    const second = model.plot.addPane({ axis: paneAxis, flex, minHeight: 0 });
    second.addSeries({ series: lineSeries(), data });
    second.addDecoration({
      draw: () => undefined,
      axisBadges: () => [
        {
          axis: "y" as const,
          position: second.pixelAtValue(130),
          label: "BADGE",
          back: "#000",
          color: "#fff",
        },
      ],
    });
    model.plot.render();

    return model
      .commands()
      .filter(
        (command) =>
          command.type === "drawText" && command.params.text === "BADGE",
      ).length;
  }

  /** A pane collapsed with flex:0 gets the 1px fake range that
   * floorAtOnePixel produces, and a badge bunched into that narrow strip
   * overlapped another pane's label. */
  it("a collapsed pane does not put up a badge", () => {
    expect(badgeCount({}, 0)).toBe(0);
  });

  /** A pane with only its labels off should still have a normal slot, but the showLabels gate erased the badge along with it. */
  it("a pane with labels off still puts up a badge", () => {
    expect(badgeCount({ showLabels: false }, 1)).toBeGreaterThan(0);
  });
});
