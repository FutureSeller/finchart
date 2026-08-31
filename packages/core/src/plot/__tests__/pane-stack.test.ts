/**
 * The pane list on its own — no stage, no render. The subtle contracts
 * here (main survives, a removal during someone else's cleanup takes the
 * right pane, teardown walks a copy) used to be reachable only through a
 * whole chart and its lifecycle regressions.
 */
import { describe, expect, it, vi } from "vitest";
import type { DataManagerFactory } from "../../data";
import { M4Decimation, SimpleDataManager } from "../../data";
import { ContractError } from "../../primitives";
import { LinearScale } from "../../scale";
import type { Pane, PaneChange } from "../pane";
import { pluginApi } from "../../primitives";
import { PaneStack } from "../panes";

const managers: DataManagerFactory = (coordinates) =>
  new SimpleDataManager({
    decimation: new M4Decimation(coordinates),
    coordinates,
  });

function setup() {
  const created: Pane[] = [];
  const changes: PaneChange[] = [];
  const stack = new PaneStack(new LinearScale(), {
    createDataManager: managers,
    yAxisOptions: () => undefined,
    onCreate: (pane) => created.push(pane),
    onChange: (change) => changes.push(change),
  });
  return { stack, created, changes };
}

describe("PaneStack", () => {
  it("should start with the main pane, which every pane is born through onCreate", () => {
    const { stack, created } = setup();
    expect(stack.list).toHaveLength(1);
    expect(stack.main).toBe(stack.list[0]);
    expect(created).toEqual([stack.main]);

    const added = stack.add(new LinearScale(), {});
    expect(stack.list).toEqual([stack.main, added]);
    expect(created).toEqual([stack.main, added]);
  });

  it("should forward a pane's changes to the chart", () => {
    const { stack, changes } = setup();
    const pane = stack.add(new LinearScale(), {});
    pane.applyOptions({ flex: 2 });
    expect(changes.length).toBeGreaterThan(0);
  });

  it("should refuse to remove the main pane", () => {
    const { stack } = setup();
    expect(() => stack.remove(stack.main)).toThrow(ContractError);
  });

  it("should reject a duplicate stateKey", () => {
    const { stack } = setup();
    stack.add(new LinearScale(), { stateKey: "rsi" });
    expect(() => stack.add(new LinearScale(), { stateKey: "rsi" })).toThrow(
      /stateKey/,
    );
  });

  it("should report a pane it does not hold as not removed", () => {
    const { stack } = setup();
    const other = setup().stack.add(new LinearScale(), {});
    expect(stack.remove(other)).toBeNull();
  });

  it("should stop forwarding once a pane is removed", () => {
    const { stack, changes } = setup();
    const pane = stack.add(new LinearScale(), {});
    stack.remove(pane);
    changes.length = 0;
    pane.applyOptions({ flex: 3 });
    expect(changes).toEqual([]);
  });

  it("should still remove the right pane when a cleanup removes a neighbor first", () => {
    // [main, a, b] — b's extension removes a while b is being detached.
    const { stack } = setup();
    const a = stack.add(new LinearScale(), {});
    const b = stack.add(new LinearScale(), {});
    b.use(() => pluginApi({}, () => void stack.remove(a)));

    expect(stack.remove(b)).toEqual([]);
    expect(stack.list).toEqual([stack.main]);
  });

  it("should finish a removal even when an extension's cleanup throws, and report it", () => {
    const { stack } = setup();
    const pane = stack.add(new LinearScale(), {});
    pane.use(() =>
      pluginApi({}, () => {
        throw new Error("cleanup failed");
      }),
    );

    expect(stack.remove(pane)).toHaveLength(1);
    expect(stack.list).toEqual([stack.main]);
  });

  it("should detach every pane on teardown even when one removes another", () => {
    const { stack } = setup();
    const a = stack.add(new LinearScale(), {});
    const b = stack.add(new LinearScale(), {});
    const bDisposed = vi.fn();
    a.use(() => pluginApi({}, () => void stack.remove(b)));
    b.use(() => pluginApi({}, bDisposed));

    const failures = stack.detachAll();

    expect(failures).toEqual([]);
    expect(bDisposed).toHaveBeenCalledTimes(1);
  });

  it("should union the x range across panes and answer null when empty", () => {
    const { stack } = setup();
    expect(stack.xRange()).toBeNull();
  });
});

describe("PaneStack.at", () => {
  function withAreas() {
    const { stack } = setup();
    const lower = stack.add(new LinearScale(), {});
    stack.main.setArea({ left: 0, right: 100, top: 0, bottom: 50 });
    lower.setArea({ left: 0, right: 100, top: 50, bottom: 100 });
    return { stack, lower };
  }

  it("should find the pane under a point", () => {
    const { stack, lower } = withAreas();
    expect(stack.at({ x: 10, y: 10 })).toBe(stack.main);
    expect(stack.at({ x: 10, y: 75 })).toBe(lower);
    expect(stack.at({ x: 200, y: 75 })).toBeNull();
  });

  it("should not let a pane with no area yet win a hit", () => {
    // Before its first frame a pane's area is the empty box at (0,0) — a
    // phantom hit there used to read a value off a pane nobody can see.
    const { stack } = setup();
    stack.main.setArea({ left: 10, right: 100, top: 10, bottom: 50 });
    stack.add(new LinearScale(), {});
    expect(stack.at({ x: 0, y: 0 })).toBeNull();
    expect(stack.atY(0)).toBeNull();
  });
});
