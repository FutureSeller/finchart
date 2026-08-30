import type { DividerFactory, Scope } from "@finchart/core";
import { createScope } from "@finchart/core";
import { listen } from "./listen";
import { requireOverlayElement } from "./overlay-element";

/** Thick enough to grab, thin enough not to obscure the pane. */
const THICKNESS = 7;

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

  function handle(): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-chart-divider", "");
    element.style.position = "absolute";
    element.style.height = `${THICKNESS}px`;
    element.style.cursor = "row-resize";
    element.style.pointerEvents = "auto";
    return element;
  }

  function attach(element: HTMLElement, index: number): void {
    let drag: Scope | null = null;

    const end = (): void => {
      drag?.dispose();
      drag = null;
    };

    listen(scope, element, "pointerdown", (event: PointerEvent) => {
      // Without stopping this, the container's pan handler gets dragged along too.
      event.stopPropagation();
      event.preventDefault();

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
        onDrag(index, moveEvent.clientY - lastY);
        lastY = moveEvent.clientY;
      };

      drag = scope.child();
      // Registered first, so it runs last: listeners come off, then the
      // attribute resets — a mid-drag destroy() walks the same path as release.
      drag.add(() => element.removeAttribute("data-dragging"));
      listen(drag, document, "pointermove", move);
      listen(drag, document, "pointerup", end);
      listen(drag, document, "pointercancel", end);
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
      });

      root.replaceChildren(...pool.slice(0, boundaries.length));
    },

    clear() {
      root.replaceChildren();
    },

    destroy() {
      scope.dispose();
    },
  };
};
