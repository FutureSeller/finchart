/**
 * Keyboard ownership when there are two toolboxes. A fixture that mocks
 * the stage tends to be defined more narrowly than the real stage,
 * missing boundary cases like axes, margins, and panes with no toolbox.
 * So this file sets up a real `Plot`, creates an indicator pane with a
 * real `addPane`, and mounts a toolbox on only some of them -- the
 * wiring the README sells.
 */
import type { LineDataPoint } from "@finchart/core";
import { createPlotModel, lineSeries } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { drawingTools } from "../tools";

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 5, y: 120 },
  { x: 10, y: 110 },
];

/**
 * main (price) · indicator · axes.
 *
 * `toolsOnIndicator` decides whether a toolbox is also mounted on the
 * indicator pane -- by default it isn't. That's the real-world wiring.
 */
function stage({ toolsOnIndicator = false, indicatorFirst = false } = {}) {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    series: { series: lineSeries(), data },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const { plot } = model;
  const indicator = plot.addPane({ flex: 1 });
  indicator.addSeries({ series: lineSeries(), data });
  plot.render();

  /**
   * Install order can mask a bug in the judgment -- on a tied priority,
   * the router asks the later registration first. In the default order
   * (main -> rsi), even a wrong ownership decision could accidentally
   * line up with "rsi wins" being the correct answer. `indicatorFirst`
   * reverses the order so main gets asked first.
   */
  const rsiFirst = toolsOnIndicator && indicatorFirst
    ? indicator.use(drawingTools({ plot }))
    : null;
  const main = plot.mainPane.use(drawingTools({ plot }));
  const rsi = rsiFirst ?? (toolsOnIndicator ? indicator.use(drawingTools({ plot })) : null);

  main.add({ type: "horizontal", price: 110 });
  rsi?.add({ type: "horizontal", price: 105 });

  const hover = (pane: { area: { top: number; bottom: number } }) =>
    plot.routeInput({
      type: "pointermove",
      point: { x: 100, y: (pane.area.top + pane.area.bottom) / 2 },
      pointerId: 1,
    });

  const key = (k: string) => plot.routeInput({ type: "keydown", key: k });

  return { model, plot, main, rsi, indicator, hover, key };
}

describe("if the cursor is over another pane, the key belongs there", () => {
  it("should keep the selection in the pane under the cursor", () => {
    const s = stage({ toolsOnIndicator: true });
    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);

    s.key("]");

    expect(s.main.selection()).not.toBeNull();
    expect(s.rsi?.selection()).toBeNull();
  });

  it("should delete from the pane under the cursor, not the last registered", () => {
    const s = stage({ toolsOnIndicator: true });
    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);

    s.key("Delete");

    expect(s.main.list()).toEqual([]);
    expect(s.rsi?.list()).toMatchObject([{ type: "horizontal", price: 105 }]);
  });

  it("should hand the keyboard over when the cursor moves to the other pane", () => {
    const s = stage({ toolsOnIndicator: true });
    s.hover(s.indicator);

    s.key("]");

    expect(s.rsi?.selection()).not.toBeNull();
    expect(s.main.selection()).toBeNull();
  });

  /** A disposed toolbox must not keep hold of the keyboard for the remaining toolbox -- its claim is released. */
  it("should release its area claim on dispose", () => {
    const s = stage({ toolsOnIndicator: true });
    s.main.select(s.main.handles()[0]);
    s.rsi?.dispose();

    s.hover(s.indicator);
    s.key("Delete");

    expect(s.main.list()).toEqual([]);
  });
});

describe("ownership does not change over a spot nobody claims", () => {
  /** If the gate only asks "is this inside my area," the price axis, time axis, and margins all come back false. */
  it.each([
    ["the price axis", { x: 795, y: 100 }],
    ["the time axis", { x: 100, y: 599 }],
    ["the top margin", { x: 100, y: 1 }],
  ])("should keep the keyboard when the cursor leaves onto the %s", (_, at) => {
    const s = stage({ toolsOnIndicator: true });
    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);

    s.plot.routeInput({ type: "pointermove", point: at, pointerId: 1 });
    s.key("Delete");

    expect(s.main.list()).toEqual([]);
    expect(s.rsi?.list()).toMatchObject([{ type: "horizontal", price: 105 }]);
  });

  /**
   * If the check only asks "is this over some pane," the instant the
   * cursor drops onto an indicator pane with no toolbox (the default
   * wiring we sell), Delete, `]`, and `[` all die silently.
   */
  it("should keep the keyboard over a pane that has no toolbox", () => {
    const s = stage(); // no toolbox on the indicator pane -- the default wiring
    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);

    s.hover(s.indicator);
    s.key("Delete");

    expect(s.main.list()).toEqual([]);
  });

  /** Delete must stay alive even after the dragging hand crosses into the indicator pane. */
  it("should still delete after a drag that crossed into a toolbox-less pane", () => {
    const s = stage();
    const on = { x: 400, y: s.plot.mainPane.pixelAtValue(110) };
    const below = { x: 400, y: s.indicator.area.top + 20 };

    s.plot.routeInput({ type: "pointerdown", point: on, pointerId: 1 });
    s.plot.routeInput({ type: "pointermove", point: below, pointerId: 1 });
    s.plot.routeInput({ type: "pointerup", point: below, pointerId: 1 });

    s.key("Delete");

    expect(s.main.list()).toEqual([]);
  });

  /** If the cursor never passed over it, that's unknown, not someone else's -- cycling with the keyboard alone must still work. */
  it("should still cycle with the keyboard alone", () => {
    const s = stage();
    expect(s.main.selection()).toBeNull();
    s.key("]");
    expect(s.main.selection()).not.toBeNull();
  });
});

/**
 * A neighbor that doesn't contest. If the check only asks "is there
 * someone else with an area," an extension like a legend that has an
 * area but doesn't care about the keyboard could still kill the
 * toolbox's keys -- only a neighbor that registered to contest the
 * keyboard should be able to take ownership.
 */
describe("a neighbor that doesn't contest the key cannot change ownership", () => {
  it("should ignore an extension that never claimed focus", () => {
    const s = stage();
    // An extension like a legend that has an area but doesn't contest the
    // keyboard -- it simply never registers.
    s.plot.use(() => ({ dispose: () => {}, get disposed() { return false; } }));

    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);
    s.hover(s.indicator);
    s.key("Delete");

    expect(s.main.list()).toEqual([]);
  });

  /** Only a neighbor that registered to contest takes ownership -- that's the whole point of this door. */
  it("should hand over only to a claimant that contests focus", () => {
    const s = stage();
    const rival = s.plot.claimFocusArea(() => s.indicator.area);

    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);
    s.hover(s.indicator);
    s.key("Delete");

    expect(s.main.list()).toMatchObject([{ type: "horizontal", price: 110 }]);
    rival.release();
  });

  /** Releasing the registration hands ownership back too. */
  it("should take focus back when the rival releases", () => {
    const s = stage();
    const rival = s.plot.claimFocusArea(() => s.indicator.area);
    rival.release();

    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);
    s.hover(s.indicator);
    s.key("Delete");

    expect(s.main.list()).toEqual([]);
  });
});

/**
 * Someone else's bug does not kill my keyboard. Even if a third-party
 * extension's `areaOf` throws or returns a strange value, that error
 * must stay contained to itself, not spread to a neighboring toolbox.
 */
describe("my key survives even a bad areaOf from a contestant", () => {
  it.each([
    ["null -- not contesting right now", () => null],
    ["throws", () => { throw new Error("the other extension blew up"); }],
    ["not the right shape", () => "nope"],
    ["non-finite", () => ({ left: 0, right: Number.NaN, top: 0, bottom: 1 })],
    ["a degenerate area", () => ({ left: 0, right: 0, top: 0, bottom: 0 })],
  ])("%s", (_label, areaOf) => {
    const s = stage();
    const rival = s.plot.claimFocusArea(areaOf as never);

    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);
    expect(() => s.hover(s.indicator)).not.toThrow();
    s.key("Delete");

    expect(s.main.list()).toEqual([]);
    rival.release();
  });

  /** Control -- a well-behaved contestant actually does take ownership. The above isn't free. */
  it("control: a well-behaved contestant takes ownership", () => {
    const s = stage();
    const rival = s.plot.claimFocusArea(() => s.indicator.area);
    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);
    s.hover(s.indicator);
    s.key("Delete");
    expect(s.main.list()).toMatchObject([{ type: "horizontal", price: 110 }]);
    rival.release();
  });

  /**
   * The judgment does not depend on registration order -- using `some`'s
   * short-circuit means that if an earlier claimant returns true first,
   * a later `areaOf` never gets called, so whether it would have thrown
   * becomes a matter of registration order.
   */
  it("should not let registration order decide whether it throws", () => {
    const s = stage();
    const good = s.plot.claimFocusArea(() => s.indicator.area);
    const bad = s.plot.claimFocusArea(() => {
      throw new Error("the second one blows up");
    });

    s.hover(s.plot.mainPane);
    expect(() => s.hover(s.indicator)).not.toThrow();

    good.release();
    bad.release();
  });
});

/**
 * The shared 1px boundary. If both ends are inclusive, the boundary y
 * falls inside both panes at once, so each one believes it owns it, and
 * the winner ends up decided by registration order instead of the
 * cursor.
 */
describe("at a shared boundary, exactly one pane owns it", () => {
  it("should give the shared edge to exactly one pane", () => {
    // Make main get asked first -- otherwise rsi wins even when the
    // judgment is wrong.
    const s = stage({ toolsOnIndicator: true, indicatorFirst: true });
    const edge = { x: 100, y: s.indicator.area.top };

    s.hover(s.plot.mainPane);
    s.main.select(s.main.handles()[0]);
    s.rsi?.select(s.rsi.handles()[0]);
    s.plot.routeInput({ type: "pointermove", point: edge, pointerId: 1 });
    s.key("Delete");

    // The boundary belongs to the pane **below** -- the pane above's
    // bottom edge is not its own territory. This used to have both
    // believing it was theirs, with the winner decided by registration
    // order.
    expect(s.rsi?.list()).toEqual([]);
    expect(s.main.list()).toMatchObject([{ type: "horizontal", price: 110 }]);
  });
});

/**
 * Touch has no hover. If ownership is only decided on `pointermove` and
 * `contextmenu`, a tap on a tablet arrives straight as `pointerdown`, so
 * both toolboxes could believe they own it at once.
 */
describe("touch -- wherever the finger landed owns it", () => {
  it("should hand focus to the pane the finger touched, not the one hovered", () => {
    const s = stage({ toolsOnIndicator: true });
    const onMain = { x: 400, y: s.plot.mainPane.pixelAtValue(110) };
    const onRsi = { x: 400, y: s.indicator.pixelAtValue(105) };

    // The cursor was over main, but the finger touched rsi -- if
    // ownership isn't updated on the tap (pointerdown) too, Delete would
    // erase main's line, which the user never touched.
    s.plot.routeInput({ type: "pointermove", point: onMain, pointerId: 1 });
    s.plot.routeInput({ type: "pointerdown", point: onRsi, pointerId: 2 });
    s.plot.routeInput({ type: "pointerup", point: onRsi, pointerId: 2 });

    s.key("Delete");

    expect(s.rsi?.list()).toEqual([]);
    expect(s.main.list()).toMatchObject([{ type: "horizontal", price: 110 }]);
  });
});

/**
 * A toolbox's own drag must not steal its own keyboard. While a toolbox
 * holds the router's capture, every move goes only to it and its
 * sibling never sees them -- but if it gave up ownership just because
 * the cursor crossed into another pane, the sibling wouldn't pick it up
 * either, and nobody would receive Delete. An in-progress gesture must
 * freeze the judgment.
 */
describe("an in-progress gesture does not release ownership", () => {
  it("should still delete after a drag that crossed into another pane", () => {
    const s = stage({ toolsOnIndicator: true });
    const main = s.plot.mainPane;
    const onMainLine = { x: 400, y: main.yScale.scale(110) };
    const insideIndicator = { x: 400, y: s.indicator.area.top + 20 };

    // Grab main's shape and drag it into the indicator pane -- one
    // pointer, still captured.
    s.plot.routeInput({ type: "pointerdown", point: onMainLine, pointerId: 1 });
    s.plot.routeInput({ type: "pointermove", point: insideIndicator, pointerId: 1 });
    s.plot.routeInput({ type: "pointerup", point: insideIndicator, pointerId: 1 });

    // The handle is drawn on screen -- Delete must not be dead here.
    expect(s.main.selection()).not.toBeNull();
    expect(s.key("Delete")).toBe(true);
    expect(s.main.list()).toEqual([]);
  });
});
