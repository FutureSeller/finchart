/**
 * The base wiring that follows `devicePixelRatio` changes.
 *
 * The core side is tested with a fake observer
 * (`plot/__tests__/resolution.test.ts`) — that's where the stage's reaction
 * to a notification is covered. What's under test here is the idiom
 * itself: pinning the query, resubscribing after it fires, the SSR
 * fallback, and release.
 */
import { describe, expect, it, vi } from "vitest";
import { observeDevicePixelRatio } from "../observe-resolution";

type Listener = () => void;

/** An element fitted with a window (view) that mimics `matchMedia`. */
function elementIn(hasMatchMedia: boolean, ratio = 2) {
  /** The queries that got created — the material for observing resubscription. */
  const queries: { media: string; listeners: Listener[]; removed: number }[] =
    [];

  const view = {
    devicePixelRatio: ratio,
    matchMedia: hasMatchMedia
      ? (media: string) => {
          const query = { media, listeners: [] as Listener[], removed: 0 };
          queries.push(query);
          return {
            media,
            addEventListener: (_: string, listener: Listener) => {
              query.listeners.push(listener);
            },
            removeEventListener: (_: string, listener: Listener) => {
              query.removed += 1;
              const at = query.listeners.indexOf(listener);
              if (at >= 0) query.listeners.splice(at, 1);
            },
          } as unknown as MediaQueryList;
        }
      : undefined,
  };

  const element = {
    ownerDocument: { defaultView: view },
  } as unknown as HTMLElement;

  return {
    element,
    queries,
    /** The screen changes its ratio — the last query registered fires. */
    changeTo(next: number) {
      view.devicePixelRatio = next;
      const last = queries[queries.length - 1];
      // With `once: true` the call detaches the listener, so this has to
      // iterate a copy.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const listener of [...last.listeners]) listener();
    },
  };
}

describe("observeDevicePixelRatio", () => {
  it("should pin the query to the current ratio", () => {
    const dom = elementIn(true, 2);

    observeDevicePixelRatio(dom.element)(() => undefined);

    expect(dom.queries).toHaveLength(1);
    expect(dom.queries[0].media).toBe("(resolution: 2dppx)");
  });

  it("should notify when the ratio changes", () => {
    const dom = elementIn(true, 2);
    const onChange = vi.fn();

    observeDevicePixelRatio(dom.element)(onChange);
    dom.changeTo(3);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("should re-subscribe with the new ratio", () => {
    const dom = elementIn(true, 2);

    observeDevicePixelRatio(dom.element)(() => undefined);
    dom.changeTo(3);

    // The query that already fired is bound to the old ratio (2dppx) and cannot be reused.
    expect(dom.queries.map((query) => query.media)).toEqual([
      "(resolution: 2dppx)",
      "(resolution: 3dppx)",
    ]);
  });

  it("should keep following across several changes", () => {
    const dom = elementIn(true, 1);
    const onChange = vi.fn();

    observeDevicePixelRatio(dom.element)(onChange);
    dom.changeTo(2);
    dom.changeTo(3);
    dom.changeTo(1);

    // If it only ever listened once, this would end up at 1 — whether the loop keeps going is the whole point of this test.
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(dom.queries).toHaveLength(4);
  });

  it("should re-listen before notifying", () => {
    const dom = elementIn(true, 2);
    let queriesWhenNotified = 0;

    // If observation went empty while notifying, one of a rapid succession of ratio changes would be missed.
    observeDevicePixelRatio(dom.element)(() => {
      queriesWhenNotified = dom.queries.length;
    });
    dom.changeTo(3);

    expect(queriesWhenNotified).toBe(2);
  });

  it("should write fractional ratios in full", () => {
    const dom = elementIn(true, 1.7999999523162842);

    observeDevicePixelRatio(dom.element)(() => undefined);

    // Rounding would produce a query that no longer matches its own ratio the moment it's created, and it would never fire.
    expect(dom.queries[0].media).toBe("(resolution: 1.7999999523162842dppx)");
  });

  it("should stop after release", () => {
    const dom = elementIn(true, 2);
    const onChange = vi.fn();

    const release = observeDevicePixelRatio(dom.element)(onChange);
    release();
    dom.changeTo(3);

    expect(onChange).not.toHaveBeenCalled();
    // No new query gets registered after release — release means it's over.
    expect(dom.queries).toHaveLength(1);
    expect(dom.queries[0].removed).toBe(1);
  });

  it("should ignore a listener that arrives after release", () => {
    const dom = elementIn(true, 2);
    const onChange = vi.fn();

    const release = observeDevicePixelRatio(dom.element)(onChange);
    // Releases while holding onto something the browser already dispatched.
    const inFlight = dom.queries[0].listeners[0];
    release();

    // `removeEventListener` only blocks what hasn't been dispatched yet —
    // an event already queued still arrives after release. It must not be
    // allowed to draw a destroyed stage.
    inFlight();

    expect(onChange).not.toHaveBeenCalled();
    expect(dom.queries).toHaveLength(1);
  });

  it("should do nothing without matchMedia", () => {
    const dom = elementIn(false);
    const onChange = vi.fn();

    // SSR and some of jsdom. There's simply nothing to observe, not an invalid state.
    const release = observeDevicePixelRatio(dom.element)(onChange);

    expect(dom.queries).toHaveLength(0);
    expect(() => release()).not.toThrow();
  });
});
