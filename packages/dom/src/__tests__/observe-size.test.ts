/**
 * The base wiring that follows container size. `plot/__tests__/auto-size.test.ts`
 * watches the stage's reaction with a fake observer; this file covers the
 * part that wraps the real `ResizeObserver` (SSR fallback, rounding,
 * disconnecting).
 */
import { describe, expect, it, vi } from "vitest";
import { observeElementSize } from "../observe-size";

type ObserverCallback = (entries: { contentRect: DOMRectReadOnly }[]) => void;

/** An element fitted with a window (view) that mimics `ResizeObserver`. */
function elementIn(hasObserver: boolean) {
  const observed: unknown[] = [];
  const disconnect = vi.fn();
  let fire: ObserverCallback = () => undefined;

  class FakeResizeObserver {
    constructor(callback: ObserverCallback) {
      fire = callback;
    }
    observe(target: unknown) {
      observed.push(target);
    }
    disconnect = disconnect;
  }

  const element = {
    ownerDocument: {
      defaultView: hasObserver ? { ResizeObserver: FakeResizeObserver } : {},
    },
  } as unknown as HTMLElement;

  const size = (width: number, height: number) =>
    ({ contentRect: { width, height } }) as { contentRect: DOMRectReadOnly };

  return { element, observed, disconnect, size, fire: () => fire };
}

describe("observeElementSize", () => {
  it("should watch the element it was given", () => {
    const dom = elementIn(true);

    observeElementSize(dom.element)(() => undefined);

    expect(dom.observed).toEqual([dom.element]);
  });

  it("should report rounded css pixels", () => {
    const dom = elementIn(true);
    const onResize = vi.fn();

    observeElementSize(dom.element)(onResize);
    dom.fire()([dom.size(1023.6, 767.2)]);

    expect(onResize).toHaveBeenCalledWith(1024, 767);
  });

  /** If it changed several times in one frame, only the last one matters. */
  it("should use the last entry when several arrive at once", () => {
    const dom = elementIn(true);
    const onResize = vi.fn();

    observeElementSize(dom.element)(onResize);
    dom.fire()([dom.size(100, 100), dom.size(200, 200), dom.size(300, 300)]);

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(300, 300);
  });

  it("should stop watching when the returned function is called", () => {
    const dom = elementIn(true);

    observeElementSize(dom.element)(() => undefined)();

    expect(dom.disconnect).toHaveBeenCalled();
  });

  /**
   * Standing up a stage under SSR is a normal path — there's simply nothing
   * to observe, not an invalid state, so it must not throw.
   */
  it("should do nothing where ResizeObserver does not exist", () => {
    const dom = elementIn(false);
    const onResize = vi.fn();

    const stop = observeElementSize(dom.element)(onResize);

    expect(dom.observed).toEqual([]);
    expect(() => stop()).not.toThrow();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("should do nothing for an element with no document", () => {
    const orphan = {} as HTMLElement;

    expect(() => observeElementSize(orphan)(() => undefined)()).not.toThrow();
  });
});
