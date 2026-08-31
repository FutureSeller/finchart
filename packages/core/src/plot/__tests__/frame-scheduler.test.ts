/**
 * The scheduler that coalesces requests down to one per frame.
 * render-scheduling.test.ts checks whether the stage schedules a render;
 * this file checks the coalescing itself — since whether rAF exists is
 * the branch point, frameScheduler takes the window (view) as an argument.
 */
import { describe, expect, it, vi } from "vitest";
import { frameScheduler } from "../../render";

/** A window whose rAF you flush by hand. */
function fakeFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let next = 1;

  return {
    view: {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const handle = next++;
        pending.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (handle: number) => {
        pending.delete(handle);
      },
    },
    get scheduled() {
      return pending.size;
    },
    /** Flushes everything that was queued. */
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    },
  };
}

describe("frameScheduler", () => {
  it("should render once no matter how many times a frame asks", () => {
    const frames = fakeFrames();
    const render = vi.fn();
    const scheduler = frameScheduler(frames.view)(render);

    scheduler.request();
    scheduler.request();
    scheduler.request();

    expect(frames.scheduled).toBe(1);
    expect(render).not.toHaveBeenCalled();

    frames.flush();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("should take a new request after the frame ran", () => {
    const frames = fakeFrames();
    const render = vi.fn();
    const scheduler = frameScheduler(frames.view)(render);

    scheduler.request();
    frames.flush();
    scheduler.request();
    frames.flush();

    expect(render).toHaveBeenCalledTimes(2);
  });

  it("should drop a pending frame on cancel", () => {
    const frames = fakeFrames();
    const render = vi.fn();
    const scheduler = frameScheduler(frames.view)(render);

    scheduler.request();
    scheduler.cancel();
    frames.flush();

    expect(frames.scheduled).toBe(0);
    expect(render).not.toHaveBeenCalled();
  });

  it("should let a request through after a cancel", () => {
    const frames = fakeFrames();
    const render = vi.fn();
    const scheduler = frameScheduler(frames.view)(render);

    scheduler.request();
    scheduler.cancel();
    scheduler.request();
    frames.flush();

    expect(render).toHaveBeenCalledTimes(1);
  });

  it("should do nothing when cancelling with no frame pending", () => {
    const frames = fakeFrames();
    const scheduler = frameScheduler(frames.view)(() => undefined);

    expect(() => scheduler.cancel()).not.toThrow();
    expect(frames.scheduled).toBe(0);
  });

  /** node/SSR has no frame to coalesce into — it falls back to running immediately. */
  it("should fall back to immediate where rAF does not exist", () => {
    const render = vi.fn();
    const scheduler = frameScheduler({})(render);

    scheduler.request();

    expect(render).toHaveBeenCalledTimes(1);
  });

  it("should fall back when only one half of the pair exists", () => {
    const render = vi.fn();
    const scheduler = frameScheduler({
      requestAnimationFrame: () => 1,
    })(render);

    scheduler.request();

    expect(render).toHaveBeenCalledTimes(1);
  });
});
