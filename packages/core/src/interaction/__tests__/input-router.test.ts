import { describe, expect, it } from "vitest";
import { InputRouter, type InputEvent } from "../input-router";
import { ContractError } from "../../primitives";

const down = (pointerId = 1): InputEvent => ({
  type: "pointerdown",
  point: { x: 10, y: 10 },
  pointerId,
});
const move = (pointerId = 1): InputEvent => ({
  type: "pointermove",
  point: { x: 20, y: 10 },
  pointerId,
});
const up = (pointerId = 1): InputEvent => ({
  type: "pointerup",
  point: { x: 20, y: 10 },
  pointerId,
});

/** A consumer that records its own name and returns a fixed answer. */
function consumer(name: string, seen: string[], eats: boolean) {
  return {
    handle(event: InputEvent) {
      seen.push(`${name}:${event.type}`);
      return eats;
    },
  };
}

describe("InputRouter", () => {
  it("should stop at the first consumer that eats", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("above", seen, true), { priority: 1 });
    router.add(consumer("below", seen, false), { priority: 0 });

    expect(router.route(down())).toBe(true);
    expect(seen).toEqual(["above:pointerdown"]);
  });

  it("should fall through consumers that decline", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("above", seen, false), { priority: 1 });
    router.add(consumer("below", seen, false));

    expect(router.route(down())).toBe(false);
    expect(seen).toEqual(["above:pointerdown", "below:pointerdown"]);
  });

  it("should ask the later registration first on a tie", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("first", seen, false));
    router.add(consumer("second", seen, false));

    router.route(down());

    // Convention: whatever's drawn on top gets first crack — same
    // direction as z-order.
    expect(seen).toEqual(["second:pointerdown", "first:pointerdown"]);
  });

  it("should capture the pointer for whoever ate the down", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("tool", seen, true), { priority: 1 });
    router.add(consumer("other", seen, true));

    router.route(down());
    router.route(move());
    router.route(up());

    // move/up go straight to the capturing consumer instead of walking
    // the stack again.
    expect(seen).toEqual([
      "tool:pointerdown",
      "tool:pointermove",
      "tool:pointerup",
    ]);
  });

  it("should release the capture after pointerup", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("tool", seen, false), { priority: 1 });

    // Nobody ate the down — no capture.
    router.route(down());
    router.route(up());
    seen.length = 0;

    const eater = consumer("eater", seen, true);
    const release = router.add(eater, { priority: 2 });
    router.route(down());
    router.route(up());
    release();

    // Once the capture is released, move walks the stack again — the
    // eater is already gone.
    expect(router.route(move())).toBe(false);
  });

  it("should keep captures per pointer — pinch needs two", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("tool", seen, true));

    router.route(down(1));
    router.route(down(2));
    router.route(move(2));
    router.route(up(1));
    router.route(move(2));

    expect(seen.filter((s) => s === "tool:pointermove")).toHaveLength(2);
  });

  it("should treat captured events as eaten even when the consumer declines", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("half", seen, false), { priority: 1 });
    const eatOnce = {
      handle(event: InputEvent) {
        return event.type === "pointerdown";
      },
    };
    router.add(eatOnce, { priority: 2 });

    router.route(down());

    // If a move during capture returns false and falls through to pan,
    // you get a half-drag.
    expect(router.route(move())).toBe(true);
    expect(seen).toEqual([]);
  });

  it("should free the capture when the consumer is removed", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    const release = router.add(consumer("tool", seen, true));

    router.route(down());
    release();

    // If a removed consumer keeps swallowing input, the chart dies.
    expect(router.route(move())).toBe(false);
  });

  it("should never capture on wheel", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("tool", seen, true));

    router.route({ type: "wheel", point: { x: 0, y: 0 }, deltaY: -120 });

    expect(seen).toEqual(["tool:wheel"]);
  });

  it("should route keydown down the stack like wheel", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    router.add(consumer("above", seen, false), { priority: 1 });
    router.add(consumer("below", seen, true));

    expect(router.route({ type: "keydown", key: "Delete" })).toBe(true);
    expect(seen).toEqual(["above:keydown", "below:keydown"]);
  });

  it("should not send keydown to a pointer capture", () => {
    const router = new InputRouter();
    const seen: string[] = [];
    // Even while a lower consumer holds the drag, a key walks the stack
    // in normal order.
    router.add(consumer("dragging", seen, true));
    router.route(down());
    router.add(consumer("editor", seen, true), { priority: 1 });

    router.route({ type: "keydown", key: "Escape" });

    expect(seen).toEqual([
      "dragging:pointerdown",
      "editor:keydown",
    ]);
  });
});

/**
 * The rejection branch of the input door. This guard existed, but had no
 * test — deleting the single line `checkInputEvent(event)` still left
 * the whole suite green. An example of "a passing test suite can guard
 * nothing."
 *
 * `routeInput` is a public contract, and this module explicitly sells
 * the idea that a headless host can synthesize input. Those synthesized
 * values come from RN gestures, worker bridges, custom hosts, and test
 * harnesses — none of it is ours.
 */
describe("the input door — synthesized coordinates aren't ours", () => {
  const router = () => new InputRouter();

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["string", "pointerdown"],
    ["empty object", {}],
  ])("should refuse %s as the event", (_label, bad) => {
    expect(() => router().route(bad as never)).toThrow(ContractError);
  });

  it("should refuse an event whose type has no point", () => {
    // It used to crash **inside** `@finchart/tools` with a raw
    // TypeError — what the consumer saw was another package's internal
    // variable name.
    expect(() => router().route({ type: "dblclick" } as never)).toThrow(
      ContractError,
    );
  });

  it.each([
    ["x is NaN", { x: Number.NaN, y: 0 }],
    ["y is NaN", { x: 0, y: Number.NaN }],
    ["x is Infinity", { x: Number.POSITIVE_INFINITY, y: 0 }],
    ["point is null", null],
    ["point is a string", "10,10"],
  ])("should refuse %s", (_label, point) => {
    expect(() =>
      router().route({ type: "pointermove", point, pointerId: 1 } as never),
    ).toThrow(ContractError);
  });

  /**
   * `pointerId` is the capture Map's key and the gesture's owner. If
   * it's missing, `undefined !== undefined` is false, which defeats
   * multi-touch protection; if its type mismatches (down gets `1`, move
   * gets `"1"`), the state machine gets stuck in `dragging` and the tool
   * eats every pointer input after that.
   */
  it.each([
    ["missing", undefined],
    ["string", "1"],
    ["null", null],
    ["NaN", Number.NaN],
  ])("should refuse %s as a pointerId", (_label, pointerId) => {
    expect(() =>
      router().route({
        type: "pointerdown",
        point: { x: 1, y: 1 },
        pointerId,
      } as never),
    ).toThrow(ContractError);
  });

  /**
   * cancel is the capture-**release** key. A malformed cancel that slips
   * this gate misses `captures.get`, the capture lingers, and — the
   * exact zombie this gate exists to prevent — that consumer swallows
   * the next drag on the same pointerId whole.
   */
  it.each([
    ["missing", undefined],
    ["string", "1"],
    ["null", null],
    ["NaN", Number.NaN],
  ])("should refuse %s as a pointercancel pointerId", (_label, pointerId) => {
    expect(() =>
      router().route({
        type: "pointercancel",
        point: { x: 1, y: 1 },
        pointerId,
      } as never),
    ).toThrow(ContractError);
  });

  it("should refuse a non-string keydown key", () => {
    expect(() => router().route({ type: "keydown", key: 42 } as never)).toThrow(
      ContractError,
    );
  });

  /** Branches that don't capture have no `pointerId` — requiring one would block valid input. */
  it("should accept wheel and dblclick without a pointerId", () => {
    expect(() =>
      router().route({ type: "wheel", point: { x: 1, y: 1 }, deltaY: 3 }),
    ).not.toThrow();
    expect(() =>
      router().route({ type: "dblclick", point: { x: 1, y: 1 } }),
    ).not.toThrow();
  });
});

/**
 * Checks that what's declared is actually checked. `checkInputEvent`
 * claimed to check `type` itself but didn't — a single typo passed
 * straight through to every consumer, and the consumer had no idea why
 * its own `handle` wasn't being called.
 *
 * `wheel`'s `deltaY` was declared `number` in the union too, with no
 * runtime check. If `NaN` arrives, `@finchart/dom`'s
 * `deltaY < 0 ? zoomSpeed : 1/zoomSpeed` silently falls into the
 * zoom-out branch — synthesized input (RN inertial scroll, worker
 * bridges) is where that comes from.
 */
describe("the shape of synthesized input — declaration and validation must match", () => {
  const routerSeeing = () => {
    const seen: string[] = [];
    const router = new InputRouter();
    router.add({
      handle: (event) => {
        seen.push(event.type);
        return false;
      },
    });
    return { router, seen };
  };

  it("should refuse a gesture it does not know", () => {
    const { router, seen } = routerSeeing();

    expect(() =>
      router.route({ type: "bogus", point: { x: 1, y: 1 } } as never),
    ).toThrow(/type/);

    // And it never leaks to the consumer — a silently running typo was
    // the problem.
    expect(seen).toEqual([]);
  });

  it.each([
    ["none", undefined],
    ["NaN", NaN],
    ["string", "10"],
    ["Infinity", Infinity],
  ])("should refuse a wheel whose deltaY is %s", (_label, deltaY) => {
    const { router, seen } = routerSeeing();

    expect(() =>
      router.route({ type: "wheel", point: { x: 1, y: 1 }, deltaY } as never),
    ).toThrow(/deltaY/);
    expect(seen).toEqual([]);
  });

  it("should still let a well-formed wheel through", () => {
    const { router, seen } = routerSeeing();

    expect(() =>
      router.route({ type: "wheel", point: { x: 1, y: 1 }, deltaY: -120 }),
    ).not.toThrow();
    expect(seen).toEqual(["wheel"]);
  });
});

/**
 * Pairing the union with the gate. `INPUT_TYPES` is a hand-maintained
 * list, so it's easy to forget when adding a variant — extend only the
 * type and compilation still passes while the runtime gate rejects the
 * new variant as "not a known gesture." A union can't be enumerated at
 * runtime, so this pokes each known one by hand — leave one out of the
 * list and this line throws.
 */
describe("the known-gesture list is paired with the union", () => {
  const router = () => new InputRouter();

  it("every variant passes the gate", () => {
    const point = { x: 1, y: 2 };
    const events: InputEvent[] = [
      { type: "pointerdown", point, pointerId: 1 },
      { type: "pointermove", point, pointerId: 1 },
      { type: "pointerup", point, pointerId: 1 },
      { type: "pointercancel", point, pointerId: 1 },
      { type: "wheel", point, deltaY: 1 },
      { type: "dblclick", point },
      { type: "contextmenu", point },
      { type: "keydown", key: "Escape" },
    ];

    for (const event of events) {
      expect(() => router().route(event)).not.toThrow();
    }
  });
});

describe("cancellation releases the capture", () => {
  /** A pointer the browser has reclaimed never comes back — if the capture lingers, that consumer becomes a zombie capture that swallows the next drag with the same pointerId whole. */
  it("the next drag on a cancelled pointer walks the stack again", () => {
    const router = new InputRouter();
    const first: InputEvent[] = [];
    const second: InputEvent[] = [];

    router.add({
      handle: (event) => {
        first.push(event);
        return event.type === "pointerdown";
      },
    });

    const point = { x: 1, y: 2 };
    router.route({ type: "pointerdown", point, pointerId: 7 });
    router.route({ type: "pointercancel", point, pointerId: 7 });

    // A consumer added after the cancellation must be able to see the
    // next down — if the capture lingered, it would go straight to the
    // first consumer and never see it.
    router.add({
      handle: (event) => {
        second.push(event);
        return false;
      },
    });
    router.route({ type: "pointermove", point, pointerId: 7 });

    expect(second).toHaveLength(1);
  });
});

it("does not capture a consumer removed by its own down callback", () => {
  const router = new InputRouter();
  const seen: string[] = [];
  let remove = () => {};
  remove = router.add({ handle(event) {
    seen.push(event.type);
    remove();
    return true;
  } });
  expect(router.route(down())).toBe(true);
  expect(router.route(move())).toBe(false);
  expect(seen).toEqual(["pointerdown"]);
});
