/** The single-stream emitter extensions expose — the same removal rules as the chart's channel. */
import { describe, expect, it, vi } from "vitest";
import { emitter } from "../emitter";

describe("emitter", () => {
  it("should stop calling a listener that unsubscribed, and tolerate a second off", () => {
    const stream = emitter<number>();
    const seen: number[] = [];
    const off = stream.subscribe((n) => seen.push(n));

    stream.emit(1);
    off();
    off(); // Safe to call twice
    stream.emit(2);

    expect(seen).toEqual([1]);
  });

  it("should report how many are listening", () => {
    const stream = emitter<void>();
    expect(stream.size).toBe(0);

    const off = stream.subscribe(() => {});
    expect(stream.size).toBe(1);

    off();
    expect(stream.size).toBe(0);
  });

  it("should not call listeners subscribed during the same emit", () => {
    const stream = emitter<void>();
    const late = vi.fn();

    stream.subscribe(() => stream.subscribe(late));
    stream.emit();

    // Otherwise a handler could keep growing itself forever.
    expect(late).not.toHaveBeenCalled();
  });

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

  it("should call everyone and then rethrow a lone failure as itself", () => {
    const stream = emitter<number>("a tool");
    const after = vi.fn();
    const boom = new Error("boom");
    stream.subscribe(() => {
      throw boom;
    });
    stream.subscribe(after);

    expect(() => stream.emit(1)).toThrow(boom);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("should aggregate several failures under the owner's name", () => {
    const stream = emitter<number>("a tool");
    const first = new Error("first");
    const second = new Error("second");
    stream.subscribe(() => {
      throw first;
    });
    stream.subscribe(() => {
      throw second;
    });

    let caught: unknown;
    try {
      stream.emit(1);
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof AggregateError)) throw new Error("expected an AggregateError");
    expect(caught.message).toBe("a tool threw");
    expect(caught.errors).toEqual([first, second]);
  });
});
