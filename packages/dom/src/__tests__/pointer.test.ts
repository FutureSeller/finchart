// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Point } from "@finchart/core";
import { InputRouter, type InputEvent } from "@finchart/core";
import { PointerInteractions } from "../pointer";
import type { InteractionTarget } from "@finchart/core";

function recordingTarget() {
  const pans: number[] = [];
  const pixelPans: number[] = [];
  const zooms: Array<{ factor: number; center: number }> = [];
  const pixelZooms: Array<{ factor: number; screenX: number }> = [];
  const crosshairs: Array<Point | null> = [];
  const fits: number[] = [];
  const clicks: Point[] = [];
  const menus: Point[] = [];

  const target: InteractionTarget = {
    // A target whose stack is empty — it consumes no input (verifies the default gesture path).
    routeInput: () => false,
    fitDomains: () => void fits.push(1),
    click: (position) => void clicks.push(position),
    doubleClick: () => undefined,
    contextMenu: (position) => void menus.push(position),
    pan: (offset) => void pans.push(offset),
    panByPixels: (dx) => void pixelPans.push(dx),
    zoom: (factor, center) => void zooms.push({ factor, center }),
    zoomAtPixel: (factor, screenX) => void pixelZooms.push({ factor, screenX }),
    crosshair: (position) => void crosshairs.push(position),
  };

  return { target, pans, pixelPans, zooms, pixelZooms, crosshairs, fits, clicks, menus };
}

let element: HTMLElement;
let target: ReturnType<typeof recordingTarget>;

beforeEach(() => {
  element = document.createElement("div");
  document.body.appendChild(element);
  // jsdom's layout is all zero, so the coordinate baseline is supplied directly.
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 50,
    top: 20,
  } as DOMRect);
  target = recordingTarget();
});

afterEach(() => {
  vi.restoreAllMocks();
  element.remove();
});

const down = (clientX: number) =>
  element.dispatchEvent(
    new MouseEvent("pointerdown", { clientX, bubbles: true }),
  );
const move = (clientX: number) =>
  document.dispatchEvent(
    new MouseEvent("pointermove", { clientX, bubbles: true }),
  );
const up = () =>
  document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));

/**
 * Counts what is attached right now — the "stops responding" guards can stay
 * green while a listener leaks (a leaked handler that early-returns responds
 * to nothing), so hygiene is asserted by count, not by behavior. Returns the
 * still-attached types so a failure names the leak.
 */
function trackListeners(target: EventTarget) {
  const live = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const realAdd = target.addEventListener.bind(target);
  const realRemove = target.removeEventListener.bind(target);

  vi.spyOn(target, "addEventListener").mockImplementation(
    (type, listener, options) => {
      realAdd(type, listener, options);
      if (!listener) return;
      const set =
        live.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      set.add(listener);
      live.set(type, set);
    },
  );
  vi.spyOn(target, "removeEventListener").mockImplementation(
    (type, listener, options) => {
      realRemove(type, listener, options);
      if (!listener) return;
      live.get(type)?.delete(listener);
    },
  );

  return () =>
    [...live.entries()]
      .filter(([, set]) => set.size > 0)
      .map(([type, set]) => `${type}\u00d7${set.size}`);
}

describe("listener hygiene", () => {
  it("should leave zero listeners on element and document after disconnect", () => {
    const leakedOnElement = trackListeners(element);
    const leakedOnDocument = trackListeners(document);
    const interactions = new PointerInteractions(element);
    interactions.connect(target.target);

    // Disconnect lands mid-drag on purpose — the document listeners a drag
    // attaches are the ones most easily left behind.
    down(100);
    move(120);
    interactions.disconnect();

    expect(leakedOnElement()).toEqual([]);
    expect(leakedOnDocument()).toEqual([]);
  });

  it("should release the document once the gesture ends", () => {
    const leaked = trackListeners(document);
    new PointerInteractions(element).connect(target.target);

    down(100);
    move(120);
    up();

    expect(leaked()).toEqual([]);
  });

  it("should drag again after a mid-drag reconnect", () => {
    // React StrictMode's double effect run lands exactly here: unmount
    // arrives mid-gesture, then the chart mounts again. The second life
    // must get its own document listeners — a drag-scope handle left
    // pointing at the disposed gesture would swallow every drag after.
    const interactions = new PointerInteractions(element);
    interactions.connect(target.target);
    down(100);
    interactions.disconnect();

    interactions.connect(target.target);
    down(100);
    move(140);

    expect(target.pixelPans).toEqual([40]);
  });

  it("should not stack listeners across repeated connects", () => {
    const leakedOnElement = trackListeners(element);
    const interactions = new PointerInteractions(element);
    interactions.connect(target.target);
    interactions.connect(target.target);
    interactions.disconnect();

    expect(leakedOnElement()).toEqual([]);
  });
});

describe("PointerInteractions drag", () => {
  it("should pan by the pointer delta while dragging", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    move(140);

    expect(target.pixelPans).toEqual([40]);
  });

  it("should report deltas relative to the previous move", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    move(120);
    move(150);

    expect(target.pixelPans).toEqual([20, 30]);
  });

  it("should keep dragging when the pointer leaves the element", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    // Received from the document, so it doesn't cut off when the pointer leaves the chart.
    move(-500);

    expect(target.pixelPans).toEqual([-600]);
  });

  it("should stop panning after pointerup", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    move(120);
    up();
    move(200);

    expect(target.pixelPans).toEqual([20]);
  });

  it("should not pan without a preceding pointerdown", () => {
    new PointerInteractions(element).connect(target.target);

    move(200);

    expect(target.pixelPans).toEqual([]);
  });

  it("should ignore drags when panning is disabled", () => {
    new PointerInteractions(element, { pan: false }).connect(target.target);

    down(100);
    move(200);

    expect(target.pixelPans).toEqual([]);
  });
});

describe("PointerInteractions wheel", () => {
  const wheel = (deltaY: number, clientX = 150) =>
    element.dispatchEvent(
      new WheelEvent("wheel", { deltaY, clientX, cancelable: true }),
    );

  it("should zoom in when scrolling up", () => {
    new PointerInteractions(element).connect(target.target);

    wheel(-100);

    expect(target.pixelZooms[0].factor).toBeGreaterThan(1);
  });

  it("should zoom out when scrolling down", () => {
    new PointerInteractions(element).connect(target.target);

    wheel(100);

    expect(target.pixelZooms[0].factor).toBeLessThan(1);
  });

  it("should anchor the zoom at the cursor, in element coordinates", () => {
    new PointerInteractions(element).connect(target.target);

    wheel(-100, 150);

    // clientX 150 - rect.left 50
    expect(target.pixelZooms[0].screenX).toBe(100);
  });

  it("should honour a custom zoom speed", () => {
    new PointerInteractions(element, { zoomSpeed: 2 }).connect(target.target);

    wheel(-100);

    expect(target.pixelZooms[0].factor).toBe(2);
  });

  it("should prevent the page from scrolling", () => {
    new PointerInteractions(element).connect(target.target);
    const event = new WheelEvent("wheel", { deltaY: -100, cancelable: true });

    element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("should ignore the wheel when zooming is disabled", () => {
    new PointerInteractions(element, { zoom: false }).connect(target.target);

    wheel(-100);

    expect(target.pixelZooms).toEqual([]);
  });
});

describe("PointerInteractions crosshair", () => {
  const hover = (clientX: number, clientY: number) =>
    element.dispatchEvent(
      new MouseEvent("pointermove", { clientX, clientY, bubbles: true }),
    );

  it("should report positions relative to the element", () => {
    new PointerInteractions(element).connect(target.target);

    hover(150, 120);

    expect(target.crosshairs).toEqual([{ x: 100, y: 100 }]);
  });

  it("should follow the pointer through a pan drag", () => {
    // The contract flipped (2026-08-14 review) — the crosshair now stays
    // under the pointer even while panning. Matches the reference-library
    // convention (lightweight-charts, TradingView).
    new PointerInteractions(element).connect(target.target);

    down(100);
    hover(150, 120);

    expect(target.crosshairs).toEqual([{ x: 100, y: 100 }]);
    // pan still runs unchanged — the echo doesn't crowd out translation.
    expect(target.pixelPans).toEqual([50]);
  });

  it("should not follow a touch pan", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    document.dispatchEvent(
      Object.assign(
        new MouseEvent("pointermove", {
          clientX: 150,
          clientY: 120,
          bubbles: true,
        }),
        { pointerType: "touch" },
      ),
    );

    // A crosshair under a finger conveys no information — touch pan keeps its prior behavior.
    expect(target.crosshairs).toEqual([]);
    expect(target.pixelPans).toEqual([50]);
  });

  it("should stay quiet during a pinch", () => {
    new PointerInteractions(element).connect(target.target);
    const downAt = (pointerId: number, clientX: number) =>
      element.dispatchEvent(
        Object.assign(
          new MouseEvent("pointerdown", { clientX, bubbles: true }),
          { pointerId },
        ),
      );

    downAt(1, 100);
    downAt(2, 200);
    document.dispatchEvent(
      Object.assign(
        new MouseEvent("pointermove", { clientX: 260, bubbles: true }),
        { pointerId: 2 },
      ),
    );

    expect(target.crosshairs).toEqual([]);
  });

  it("should keep the toggle honored while dragging", () => {
    new PointerInteractions(element, { crosshair: false }).connect(target.target);

    down(100);
    hover(150, 120);

    expect(target.crosshairs).toEqual([]);
  });

  it("should resume after the drag ends", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    up();
    hover(150, 120);

    expect(target.crosshairs).toHaveLength(1);
  });

  it("should be silent when crosshair is disabled", () => {
    new PointerInteractions(element, { crosshair: false }).connect(target.target);

    hover(150, 120);

    expect(target.crosshairs).toEqual([]);
  });
});

describe("PointerInteractions lifecycle", () => {
  it("should take horizontal touch drags and leave vertical ones to the page", () => {
    new PointerInteractions(element).connect(target.target);

    // A pan is horizontal; `none` swallowed the vertical swipe that should
    // have scrolled the page a chart sits in.
    expect(element.style.touchAction).toBe("pan-y");
  });

  it("should stop responding after disconnect", () => {
    const interactions = new PointerInteractions(element);
    interactions.connect(target.target);

    interactions.disconnect();
    down(100);
    move(200);

    expect(target.pixelPans).toEqual([]);
  });

  it("should drop document listeners left over from a drag", () => {
    const interactions = new PointerInteractions(element);
    interactions.connect(target.target);

    down(100);
    interactions.disconnect();
    move(200);

    expect(target.pixelPans).toEqual([]);
  });

  it("should replace the previous connection instead of stacking", () => {
    const interactions = new PointerInteractions(element);
    interactions.connect(target.target);
    interactions.connect(target.target);

    down(100);
    move(140);

    expect(target.pixelPans).toEqual([40]);
  });

  it("should still forward programmatic calls", () => {
    const interactions = new PointerInteractions(element);
    interactions.connect(target.target);

    interactions.handlePan(12);
    interactions.handleZoom(2, 50);
    interactions.handleCrosshair({ x: 1, y: 2 });

    expect(target.pans).toEqual([12]);
    expect(target.zooms).toEqual([{ factor: 2, center: 50 }]);
    expect(target.crosshairs).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("PointerInteractions through the input stack", () => {
  /** A target fitted with a real router — with a consumer present, the stack goes first. */
  function stackedTarget() {
    const recording = recordingTarget();
    const router = new InputRouter();
    const events: InputEvent[] = [];

    return {
      ...recording,
      events,
      target: {
        ...recording.target,
        routeInput: (event: InputEvent) => {
          const eaten = router.route(event);
          if (eaten) events.push(event);
          return eaten;
        },
      } satisfies InteractionTarget,
      addConsumer: (eats: (event: InputEvent) => boolean, priority = 0) =>
        router.add({ handle: eats }, { priority }),
    };
  }

  const wheel = (deltaY: number) =>
    element.dispatchEvent(
      new WheelEvent("wheel", { deltaY, clientX: 100, bubbles: true }),
    );

  it("should not pan a single pixel while a consumer owns the drag", () => {
    const stacked = stackedTarget();
    stacked.addConsumer((event) => event.type === "pointerdown");
    new PointerInteractions(element).connect(stacked.target);

    down(100);
    move(140);
    move(180);
    up();

    expect(stacked.pixelPans).toEqual([]);
    // The entire drag (including the captured moves and up) went to the consumer.
    expect(stacked.events.map((event) => event.type)).toEqual([
      "pointerdown",
      "pointermove",
      "pointermove",
      "pointerup",
    ]);
  });

  it("should pan again after the consumed drag ends", () => {
    const stacked = stackedTarget();
    let arm = true;
    stacked.addConsumer((event) => arm && event.type === "pointerdown");
    new PointerInteractions(element).connect(stacked.target);

    down(100);
    up();
    arm = false;

    down(100);
    move(150);

    expect(stacked.pixelPans).toEqual([50]);
  });

  it("should suppress the crosshair when a hover is eaten", () => {
    const stacked = stackedTarget();
    stacked.addConsumer((event) => event.type === "pointermove");
    new PointerInteractions(element).connect(stacked.target);

    element.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 100, clientY: 60, bubbles: true }),
    );

    expect(stacked.crosshairs).toEqual([]);
  });

  it("should let an unconsumed hover reach the crosshair", () => {
    const stacked = stackedTarget();
    stacked.addConsumer(() => false);
    new PointerInteractions(element).connect(stacked.target);

    element.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 100, clientY: 60, bubbles: true }),
    );

    expect(stacked.crosshairs).toEqual([{ x: 50, y: 40 }]);
  });

  it("should give the wheel to a consumer before zooming", () => {
    const stacked = stackedTarget();
    stacked.addConsumer((event) => event.type === "wheel");
    new PointerInteractions(element).connect(stacked.target);

    wheel(-120);

    expect(stacked.pixelZooms).toEqual([]);
    expect(stacked.events.map((event) => event.type)).toEqual(["wheel"]);
  });
});

describe("PointerInteractions pinch (2.4)", () => {
  const downAt = (pointerId: number, clientX: number) =>
    element.dispatchEvent(
      Object.assign(new MouseEvent("pointerdown", { clientX, bubbles: true }), {
        pointerId,
      }),
    );
  const moveAt = (pointerId: number, clientX: number) =>
    document.dispatchEvent(
      Object.assign(new MouseEvent("pointermove", { clientX, bubbles: true }), {
        pointerId,
      }),
    );
  const upAt = (pointerId: number) =>
    document.dispatchEvent(
      Object.assign(new MouseEvent("pointerup", { bubbles: true }), {
        pointerId,
      }),
    );

  it("should zoom by the ratio of finger distances, anchored at the midpoint", () => {
    new PointerInteractions(element).connect(target.target);

    downAt(1, 100);
    downAt(2, 200);
    // 100px spread to 150px: 1.5x.
    moveAt(2, 250);

    expect(target.pixelZooms).toHaveLength(1);
    expect(target.pixelZooms[0].factor).toBeCloseTo(1.5, 8);
    // Midpoint (100+250)/2 = 175, element's left edge at 50 → local 125.
    expect(target.pixelZooms[0].screenX).toBe(125);
    // No pan during a pinch.
    expect(target.pixelPans).toEqual([]);
  });

  it("should resume panning with the remaining finger", () => {
    new PointerInteractions(element).connect(target.target);

    downAt(1, 100);
    downAt(2, 200);
    moveAt(2, 260);
    upAt(2);
    moveAt(1, 130);

    expect(target.pixelPans).toEqual([30]);
  });

  it("should not pinch when zooming is disabled", () => {
    new PointerInteractions(element, { zoom: false }).connect(target.target);

    downAt(1, 100);
    downAt(2, 200);
    moveAt(2, 260);

    expect(target.pixelZooms).toEqual([]);
  });
});

describe("PointerInteractions dblclick + keyboard (2.4)", () => {
  it("should reset to the full view on double click", () => {
    new PointerInteractions(element).connect(target.target);

    element.dispatchEvent(
      new MouseEvent("dblclick", { clientX: 200, bubbles: true }),
    );

    expect(target.fits).toHaveLength(1);
  });

  it("should let a consumer eat the double click first", () => {
    const eaten = {
      ...target.target,
      routeInput: (event: InputEvent) => event.type === "dblclick",
    };
    new PointerInteractions(element).connect(eaten);

    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(target.fits).toHaveLength(0);
  });

  it("should make the element focusable and pan with arrows", () => {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
    } as DOMRect);
    new PointerInteractions(element).connect(target.target);

    expect(element.tabIndex).toBe(0);

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    // 5% of the 800px viewport = 40px — the left key moves into the past (positive), the right key into the future.
    expect(target.pixelPans).toEqual([40, -40]);
  });

  /**
   * Only the primary button pans. jsdom's synthetic `PointerEvent`
   * defaults `button` to 0, so a test that doesn't set this explicitly
   * would slip right past the guard — this one verifies it explicitly.
   */
  it("should not pan with the secondary button", () => {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
    } as DOMRect);
    new PointerInteractions(element).connect(target.target);

    element.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 100, button: 2, bubbles: true }),
    );
    move(160);
    up();

    expect(target.pixelPans).toEqual([]);

    // Control group — the primary button still pans. Shows the above isn't a freebie.
    down(100);
    move(160);
    up();
    expect(target.pixelPans).not.toEqual([]);
  });

  /**
   * The escape hatch for removing an element from tab order — used when an
   * accessibility audit demands `tabindex="-1"` on a focusable but unnamed
   * element. `element.tabIndex < 0` can't distinguish "no attribute" from
   * "explicit -1" (a `div`'s default is `-1`), which could paper over this
   * escape hatch — the test below pins down that distinction.
   */
  describe("tabindex", () => {
    function connected(): void {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
      } as DOMRect);
      new PointerInteractions(element).connect(target.target);
    }

    it("should keep an explicit tabindex=-1 out of the tab order", () => {
      element.setAttribute("tabindex", "-1");
      connected();
      expect(element.getAttribute("tabindex")).toBe("-1");
    });

    it("should respect an explicit positive tabindex", () => {
      element.setAttribute("tabindex", "5");
      connected();
      expect(element.getAttribute("tabindex")).toBe("5");
    });

    it("control group: with no attribute, it becomes a tab stop", () => {
      connected();
      expect(element.getAttribute("tabindex")).toBe("0");
    });
  });

  /**
   * All `keyboard: false` turns off is the floor gesture — the keydown
   * listener and `tabIndex` get attached regardless of the option, so even
   * with it off, drawing tools' Delete/Esc/`]`/`[` and focus stay alive.
   */
  describe("keyboard: false", () => {
    function offKeyboard() {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
      } as DOMRect);
      return new PointerInteractions(element, { keyboard: false });
    }

    it("should still make the element focusable", () => {
      offKeyboard().connect(target.target);
      expect(element.tabIndex).toBe(0);
    });

    it("should still route keys into the input stack", () => {
      const seen: string[] = [];
      const listening = {
        ...target.target,
        routeInput: (event: InputEvent) => {
          if (event.type === "keydown") {
            seen.push(event.key);
            return true;
          }
          return false;
        },
      };
      offKeyboard().connect(listening);

      for (const key of ["Delete", "Escape", "]", "["]) {
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      }

      expect(seen).toEqual(["Delete", "Escape", "]", "["]);
    });

    it("should not pan or zoom with the built-in gestures", () => {
      offKeyboard().connect(target.target);

      for (const key of ["ArrowLeft", "ArrowRight", "+", "-"]) {
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      }

      expect(target.pixelPans).toEqual([]);
      expect(target.pixelZooms).toEqual([]);
    });
  });

  it("should zoom around the center with plus and minus", () => {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
    } as DOMRect);
    new PointerInteractions(element).connect(target.target);

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "+", bubbles: true }),
    );

    expect(target.pixelZooms[0].factor).toBeCloseTo(1.1, 8);
    expect(target.pixelZooms[0].screenX).toBe(400);
  });

  it("should leave modifier combos to the browser", () => {
    new PointerInteractions(element).connect(target.target);

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", metaKey: true, bubbles: true }),
    );

    expect(target.pixelPans).toEqual([]);
  });

  it("should offer keys to the stack before panning", () => {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
    } as DOMRect);
    const routed: string[] = [];
    const eaten = {
      ...target.target,
      routeInput: (event: InputEvent) => {
        if (event.type !== "keydown") return false;
        routed.push(event.key);
        return event.key === "Delete";
      },
    };
    new PointerInteractions(element).connect(eaten);

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );

    // The stack consumed Delete, and only the unconsumed ArrowLeft falls through to the floor gesture.
    expect(routed).toEqual(["Delete", "ArrowLeft"]);
    expect(target.pixelPans).toEqual([40]);
  });

  it("should not route modifier combos to the stack", () => {
    const routed: string[] = [];
    const spying = {
      ...target.target,
      routeInput: (event: InputEvent) => {
        if (event.type === "keydown") routed.push(event.key);
        return false;
      },
    };
    new PointerInteractions(element).connect(spying);

    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", ctrlKey: true, bubbles: true }),
    );

    expect(routed).toEqual([]);
  });
});

describe("PointerInteractions kinetic scroll (2.4)", () => {
  it("should keep flowing after release when enabled", async () => {
    // jsdom has rAF — this actually waits out a few frames.
    new PointerInteractions(element, { kineticScroll: true }).connect(target.target);

    down(100);
    move(160);
    up();

    const panned = target.pixelPans.length;
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(target.pixelPans.length).toBeGreaterThan(panned);
  });

  /**
   * A cancellation is not a release — and neither is kinetic scrolling.
   * If a pan reclaimed by palm rejection or a browser gesture handoff
   * still kicks off inertia at its last velocity, the chart flies off on
   * its own.
   */
  it("should not fling after the system cancels the pan", async () => {
    new PointerInteractions(element, { kineticScroll: true }).connect(target.target);

    down(100);
    move(160);
    document.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));

    const panned = target.pixelPans.length;
    await new Promise((resolve) => setTimeout(resolve, 80));

    // The user didn't fling this — it must not keep flowing.
    expect(target.pixelPans.length).toBe(panned);
  });

  it("should stop dead the moment a finger lands", async () => {
    new PointerInteractions(element, { kineticScroll: true }).connect(target.target);

    down(100);
    move(160);
    up();
    down(200); // stops inertia.
    up();

    const panned = target.pixelPans.length;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(target.pixelPans.length).toBe(panned);
  });

  it("should not flow at all by default", async () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    move(160);
    up();

    const panned = target.pixelPans.length;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(target.pixelPans.length).toBe(panned);
  });
});

describe("PointerInteractions click trio (2.5)", () => {
  it("should echo a clean click with local coordinates", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    up();
    element.dispatchEvent(
      new MouseEvent("click", { clientX: 150, clientY: 120, bubbles: true }),
    );

    expect(target.clicks).toEqual([{ x: 100, y: 100 }]);
  });

  it("should swallow the click at the end of a drag", () => {
    new PointerInteractions(element).connect(target.target);

    down(100);
    move(160); // past the 5px threshold — this is a drag.
    up();
    element.dispatchEvent(
      new MouseEvent("click", { clientX: 160, bubbles: true }),
    );

    expect(target.clicks).toEqual([]);
  });

  it("should echo the context menu", () => {
    new PointerInteractions(element).connect(target.target);

    element.dispatchEvent(
      new MouseEvent("contextmenu", { clientX: 90, clientY: 70, bubbles: true }),
    );

    expect(target.menus).toEqual([{ x: 40, y: 50 }]);
  });
});


/**
 * **The cursor left, so the crosshair is nowhere.** A tooltip or legend
 * left holding the last value on a live chart reads as the current price,
 * so leaving the element — or the browser taking the gesture over — tells
 * the target the crosshair is `null`. Not mid-drag: the pointer leaving the
 * element while dragging is ordinary, and the drag goes on.
 */
describe("leaving the chart", () => {
  it("clears the crosshair on pointerleave", () => {
    new PointerInteractions(element).connect(target.target);
    element.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, clientY: 40, bubbles: true }));
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));

    expect(target.crosshairs.at(-1)).toBeNull();
    expect(target.crosshairs.length).toBe(2);
  });

  it("clears the crosshair when the browser cancels the pointer", () => {
    new PointerInteractions(element).connect(target.target);
    element.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));

    expect(target.crosshairs).toEqual([null]);
  });

  it("does not clear it mid-drag — the drag goes on through the document", () => {
    new PointerInteractions(element).connect(target.target);
    down(100);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));

    expect(target.crosshairs).toEqual([]);
    up();
  });

  it("tells the target on a cancel and again on the leave that follows — the plot makes them one", () => {
    // With nothing to drag, a browser taking the gesture over sends both;
    // saying `null` once is the plot's, at the door every emitter uses.
    new PointerInteractions(element, { pan: false, zoom: false }).connect(target.target);
    element.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, clientY: 40, bubbles: true }));
    element.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));

    expect(target.crosshairs).toEqual([{ x: 30, y: 20 }, null, null]);
  });

  /**
   * A drag a tool owns goes through the stack, not the pan — and ends the
   * same way: released outside, that is the departure.
   */
  it("clears when a tool-owned drag that left the chart is released outside", () => {
    const grabbing = recordingTarget();
    grabbing.target.routeInput = (event: InputEvent) => event.type === "pointerdown";
    new PointerInteractions(element).connect(grabbing.target);
    element.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, clientY: 40, bubbles: true }));
    down(100);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));
    move(140);
    up();

    expect(grabbing.crosshairs.at(-1)).toBeNull();
  });

  it("clears again after the pointer came back and left again", () => {
    new PointerInteractions(element).connect(target.target);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));
    element.dispatchEvent(new MouseEvent("pointerenter", { bubbles: false }));
    element.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, clientY: 40, bubbles: true }));
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));

    expect(target.crosshairs).toEqual([null, { x: 30, y: 20 }, null]);
  });

  /**
   * A drag that leaves the element goes on through the document — a mouse
   * pan keeps the crosshair under the pointer meanwhile — and where it is
   * released outside, that is the departure, held back until then.
   */
  it("clears when a drag that left the chart is released outside", () => {
    new PointerInteractions(element).connect(target.target);
    element.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, clientY: 40, bubbles: true }));
    down(100);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));
    move(140);
    expect(target.crosshairs.at(-1)).not.toBeNull();

    up();

    expect(target.crosshairs.at(-1)).toBeNull();
  });

  /**
   * The departure is announced after the drag's document listeners are
   * off — a subscriber that throws on it must not leave the document
   * listening, or the next unrelated release would start a pan's inertia.
   */
  it("cleans the drag up even when the departure's subscriber throws", () => {
    const listening = trackListeners(document);
    const throwing = recordingTarget();
    throwing.target.crosshair = (position) => {
      if (position === null) throw new Error("subscriber failed");
    };
    new PointerInteractions(element).connect(throwing.target);
    down(100);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));
    move(140);
    // The throw leaves the listener as an uncaught error on the window —
    // expected here, and swallowed so the runner does not count it.
    const failed: string[] = [];
    const swallow = (event: ErrorEvent): void => {
      failed.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", swallow);
    try {
      up();
    } finally {
      window.removeEventListener("error", swallow);
    }

    expect(failed).toEqual(["subscriber failed"]);
    expect(listening()).toEqual([]);
  });

  it("starts no inertia from a later unrelated release, even with kinetic scroll on", () => {
    const throwing = recordingTarget();
    throwing.target.crosshair = (position) => {
      if (position === null) throw new Error("subscriber failed");
    };
    new PointerInteractions(element, { kineticScroll: true }).connect(throwing.target);
    down(100);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));
    move(140);
    const swallow = (event: ErrorEvent): void => event.preventDefault();
    window.addEventListener("error", swallow);
    try {
      up();
    } finally {
      window.removeEventListener("error", swallow);
    }
    const pansAfterRelease = throwing.pixelPans.length;

    // A release the chart has nothing to do with: a stale document listener
    // would have read it as the end of a pan and started to coast.
    up();

    expect(throwing.pixelPans.length).toBe(pansAfterRelease);
  });

  it("does not clear when a drag that left the chart comes back before release", () => {
    new PointerInteractions(element).connect(target.target);
    down(100);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));
    element.dispatchEvent(new MouseEvent("pointerenter", { bubbles: false }));
    up();

    expect(target.crosshairs).not.toContain(null);
  });

  it("says nothing when the crosshair is off", () => {
    new PointerInteractions(element, { crosshair: false }).connect(target.target);
    element.dispatchEvent(new MouseEvent("pointerleave", { bubbles: false }));

    expect(target.crosshairs).toEqual([]);
  });
});

/**
 * **Horizontal gestures are the chart's, vertical ones the page's.** With
 * `touch-action: none` a vertical swipe over a chart in a scrolling page
 * did nothing and scrolled nothing.
 */
describe("touch-action", () => {
  it("leaves vertical panning to the page", () => {
    new PointerInteractions(element).connect(target.target);
    expect(element.style.touchAction).toBe("pan-y");
  });
});

/**
 * **A plain wheel is the page's when asked.** `wheel: "modifier"` zooms
 * only with Ctrl or ⌘ held — a trackpad pinch sends exactly that — and
 * lets two-finger scrolling reach the page; the default takes every event.
 */
describe("wheel", () => {
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent("wheel", { deltaY: -100, clientX: 80, bubbles: true, cancelable: true, ...init });
    element.dispatchEvent(event);
    return event;
  };

  it("zooms on every wheel by default and keeps it from the page", () => {
    new PointerInteractions(element).connect(target.target);
    const event = wheel({});

    expect(target.pixelZooms).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets a plain wheel reach the page under wheel: modifier", () => {
    new PointerInteractions(element, { wheel: "modifier" }).connect(target.target);
    const event = wheel({});

    expect(target.pixelZooms).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("zooms with a modifier held — %o", (held) => {
    new PointerInteractions(element, { wheel: "modifier" }).connect(target.target);
    const event = wheel(held);

    expect(target.pixelZooms).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
