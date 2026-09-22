import { mountDrawingStage } from "./drawing-stage.fixture";
/**
 * Don't trust the consumer. If `add` only validates the argument and
 * then saves it via `structuredClone`, an argument that uses getters or
 * a prototype can make validation and storage see different values -- a
 * class instance gets stored as `{}`, and `load` can end up rejecting
 * its own `serialize()` output. Next session the ledger is gone, but
 * the line is still drawn on screen, so nobody notices.
 *
 * This file pins that round-trip invariant down against hostile input.
 */
import { describe, expect, it } from "vitest";
import {
  barIndexX,
  ContractError,
  createPlotModel,
  lineSeries,
} from "@finchart/core";
import { drawingTools } from "../tools";

const mount = () => {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    deps: { createXMapping: barIndexX },
    config: { showGrid: false },
  });
  model.plot.mainPane.addSeries({
    series: lineSeries(),
    data: [{ x: 0, y: 100 }, { x: 1, y: 110 }],
  });
  return model.plot.mainPane.use(drawingTools({ plot: model.plot }));
};

describe("add builds an owned copy, not the argument itself", () => {
  it("should survive a round trip when the argument uses getters", () => {
    const tools = mount();
    class HorizontalLine {
      get type() {
        return "horizontal" as const;
      }
      get price() {
        return 105;
      }
    }

    tools.add(new HorizontalLine());

    // This used to be `[{}]`, and the load below used to return false.
    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 105 }]);
    expect(tools.load(tools.serialize())).toBe(true);
  });

  it("should survive a round trip when the argument has a prototype", () => {
    const tools = mount();
    tools.add(Object.create({ type: "horizontal", price: 7 }));
    expect(tools.load(tools.serialize())).toBe(true);
  });

  it("should not choke on a function field", () => {
    const tools = mount();
    // This used to throw `DOMException: () => {} could not be cloned` --
    // outside the contract's vocabulary.
    expect(() =>
      tools.add({ type: "horizontal", price: 1, onDone: () => {} } as never),
    ).not.toThrow();
    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 1 }]);
  });

  it("should not let a cyclic argument poison serialize()", () => {
    const tools = mount();
    const cyclic: Record<string, unknown> = { type: "horizontal", price: 2 };
    cyclic.self = cyclic;

    tools.add(cyclic as never);
    // This used to throw `TypeError: Converting circular structure to JSON` here.
    expect(() => tools.serialize()).not.toThrow();
    expect(tools.load(tools.serialize())).toBe(true);
  });
});

describe("the remaining doors are also blocked in the contract's vocabulary", () => {
  const SHAPES: readonly [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["string", "x"],
    ["number", 1],
  ];

  it.each(SHAPES)("begin(%s)", (_label, bad) => {
    expect(() => mount().begin(bad as never)).toThrow(ContractError);
  });

  it("should refuse an unknown kind", () => {
    expect(() => mount().begin("no-such-kind" as never)).toThrow(ContractError);
  });

  /**
   * If `setSnap("no")` passed, it would read as truthy internally and
   * turn on the magnet you meant to turn off.
   */
  it.each(SHAPES)("setSnap(%s)", (_label, bad) => {
    expect(() => mount().setSnap(bad as never)).toThrow(ContractError);
  });

  it.each(SHAPES)("applyOptions(%s)", (_label, bad) => {
    expect(() => mount().applyOptions(bad as never)).toThrow(ContractError);
  });

  it("should refuse assembly without a plot", () => {
    expect(() => drawingTools(null as never)).toThrow(ContractError);
    expect(() => drawingTools({ plot: undefined } as never)).toThrow(ContractError);
  });
});

describe("assembly is held to the same rule", () => {
  const mountWith = (opts: Record<string, unknown>) => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      deps: { createXMapping: barIndexX },
      config: { showGrid: false },
    });
    model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: [{ x: 0, y: 100 }, { x: 1, y: 110 }],
    });
    return model.plot.mainPane.use(
      drawingTools({ plot: model.plot, ...opts } as never),
    );
  };

  /**
   * Not just `setSnap` -- `drawingTools({ snap })` at assembly time must
   * be the same door.
   */
  it.each(["no", "false", 0, 1, null])("should refuse snap: %s", (bad) => {
    expect(() => mountWith({ snap: bad })).toThrow(ContractError);
  });

  /**
   * The lie in the opposite direction -- `snapping()` reports true while
   * nothing actually snaps.
   */
  it.each([NaN, -5, 0, "8px"])("should refuse snapRadius: %s", (bad) => {
    expect(() => mountWith({ snapRadius: bad })).toThrow(ContractError);
  });

  it.each(["red", 42])("should refuse style: %s", (bad) => {
    expect(() => mountWith({ style: bad })).toThrow(ContractError);
  });

  it("should accept a well-formed assembly", () => {
    expect(() => mountWith({ snap: true, snapRadius: 8 })).not.toThrow();
  });
});

describe("validation and storage see the same object", () => {
  const mount2 = () => {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      deps: { createXMapping: barIndexX },
      config: { showGrid: false },
    });
    model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: [{ x: 0, y: 100 }, { x: 1, y: 110 }],
    });
    return model.plot.mainPane.use(drawingTools({ plot: model.plot }));
  };

  /**
   * If the two predicates each read the argument separately, a single
   * getter whose value changes between calls could make validation and
   * storage see different values. Because the check runs on the built
   * copy rather than the raw argument, that gap cannot exist in
   * principle.
   */
  it("should survive a getter that changes between reads", () => {
    const tools = mount2();
    let reads = 0;
    tools.add({
      type: "horizontal",
      get price() {
        return reads++ === 0 ? 100 : NaN;
      },
    } as never);

    expect(tools.load(tools.serialize())).toBe(true);
  });

  /**
   * A getter that switches branches ends safely without throwing --
   * because `toOwnedDrawing` reads `type` exactly once and builds using
   * that one branch.
   */
  it("should stay consistent when a getter switches the variant", () => {
    const tools = mount2();
    let reads = 0;
    tools.add({
      get type() {
        return reads++ === 0 ? "horizontal" : "trend";
      },
      price: 1,
    } as never);

    expect(tools.load(tools.serialize())).toBe(true);
    expect(tools.list()).toMatchObject([{ type: "horizontal", price: 1 }]);
  });

  /** Even a getter that throws from a consumer's store gets translated into the contract's vocabulary. */
  it("should translate a throwing getter", () => {
    const tools = mount2();
    expect(() =>
      tools.add({
        type: "horizontal",
        get price(): number {
          throw new Error("boom from consumer store");
        },
      } as never),
    ).toThrow(ContractError);
  });

  /**
   * Both doors (add and load) store the same shape -- whichever one it
   * enters through, it goes through the same normalization. Ids are the
   * one legitimate difference: add mints a fresh one, load keeps (or
   * derives) the payload's — so the comparison strips them, and asserts
   * separately that both doors produced one.
   */
  it("should store the same shape through add and load", () => {
    const viaAdd = mount2();
    viaAdd.add({ type: "horizontal", price: 100, junk: "x" } as never);

    const viaLoad = mount2();
    viaLoad.load(
      '{"version":1,"drawings":[{"type":"horizontal","price":100,"junk":"x"}]}',
    );

    const shapeOf = (api: typeof viaAdd) =>
      api.list().map(({ id, ...rest }) => {
        expect(id.length).toBeGreaterThan(0);
        return rest;
      });
    expect(shapeOf(viaLoad)).toEqual(shapeOf(viaAdd));
    expect(viaAdd.list()).toMatchObject([{ type: "horizontal", price: 100 }]);
  });
});

it('does not add after an input getter disposes the toolbox', () => {
  const { api } = mountDrawingStage();
  expect(() => api.add({ type: 'horizontal', get price() { api.dispose(); return 50; } })).toThrow(/disposed/);
  expect(api.list()).toEqual([]);
});

it('does not write or record history for a target removed by a patch getter', () => {
  const { api } = mountDrawingStage();
  const handle = api.add({ type: 'horizontal', price: 50 });
  expect(() => handle.update({ get price() { api.clear(); return 60; } })).toThrow(/changed while reading/);
  expect(handle.read()).toMatchObject({ price: 50 });
  expect(api.list()).toEqual([]);
  expect(api.canUndo()).toBe(false);
  api.dispose();
});
