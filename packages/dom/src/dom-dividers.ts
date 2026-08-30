import type { DividerFactory } from "@finchart/core";
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

  /** Reuses dividers once created — recreating them on every render would swap the handle out mid-drag. */
  const pool: HTMLElement[] = [];

  /**
   * For cleaning up drags in progress. move/end are attached to document,
   * so removing the handle alone doesn't tear them down — if destroy()
   * happens mid-drag (SPA routing, a React unmount), onDrag would keep
   * firing into a dead plot.
   */
  const activeDrags = new Set<() => void>();

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
    let lastY: number | null = null;

    const move = (event: Event): void => {
      if (lastY === null) return;

      const { clientY } = event as PointerEvent;
      onDrag(index, clientY - lastY);
      lastY = clientY;
    };

    const end = (): void => {
      lastY = null;
      activeDrags.delete(end);
      element.removeAttribute("data-dragging");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
    };

    element.addEventListener("pointerdown", (event: PointerEvent) => {
      // Without stopping this, the container's pan handler gets dragged along too.
      event.stopPropagation();
      event.preventDefault();

      /**
       * The pointer often strays off the 7px handle mid-drag — `:hover`
       * styling flickers every time that happens. Capture keeps events (and
       * hover) pinned to the handle, and state is exposed via the
       * `[data-dragging]` attribute — consumers use this instead of (or
       * alongside) `:hover`.
       */
      element.setPointerCapture?.(event.pointerId);
      element.setAttribute("data-dragging", "");

      lastY = event.clientY;
      activeDrags.add(end);
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end);
      document.addEventListener("pointercancel", end);
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
      // A Set is safe to self-delete from during iteration — end() removes itself.
      for (const end of activeDrags) end();
      root.remove();
    },
  };
};
