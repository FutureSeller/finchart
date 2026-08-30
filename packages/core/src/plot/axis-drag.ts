import { ContractError, contains, type PlotArea, type Point } from "../primitives";
import type { InputConsumer } from "../interaction";
import type { Scale } from "../scale";
import type { AxisSlices } from "./layout";

/**
 * What this consumer **actually uses** from a pane — reading the value axis
 * and re-fitting the value range. It doesn't ask for the whole `Pane` for
 * the same reason as `capabilities.ts`: what an extension needs is the few
 * pieces it uses, not the entire type. With only two requirements, a
 * standalone test can stand on an object literal.
 */
export interface ValueAxisTarget {
  readonly yScale: Scale;
  /** Sets the value range directly. **Turns off `autoScale`.** */
  setValueDomain(min: number, max: number): void;
}

/**
 * What axis dragging borrows from Plot. **This much is enough for the
 * consumer to stand alone** — fake these four without a `Plot` and you have
 * a standalone test.
 */
export interface AxisDragTarget {
  /** The axis slices from the last frame — the criterion for "is this on an axis". `null` before the first draw. */
  slices(): AxisSlices | null;
  /**
   * The pane spanning this vertical position. The y-axis slice sits outside
   * a pane's x range, so **lookup is by y only** — a full hit test
   * (`contains`) would fail to find any pane for a cursor on the axis.
   */
  paneAt(y: number): ValueAxisTarget | null;
  /** Zooms the x domain by `factor` around its center (`factor` > 1 zooms in). */
  zoomAroundCenter(factor: number): void;
  requestRender(): void;
  /** Cursor claim (`Plot.claimCursor`) — the "grabbable" indicator goes through here. */
  claimCursor(cursor: string): () => void;
}

/**
 * Axis-drag scaling — one of Plot's **built-in input consumers.**
 *
 * A vertical drag on the y-axis slice stretches or shrinks that pane's
 * value axis (turning off `autoScale`); a horizontal drag on the x-axis
 * slice zooms x in or out around its center. This must never grab before a
 * drawing tool does, so the registering side (Plot) mounts it at low
 * priority.
 */
export function axisDragConsumer(target: AxisDragTarget): InputConsumer {
  let dragging:
    | { axis: "y"; pane: ValueAxisTarget; lastY: number }
    | { axis: "x"; lastX: number }
    | null = null;

  const inside = (area: PlotArea | null, point: Point): area is PlotArea =>
    area !== null && contains(area, point);

  /** The axis the current hover points at, and its claim. Swapped **only on transition**. */
  let hover: { axis: "x" | "y"; release: () => void } | null = null;

  const axisAt = (point: Point): "x" | "y" | null => {
    const slices = target.slices();
    if (!slices) return null;
    if (inside(slices.y, point)) return "y";
    if (inside(slices.x, point)) return "x";
    return null;
  };

  /**
   * Signals "grabbable" while over an axis — y stretches vertically and x
   * zooms horizontally, so the cursor matches that direction. The style is
   * only touched when the axis changes, not on every move.
   */
  const showGrabbable = (point: Point): void => {
    const axis = axisAt(point);
    if (axis === (hover?.axis ?? null)) return;
    hover?.release();
    hover =
      axis === null
        ? null
        : {
            axis,
            release: target.claimCursor(axis === "y" ? "ns-resize" : "ew-resize"),
          };
  };

  /** Grabbed only over an axis slice. Which axis it is decides the kind of drag. */
  const grab = (point: Point): boolean => {
    const slices = target.slices();
    if (!slices) return false;

    if (inside(slices.y, point)) {
      const pane = target.paneAt(point.y);
      if (!pane) return false;
      dragging = { axis: "y", pane, lastY: point.y };
      return true;
    }
    if (inside(slices.x, point)) {
      dragging = { axis: "x", lastX: point.x };
      return true;
    }
    return false;
  };

  /**
   * **Just stops when it reaches a range the scale can't live in** — the
   * gesture doesn't throw. This arithmetic is linear addition, so it can
   * push a log axis's lower bound below zero; when that's rejected,
   * `setValueDomain` changes nothing (the scale only turns off `autoScale`
   * after it accepts the value). Stopping is the right answer for the same
   * reason as the floor in `XViewport.zoom` — when it can't go further, it
   * quietly stops.
   *
   * **The only thing swallowed here is "the scale rejected it".** Catching
   * every `ContractError` would be too broad — `setValueDomain` calls
   * `notify` after planting the domain, so a `ContractError` a subscriber
   * throws inside that also lands in this catch. So the verdict is: if the
   * domain didn't move, it was a rejection; if it did move, this is a real
   * failure, and it's rethrown.
   */
  const scaleValues = (pane: ValueAxisTarget, factor: number): void => {
    const [min, max] = pane.yScale.getDomain();
    const center = (min + max) / 2;
    try {
      pane.setValueDomain(
        center + (min - center) * factor,
        center + (max - center) * factor,
      );
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;

      const [nowMin, nowMax] = pane.yScale.getDomain();
      if (nowMin !== min || nowMax !== max) throw error;
    }
  };

  const drag = (point: Point, state: NonNullable<typeof dragging>): void => {
    if (state.axis === "y") {
      const dy = point.y - state.lastY;
      state.lastY = point.y;
      // Dragging down widens the range (zooms out) — exponential, so a round trip cancels out.
      scaleValues(state.pane, Math.exp(dy * 0.005));
    } else {
      const dx = point.x - state.lastX;
      state.lastX = point.x;
      // Dragging right zooms in — bars get wider.
      target.zoomAroundCenter(Math.exp(dx * 0.005));
    }
    target.requestRender();
  };

  return {
    handle: (event) => {
      if (event.type === "pointerdown") {
        const grabbed = grab(event.point);
        // A touch can land without a preceding move — sync the indicator at the moment of grab too.
        if (grabbed) showGrabbable(event.point);
        return grabbed;
      }

      if (event.type === "pointermove" && dragging) {
        // Keep the claim even if the pointer leaves the axis mid-drag — the drag is still live.
        drag(event.point, dragging);
        return true;
      }

      if (event.type === "pointermove") {
        showGrabbable(event.point);
        return false; // Just an indicator — doesn't consume input, so crosshair/pan still work.
      }

      /**
       * **A cancellation ends the drag too.** Watching only for `pointerup`
       * would leave `dragging` set when a system gesture takes over the
       * touch and only `cancel` arrives without an `up` — the value axis
       * would then keep stretching from hover alone after the hand lifts.
       */
      if (
        (event.type === "pointerup" || event.type === "pointercancel") &&
        dragging
      ) {
        dragging = null;
        return true;
      }

      return false;
    },
  };
}
