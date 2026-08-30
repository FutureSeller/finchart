import type { DrawCommand, Renderer, RendererFactory } from "./types";

export interface RecordingRenderer {
  /**
   * Drops straight into `PlotDeps.createRenderer`'s slot. It doesn't use a
   * surface — having nothing to draw onto is the whole point of this
   * renderer.
   *
   * Each call hands out a fresh recorder — sharing one means two charts
   * pile onto the same `pending`, and since `Plot.render()` opens with
   * `clear()`, one starting throws away the frame the other was building.
   */
  factory: RendererFactory;
  /**
   * The last frame that was `commit`ted. An empty array if there isn't one
   * yet. It's a single slot — if several charts share this recorder,
   * whichever committed last is what comes out. To watch each chart
   * separately, give each one its own `recordingRenderer()`.
   *
   * `destroy()` counts as a commit too — teardown clears the screen with
   * `clear(); commit()`, so `commands()` afterward is an empty array.
   */
  commands(): readonly DrawCommand[];
}

/**
 * A renderer that receives commands without replaying them — the command
 * list is itself the output.
 *
 * This is the renderer for a headless chart: a server render replays these
 * commands onto its own surface (PNG, SVG), and a test asserts "what did it
 * draw" without touching pixels. Since commands are plain data, it's safe
 * to send what's received to a worker or serialize it.
 *
 * A frame isn't visible before `commit` — the same contract as a canvas not
 * changing the screen until commit. `clear` only discards what's piling up;
 * it doesn't erase the last frame.
 */
export function recordingRenderer(): RecordingRenderer {
  let committed: readonly DrawCommand[] = [];

  /** The recorder one surface uses. **It alone owns the pile (`pending`).** */
  const create = (): Renderer => {
    let pending: DrawCommand[] = [];

    return {
      drawLine(points, style) {
        pending.push({ type: "drawLine", points: [...points], style });
      },
      drawShape(shape) {
        pending.push({ type: "drawShape", shape });
      },
      drawText(params) {
        pending.push({ type: "drawText", params });
      },
      clip(area) {
        pending.push({ type: "clip", area });
      },
      // An extension's primitive is stored as-is too — it isn't unwrapped
      // to its fallback here because the consumer is the one replaying it
      // onto their own surface. They need the original to draw a name they
      // recognize directly, and fall back to the fallback only when they
      // don't.
      drawCustom(draw) {
        pending.push({ type: "custom", ...draw });
      },
      clear() {
        pending = [];
      },
      commit() {
        committed = pending;
        pending = [];
      },
    };
  };

  return {
    factory: () => create(),
    commands: () => committed,
  };
}
