/**
 * The subscription that turns a theme swap into a repaint request.
 *
 * Like the other observer tests, this builds elements fitted with a fake view
 * rather than standing up a DOM — what is under test is the wiring, not the
 * browser.
 */
import { describe, expect, it, vi } from "vitest";

import { observeTheme } from "../observe-theme";

interface FakeQuery {
  listeners: (() => void)[];
  removed: number;
}

interface FakeObserved {
  target: unknown;
  options: { attributes: boolean; attributeFilter: string[] };
}

/**
 * A chain of elements (`chain[0]` is the chart's container, the rest are its
 * ancestors), sharing one view whose `matchMedia` and `MutationObserver` are
 * inspectable.
 */
function chainOf(
  depth: number,
  has: { matchMedia?: boolean; mutation?: boolean } = {},
) {
  const query: FakeQuery = { listeners: [], removed: 0 };
  const observed: FakeObserved[] = [];
  const disconnect = vi.fn();
  let fireMutation: () => void = () => undefined;

  class FakeMutationObserver {
    constructor(callback: () => void) {
      fireMutation = callback;
    }
    observe(target: unknown, options: FakeObserved["options"]) {
      observed.push({ target, options });
    }
    disconnect = disconnect;
  }

  const view: Record<string, unknown> = {};
  if (has.matchMedia !== false) {
    view.matchMedia = (): unknown => ({
      addEventListener: (_: string, listener: () => void) =>
        query.listeners.push(listener),
      removeEventListener: () => {
        query.removed += 1;
      },
    });
  }
  if (has.mutation !== false) view.MutationObserver = FakeMutationObserver;

  const chain: Record<string, unknown>[] = [];
  for (let index = 0; index < depth; index += 1) {
    chain.push({ ownerDocument: { defaultView: view }, parentElement: null });
  }
  for (let index = 0; index < depth - 1; index += 1) {
    chain[index].parentElement = chain[index + 1];
  }

  return {
    element: chain[0] as unknown as HTMLElement,
    chain,
    query,
    observed,
    disconnect,
    fireMutation: () => fireMutation(),
  };
}

describe("observeTheme", () => {
  it("should watch the element and every ancestor", () => {
    const fake = chainOf(3);
    observeTheme(fake.element, vi.fn());

    // A theme class usually sits on <html> or <body>, not on the container.
    expect(fake.observed).toHaveLength(3);
    expect(fake.observed.map((entry) => entry.target)).toEqual(fake.chain);
  });

  it("should filter to the attributes that carry a theme", () => {
    const fake = chainOf(1);
    observeTheme(fake.element, vi.fn());

    expect(fake.observed[0].options).toEqual({
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
  });

  it("should let the caller name its own attributes", () => {
    const fake = chainOf(1);
    observeTheme(fake.element, vi.fn(), { attributes: ["data-mode"] });

    expect(fake.observed[0].options.attributeFilter).toEqual(["data-mode"]);
  });

  it("should report an attribute change", () => {
    const fake = chainOf(2);
    const onChange = vi.fn();
    observeTheme(fake.element, onChange);

    fake.fireMutation();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("should report the os switching color scheme", () => {
    const fake = chainOf(1);
    const onChange = vi.fn();
    observeTheme(fake.element, onChange);

    expect(fake.query.listeners).toHaveLength(1);
    fake.query.listeners[0]();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("should go quiet once unsubscribed", () => {
    const fake = chainOf(2);
    const onChange = vi.fn();
    const stop = observeTheme(fake.element, onChange);

    stop();
    // Both paths: one already queued, one arriving through the media query.
    fake.fireMutation();
    fake.query.listeners[0]();

    expect(onChange).not.toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.query.removed).toBe(1);
  });

  it("should do nothing where the browser has neither (ssr)", () => {
    const fake = chainOf(1, { matchMedia: false, mutation: false });
    const onChange = vi.fn();

    // Subscribing and unsubscribing must not throw — browser wiring running
    // under SSR is a normal path, not a broken state.
    expect(() => observeTheme(fake.element, onChange)()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should do nothing for a detached element", () => {
    const orphan = { ownerDocument: { defaultView: null } };
    expect(() =>
      observeTheme(orphan as unknown as HTMLElement, vi.fn())(),
    ).not.toThrow();
  });
});
