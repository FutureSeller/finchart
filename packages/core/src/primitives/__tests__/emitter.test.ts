/** The single-stream emitter extensions expose — the same removal rules as the chart's channel. */
import { describe, expect, it, vi } from "vitest";
import { emitter } from "../emitter";

describe("emitter", () => {
  it("should still reach later listeners when one unsubscribes itself", () => {
    const stream = emitter<number>();
    const later = vi.fn();
    const off = stream.subscribe(() => off());
    stream.subscribe(later);

    stream.emit(1);

    expect(later).toHaveBeenCalledTimes(1);
  });

  it("should not run a listener another listener unsubscribed earlier in the same emit", () => {
    const stream = emitter<number>();
    const removed = vi.fn();
    let offRemoved = () => {};
    stream.subscribe(() => offRemoved());
    offRemoved = stream.subscribe(removed);

    stream.emit(1);

    expect(removed).not.toHaveBeenCalled();
    expect(stream.size).toBe(1);
  });

  it("should call everyone and then report the failures", () => {
    const stream = emitter<number>("a tool");
    const after = vi.fn();
    stream.subscribe(() => {
      throw new Error("boom");
    });
    stream.subscribe(after);

    expect(() => stream.emit(1)).toThrow(/a tool threw|boom/);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
