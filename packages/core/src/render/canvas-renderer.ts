import {
  ContractError,
  RenderError,
  type PlotArea,
  type Point,
} from "../primitives";
import { textHeight } from "./text-measurer";
import { eachFallback } from "./types";
import type {
  Canvas2DContext,
  DrawCommand,
  DrawSurface,
  CustomDraw,
  LineStyle,
  Renderer,
  RendererFactory,
  ShapeParams,
  TextParams,
} from "./types";

/**
 * How to draw an extension's primitive onto an actual canvas.
 *
 * It arrives through wiring — there's no global registry. When a consumer
 * builds their own renderer, they load only what they know about:
 *
 * ```ts
 * createRenderer: (surface) =>
 *   createCanvasRenderer(surface, { painters: { "acme/gradient": paintGradient } }),
 * ```
 *
 * `params` is `unknown` — narrowing it is the job of whoever defined the
 * primitive.
 */
export type CustomPainter = (
  context: Canvas2DContext,
  params: unknown,
) => void;

export interface CanvasRendererOptions {
  /** Name → how to draw it. A name that isn't here falls to `fallback`. */
  painters?: Readonly<Record<string, CustomPainter>>;
}

/**
 * Piles up draw commands and replays them onto a 2D context all at once in
 * commit().
 *
 * Piling commands up first serves two purposes — partial state during a
 * render never shows on screen, and a test can check what was drawn
 * without a context at all.
 */
export class CanvasRenderer implements Renderer {
  private commands: DrawCommand[] = [];
  /** Narrowed at construction — a surface without a context fails at wiring time, not on the first frame. */
  private readonly context: Canvas2DContext;

  private readonly painters: Readonly<Record<string, CustomPainter>>;

  /**
   * Remembers color verdicts — born and dies with the renderer. Reading
   * back canvas state to verify it serializes state on every command and
   * was eating a sizable chunk of frame time — a verdict is purely a
   * property of the string, so once per value is enough.
   */
  private readonly colorVerdicts = new ColorVerdicts();

  /**
   * Font verdicts live in the same kind of container — same reason as
   * color. `applyFont`'s read-back runs more often: its fast path only
   * holds when "the value changed," so the common case where the font
   * stays the same (axis labels within one frame) was actually the one
   * falling to the slow path.
   */
  private readonly fontVerdicts = new FontVerdicts();

  /** The boundary currently set. `null` means no `save()` is pending. */
  private clipArea: PlotArea | null = null;

  constructor(
    private surface: DrawSurface,
    options: CanvasRendererOptions = {},
  ) {
    // The renderer doesn't know painters — even the built-in gradient is
    // injected by a preset. A name that isn't loaded demotes to fallback;
    // it doesn't go silent.
    this.painters = options.painters ?? {};
    if (!surface.context) {
      throw new RenderError(
        "The canvas renderer needs a 2D context — use the recording renderer if you only want commands",
      );
    }
    this.context = surface.context;
  }

  get width(): number {
    return this.surface.width;
  }

  get height(): number {
    return this.surface.height;
  }

  clear(): void {
    this.commands = [];
  }

  drawLine(points: Point[], style: LineStyle): void {
    if (points.length < 2) {
      throw new ContractError("drawLine requires at least 2 points");
    }

    this.commands.push({ type: "drawLine", points, style });
  }

  drawShape(shape: ShapeParams): void {
    // The caller builds a fresh object every time it calls, so this
    // doesn't copy it again — with 1000 candles, that would be 1000
    // objects thrown away every frame for nothing.
    this.commands.push({ type: "drawShape", shape });
  }

  drawText(params: TextParams): void {
    this.commands.push({ type: "drawText", params });
  }

  clip(area: PlotArea | null): void {
    this.commands.push({ type: "clip", area });
  }

  /** Callers should use `drawCustom(target, draw)` — that function holds the fallback. */
  drawCustom(draw: CustomDraw): void {
    this.commands.push({ type: "custom", ...draw });
  }

  commit(): void {
    const { width, height } = this.surface;
    const context = this.context;

    context.clearRect(0, 0, width, height);
    try {
      for (const command of this.commands) {
        this.replay(context, command);
      }
    } finally {
      // Release the boundary if the frame ended with it still set — the
      // context outlives a single frame, so leaving it set means the next
      // frame draws inside someone else's boundary. It's a finally because
      // replay can throw (a painter's ContractError, etc.) — the exception
      // still propagates; only the state gets cleaned up.
      this.releaseClip(context);
    }
  }

  /**
   * Swaps in a new boundary. **It releases what's set, then sets the new
   * one** — a canvas clip is an intersection, so stacking them only ever
   * narrows and can never widen.
   */
  private applyClip(context: Canvas2DContext, area: PlotArea | null): void {
    this.releaseClip(context);
    if (!area) return;

    /**
     * Records the moment `save()` takes effect. Recording it after
     * `clip()` instead would mean that on a surface that throws in
     * between (a partial-implementation shim, say), `commit()`'s
     * `finally` skips `releaseClip` (since `clipArea` is still `null`) and
     * one layer of save is left on the stack forever — the next frame's
     * `clearRect` only takes inside the stale boundary, and the screen
     * freezes with stale pixels.
     */
    context.save();
    this.clipArea = area;
    context.beginPath();
    context.rect(
      area.left,
      area.top,
      area.right - area.left,
      area.bottom - area.top,
    );
    context.clip();
  }

  private releaseClip(context: Canvas2DContext): void {
    if (!this.clipArea) return;
    // Clear it first — even if `restore()` throws, the same spot doesn't get released twice.
    this.clipArea = null;
    context.restore();
  }

  getCommands(): DrawCommand[] {
    return this.commands;
  }

  private replay(context: Canvas2DContext, command: DrawCommand): void {
    switch (command.type) {
      case "drawLine": {
        const { points, style } = command;
        /**
         * A point count too small for a line doesn't get drawn.
         * `drawLine` (the public door) throws under 2 points, but
         * `custom`'s fallback path (`eachFallback` → `replay`) never
         * passes through that door — `{ points: [] }` used to be a raw
         * `TypeError` in the middle of `commit()`, and punching through
         * rAF leaves the canvas stuck on a partial frame permanently.
         */
        if (points.length < 2) return;
        context.setLineDash(parseDashArray(style.dashArray));
        // A canvas quietly ignores an invalid value — if the assignment
        // doesn't take, the previous command's value stays, and this gets
        // drawn with a neighbor's color or width.
        context.lineWidth = usableWidth(style.width);
        applyColor(context, "strokeStyle", style.color, this.colorVerdicts);
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        // Slicing off the tail would copy the whole points array on every commit.
        for (let i = 1; i < points.length; i++) {
          context.lineTo(points[i].x, points[i].y);
        }
        context.stroke();
        return;
      }

      case "drawShape":
        this.replayShape(context, command.shape);
        return;

      case "drawText":
        this.replayText(context, command.params);
        return;

      case "clip":
        this.applyClip(context, command.area);
        return;

      case "custom":
        this.replayCustom(context, command);
        return;
    }

    // Adding a variant to the union breaks compilation here.
    const unreachable: never = command;
    throw new ContractError(`unknown command: ${JSON.stringify(unreachable)}`);
  }

  /**
   * Draws it if the name is known, replays the fallback if it isn't.
   *
   * Wraps the painter in `save`/`restore` — if someone else's code changes
   * `fillStyle` or the transform matrix, every command that follows would
   * be thrown off. Clipping is contained here too — even if the painter
   * sets its own boundary, the frame's boundary stays intact.
   */
  private replayCustom(
    context: Canvas2DContext,
    draw: CustomDraw,
    depth = 0,
  ): void {
    /**
     * Only looks at its own. `this.painters[draw.name]` is a plain object,
     * so it's read through `Object.prototype` — `name: "toString"` would
     * look like a painter exists and skip the fallback, and
     * `name: "__proto__"` would call something that isn't a function and
     * throw a `TypeError`.
     */
    const painter = Object.hasOwn(this.painters, draw.name)
      ? this.painters[draw.name]
      : undefined;

    if (!painter) {
      // A `clip` can't get into the fallback — the replay side never
      // touches the boundary. `eachFallback` counts the depth of nested
      // customs.
      eachFallback(
        draw,
        (command) =>
          command.type === "custom"
            ? this.replayCustom(context, command, depth + 1)
            : this.replay(context, command),
        depth,
      );
      return;
    }

    context.save();
    try {
      painter(context, draw.params);
    } finally {
      context.restore();
      /**
       * Re-sets the boundary. The save/restore pair above only balances
       * our own — if the painter doesn't balance its own, that imbalance
       * takes the frame's boundary down with it. Forgetting a restore
       * would trap the next frame inside a stale boundary; calling it too
       * many times leaks the picture outside the pane in the other
       * direction. Re-setting it puts things right here regardless of
       * which way the stack drifted.
       */
      if (this.clipArea) this.applyClip(context, this.clipArea);
    }
  }

  private replayShape(context: Canvas2DContext, shape: ShapeParams): void {
    applyColor(context, "fillStyle", shape.fill, this.colorVerdicts);

    switch (shape.shape) {
      case "circle":
        context.beginPath();
        context.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
        context.fill();
        return;

      case "rect":
        context.fillRect(shape.x, shape.y, shape.width, shape.height);
        return;

      case "polygon": {
        const { points } = shape;
        /**
         * A point count too small for a face doesn't get drawn — reading
         * `points[0]` unchecked would let an empty array punch through
         * rAF with a `TypeError`. Why it's a no-op instead of throwing:
         * `gradient.ts`'s painter already settled on that — the same call
         * crashing on one surface and doing nothing harmlessly on another
         * isn't a contract. Why this differs from `drawLine` throwing
         * under 2 points: that one is a door the consumer calls directly,
         * while this is a fallback path where zero points is normal when
         * the data is empty.
         */
        if (points.length < 3) return;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          context.lineTo(points[i].x, points[i].y);
        }
        context.closePath();
        context.fill();
        return;
      }
    }

    const unreachable: never = shape;
    throw new ContractError(`unknown shape: ${JSON.stringify(unreachable)}`);
  }

  /**
   * Places text — measuring and deciding coordinates only happen here.
   *
   * The caller supplies just one anchor and an alignment. Why it doesn't
   * take a box size: knowing the width needs font metrics, and requiring
   * that of series and decorations would make them unable to run without a
   * canvas.
   */
  private replayText(context: Canvas2DContext, params: TextParams): void {
    const { text, align, baseline, style, box, within } = params;

    // Must set the font before measuring — measureText uses whatever font is currently set.
    const applied = applyFont(
      context,
      style.font,
      FALLBACK_FONT,
      this.fontVerdicts,
    );

    // Measured once, after the font is set, when either needs it: one
    // horizontal shift for box and text alike, then the box's size.
    const metrics = within || box ? context.measureText(text) : null;
    const at = within && metrics ? { x: params.at.x + shiftInside(metrics.width, params, within), y: params.at.y } : params.at;

    if (box && metrics) {
      const width = metrics.width;
      /**
       * Measured with the font that was actually set. Measuring with
       * `style.font` (the requested font) would, in a demoted frame on a
       * surface without `fontBoundingBox*`, lay a big box behind small
       * text.
       */
      const height = textHeight(metrics, applied);

      applyColor(context, "fillStyle", box.fill, this.colorVerdicts);
      context.fillRect(
        anchorLeft(at.x, width, align) - box.padding,
        anchorTop(at.y, height, baseline) - box.padding,
        width + box.padding * 2,
        height + box.padding * 2,
      );
    }

    // The context handles the text's own alignment. The box above was placed by the same rule.
    /**
     * Alignment is the same kind of channel. `ctx.textAlign = "middle"`
     * doesn't throw — it's ignored and the previous value stays — and
     * since the API names them `align: "center"` / `baseline: "middle"`,
     * it's an easy mistake to swap the two, which draws the box at
     * left/top while the text keeps a neighbor's alignment, splitting them
     * apart.
     *
     * This is a membership check, not a read-back — the value is a finite
     * set, so that's enough.
     */
    context.textAlign = TEXT_ALIGNS.includes(align) ? align : "left";
    context.textBaseline = TEXT_BASELINES.includes(baseline) ? baseline : "top";
    applyColor(context, "fillStyle", style.color, this.colorVerdicts);
    context.fillText(text, at.x, at.y);
  }
}

/**
 * How far to move text so it and its box stay within `left`..`right`: back
 * in from whichever edge it crosses, and onto `left` when it can't fit.
 * A range that isn't a pair of finite numbers moves nothing.
 */
function shiftInside(
  width: number,
  { at, align, box }: TextParams,
  within: { readonly left: number; readonly right: number },
): number {
  if (!Number.isFinite(within.left) || !Number.isFinite(within.right)) return 0;
  const padding = box?.padding ?? 0;
  const left = anchorLeft(at.x, width, align) - padding;
  const right = left + width + padding * 2;
  let shift = 0;
  if (right > within.right) shift = within.right - right;
  if (left + shift < within.left) shift = within.left - left;
  return shift;
}

function anchorLeft(x: number, width: number, align: TextParams["align"]): number {
  if (align === "center") return x - width / 2;
  if (align === "right") return x - width;
  return x;
}

function anchorTop(
  y: number,
  height: number,
  baseline: TextParams["baseline"],
): number {
  if (baseline === "middle") return y - height / 2;
  if (baseline === "bottom") return y - height;
  return y;
}

/**
 * The default wiring. Plot only needs to pass a surface.
 *
 * If a renderer that knows an extension's primitive is needed, pass a
 * painter along with it — it still drops straight into the
 * `RendererFactory` slot.
 */
export const createCanvasRenderer = (
  surface: DrawSurface,
  options?: CanvasRendererOptions,
): Renderer => new CanvasRenderer(surface, options);

/** Compilation guarantees this drops straight into the factory slot. */
const _factory: RendererFactory = createCanvasRenderer;
void _factory;

/**
 * Must match the axis label's size (the fallback in
 * `AXIS_LABEL_SPEC.fontSize`). Not linked by import, because of layering —
 * the renderer doesn't know about axes. Instead,
 * `axis/__tests__/label-font-fallback.test.ts` cross-checks the two spots.
 */
const FALLBACK_FONT_SIZE = "11px";

/** Where an invalid font lands once rejected — same as the axis label's declaration. */
export const FALLBACK_FONT = `${FALLBACK_FONT_SIZE} sans-serif`;

/**
 * What `applyColor` actually needs — just the two channels.
 *
 * The old signature was `Canvas2DContext`, `string`, which forced the one
 * caller assigning a gradient to use two type assertions. Since
 * `Canvas2DContext` already types its channels as `string |
 * CanvasGradientLike | CanvasPatternLike`, this borrows that instead — the
 * headless type smoke test blocks the DOM global name (`CanvasGradient`).
 */
export type CanvasBrush = Canvas2DContext["fillStyle"];

export type CanvasColorChannels = Pick<
  Canvas2DContext,
  "fillStyle" | "strokeStyle"
>;

/**
 * The finite set of values we know how to place — everything else falls
 * to the same side as box placement.
 *
 * This isn't the set canvas accepts, it's the set `anchorLeft` and
 * `anchorTop` know about — values like `start`, `end`, `alphabetic` pass
 * the check and do get set on the context, but the box still ends up at
 * left/top, splitting box and text apart (`align: "end"` leaves a gap the
 * width of the text).
 *
 * Why an array and not a `Set`: the `no-global-registry` machinery treats
 * a module-level `Map`/`Set` as a container that accumulates and blocks
 * it, and `includes` is cheaper for a three-element lookup anyway.
 */
const TEXT_ALIGNS: readonly TextParams["align"][] = ["left", "center", "right"];
const TEXT_BASELINES: readonly TextParams["baseline"][] = [
  "top",
  "middle",
  "bottom",
];

/** Where a rejected color lands — not drawing is more honest than drawing with a neighbor's color. */
const REJECTED_COLOR = "rgba(0,0,0,0)";

/**
 * A container holding verdicts for color strings. Each renderer owns one —
 * putting it at module level would make it an accumulating global that
 * outlives the surface it belonged to.
 *
 * Why there's a cap: a consumer that computes a color per point (a heatmap,
 * say) would grow the key set without bound. Once it overflows, verdicts
 * just stop being remembered — the read-back path stays correct either way.
 */
class Verdicts<V> {
  private readonly seen = new Map<string, V>();
  private static readonly LIMIT = 256;

  get(key: string): V | undefined {
    return this.seen.get(key);
  }

  set(key: string, verdict: V): void {
    if (this.seen.size >= Verdicts.LIMIT) return;
    this.seen.set(key, verdict);
  }
}

/** Color string → does the canvas accept it. */
export class ColorVerdicts extends Verdicts<boolean> {}

/**
 * Font string → the string that actually gets set, or `null` (= fall to
 * the caller's fallback).
 *
 * Unlike color, this isn't true/false, because there's a middle step — a
 * font invalid only in size gets set as `"11px <family>"`, keeping the
 * family alive.
 */
export class FontVerdicts extends Verdicts<string | null> {}

/**
 * Checks whether an assignment actually took.
 *
 * `ctx.fillStyle = "nope"` doesn't throw — it's ignored, and the previous
 * command's color stays in place, so a single typo gets drawn in a
 * neighbor's color. It's not just typos — `currentColor`,
 * `light-dark(...)`, and an undefined `var(--brand)` all pass straight
 * through `getComputedStyle` and arrive here too.
 *
 * It judges by reading back — setting transparent first and then assigning
 * means "it didn't change" is exactly "it was rejected." Since the browser
 * normalizes colors (`#fff` → `rgb(...)`), this checks "did it change,"
 * not string equality.
 *
 * But that read-back itself was expensive — reading a canvas channel makes
 * the browser serialize the current color as a CSS string, and doing that
 * twice per command runs the serialization 34,000 times in a frame with
 * 17,000 commands.
 *
 * | hover frame | total | commit |
 * |---|---|---|
 * | before read-back | 3.70ms | 2.42ms |
 * | after adding read-back | 9.70ms | 8.22ms |
 * | bypassing read-back only | 4.00ms | 2.66ms |
 *
 * So the verdict gets cached — a canvas's color parsing is purely a
 * function of the string, so once per value is enough. Without a cache,
 * it's the old path unchanged (slow, but correct).
 */
export function applyColor(
  context: CanvasColorChannels,
  channel: "fillStyle" | "strokeStyle",
  color: CanvasBrush,
  verdicts?: ColorVerdicts,
): void {
  if (typeof color !== "string") {
    /**
     * A gradient or pattern is an object, so it never goes through
     * parsing and can't be rejected.
     *
     * Anything else that isn't a string is a rejection — `typeof x !==
     * "string"` is also true for `undefined`, `null`, and numbers, and the
     * IDL coerces those to a string before handing them to the canvas,
     * which quietly ignores it (the previous command's color stays). This
     * commonly happens from a single row missing `color` in `fill:
     * point.color`.
     */
    context[channel] =
      typeof color === "object" && color !== null ? color : REJECTED_COLOR;
    return;
  }

  const known = verdicts?.get(color);
  if (known !== undefined) {
    context[channel] = known ? color : REJECTED_COLOR;
    return;
  }

  /**
   * A value seen for the first time — this is the only spot that reads
   * back.
   *
   * Setting transparent first and then assigning means "it didn't change"
   * is exactly "it was rejected." Even if `color` itself normalizes to
   * transparent, it still gets recorded as rejected, but since both
   * branches paint the same "nothing," there's no visible difference on
   * screen.
   */
  context[channel] = REJECTED_COLOR;
  const rejected = context[channel];
  context[channel] = color;
  const accepted = context[channel] !== rejected;

  if (!accepted) context[channel] = REJECTED_COLOR;
  verdicts?.set(color, accepted);
}

/**
 * A font is the same kind of channel — `ctx.font = "nope"` is also ignored
 * instead of thrown. The blast radius is wider than color's — the same
 * string is also used for text measurement, which decides the axis's width
 * and height, so a demotion shakes the layout too.
 *
 * Returns the string that was actually set — if this were `void`, the
 * caller wouldn't know what got set, and would compute layout using the
 * requested font even in a frame where a demotion happened.
 *
 * The verdict gets cached too — since a read-back is only needed when the
 * value changes, the common case where the font stays the same (axis
 * labels within one frame usually share a font) hits the cache and skips
 * the read-back entirely. That said, it's too small a value to show up in
 * frame time (serialization is much cheaper here than for color) — this
 * isn't a speed fix, it's using the same shape as its sibling function
 * (`applyColor`).
 */
export function applyFont(
  context: { font: string },
  font: string,
  fallback: string,
  verdicts?: FontVerdicts,
): string {
  const known = verdicts?.get(font);
  if (known !== undefined) {
    const applied = known ?? fallback;
    context.font = applied;
    return applied;
  }

  // The fast path — if the value changed, it's **certain** to have been accepted.
  const before = context.font;
  context.font = font;
  if (context.font !== before) {
    verdicts?.set(font, font);
    return font;
  }

  /**
   * It didn't change — either it was the same font, or it was rejected.
   * The value a neighbor left behind can't tell these two apart — the
   * value the ladder produces (`"11px <family>"`) can equal what the
   * previous label already had set, and there used to be a regression
   * where success from the second label onward got misread as rejection.
   *
   * Uses a sentinel the same way `applyColor` does, asking through a value
   * that's certainly different regardless of the neighbor.
   */
  if (accepts(context, font)) {
    verdicts?.set(font, font);
    return font;
  }

  /**
   * Truly rejected — save the family first. Falling straight to a single
   * fallback would kill the family too on a single size typo (a value
   * missing its unit, like `--chart-label-font-size: 12`). In the canvas
   * font shorthand, family is the last token, so swapping only the size
   * slot for the default size turns `"12 system-ui"` into `"11px
   * system-ui"`.
   */
  const resized = withDefaultSize(font);
  if (resized !== null && accepts(context, resized)) {
    verdicts?.set(font, resized);
    return resized;
  }

  context.font = fallback;
  verdicts?.set(font, null);
  return fallback;
}

/**
 * Does the canvas accept this font — asks without relying on a neighbor's
 * value.
 *
 * Sets a value known to be different (a sentinel) first, then plants it.
 * If the value moved away from the sentinel, it was accepted. There are
 * two sentinels because `font` itself could equal one of them — since the
 * two differ from each other, it can't equal both at once.
 */
const FONT_PROBES: readonly string[] = ["1px serif", "2px serif"];

function accepts(context: { font: string }, font: string): boolean {
  for (const probe of FONT_PROBES) {
    context.font = probe;
    // A surface where the sentinel itself gets rejected doesn't handle fonts at all — try the next one.
    if (context.font !== probe) continue;
    context.font = font;
    if (context.font !== probe) return true;
  }
  return false;
}

/**
 * Swaps just the size slot for the default size. `null` if there's no slot to swap.
 *
 * Size isn't the first token — in the CSS `font` shorthand, up to four of
 * style, variant, weight, and stretch can come before size. So this
 * searches right-to-left for the numeric token right before the family
 * (the `12` in `"600 12 Inter"`) — searching left-to-right would catch the
 * weight first.
 *
 * It doesn't climb the ladder if the input isn't a string — even an
 * `undefined` must demote without throwing (calling `font.trim()`
 * unconditionally would turn the most common missing-value case into a
 * crash). An uncaught exception punching through rAF leaves the canvas
 * stuck on a partial frame permanently.
 */
function withDefaultSize(font: unknown): string | null {
  if (typeof font !== "string") return null;
  const tokens = font.trim().split(/\s+/);
  // The last token is the family — swapping that slot leaves nothing to save.
  for (let i = tokens.length - 2; i >= 0; i--) {
    if (!SIZE_TOKEN.test(tokens[i])) continue;
    return [
      ...tokens.slice(0, i),
      FALLBACK_FONT_SIZE,
      ...tokens.slice(i + 1),
    ].join(" ");
  }
  return null;
}

/** A token that starts with a number — units and a `/line-height` still count as the size slot. */
const SIZE_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)[a-z%]*(\/\S+)?$/i;

/**
 * Turns a width the canvas ignores (0, negative, non-finite) into "don't draw."
 *
 * `ctx.lineWidth = -3` doesn't throw — it's ignored, so the previous
 * command's width stays. Zero doesn't mean "don't draw" per spec either,
 * it's ignored too, so trying to turn off the grid with
 * `--chart-grid-width: 0` draws it with the previous line's width instead.
 */
function usableWidth(width: number): number {
  /**
   * Coerced with `Number()`. `ctx.lineWidth`'s IDL type is `unrestricted
   * double`, so a string runs through `ToNumber` — `ctx.lineWidth = "3"`
   * draws a normal 3px line. `Number.isFinite("3")` is false, so using it
   * as-is would judge "3" as "don't draw."
   *
   * The docs themselves teach this input — the CSS-variable convention of
   * writing numbers as strings too makes a value like `"2"` common.
   * `DrawTarget` is a public door, so a call that skips the spec still
   * arrives here as-is.
   */
  const numeric = Number(width);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0.0001;
}

function parseDashArray(dashArray: string | undefined): number[] {
  /**
   * Not a string means no dashing.
   *
   * This used to be `if (!dashArray) return []` — it blocked `undefined`
   * and `""`, but an array or a number still went on to `.split`. An array
   * is the shape of the canvas API itself (`ctx.setLineDash([4,4])`), so
   * it's a value a consumer naturally tries. An uncaught `TypeError`
   * punching through rAF leaves the canvas stuck on a partial frame
   * permanently.
   */
  if (typeof dashArray !== "string" || dashArray.length === 0) return [];

  /**
   * Drops empty tokens. Something like `"4 4 "` that ends in a separator
   * makes `split` produce one more empty string, and `Number("")` is 0, so
   * it slips right past the filter — the result `[4,4,0]` has an odd
   * length, so the canvas doubles it up and the rhythm comes out different.
   */
  const segments = dashArray
    .split(/[\s,]+/)
    .filter((token) => token.length > 0)
    .map(Number);

  /**
   * Even one unusable segment means a solid line. `setLineDash` does
   * nothing at all if even one value is negative, leaving the previous
   * dash in place — so this has to filter first. Dropping only the bad
   * slots and setting the rest would create a rhythm the consumer never
   * asked for. Same rule as the other channels: a parse failure falls to
   * the default (solid).
   */
  return segments.every((n) => Number.isFinite(n) && n >= 0) ? segments : [];
}
