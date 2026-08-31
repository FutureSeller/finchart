/** The chart's event channel on its own — no stage, just names and payloads. */
import { describe, expect, it, vi } from "vitest";
import { eventChannel } from "../event-channel";

interface Events {
  a: number;
  b: string;
}

describe("eventChannel", () => {
  it("should keep handlers of different events apart", () => {
    const events = eventChannel<Events>();
    const a = vi.fn();
    const b = vi.fn();
    events.on("a", a);
    events.on("b", b);

    events.emit("a", 1);

    expect(a).toHaveBeenCalledWith(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("should say whether anyone is listening", () => {
    const events = eventChannel<Events>();
    expect(events.has("a")).toBe(false);
    const off = events.on("a", () => {});
    expect(events.has("a")).toBe(true);
    off();
    expect(events.has("a")).toBe(false);
  });

  it("should still reach later handlers when one unsubscribes itself", () => {
    const events = eventChannel<Events>();
    const later = vi.fn();
    const off = events.on("a", () => off());
    events.on("a", later);

    events.emit("a", 1);

    expect(later).toHaveBeenCalledTimes(1);
  });

  it("should not run a handler subscribed during the same emit", () => {
    const events = eventChannel<Events>();
    const late = vi.fn();
    events.on("a", () => events.on("a", late));

    events.emit("a", 1);
    expect(late).not.toHaveBeenCalled();

    events.emit("a", 2);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("should keep two registrations of the same function apart", () => {
    const events = eventChannel<Events>();
    const handler = vi.fn();
    const first = events.on("a", handler);
    events.on("a", handler);

    first();
    first(); // a second run must not reach the surviving registration
    events.emit("a", 1);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should call everyone and then report the failures", () => {
    const events = eventChannel<Events>();
    const after = vi.fn();
    events.on("a", () => {
      throw new Error("boom");
    });
    events.on("a", after);

    expect(() => events.emit("a", 1)).toThrow(/"a" subscriber threw|boom/);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("should drop every handler on clear", () => {
    const events = eventChannel<Events>();
    const a = vi.fn();
    events.on("a", a);
    events.on("b", () => {});

    events.clear();
    events.emit("a", 1);

    expect(a).not.toHaveBeenCalled();
    expect(events.has("b")).toBe(false);
  });
});
