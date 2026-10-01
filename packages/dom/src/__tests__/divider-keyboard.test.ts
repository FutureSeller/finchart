// @vitest-environment jsdom
/**
 * A divider is a focusable separator: it names itself, reports the upper
 * pane's height and limits, and moves with the arrow keys. The keys it
 * handles stop at the handle — neither the input stack (a drawing tool's
 * editing keys) nor the container's own key gestures see them — and a
 * frame drawn while it has focus doesn't take the focus away.
 */
import type { ChartLayers, LayersFactory, LineDataPoint, Pane } from "@finchart/core";
import { lineSeries, manualScheduler, Plot } from "@finchart/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserDeps } from "../browser-deps";
import { createDomDividers } from "../dom-dividers";
import { fakeCanvasContext } from "./fakes";

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  vi.restoreAllMocks();
  container.remove();
});

/** Layers whose overlay sits inside the container, so key events bubble the way they do in a page. */
const layersInContainer: LayersFactory = (width, height): ChartLayers => {
  const size = { width, height };
  const overlay = document.createElement("div");
  container.appendChild(overlay);
  return {
    data: {
      get width() {
        return size.width;
      },
      get height() {
        return size.height;
      },
      context: fakeCanvasContext(),
    },
    overlay,
    resize(nextWidth, nextHeight) {
      size.width = nextWidth;
      size.height = nextHeight;
    },
    destroy() {
      overlay.remove();
    },
  };
};

function setup() {
  // Frames only when the test draws one — keys can land between them, as they do in a page.
  const deps = browserDeps({
    createLayers: layersInContainer,
    createScheduler: manualScheduler(),
    observeResolution: undefined,
  })(container);
  const plot = new Plot({
    deps,
    config: {
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
    size: { width: 800, height: 600 },
  });
  plot.mainPane.addSeries({ series: lineSeries(), data });
  plot.addPane().addSeries({ series: lineSeries(), data });
  plot.render();

  const routed = vi.spyOn(plot, "routeInput");
  const divider = () => {
    const found = container.querySelector("[data-chart-divider]");
    if (!(found instanceof HTMLElement)) throw new Error("no divider");
    return found;
  };
  const heightOf = (pane: Pane) => pane.area.bottom - pane.area.top;
  const key = (name: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
    divider().dispatchEvent(event);
    return event;
  };
  /** A key, then the frame it asked for. */
  const press = (name: string, init: KeyboardEventInit = {}) => {
    const event = key(name, init);
    plot.render();
    return event;
  };
  return { plot, routed, divider, heightOf, key, press };
}

describe("a divider as a separator", () => {
  it("names itself and reports the upper pane's height and limits", () => {
    const { plot, divider, heightOf } = setup();
    const [upper, lower] = plot.panes;
    const handle = divider();
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("aria-label")).toBe("Resize panes");
    // In whole pixels.
    const whole = (value: number) => String(Math.round(value));
    expect(handle.getAttribute("aria-valuenow")).toBe(whole(heightOf(upper)));
    expect(handle.getAttribute("aria-valuemin")).toBe(whole(upper.minHeight));
    expect(handle.getAttribute("aria-valuemax")).toBe(
      whole(heightOf(upper) + heightOf(lower) - lower.minHeight),
    );
  });

  it("moves 8px per arrow, 40px with Shift, and updates aria-valuenow", () => {
    const { plot, divider, heightOf, press } = setup();
    const [upper, lower] = plot.panes;
    const start = heightOf(upper);
    const total = heightOf(upper) + heightOf(lower);

    press("ArrowDown");
    expect(heightOf(upper)).toBe(start + 8);
    expect(divider().getAttribute("aria-valuenow")).toBe(String(Math.round(start + 8)));

    press("ArrowUp", { shiftKey: true });
    expect(heightOf(upper)).toBe(start - 32);
    expect(heightOf(upper) + heightOf(lower)).toBe(total);
    expect(divider().getAttribute("aria-valuenow")).toBe(String(Math.round(start - 32)));
  });

  it("adds up keys pressed before the next frame, Home and End included", () => {
    const { plot, heightOf, key } = setup();
    const [upper, lower] = plot.panes;
    const start = heightOf(upper);

    key("ArrowDown");
    key("ArrowDown");
    plot.render();
    expect(heightOf(upper)).toBe(start + 16);

    key("Home");
    key("ArrowDown");
    key("Home");
    plot.render();
    expect(heightOf(upper)).toBe(upper.minHeight);

    key("End");
    key("ArrowUp");
    key("End");
    plot.render();
    expect(heightOf(lower)).toBe(lower.minHeight);
  });

  it("goes to the limits with Home and End, and stops there", () => {
    const { plot, heightOf, press } = setup();
    const [upper, lower] = plot.panes;
    const total = heightOf(upper) + heightOf(lower);

    press("Home");
    expect(heightOf(upper)).toBe(upper.minHeight);
    press("ArrowUp");
    expect(heightOf(upper)).toBe(upper.minHeight);

    press("End");
    expect(heightOf(lower)).toBe(lower.minHeight);
    expect(heightOf(upper)).toBe(total - lower.minHeight);
  });

  it("keeps the keys it handles away from the input stack and the container", () => {
    const { routed, press } = setup();
    const heard = vi.fn();
    container.addEventListener("keydown", heard);

    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      const event = press(key);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(routed).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  it("lets every other key through", () => {
    const { plot, routed, heightOf, press } = setup();
    const [upper] = plot.panes;
    const start = heightOf(upper);
    const heard = vi.fn();
    container.addEventListener("keydown", heard);

    const event = press("Delete");
    expect(event.defaultPrevented).toBe(false);
    expect(routed).toHaveBeenCalledWith({ type: "keydown", key: "Delete" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heightOf(upper)).toBe(start);

    // With Ctrl, Meta or Alt an arrow belongs to the browser.
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
      const combined = press("ArrowDown", { [modifier]: true });
      expect(combined.defaultPrevented).toBe(false);
      expect(heightOf(upper)).toBe(start);
    }
    expect(heard).toHaveBeenCalledTimes(4);
  });

  it("keeps focus across the frames its own keys cause", () => {
    const { divider, press } = setup();
    const handle = divider();
    handle.focus();
    expect(document.activeElement).toBe(handle);

    press("ArrowDown");
    press("ArrowDown");
    press("ArrowUp", { shiftKey: true });
    expect(divider()).toBe(handle);
    expect(document.activeElement).toBe(handle);
  });
});

/** Two real panes for a boundary drawn without a chart around it. */
function paneFixture(): readonly [Pane, Pane] {
  const [upper, lower] = setup().plot.panes;
  return [upper, lower];
}

describe("createDomDividers on its own", () => {
  const boundary = (index: number, now: number) => ({
    index,
    y: 100 * (index + 1),
    left: 0,
    right: 200,
    value: { now, min: 40, max: 300 },
    panes: paneFixture(),
  });

  it("reports each render's values, and sends Home/End as a move to the limit", () => {
    const overlay = document.createElement("div");
    container.appendChild(overlay);
    const drags: Array<[number, number]> = [];
    const dividers = createDomDividers(overlay, (index, dy) => void drags.push([index, dy]));

    dividers.render([boundary(0, 100), boundary(1, 120)]);
    dividers.render([boundary(0, 110.4), boundary(1, 89.6)]);
    const handles = [...overlay.querySelectorAll("[data-chart-divider]")];
    expect(handles.map((handle) => handle.getAttribute("aria-valuenow"))).toEqual(["110", "90"]);

    const key = (slot: number, name: string) =>
      handles[slot].dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    key(1, "Home");
    key(1, "End");
    key(0, "ArrowDown");
    expect(drags).toEqual([
      [1, -Infinity],
      [1, Infinity],
      [0, 8],
    ]);
    dividers.destroy();
  });

  it("keeps focus when the count stays, and still drops a handle that goes", () => {
    const overlay = document.createElement("div");
    container.appendChild(overlay);
    const dividers = createDomDividers(overlay, () => undefined);

    dividers.render([boundary(0, 100), boundary(1, 120)]);
    const [first] = overlay.querySelectorAll("[data-chart-divider]");
    if (!(first instanceof HTMLElement)) throw new Error("no divider");
    first.focus();
    dividers.render([boundary(0, 104), boundary(1, 120)]);
    expect(document.activeElement).toBe(first);

    dividers.render([boundary(0, 104)]);
    expect(overlay.querySelectorAll("[data-chart-divider]")).toHaveLength(1);
    dividers.render([boundary(0, 104), boundary(1, 120)]);
    expect(overlay.querySelectorAll("[data-chart-divider]")).toHaveLength(2);

    // Cleared, then drawn again at the same count — the handles come back.
    dividers.clear();
    expect(overlay.querySelectorAll("[data-chart-divider]")).toHaveLength(0);
    dividers.render([boundary(0, 104), boundary(1, 120)]);
    expect(overlay.querySelectorAll("[data-chart-divider]")).toHaveLength(2);
    dividers.destroy();
  });

  describe("a handle that cannot move", () => {
    const at = (value: { now: number; min: number; max: number }) => ({ index: 0, y: 100, left: 0, right: 200, value, panes: pair });
    let pair: readonly [Pane, Pane];
    beforeEach(() => {
      pair = paneFixture();
    });
    const mountOne = () => {
      const overlay = document.createElement("div");
      container.appendChild(overlay);
      const drags: number[] = [];
      const dividers = createDomDividers(overlay, (_index, dy) => void drags.push(dy));
      const handle = () => {
        const found = overlay.querySelector("[data-chart-divider]");
        if (!(found instanceof HTMLElement)) throw new Error("no divider");
        return found;
      };
      return { overlay, dividers, handle, drags };
    };

    it("says so while its limits meet, and stops saying so when they part — on every render", () => {
      const { dividers, handle } = mountOne();
      dividers.render([at({ now: 60, min: 60, max: 60 })]);
      expect(handle().getAttribute("aria-disabled")).toBe("true");
      expect(handle().style.cursor).toBe("default");

      dividers.render([at({ now: 60, min: 40, max: 90 })]);
      expect(handle().hasAttribute("aria-disabled")).toBe(false);
      expect(handle().style.cursor).toBe("row-resize");

      dividers.render([at({ now: 60, min: 60, max: 60 })]);
      expect(handle().getAttribute("aria-disabled")).toBe("true");
      dividers.destroy();
    });

    it("judges by the limits themselves, not by their rounded ARIA text", () => {
      const { dividers, handle } = mountOne();
      // All three read "100" once rounded, yet there is room to move.
      dividers.render([at({ now: 100, min: 99.6, max: 100.4 })]);
      expect(handle().getAttribute("aria-valuemin")).toBe(handle().getAttribute("aria-valuemax"));
      expect(handle().hasAttribute("aria-disabled")).toBe(false);
      dividers.destroy();
    });

    it("keeps its focus and tab stop, still keeps its own keys, and lets the others through", () => {
      const { dividers, handle, drags } = mountOne();
      dividers.render([at({ now: 60, min: 40, max: 90 })]);
      handle().focus();
      dividers.render([at({ now: 60, min: 60, max: 60 })]);
      expect(document.activeElement).toBe(handle());
      expect(handle().tabIndex).toBe(0);

      const arrow = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      handle().dispatchEvent(arrow);
      expect(arrow.defaultPrevented).toBe(true);
      expect(drags).toEqual([8]);

      const other = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      handle().dispatchEvent(other);
      expect(other.defaultPrevented).toBe(false);
      dividers.destroy();
    });

    it("does not start a drag, but still keeps the press from panning the chart", () => {
      const { dividers, handle, drags } = mountOne();
      dividers.render([at({ now: 60, min: 60, max: 60 })]);
      const heard = vi.fn();
      container.addEventListener("pointerdown", heard);

      handle().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: 100 }));
      expect(heard).not.toHaveBeenCalled();
      expect(handle().hasAttribute("data-dragging")).toBe(false);
      document.dispatchEvent(new MouseEvent("pointermove", { clientY: 140 }));
      expect(drags).toEqual([]);
      dividers.destroy();
    });

    it("lets a drag that started while it could move carry on after the limits meet", () => {
      const { dividers, handle, drags } = mountOne();
      dividers.render([at({ now: 60, min: 40, max: 90 })]);
      handle().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: 100 }));
      dividers.render([at({ now: 60, min: 60, max: 60 })]);
      document.dispatchEvent(new MouseEvent("pointermove", { clientY: 110 }));
      expect(drags).toEqual([10]);
      document.dispatchEvent(new MouseEvent("pointerup", {}));
      dividers.destroy();
    });
  });
});

it("ignores moves and releases belonging to a different pointer", () => {
  const drag = vi.fn();
  const dividers = createDomDividers(container, drag);
  dividers.render([{ index: 0, y: 50, left: 0, right: 100, value: { now: 50, min: 10, max: 90 }, panes: paneFixture() }]);
  const handle = container.querySelector('[data-chart-divider]');
  if (!handle) throw new Error('missing divider');
  const send = (target: EventTarget, type: string, id: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: id });
    target.dispatchEvent(event);
  };
  send(handle, 'pointerdown', 1, 50);
  send(document, 'pointermove', 2, 80);
  send(document, 'pointerup', 2, 80);
  send(document, 'pointercancel', 2, 80);
  expect(drag).not.toHaveBeenCalled();
  send(document, 'pointermove', 1, 60);
  expect(drag).toHaveBeenCalledExactlyOnceWith(0, 10);
  send(document, 'pointerup', 1, 60);
  send(document, 'pointermove', 1, 70);
  expect(drag).toHaveBeenCalledTimes(1);
  dividers.destroy();
});

describe("a drag whose panes change under it", () => {
  it("stops moving anything once the handle no longer sits between the panes it grabbed", () => {
    const { plot, divider } = setup();
    const lower = plot.panes[1];
    const third = plot.addPane();
    third.addSeries({ series: lineSeries(), data });
    plot.render();
    const flexes = () => plot.panes.map((pane) => pane.flex);

    // Grab the handle between the main pane and `lower`, then an indicator toggle removes `lower`.
    divider().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: 100 }));
    plot.removePane(lower);
    const before = flexes();

    document.dispatchEvent(new MouseEvent("pointermove", { clientY: 140 }));
    plot.render();
    document.dispatchEvent(new MouseEvent("pointermove", { clientY: 180 }));
    plot.render();

    expect(flexes()).toEqual(before);
    document.dispatchEvent(new MouseEvent("pointerup", {}));
  });
});
