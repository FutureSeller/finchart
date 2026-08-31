import type { Point } from "../primitives";
import type { InputEvent } from "./input-router";

/**
 * The side that actually applies an interaction. The chart implements this.
 *
 * Input arrives in pixels, but the domain works in data units, so a
 * conversion is needed. The chart is the only thing that knows the scale
 * used for that conversion, so the pixel entry points live here too — if
 * the handler knew the scale, the input layer would take on the coordinate
 * system as well.
 */
export interface InteractionTarget {
  /**
   * Offers the normalized input to the stack (registered consumers)
   * first. `true` means it was consumed — the caller (the handler) must
   * not then apply the gesture vocabulary below. pan/zoom/crosshair
   * remain simply the translation of input the stack didn't consume.
   */
  routeInput(event: InputEvent): boolean;

  /** Shifts the x domain by `offset` data units. */
  pan(offset: number): void;
  /** For a drag of `dx` screen pixels. Dragging right shows the earlier range. */
  panByPixels(dx: number): void;

  /** Zooms by `factor`, holding `center` (data coordinates) fixed. */
  zoom(factor: number, center: number): void;
  /** Zooms holding a screen x fixed (for a wheel event, at the cursor). */
  zoomAtPixel(factor: number, screenX: number): void;

  crosshair(position: Point): void;

  /**
   * A set of input echoes — the same character as `crosshair`: they never
   * change state, only pass through to subscribers. The material behind
   * drawing tools and app integrations (marker clicks).
   */
  click(position: Point): void;
  doubleClick(position: Point): void;
  contextMenu(position: Point): void;

  /**
   * Resets both axes so the whole dataset is visible — the destination of
   * the double-click reset. This just lifts a public method that already
   * existed on `Plot` onto the contract.
   */
  fitDomains(): void;
}

/**
 * Translates input into interaction intent. Receives its target via
 * `connect`, and removes its listeners in `disconnect`. What it's attached
 * to isn't part of the contract — the implementation knows its own element
 * ahead of time (the browser assembly wires it up as
 * `pointerInteractions(container)`, for instance). Keeping an element type
 * out of the core contract is what makes headless possible.
 */
export interface InteractionHandler {
  connect(target: InteractionTarget): void;
  disconnect(): void;

  handlePan(offset: number): void;
  handleZoom(factor: number, center: number): void;
  handleCrosshair(position: Point): void;
}

/**
 * What a keyboard contestant holds after registering with the chart
 * (`FocusAreaHost.claimFocusArea`).
 */
export interface FocusClaim {
  /**
   * Whether this point is claimed by some other contestant, **not this
   * one.** A spot nobody contests (an axis, margin, or a pane with no
   * toolbox) is `false`. **Never throws here even if someone else's
   * `areaOf` throws or returns garbage** — that extension is simply
   * treated as not contesting.
   */
  contestedAt(point: Point): boolean;
  /** Safe to call twice. */
  release(): void;
}
