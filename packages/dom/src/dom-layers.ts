import type { ChartLayers } from "@finchart/core";
import { RenderError } from "@finchart/core";
import { isElementLike } from "./overlay-element";

/**
 * Stacks a data canvas and an overlay inside the container.
 *
 * The overlay lets pointer events pass through by default — an annotation
 * that needs them turns on pointer-events on just its own element, without
 * blocking chart manipulation.
 *
 * Not a `LayersFactory` itself — assembly pre-binds the container:
 * `(w, h) => createDomLayers(container, w, h)` (the browserDeps recipe).
 */
export const createDomLayers = (
  container: HTMLElement | null,
  width: number,
  height: number,
): ChartLayers => {
  // Blocks truthy garbage too — while this only checked falsy, a selector
  // string sailed through here and blew up as a raw TypeError at
  // `container.style`. This is a wiring site, so it's `RenderError`; the
  // consumer-facing door (`PlotBuilder.build`) is a ContractError instead.
  if (!isElementLike(container)) {
    throw new RenderError(
      "DOM layers require a DOM element as container — a headless chart uses " +
        "headless layers instead; pass the result of document.querySelector(...), not a selector string",
    );
  }

  const document = container.ownerDocument;

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";

  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";

  const context = canvas.getContext("2d");
  if (!context) {
    throw new RenderError("could not get a 2D context");
  }

  /** The coordinate unit the chart works in (CSS px). Different from the backing store size. */
  let logical = { width, height };

  /** What's **actually applied** to the backing store. Zero until something's been set. */
  let applied = { width: 0, height: 0, ratio: 0 };

  /**
   * Keeps the pixel grid at physical resolution while coordinates stay in
   * CSS pixels.
   *
   * Sizing the grid to CSS dimensions blurs the drawing on high-density
   * screens. Moving coordinates to physical pixels too would put them out
   * of step with the overlay DOM and pointer input, which are both
   * CSS-pixel-based — so the context transform carries the scale factor
   * alone.
   *
   * Assigning `canvas.width` resets the context, so the transform gets
   * reapplied every time, and skipped when nothing changed — even the same
   * value clears the bitmap, since that's what the API does. dpr is checked
   * too because moving to a different monitor can change the ratio while
   * the size stays the same.
   */
  const sizeBackingStore = (): void => {
    const ratio = document.defaultView?.devicePixelRatio || 1;

    if (
      logical.width === applied.width &&
      logical.height === applied.height &&
      ratio === applied.ratio
    ) {
      return;
    }

    canvas.width = Math.round(logical.width * ratio);
    canvas.height = Math.round(logical.height * ratio);
    canvas.style.width = `${logical.width}px`;
    canvas.style.height = `${logical.height}px`;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    applied = { width: logical.width, height: logical.height, ratio };
  };

  sizeBackingStore();

  // Prepare the surfaces before publishing DOM children. A missing context
  // or backing-store failure leaves the caller's container untouched.
  const position = container.style.position;
  try {
    container.appendChild(canvas);
    container.appendChild(overlay);
    if (!position) container.style.position = "relative";
  } catch (error) {
    canvas.remove();
    overlay.remove();
    throw error;
  }

  return {
    data: {
      get width() {
        return logical.width;
      },
      get height() {
        return logical.height;
      },
      context,
    },
    overlay,
    screenshot() {
      // Axis labels live in the DOM so they remain selectable and readable.
      // Composite those labels onto a copy; the live canvas and overlay stay
      // untouched. Legend, tooltip, and custom overlay elements are omitted.
      const shot = document.createElement("canvas");
      shot.width = canvas.width;
      shot.height = canvas.height;
      const target = shot.getContext("2d");
      if (!target) throw new RenderError("could not get a screenshot 2D context");
      target.drawImage(canvas, 0, 0);
      const view = document.defaultView;
      if (!view || logical.width <= 0 || logical.height <= 0) return shot.toDataURL("image/png");
      target.scale(canvas.width / logical.width, canvas.height / logical.height);
      const origin = canvas.getBoundingClientRect();
      overlay.querySelectorAll<HTMLElement>("[data-chart-axis] span").forEach((label) => {
        const style = view.getComputedStyle(label);
        if (style.display === "none" || style.visibility === "hidden") return;
        const rect = label.getBoundingClientRect();
        const x = rect.left - origin.left;
        const y = rect.top - origin.top;
        if (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent") {
          target.fillStyle = style.backgroundColor;
          target.fillRect(x, y, rect.width, rect.height);
        }
        target.fillStyle = style.color;
        target.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        target.textBaseline = "middle";
        target.fillText(
          label.textContent ?? "",
          x + Number.parseFloat(style.paddingLeft || "0"),
          y + rect.height / 2,
        );
      });
      return shot.toDataURL("image/png");
    },
    setCursor(cursor) {
      // Set on canvas, not container — it's the surface the pointer
      // actually touches (overlay has pointer-events: none), and this way
      // we don't touch anyone else's element style. Dividers are children,
      // so their own cursor wins under normal CSS rules.
      canvas.style.cursor = cursor ?? "";
    },
    resize(nextWidth, nextHeight) {
      logical = { width: nextWidth, height: nextHeight };
      sizeBackingStore();
    },
    destroy() {
      canvas.remove();
      overlay.remove();
      // The container is the caller's and may be reused after the chart.
      if (!position) container.style.position = "";
    },
  };
};
