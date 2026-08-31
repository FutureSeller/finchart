/** The handle's liveness rules with no pane — a fake entry and a recording host. */
import { describe, expect, it, vi } from "vitest";
import { ContractError } from "../../primitives";
import type { TypedEntry } from "../../registration";
import { createSeriesHandle, type HandleHost } from "../series-handle";

function fakeEntry(): TypedEntry<{ x: number }> & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    series: {},
    name: null,
    color: null,
    zIndex: 0,
    nearest: () => null,
    swapSeries: () => void calls.push("swapSeries"),
    feed: () => void calls.push("feed"),
    xRange: () => ({ min: 1, max: 9 }),
    xValues: () => [],
    valueExtent: () => null,
    positiveFloor: () => null,
    draw: () => undefined,
    setData: () => void calls.push("setData"),
    prepend: () => void calls.push("prepend"),
    append: () => void calls.push("append"),
    updateLast: () => {
      calls.push("updateLast");
      return false;
    },
    read: () => [],
  };
}

function setup(over: Partial<HandleHost> = {}) {
  const entry = fakeEntry();
  const notified: unknown[] = [];
  let registered = true;
  const host: HandleHost = {
    registered: () => registered,
    attached: () => registered,
    remove: () => {
      registered = false;
    },
    notify: (change) => void notified.push(change ?? "default"),
    ...over,
  };
  const handle = createSeriesHandle<{ x: number }, { x: number }>(entry, host);
  return { entry, handle, notified, detach: () => (registered = false) };
}

describe("createSeriesHandle", () => {
  it("should refit on setData and keep the window on the rest", () => {
    const { handle, notified } = setup();
    handle.setData([{ x: 1 }]);
    handle.append([{ x: 2 }]);
    handle.prepend([{ x: 0 }]);
    handle.updateLast({ x: 2 });
    handle.swapSeries({} as never);

    expect(notified).toEqual([
      { data: true, refit: true },
      "default",
      "default",
      { data: true, refit: false, xValues: false },
      "default",
    ]);
  });

  it("should skip an empty append or prepend without notifying", () => {
    const { handle, entry, notified } = setup();
    handle.append([]);
    handle.prepend([]);
    expect(entry.calls).toEqual([]);
    expect(notified).toEqual([]);
  });

  it("should throw from every write door once detached, naming the door", () => {
    const { handle, detach } = setup();
    detach();
    expect(() => handle.setData([])).toThrow(/setData/);
    expect(() => handle.prepend([{ x: 1 }])).toThrow(/prepend/);
    expect(() => handle.append([{ x: 1 }])).toThrow(/append/);
    expect(() => handle.updateLast({ x: 1 })).toThrow(/updateLast/);
    expect(() => handle.swapSeries({} as never)).toThrow(/swapSeries/);
  });

  it("should check detachment before the empty-array shortcut", () => {
    // Streaming that mixes in empty chunks is exactly this door's consumer.
    const { handle, detach } = setup();
    detach();
    expect(() => handle.append([])).toThrow(ContractError);
  });

  it("should check the shape before liveness", () => {
    const { handle, detach } = setup();
    detach();
    // @ts-expect-error a null chunk — the shape guard must speak first
    expect(() => handle.append(null)).toThrow(/append\(points\)/);
  });

  it("should keep read, xRange and dispose safe after detaching", () => {
    const { handle, detach } = setup();
    detach();
    expect(handle.read()).toEqual([]);
    expect(handle.xRange).toEqual({ min: 1, max: 9 });
    expect(() => handle.dispose()).not.toThrow();
  });

  it("should answer attached from the host, and dispose through it once", () => {
    const remove = vi.fn();
    let registered = true;
    const { handle } = setup({
      registered: () => registered,
      attached: () => registered,
      remove: () => {
        registered = false;
        remove();
      },
    });
    expect(handle.attached).toBe(true);
    handle.dispose();
    handle.dispose();
    expect(handle.attached).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
