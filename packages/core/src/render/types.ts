import { ContractError, describe } from "../primitives";
import type { PlotArea, Point } from "../primitives";

/**
 * A settled style the renderer uses as-is.
 * CSS variable resolution is finished and handed off by the chart — the renderer doesn't choose colors.
 */
export interface LineStyle {
  width: number;
  color: string;
  dashArray?: string;
}

/**
 * A settled style for text. `font` is the entire CSS shorthand property —
 * accepting size alone as a number would leave no way to express family,
 * forcing the renderer to decide a default. Taking a finished string
 * leaves no hole for the renderer to fill.
 */
export interface TextStyle {
  /** `"600 12px Inter, sans-serif"` */
  font: string;
  color: string;
}

/**
 * Where and how to place a piece of text. It doesn't take a size —
 * measuring is the renderer's job, so the caller only states an anchor and
 * an alignment.
 */
export interface TextParams {
  readonly text: string;
  /** The point to place it at. Which side of this point it lands on is decided by align and baseline. */
  readonly at: Point;
  readonly align: "left" | "center" | "right";
  readonly baseline: "top" | "middle" | "bottom";
  readonly style: TextStyle;
  /** If present, lays a box behind the text. Its size comes from the measured result. */
  readonly box?: { fill: string; padding: number };
}

export type ShapeParams =
  | { shape: "circle"; cx: number; cy: number; r: number; fill: string }
  | {
      shape: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
    }
  | { shape: "polygon"; points: Point[]; fill: string };

/**
 * The part of what `measureText` returns that core reads. Filling in width
 * alone is still a valid implementation — without a vertical box, it falls
 * to the font string's px (`textHeight`). A real `TextMetrics` satisfies
 * this shape, so it can be returned as-is.
 */
export interface TextMetricsLike {
  readonly width: number;
  readonly fontBoundingBoxAscent?: number;
  readonly fontBoundingBoxDescent?: number;
}

/**
 * A brush that isn't a color string (gradient, pattern) — core neither
 * creates nor reads it; it exists only so a real context's
 * `strokeStyle`/`fillStyle` type can be assigned.
 */
export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

/** The pattern-side half, existing for the same reason as {@link CanvasGradientLike}. */
export interface CanvasPatternLike {
  setTransform(transform?: object): void;
}

/**
 * The 2D context CanvasRenderer actually uses. A real
 * `CanvasRenderingContext2D` is assignable to it as-is (a type test
 * guarantees this), and a test can pass a fake that only satisfies this
 * shape. Why the shape is spelled out directly instead of referencing the
 * global DOM type: this contract has to hold even for a headless consumer
 * (server, worker) whose tsconfig lib has no DOM.
 */
export interface Canvas2DContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  /** A real context's return type (CanvasGradient) satisfies this shape. */
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): CanvasGradientLike;
  setLineDash(segments: number[]): void;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  lineWidth: number;
  strokeStyle: string | CanvasGradientLike | CanvasPatternLike;
  fillStyle: string | CanvasGradientLike | CanvasPatternLike;
  // Text. measureText isn't affected by the transform matrix, so it returns
  // in the same unit as coordinates (CSS px) — the DPR scale is carried by
  // setTransform alone.
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): TextMetricsLike;
  font: string;
  textAlign: "center" | "end" | "left" | "right" | "start";
  textBaseline:
    | "alphabetic"
    | "bottom"
    | "hanging"
    | "ideographic"
    | "middle"
    | "top";
  // Clipping. A boundary is set and released with save/restore — since
  // this blocks drawing itself rather than erasing and redrawing, it's
  // correct regardless of order.
  save(): void;
  restore(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
}

/**
 * The surface a picture actually lands on. The single owner of size.
 *
 * `context` exists only when there's a canvas — a surface that doesn't
 * replay commands (headless — a recording renderer just receives commands)
 * only holds size. Whoever actually requires a context
 * (`createCanvasRenderer`, `createCanvasTextMeasurer`) throws at
 * construction if it's missing — a wiring error, not a quiet null object.
 */
export interface DrawSurface {
  readonly width: number;
  readonly height: number;
  readonly context?: Canvas2DContext;
}

/**
 * The layers a chart sets up inside a container.
 *
 * Data draws onto the canvas; anything needing DOM events and
 * accessibility, like annotations and tooltips, goes onto the overlay.
 * Redrawing the canvas leaves the overlay untouched.
 */
export interface ChartLayers {
  readonly data: DrawSurface;
  /**
   * The layer annotations, DOM labels, and dividers sit on. Core doesn't
   * know what this is — a browser layer puts an element in it, a headless
   * layer puts null in it, and core just passes it along. A collaborator
   * that requires an overlay (DOM labels, dividers, legend, tooltip)
   * narrows it at its own door (`requireOverlayElement`), or throws a
   * wiring error if there isn't one.
   */
  readonly overlay: unknown;
  /**
   * Fits to this size. Should do nothing if nothing changed.
   *
   * The chart calls this right before drawing, every frame. A canvas's
   * bitmap gets wiped the instant its backing store is re-grabbed, so if
   * the moment of clearing and the moment of drawing drift apart, an empty
   * screen shows in between — that's the flicker you see during a resize.
   */
  resize(width: number, height: number): void;
  /**
   * The current pixels as a PNG data URL. Only exists on a layer that has
   * a canvas — this lives here because the layer owns the pixels. A
   * headless layer has no pixels to capture. With DOM-label wiring, the
   * picture comes out missing the labels.
   */
  screenshot?(): string;
  /**
   * The cursor shape over the surface the pointer touches. `null` releases
   * it. The layer owns the cursor — same reason it's here as pixels. A
   * headless layer has no cursor to show, so it's omitted, and the caller
   * (Plot) skips past it if it's absent.
   */
  setCursor?(cursor: string | null): void;
  destroy(): void;
}

/**
 * Doesn't take a container — where to set up is bound ahead of time by
 * assembly (`build(el)` feeds `el` into the recipe `browserDeps(options)`
 * returns).
 */
export type LayersFactory = (width: number, height: number) => ChartLayers;

/**
 * One draw command piled up. Being a union discriminated by `type` means
 * the replay side's `switch` gets exhaustiveness checking — add a new
 * command and the compiler catches any unhandled case.
 *
 * Shapes hold `ShapeParams` as-is, since it's already a union discriminated
 * by `shape`. Merging the two discriminants into one would mean hand-
 * building strings like `"drawShape:rect"`.
 */
export type DrawCommand =
  | {
      readonly type: "drawLine";
      readonly points: readonly Point[];
      readonly style: LineStyle;
    }
  | { readonly type: "drawShape"; readonly shape: ShapeParams }
  | { readonly type: "drawText"; readonly params: TextParams }
  /**
   * From here on, nothing outside this area gets drawn. `null` releases it.
   *
   * This is a command, not state — since the command list is itself the
   * output, another surface replaying it must end up with the same
   * boundary in the same order. The replay side only needs to hold "the
   * one currently set," not a stack: the sender (Plot) sets it per pane
   * and releases it at the end.
   */
  | { readonly type: "clip"; readonly area: PlotArea | null }
  /**
   * A draw core doesn't know about — the door where an extension sends
   * its own primitive.
   *
   * Growing the command set is a major change, since it breaks any
   * consumer doing exhaustiveness checking. In an engine that keeps
   * assembly open, third parties can't be made to wait for a major release
   * over one gradient, so this door only opens once — this variant arriving
   * is major, but whatever primitives get added afterward all pass through
   * it, so the union never has to grow again.
   *
   * The replay side does one of three things: draws it if it knows the
   * name, replays the `fallback` if it doesn't, or skips it if there's no
   * fallback either — it's right for the sender to load what to draw
   * instead, alongside it.
   */
  | ({ readonly type: "custom" } & CustomDraw);

/**
 * One drawing an extension sends. Being honest that `params` is `unknown`
 * — that type is a contract between the extension and a renderer that
 * knows it, and core isn't a party to it. The extension narrows it on its
 * own side (`CustomDraw<GradientParams>`).
 */
export interface CustomDraw<P = unknown> {
  /**
   * What to draw. Carries a namespace (`"acme/heatmap"`) — since there's
   * no global registry, the name alone is what prevents collisions.
   */
  readonly name: string;
  readonly params: P;
  /**
   * What a surface that doesn't know this name replays instead. Leaving it
   * empty draws nothing. This is the spot that keeps the promise "the
   * command list is itself the output" — whether replaying to SVG or
   * sending to a worker, an unknown command doesn't punch a hole in the
   * picture.
   *
   * `clip` can't get in here (`FallbackCommand`) — the boundary belongs to
   * whoever allocated the space, and if a fallback swapped it out, one
   * whole pane would come unbound.
   */
  readonly fallback?: readonly FallbackCommand[];
}

/**
 * The commands a fallback can actually send — the command set minus
 * boundary manipulation. Same reason `DrawTarget` has no `clip` — the
 * drawing side doesn't know where it ends.
 */
export type FallbackCommand = Exclude<DrawCommand, { readonly type: "clip" }>;

/**
 * How many layers deep to follow a `custom` inside a fallback.
 *
 * A command that holds itself as its own fallback recurses forever — a
 * cycle the user created, but not drawing beats blowing the stack.
 */
const MAX_FALLBACK_DEPTH = 8;

/**
 * The receiving side of draw commands — everything a series knows about
 * the renderer. Requiring this interface instead of a concrete renderer
 * means a series doesn't know how commands pile up or when they get
 * replayed.
 */
export interface DrawTarget {
  drawLine(points: Point[], style: LineStyle): void;
  drawShape(params: ShapeParams): void;
  /** Places text. Measuring and placement are both the receiver's job. */
  drawText(params: TextParams): void;
  /**
   * An extension sends its own primitive. It's optional so existing
   * implementations don't break.
   *
   * Don't call this directly — use `drawCustom(target, draw)`, which
   * replays the `fallback` on a surface missing this method. Calling this
   * directly lets optional chaining quietly fall to drawing nothing.
   */
  drawCustom?(draw: CustomDraw): void;
}

/**
 * Sends an extension's primitive so something gets drawn on any surface.
 *
 * ```ts
 * drawCustom(target, {
 *   name: "acme/gradient",
 *   params: { from, to, stops },
 *   fallback: [{ type: "drawShape", shape: { shape: "rect", …, fill: stops[0] } }],
 * });
 * ```
 *
 * Passes it through as-is to a surface that knows it, replays `fallback`
 * on one that doesn't — compiling fine while quietly not drawing at
 * runtime is the most dangerous outcome.
 */
export function drawCustom(target: DrawTarget, draw: CustomDraw): void {
  if (target.drawCustom) {
    target.drawCustom(draw);
    return;
  }

  eachFallback(draw, (command) => replayInto(target, command));
}

/**
 * Hands out the fallback in order — whatever the replaying surface is, it
 * uses the same rule. Since depth is counted only here, the canvas replay
 * side and this file's `DrawTarget` replay side can't behave differently
 * around a cycle.
 */
export function eachFallback(
  draw: CustomDraw,
  visit: (command: FallbackCommand) => void,
  depth = 0,
): void {
  if (depth >= MAX_FALLBACK_DEPTH) return;

  // A nested `custom` is passed along as-is too — the replaying side might know that name.
  for (const command of draw.fallback ?? []) visit(command);
}

/** Turns one command back into `DrawTarget`'s vocabulary. */
function replayInto(
  target: DrawTarget,
  command: FallbackCommand,
  depth = 0,
): void {
  switch (command.type) {
    case "drawLine":
      target.drawLine([...command.points], command.style);
      return;
    case "drawShape":
      target.drawShape(command.shape);
      return;
    case "drawText":
      target.drawText(command.params);
      return;
    case "custom":
      // `target.drawCustom` was already judged absent before we got here
      // (`drawCustom`'s branch). It isn't asked again.
      eachFallback(
        command,
        (nested) => replayInto(target, nested, depth + 1),
        depth + 1,
      );
      return;
  }

  // Adding a variant to the union breaks compilation here. Only a `fallback`
  // built by a third party can reach this at runtime, so it throws with the
  // same vocabulary as its sibling (`canvas-renderer`).
  const unreachable: never = command;
  throw new ContractError(`unknown command: ${describe(unreachable)}`);
}

/**
 * The side that piles up one frame and sends it out all at once — everything
 * Plot knows. An inspection window like `getCommands()` belongs to the
 * implementation, not the contract.
 */
export interface Renderer extends DrawTarget {
  /** Discards the piled-up commands. The screen is still unchanged. */
  clear(): void;
  /** Clears the screen and replays the piled-up commands. */
  commit(): void;
  /**
   * From here on, nothing outside this area gets drawn. `null` releases it.
   *
   * This lives here, not on `DrawTarget` — a series or decoration must not
   * know which pane it's in, or where that pane ends. The boundary is
   * owned by whoever allocated the panes (Plot).
   *
   * It's optional — a renderer that skips it simply doesn't clip. Still,
   * it's right for a renderer that actually draws onto a canvas to
   * implement it: without clipping, a picture that leaks outside the pane
   * stays visible as-is.
   */
  clip?(area: PlotArea | null): void;
}

export type RendererFactory = (surface: DrawSurface) => Renderer;
