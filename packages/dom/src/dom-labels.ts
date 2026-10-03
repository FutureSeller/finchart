import type { AxisLabelsFactory } from "@finchart/core";
import {
  AXIS_LABEL_OFFSET,
  AXIS_LABEL_SPEC,
  BADGE_PADDING,
  cssVarExpr,
} from "@finchart/core";
import { requireOverlayElement } from "./overlay-element";

const OFFSET = AXIS_LABEL_OFFSET;

/**
 * Draws tick labels into the DOM overlay — browser-only wiring.
 *
 * The label contract (AxisBadge, AxisLabelsFactory, AXIS_LABEL_SPEC) is
 * shared with the headless and canvas paths too; this is split out from
 * labels.ts because only this implementation needs a document.
 *
 * Creates one dedicated container inside the overlay and updates only
 * within it — clearing the whole overlay would wipe out any annotations the
 * user has attached.
 */
export const createDomAxisLabels: AxisLabelsFactory = (host) => {
  const overlay = requireOverlayElement(
    host.overlay,
    "DOM labels require a DOM overlay — a headless chart uses createCanvasAxisLabels instead",
  );

  const document = overlay.ownerDocument;

  const root = document.createElement("div");
  root.setAttribute("data-chart-axis", "");
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.pointerEvents = "none";
  overlay.appendChild(root);

  function label(text: string): HTMLElement {
    const element = document.createElement("span");
    element.textContent = text;
    element.style.position = "absolute";
    element.style.whiteSpace = "nowrap";
    // Set family and size separately — the `font` shorthand requires a
    // family, which would force the library to pick a font and reset
    // weight/style to initial too. The font should inherit from the page by
    // default, so it's left as inherit.
    element.style.fontSize = cssVarExpr(AXIS_LABEL_SPEC.fontSize);
    element.style.fontFamily = cssVarExpr(AXIS_LABEL_SPEC.fontFamily);
    element.style.color = cssVarExpr(AXIS_LABEL_SPEC.color);
    return element;
  }

  return {
    render({ x, y, badges, area, axes }) {
      const children: HTMLElement[] = [];
      // Which side the y-axis is on is determined from the slice's
      // geometry — not adding a separate field for it because the position
      // already carries the truth.
      const yRight = axes.y !== null && axes.y.left >= area.right;
      const yEdge = yRight ? area.right + OFFSET : area.left - OFFSET;
      const yTransform = yRight
        ? "translateY(-50%)"
        : "translate(-100%, -50%)";
      // An x label centred on an edge tick would hang half off the chart —
      // the centring is clamped between the data area's edge and the y
      // gutter on its side, in CSS so nothing is measured.
      const xLeft = yRight || axes.y === null ? area.left : axes.y.left;
      const xRight = yRight && axes.y !== null ? axes.y.right : area.right;
      const xTransform = (position: number) =>
        `translateX(clamp(${xLeft - position}px, -50%, calc(${xRight - position}px - 100%)))`;

      for (const tick of x) {
        const element = label(tick.label);
        element.style.left = `${tick.position}px`;
        element.style.top = `${area.bottom + OFFSET}px`;
        element.style.transform = xTransform(tick.position);
        children.push(element);
      }

      for (const tick of y) {
        const element = label(tick.label);
        element.style.left = `${yEdge}px`;
        element.style.top = `${tick.position}px`;
        element.style.transform = yTransform;
        children.push(element);
      }

      // Badges are appended after ticks — at the same z, document order is
      // stacking order, so a value box covers the tick underneath it.
      for (const badge of badges) {
        const element = label(badge.label);
        element.style.color = badge.color;
        element.style.background = badge.back;
        element.style.padding = `${BADGE_PADDING}px ${BADGE_PADDING}px`;

        if (badge.axis === "x") {
          element.style.left = `${badge.position}px`;
          element.style.top = `${area.bottom + OFFSET}px`;
          element.style.transform = xTransform(badge.position);
        } else {
          element.style.left = `${yEdge}px`;
          element.style.top = `${badge.position}px`;
          element.style.transform = yTransform;
        }
        children.push(element);
      }

      root.replaceChildren(...children);
    },

    clear() {
      root.replaceChildren();
    },

    destroy() {
      root.remove();
    },
  };
};
