import type { DividerFactory, Scope } from "@finchart/core";
import { createScope } from "@finchart/core";
import { listen } from "./listen";
import { requireOverlayElement } from "./overlay-element";

/** Thick enough to grab, thin enough not to obscure the pane. */
const THICKNESS = 7;

/** How far one arrow key moves a divider (px); Shift moves `LARGE_STEP`. */
const STEP = 8;
const LARGE_STEP = 40;

/**
 * Places draggable handles between panes.
 *
 * DOM in the overlay, not canvas — the browser can own cursor shape and hit
 * area, and redrawing the canvas doesn't make a divider disappear mid-drag.
 */
export const createDomDividers: DividerFactory = (rawOverlay, onDrag) => {
  const overlay = requireOverlayElement(
    rawOverlay,
    "DOM dividers require a DOM overlay — leave them out of the wiring for a headless chart",
  );

  const document = overlay.ownerDocument;

  const root = document.createElement("div");
  root.setAttribute("data-chart-dividers", "");
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.pointerEvents = "none";
  overlay.appendChild(root);

  /**
   * Owns everything acquired here. Drags in progress live in child scopes —
   * move/end are attached to document, so removing the handle alone
   * wouldn't tear them down; if destroy() happens mid-drag (SPA routing, a
   * React unmount), the child closing with the parent is what keeps onDrag
   * from firing into a dead plot.
   */
  const scope = createScope();
  scope.add(() => root.remove());

  /** Reuses dividers once created — recreating them on every render would swap the handle out mid-drag. */
  const pool: HTMLElement[] = [];
  /** How many handles are in the DOM now. */
  let shown = 0;
  /** Per slot: the last render said this boundary can't move either way. */
  const locked: boolean[] = [];
  /** Per slot: the panes the last render put either side of it. */
  const pairs: (readonly [unknown, unknown])[] = [];
  /** Per slot: ends a drag in progress on it. */
  const ends: (() => void)[] = [];

  function handle(): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-chart-divider", "");
    element.style.position = "absolute";
    element.style.height = `${THICKNESS}px`;
    element.style.cursor = "row-resize";
    element.style.pointerEvents = "auto";
    // The container leaves vertical touch gestures to the page (`pan-y`);
    // a divider is dragged vertically, so it reserves the gesture itself —
    // the allowed gestures are what every element on the way down permits.
    element.style.touchAction = "none";
    // A focusable separator — the keyboard's way to do what the drag does.
    // No focus ring is drawn here; style `[data-chart-divider]:focus-visible`.
    element.setAttribute("role", "separator");
    element.setAttribute("aria-orientation", "horizontal");
    element.setAttribute("aria-label", "Resize panes");
    element.tabIndex = 0;
    return element;
  }

  function attach(element: HTMLElement, index: number): void {
    let drag: Scope | null = null;

    listen(scope, element, "keydown", (event: KeyboardEvent) => {
      // Combinations with Ctrl, Meta or Alt belong to the browser.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const step = event.shiftKey ? LARGE_STEP : STEP;
      let dy: number;
      switch (event.key) {
        case "ArrowUp":
          dy = -step;
          break;
        case "ArrowDown":
          dy = step;
          break;
        // As far as it goes — the limit is the plot's to find, from the
        // heights as they are now rather than as the last frame drew them.
        case "Home":
          dy = -Infinity;
          break;
        case "End":
          dy = Infinity;
          break;
        default:
          return;
      }
      // A handled key stops here — past the handle, the input stack would
      // hand it to a tool and the container would read it as a gesture.
      event.preventDefault();
      event.stopPropagation();
      onDrag(index, dy);
    });

    const end = (): void => {
      drag?.dispose();
      drag = null;
    };
    ends[index] = end;

    listen(scope, element, "pointerdown", (event: PointerEvent) => {
      // Without stopping this, the container's pan handler gets dragged along too.
      event.stopPropagation();
      event.preventDefault();

      // A boundary that can't move starts no drag — the press still stays
      // here, so it doesn't pan the chart underneath either.
      if (locked[index]) return;

      // A second pointer landing mid-drag restarts the gesture. Release
      // BEFORE acquiring anything new — releasing after would sweep the
      // fresh gesture's state right back out.
      end();

      /**
       * The pointer often strays off the 7px handle mid-drag — `:hover`
       * styling flickers every time that happens. Capture keeps events (and
       * hover) pinned to the handle, and state is exposed via the
       * `[data-dragging]` attribute — consumers use this instead of (or
       * alongside) `:hover`.
       */
      element.setPointerCapture?.(event.pointerId);
      element.setAttribute("data-dragging", "");

      // Gesture state lives in the gesture — once the drag scope removes
      // `move`, nothing can read a stale baseline.
      let lastY = event.clientY;
      const move = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== event.pointerId) return;
        onDrag(index, moveEvent.clientY - lastY);
        lastY = moveEvent.clientY;
      };

      drag = scope.child();
      // Registered first, so it runs last: listeners come off, then the
      // attribute resets — a mid-drag destroy() walks the same path as release.
      drag.add(() => element.removeAttribute("data-dragging"));
      listen(drag, document, "pointermove", move);
      const release = (releaseEvent: PointerEvent): void => {
        if (releaseEvent.pointerId === event.pointerId) end();
      };
      listen(drag, document, "pointerup", release);
      listen(drag, document, "pointercancel", release);
    });
  }

  return {
    render(boundaries) {
      while (pool.length < boundaries.length) {
        const element = handle();
        attach(element, pool.length);
        pool.push(element);
      }

      boundaries.forEach((boundary, slot) => {
        const element = pool[slot];
        element.style.left = `${boundary.left}px`;
        element.style.width = `${boundary.right - boundary.left}px`;
        element.style.top = `${boundary.y - THICKNESS / 2}px`;
        // Whole pixels — flex shares lay out as fractions (`268.5`,
        // `40.00000000000001`), and a screen reader reads every digit.
        element.setAttribute("aria-valuenow", String(Math.round(boundary.value.now)));
        element.setAttribute("aria-valuemin", String(Math.round(boundary.value.min)));
        element.setAttribute("aria-valuemax", String(Math.round(boundary.value.max)));
        // Judged on the limits themselves: rounded ARIA text can read equal
        // while a fraction of a pixel of room is left.
        locked[slot] = boundary.value.min === boundary.value.max;
        // A different pair now sits at this slot — the drag grabbed panes
        // that are no longer either side of it.
        const [upper, lower] = boundary.panes;
        const last = pairs[slot];
        if (last && (last[0] !== upper || last[1] !== lower)) ends[slot]?.();
        pairs[slot] = [upper, lower];
        if (locked[slot]) {
          element.setAttribute("aria-disabled", "true");
          element.style.cursor = "default";
        } else {
          element.removeAttribute("aria-disabled");
          element.style.cursor = "row-resize";
        }
      });

      // A slot that is gone ends whatever drag was on it.
      for (let slot = boundaries.length; slot < pairs.length; slot++) ends[slot]?.();
      pairs.length = boundaries.length;

      // Only when the count changes — re-inserting a handle that stays
      // would take the focus off it on every frame its own key causes.
      if (shown !== boundaries.length) {
        root.replaceChildren(...pool.slice(0, boundaries.length));
        shown = boundaries.length;
      }
    },

    clear() {
      root.replaceChildren();
      shown = 0;
    },

    destroy() {
      scope.dispose();
    },
  };
};
