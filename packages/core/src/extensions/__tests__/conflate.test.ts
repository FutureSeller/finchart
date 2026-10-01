import { describe, expect, it } from "vitest";
import type { OHLC } from "../../data";
import { manualScheduler } from "../../render";
import { conflated, type ConflatedFeed } from "../conflate";

/** A handle that records updateLast calls — the only surface the feed touches. */
function recordingHandle<T>() {
  const updates: T[] = [];
  let attached = true;
  return {
    updates,
    detach: () => {
      attached = false;
    },
    handle: {
      updateLast: (point: T) => void updates.push(point),
      get attached() {
        return attached;
      },
    },
  };
}

const bar = (x: number, close: number, high = close): OHLC => ({
  x,
  open: 100,
  high,
  low: 99,
  close,
});

describe("conflation", () => {
  it("should fold a burst of same-bar ticks into one updateLast", () => {
    const { updates, handle } = recordingHandle<OHLC>();
    const frame = manualScheduler();
    const feed = conflated(handle, { schedule: frame });

    for (let i = 0; i < 50; i++) feed.push(bar(10, 100 + i));
    frame.created[0].flush();

    expect(updates).toEqual([bar(10, 149)]);
  });

  it("should apply a custom merge instead of last-wins", () => {
    const { updates, handle } = recordingHandle<OHLC>();
    const frame = manualScheduler();
    const feed = conflated(handle, {
      schedule: frame,
      merge: (pending, incoming) => ({
        ...incoming,
        high: Math.max(pending.high, incoming.high),
      }),
    });

    feed.push(bar(10, 100, 105));
    feed.push(bar(10, 101, 101));
    frame.created[0].flush();

    // The spike survives the fold.
    expect(updates[0]?.high).toBe(105);
    expect(updates[0]?.close).toBe(101);
  });

  it("should flush the previous bar the moment a new bar arrives", () => {
    const { updates, handle } = recordingHandle<OHLC>();
    const frame = manualScheduler();
    const feed = conflated(handle, { schedule: frame });

    feed.push(bar(10, 100));
    feed.push(bar(10, 102));
    feed.push(bar(11, 200)); // rollover mid-burst
    frame.created[0].flush();

    // Bar 10's final state is data, not a visual nicety — last-wins across
    // the boundary would lose it.
    expect(updates).toEqual([bar(10, 102), bar(11, 200)]);
  });

  it("should detect a new bar through the x the series reads", () => {
    type Tick = OHLC & { time: number };
    const { updates, handle } = recordingHandle<Tick>();
    const frame = manualScheduler();
    const feed = conflated(handle, { schedule: frame, xOf: (point) => point.time });

    feed.push({ ...bar(0, 1), time: 10 });
    feed.push({ ...bar(0, 2), time: 20 });

    expect(updates.map((point) => point.time)).toEqual([10]);
  });

  it("should flush pending ticks on dispose instead of dropping them", () => {
    const { updates, handle } = recordingHandle<OHLC>();
    const frame = manualScheduler();
    const feed = conflated(handle, { schedule: frame });

    feed.push(bar(10, 100));
    feed.dispose();

    expect(updates).toEqual([bar(10, 100)]);
    expect(frame.created[0].pending).toBe(false);
    expect(() => feed.dispose()).not.toThrow();
  });

  it("should not deliver after dispose", () => {
    const { updates, handle } = recordingHandle<OHLC>();
    const frame = manualScheduler();
    const feed = conflated(handle, { schedule: frame });

    feed.dispose();
    feed.push(bar(10, 100));
    frame.created[0].flush();

    expect(updates).toEqual([]);
  });

  it("should skip the flush quietly once the handle is detached", () => {
    const { updates, handle, detach } = recordingHandle<OHLC>();
    const frame = manualScheduler();
    const feed = conflated(handle, { schedule: frame });

    feed.push(bar(10, 100));
    detach();

    expect(() => frame.created[0].flush()).not.toThrow();
    expect(updates).toEqual([]);
  });

});


describe("conflation teardown during callbacks", () => {
  it("should not queue the next bar after rollover delivery disposes the feed", () => {
    const updates: OHLC[] = [];
    const frame = manualScheduler();
    let feed: ConflatedFeed<OHLC>;
    feed = conflated({ attached: true, updateLast(point: OHLC) { updates.push(point); feed.dispose(); } }, { schedule: frame });
    feed.push(bar(10, 100));
    feed.push(bar(11, 101));
    expect(frame.created[0].pending).toBe(false);
    frame.created[0].flush();
    expect(updates).toEqual([bar(10, 100)]);
  });

  it("should not publish a merge result after its callback disposes the feed", () => {
    const { handle, updates } = recordingHandle<OHLC>();
    const frame = manualScheduler();
    let feed: ConflatedFeed<OHLC>;
    feed = conflated(handle, { schedule: frame, merge(_pending, incoming) { feed.dispose(); return incoming; } });
    feed.push(bar(10, 100));
    feed.push(bar(10, 101));
    expect(frame.created[0].pending).toBe(false);
    frame.created[0].flush();
    expect(updates).toEqual([bar(10, 100)]);
  });

  it("should reject reentrant pushes while flushing the last pending tick on dispose", () => {
    const updates: OHLC[] = [];
    const frame = manualScheduler();
    let feed: ConflatedFeed<OHLC>;
    feed = conflated({ attached: true, updateLast(point: OHLC) { updates.push(point); feed.push(bar(11, 101)); } }, { schedule: frame });
    feed.push(bar(10, 100));
    feed.dispose();
    expect(frame.created[0].pending).toBe(false);
    frame.created[0].flush();
    expect(updates).toEqual([bar(10, 100)]);
  });

  it("should recheck disposal after reading handle attachment", () => {
    const updates: OHLC[] = [];
    const frame = manualScheduler();
    let feed: ConflatedFeed<OHLC>;
    feed = conflated({ get attached() { feed.dispose(); return true; }, updateLast(point: OHLC) { updates.push(point); } }, { schedule: frame });
    feed.push(bar(10, 100));
    frame.created[0].flush();
    expect(updates).toEqual([]);
  });

  it("should stay stopped if delivery throws during disposal", () => {
    const frame = manualScheduler();
    const feed = conflated({ attached: true, updateLast() { throw new Error("delivery failed"); } }, { schedule: frame });
    feed.push(bar(10, 100));
    expect(() => feed.dispose()).toThrow("delivery failed");
    feed.push(bar(11, 101));
    expect(frame.created[0].pending).toBe(false);
    expect(() => feed.dispose()).not.toThrow();
  });
});


it("should attempt final delivery and report both failures when scheduler cancellation throws", () => {
  const cancellation = new Error("cancel failed");
  const delivery = new Error("delivery failed");
  const updates: OHLC[] = [];
  const feed = conflated({ attached: true, updateLast(point: OHLC) { updates.push(point); throw delivery; } }, {
    schedule: () => ({ request() {}, cancel() { throw cancellation; } }),
  });
  feed.push(bar(10, 100));
  let thrown: unknown;
  try { feed.dispose(); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(AggregateError);
  if (!(thrown instanceof AggregateError)) throw new Error("missing cleanup aggregate");
  expect(thrown.errors).toEqual([cancellation, delivery]);
  expect(updates).toEqual([bar(10, 100)]);
  expect(() => feed.dispose()).not.toThrow();
});
