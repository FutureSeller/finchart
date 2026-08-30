import type { Point } from "../primitives";
import type { InteractionHandler, InteractionTarget } from "./types";

/**
 * A handler that doesn't listen for input itself.
 *
 * Use this when the host calls handlePan/handleZoom directly from its own
 * event handling. Use PointerInteractions if you want mouse and touch
 * handled automatically.
 */
export class DefaultInteractionHandler implements InteractionHandler {
  private target: InteractionTarget | null = null;

  connect(target: InteractionTarget): void {
    this.target = target;
  }

  disconnect(): void {
    this.target = null;
  }

  handlePan(offset: number): void {
    this.target?.pan(offset);
  }

  handleZoom(factor: number, center: number): void {
    this.target?.zoom(factor, center);
  }

  handleCrosshair(position: Point): void {
    this.target?.crosshair(position);
  }
}
