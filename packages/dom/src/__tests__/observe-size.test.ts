/**
 * The base wiring that follows container size. `plot/__tests__/auto-size.test.ts`
 * watches the stage's reaction with a fake observer; this file covers the
 * part that wraps the real `ResizeObserver` (SSR fallback, rounding,
 * disconnecting).
 */
import { describe, expect, it, vi } from "vitest";
import { observeElementSize } from "../observe-size";

type ObserverCallback = (entries: { contentRect: DOMRectReadOnly }[]) => void;

/** What the first measurement reads: the client box and the padding inside it. */
interface Box {
  clientWidth: number;
  clientHeight: number;
  padding: [top: number, right: number, bottom: number, left: number];
}

/** An element fitted with a window (view) that mimics `ResizeObserver`. */
function elementIn(
  hasObserver: boolean,
  box: Box = { clientWidth: 0, clientHeight: 0, padding: [0, 0, 0, 0] },
) {
  const observed: unknown[] = [];
  const disconnect = vi.fn();
  let fire: ObserverCallback = () => undefined;
  const [top, right, bottom, left] = box.padding.map((value) => `${value}px`);
  const style = {
    paddingTop: top,
    paddingRight: right,
    paddingBottom: bottom,
    paddingLeft: left,
  };

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
      defaultView: hasObserver
        ? { ResizeObserver: FakeResizeObserver, getComputedStyle: () => style }
        : {},
    },
    clientWidth: box.clientWidth,
    clientHeight: box.clientHeight,
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

  /**
   * The first callback comes after the first frame is drawn, so a chart that
   * waited for it would draw that frame at the size it was built with.
   */
  it("should report the current size as soon as watching starts", () => {
    const dom = elementIn(true, {
      clientWidth: 1024,
      clientHeight: 767,
      padding: [0, 0, 0, 0],
    });
    const onResize = vi.fn();

    observeElementSize(dom.element)(onResize);

    expect(onResize).toHaveBeenCalledWith(1024, 767);
  });

  /** The first report is once, up front — following the container is still the observer's job. */
  it("should keep watching after the first report", () => {
    const dom = elementIn(true, { clientWidth: 1024, clientHeight: 767, padding: [0, 0, 0, 0] });
    const onResize = vi.fn();

    observeElementSize(dom.element)(onResize);
    dom.fire()([dom.size(640.4, 480)]);

    expect(dom.observed).toEqual([dom.element]);
    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onResize).toHaveBeenLastCalledWith(640, 480);
  });

  /** The callback reports the content box, so the first report must as well. */
  it("should leave the padding out of the first report", () => {
    const dom = elementIn(true, {
      clientWidth: 1000,
      clientHeight: 500,
      padding: [5, 10, 7.6, 12.4],
    });
    const onResize = vi.fn();

    observeElementSize(dom.element)(onResize);

    expect(onResize).toHaveBeenCalledWith(978, 487);
  });

  /** An element that is not rendered measures 0 — less its padding, a negative size. */
  it("should not report a size the element does not have yet", () => {
    const dom = elementIn(true, {
      clientWidth: 0,
      clientHeight: 0,
      padding: [10, 10, 10, 10],
    });
    const onResize = vi.fn();

    observeElementSize(dom.element)(onResize);

    expect(onResize).not.toHaveBeenCalled();
  });

  /** Measured before observing: a callback that throws leaves no observer attached. */
  it("should not start watching when the first report throws", () => {
    const dom = elementIn(true, {
      clientWidth: 1000,
      clientHeight: 500,
      padding: [0, 0, 0, 0],
    });
    const onResize = vi.fn(() => {
      throw new Error("refused");
    });

    expect(() => observeElementSize(dom.element)(onResize)).toThrow("refused");
    expect(dom.observed).toEqual([]);
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

  it("should not measure where ResizeObserver does not exist", () => {
    const dom = elementIn(false, {
      clientWidth: 1000,
      clientHeight: 500,
      padding: [0, 0, 0, 0],
    });
    const onResize = vi.fn();

    expect(() => observeElementSize(dom.element)(onResize)).not.toThrow();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("should do nothing for an element with no document", () => {
    const orphan = {} as HTMLElement;

    expect(() => observeElementSize(orphan)(() => undefined)()).not.toThrow();
  });
});
