import type { CursorHost, DataProbe, FocusAreaHost, InputConsumer, InputEvent, InputHost, LineStyle, Observable, PaneDecoration, PaneDecorationHost, PlotArea, Plugin, PluginApi, Point, RenderRequester, StyleSpec, ValueCoordinates, XCoordinates } from "@finchart/core";
import { ContractError, emitter, pluginApi, resolveStyle, styleSpec } from "@finchart/core";
import type { Anchor, Drawing, DrawingInput, DrawingUpdate } from "./drawings";
import { DRAWING_KINDS, describeValue, drawingAnchors } from "./drawings";
import {
  assignOwned,
  isDrawing,
  mintDrawingId,
  ownWithId,
  parseDrawings,
  PATCHABLE_FIELDS,
  serializeDrawings,
  toOwnedDrawing,
} from "./drawings";
import { distanceToPoint } from "./geometry";
import type { DragState } from "./hit";
import { gripAt, gripOffsets, moveGrip, restoreDrawing } from "./hit";
import type { DrawingRenderContext } from "./render";
import { drawOne } from "./render";
import type { SnapAxes, SnapContext } from "./snap";
import { barSampleAt, snapDomainPos, snappedDomainAt } from "./snap";
import type { DrawingSpace } from "./space";
import { domainAt, toPixel } from "./space";

export type { DrawingSpace } from "./space";

/**
 * What the toolbox requires from the pane — it just needs to mount a
 * decoration, translate value coordinates, and answer what bar sits under
 * the cursor (`probe` — snapping's candidates).
 *
 * Doesn't take a `yScale`: taking `setDomain` would let the toolbox push the
 * value axis around.
 */
export type DrawingPane = PaneDecorationHost & ValueCoordinates & DataProbe;

/**
 * What the toolbox requires from **the chart** — the three things a pane
 * can't give it (input, re-render, x coordinates). The toolbox
 * installs onto a pane, but the pane doesn't know about these three, so
 * they arrive by wiring (the convention of injecting a collaborator from
 * outside, Principle 11).
 */
/**
 * The **runtime list** of methods `DrawingStage` requires. The type doesn't
 * exist at runtime, so this holds it separately — if the chart ever grows
 * one more door, this list would quietly fall short, and a non-TypeScript
 * consumer who passed a pane where plot belongs would sail through assembly
 * and hit a raw `TypeError` on the first `pointermove`.
 *
 * `Record<keyof DrawingStage, 0>` makes the type enforce the list — leaving
 * one out breaks the compile (a missing key), and so does a typo or a
 * rename (an extra key).
 */
const DRAWING_STAGE_MEMBERS = [
  "requestRender",
  "addInputConsumer",
  "claimCursor",
  "xAt",
  "pixelAtX",
  "claimFocusArea",
  "crosshair",
] as const satisfies readonly (keyof DrawingStage)[];

/**
 * A missing name breaks the compile here — if `Exclude` isn't `never`, the
 * constraint fails. It's a type alias, so it costs zero runtime bytes.
 *
 * Writing this with `Object.keys(...)` instead would be a module-top-level
 * call a bundler can't strip — even a consumer who never touches the
 * toolbox would end up shipping this name list.
 */
type AllStageMembersListed<T extends never> = T;
export type StageMembersAreComplete = AllStageMembersListed<
  Exclude<keyof DrawingStage, (typeof DRAWING_STAGE_MEMBERS)[number]>
>;

/**
 * The chart's crosshair door — "read the point under this position."
 * The toolbox consumes pointer moves while drawing or dragging, and a
 * consumed hover suppresses the wiring's own crosshair; without this
 * call the price under the hand would go dark for exactly the moves
 * where it matters most. `Plot.crosshair(position)` satisfies it.
 */
export interface CrosshairDriver {
  crosshair(position: Point): void;
}

export type DrawingStage = CrosshairDriver &
  RenderRequester &
  InputHost &
  XCoordinates &
  CursorHost &
  FocusAreaHost;

export interface DrawingToolsOptions {
  /** Input, coordinates, and render requests belong to the chart → `DrawingStage` */
  plot: DrawingStage;
  /** Stacking order. Omit for the decoration default (above the series). */
  zIndex?: number;
  /** Input priority. Higher claims first. Omit for 0. */
  priority?: number;
  /** Overrides the CSS variables and defaults. */
  style?: Partial<LineStyle>;
  /**
   * Snapping — drawing and anchor dragging stick to a bar's values (close,
   * low, high) and the bar's x. Off by default (TradingView convention).
   * Moving the whole drawing doesn't snap, to preserve its relative layout.
   * Toggle it at runtime with `api.setSnap`.
   */
  snap?: boolean;
  /** The snap radius (px). Default 8. Free-hand drawing when the candidate is outside it. A hit-test distance, so not a CSS variable. */
  snapRadius?: number;
}

/** One drawing's handle. `read` is a copy — the current value with any drag reflected. */
export interface DrawingHandle {
  read(): Drawing;
  /** Safe to call twice. */
  remove(): void;
  /**
   * Patches the drawing's own fields — geometry, `style`, `levels` —
   * through the same normalizer every door uses. **Identity is
   * preserved**: the object in the list is written in place, so every
   * handle, the selection, and a save recipe keep working.
   *
   * A key present with `undefined` means "back to the default" — the
   * documented way to return `style` to the theme. `type` and `id` can't
   * be patched. An unfit patch throws and leaves the drawing untouched.
   *
   * If the drawing is mid-drag when this arrives, the gesture is
   * **committed at its current position first**, then the patch applies —
   * the same rule as removing a mid-drag drawing (an outside change ends
   * the gesture; it never silently loses your edit to the next
   * pointermove or an Esc).
   */
  update(patch: DrawingUpdate): void;
}

/**
 * Why the list changed. A drag fires on every `pointermove` while moving,
 * so this is broken out separately so a listener can debounce just that.
 * `update` fires once per call — if you drive it from a high-frequency
 * input (a spinner, a slider), the debounce belongs on your side, the
 * same as `move`.
 */
export interface DrawingsChange {
  reason: "add" | "remove" | "move" | "update" | "clear" | "load";
  /** Whether this was a direct edit or a history replay. */
  via: "direct" | "undo" | "redo";
}

/** Undo/redo availability changed. A button can render directly from this value. */
export interface DrawingHistoryChange {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * The selection changed. Why this is separate from `changes` is
 * contractual — selection is session state, not part of the list, and it
 * isn't serialized. Piling it onto `DrawingsChange.reason` would make a
 * save recipe like `if (reason !== "move") saveDrawings()` save on every
 * selection click.
 */
export interface DrawingSelectionChange {
  /** A copy of what's currently selected. `null` if nothing is. */
  selection: Drawing | null;
  /**
   * That drawing's handle — use it as-is with `remove()` / `select()`.
   * `null` on deselection.
   *
   * `selection()` is a copy, so a handle can only be recovered by value —
   * and if two shapes share the same value, position-based hit-testing
   * (`gripAt`, the later one) and value comparison (the earlier one)
   * disagree, and a shape you never pointed at could get deleted. This
   * notification carries identity along to prevent that.
   */
  handle: DrawingHandle | null;
}

/** The selection policy for `add`. */
export interface AddDrawingOptions {
  /**
   * Selects it the moment it's mounted — ends up in the same state as
   * hand-drawing. Default false.
   *
   * Why the default is false: `add` fires even without any user intent (a
   * server push, a batch load on mount). Always selecting would steal a
   * selection the user was editing. Turn it on only where the user just
   * clicked — a side-panel button, say.
   */
  select?: boolean;
}

/** The drawing-armed state changed — begin, cancel, and completion (auto-release) all arrive here. */
export interface DrawingModeChange {
  mode: Drawing["type"] | null;
}

export interface DrawingToolsApi extends PluginApi {
  /**
   * Mounts it programmatically. Doesn't select by default — a deliberate
   * asymmetry with hand-drawing, which selects on completion
   * (`AddDrawingOptions.select`).
   */
  add(drawing: DrawingInput, options?: AddDrawingOptions): DrawingHandle;
  /**
   * The next input draws this kind. A horizontal line lands at the pressed
   * price; a trend line or Fibonacci works with either click-drag or
   * click-move-click — where you pressed is a, where you release or click
   * again is b. On completion it's selected and the armed state releases
   * itself.
   */
  begin(kind: Drawing["type"]): void;
  /**
   * Discards a draft, or restores an unreleased drag to where it was
   * grabbed, and releases the armed state too — what Esc does. Neither
   * leaves a history command (nothing was committed).
   */
  cancel(): void;
  /** The kind currently armed or being drawn. `null` if none. */
  mode(): Drawing["type"] | null;
  readonly modeChanges: Observable<DrawingModeChange>;
  /**
   * The currently selected drawing — a copy. `null` if none.
   *
   * A selection arises from a pointer hit, `select`, or keyboard cycling
   * (`]` / `[`); it's released by clicking empty space or Esc, and removed
   * by Delete/Backspace. It's session state, so it isn't serialized.
   */
  selection(): Drawing | null;
  /**
   * Sets the selection programmatically — you can drive it from the
   * keyboard or from the app (a list panel highlighting a chart entry)
   * without a pointer hit.
   *
   * Point at it with the handle `add` returned; `null` deselects. Throws
   * if the handle points at an already-removed drawing — succeeding
   * quietly there would be a failure that only looks like success.
   */
  select(handle: DrawingHandle | null): void;
  /** Copies — editing them outside doesn't tell the chart. To actually edit, use a handle or a drag. */
  list(): Drawing[];
  /**
   * Handles in the same order as `list()`.
   *
   * If only `add` issued handles, a drawing restored by `load` after a
   * page refresh couldn't be pointed at or removed individually — only
   * `clear()` would be left. So this issues handles for the whole list.
   * It's fine to hand out a fresh object every time: the contract is what
   * it points at, not its identity, so `select` / `remove` still work.
   */
  handles(): DrawingHandle[];
  /** Replaces the ledger with empty and clears undo/redo history. */
  clear(): void;
  /**
   * Reverts the latest committed edit. An unreleased drag is cancelled first;
   * a draft rewinds one confirmed anchor first (the anchors after it trail
   * the cursor again from the next pointer move — the rewind itself has no
   * cursor position). Returns whether it consumed anything, so a host that
   * chains `if (!tools.undo()) app.undo()` never double-undoes.
   */
  undo(): boolean;
  /** Reapplies the latest reverted edit. Declines while a draft or drag is in flight. */
  redo(): boolean;
  /** Whether `undo()` would consume a command, drag, or draft. This read remains available after disposal. */
  canUndo(): boolean;
  /** Whether `redo()` can replay now; false during a drag or draft. This read remains available after disposal. */
  canRedo(): boolean;
  /** Fires when command, boundary, or gesture state changes undo/redo availability. */
  readonly historyChanges: Observable<DrawingHistoryChange>;
  serialize(): string;
  /** Returns false and keeps the existing list/history if it can't be read; success clears history. */
  load(payload: string): boolean;
  /** The list changed. `via` distinguishes direct edits from undo/redo replay. */
  readonly changes: Observable<DrawingsChange>;
  /**
   * The selection changed — every path arrives here: pointer, double-click,
   * right-click, `]`, `[`, `select`, and deselection. This is what an
   * app's properties panel or trash button listens to.
   */
  readonly selectionChanges: Observable<DrawingSelectionChange>;
  /** Changes only the fields you give. Re-mounting instead would erase every line already drawn. */
  applyOptions(patch: Partial<DrawingToolsStyleOptions>): void;
  /**
   * Turns snapping on or off — drawing and anchor dragging stick to a
   * bar's values (close, low, high) and the bar's x. Applies to whatever's
   * mid-draw starting from the next pointer event.
   */
  setSnap(on: boolean): void;
  /** Whether snapping is on — what a toggle button's `aria-pressed` asks. */
  snapping(): boolean;
}

/** What can change without re-mounting — placement (pane, z, priority) is a property of registration. */
export type DrawingToolsStyleOptions = Pick<DrawingToolsOptions, "style">;

/**
 * The CSS variables a drawing owns. A public export — a consumer needs to
 * be able to read the defaults here, without opening the source (in line
 * with core's `DEFAULT_*_STYLE`). Keeps the angle brackets inside
 * backticks — outside them, the API-doc generator reads them as an HTML
 * tag and the build breaks.
 */
export const DRAWING_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  width: { css: "--chart-drawing-width", fallback: 1.5 },
  color: { css: "--chart-drawing", fallback: "#6366f1" },
  dashArray: { css: "--chart-drawing-dash", fallback: "" },
}) satisfies StyleSpec<LineStyle>;

/**
 * If a drawing's down and up are at least this far apart (px), it counts
 * as drawn by dragging — the release point becomes b and it's done. Inside
 * that, it's a click — b keeps following the cursor and the next click
 * finishes it. 5px matches pan's own "that counted as a drag" threshold.
 */
const PLACEMENT_DRAG_MIN = 5;

/** The snap marker's radius (px) — outside the handle so the two read as different things. */
const SNAP_RING_RADIUS = 7;
const SNAP_RING_SEGMENTS = 12;

/** A closed ring of points around `center` — the "it snapped" marker. */
function snapRing(center: Point): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= SNAP_RING_SEGMENTS; index++) {
    const angle = (index / SNAP_RING_SEGMENTS) * Math.PI * 2;
    points.push({
      x: center.x + SNAP_RING_RADIUS * Math.cos(angle),
      y: center.y + SNAP_RING_RADIUS * Math.sin(angle),
    });
  }
  return points;
}

/**
 * A fresh draft with every anchor at the first press — a complete
 * drawing from birth (the render loop draws it as-is), whose unconfirmed
 * anchors then trail the cursor. The draft carries an id from birth
 * too; the ledger id is still minted at `addOwned` on completion —
 * identity begins when a drawing enters the ledger, not while it's a
 * draft.
 */
function draftFor(kind: Drawing["type"], at: Anchor): Drawing {
  const id = mintDrawingId();
  const anchor = (from: Anchor): Anchor => ({ x: from.x, price: from.price });
  switch (kind) {
    case "horizontal":
      return { type: "horizontal", id, price: at.price };
    case "vertical":
      return { type: "vertical", id, x: at.x };
    case "trend":
    case "ray":
    case "extended":
    case "arrow":
    case "fib":
    case "rectangle":
    case "ellipse":
    case "priceMeasure":
    case "barMeasure":
      return { type: kind, id, a: anchor(at), b: anchor(at) };
    case "parallelChannel":
    case "pitchfork":
    case "fibExtension":
      return { type: kind, id, a: anchor(at), b: anchor(at), c: anchor(at) };
  }
  const unreachable: never = kind;
  throw new ContractError(`unknown drawing kind: ${String(unreachable)}`);
}

/**
 * Moves every anchor from `placed` onward to `at` — the unconfirmed
 * anchors trail the cursor together, so a three-anchor draft is always
 * a complete drawing. A one-coordinate kind has no anchors; its single
 * value follows instead.
 */
function followCursor(draft: Drawing, placed: number, at: Anchor): void {
  if (draft.type === "horizontal") {
    draft.price = at.price;
    return;
  }
  if (draft.type === "vertical") {
    draft.x = at.x;
    return;
  }
  const anchors = drawingAnchors(draft);
  for (let index = placed; index < anchors.length; index++) {
    anchors[index].x = at.x;
    anchors[index].price = at.price;
  }
}

/**
 * A drawing toolbox — one toolbox is one decoration. It doesn't make a
 * decoration per drawing: stacking order (z) and hit order are decided by
 * a single list, and install/teardown are tied to one plugin lifecycle.
 *
 * Installs onto a pane — because it has to live and die with that pane.
 *
 * ```ts
 * const tools = plot.mainPane.use(drawingTools({ plot }));
 * plot.removePane(rsi);   // the toolbox attached to it is cleaned up too
 * ```
 *
 * The three things that must come from the chart arrive by wiring → `DrawingStage`
 */
/**
 * Builds the owned copy, but translates into contract vocabulary even if a
 * consumer's getter throws — a computed getter backed by a store (MobX,
 * Vue) can throw while being read, and letting that bubble up unchanged
 * would show the consumer their own store's exception inside our stack.
 */
function safeOwned(drawing: unknown, id: string): unknown {
  if (typeof drawing !== "object" || drawing === null) return drawing;
  try {
    return ownWithId(drawing as never, id);
  } catch {
    return null;
  }
}

/** The **runtime** list of kinds. With only the type, `begin` would accept any value. */
export function drawingTools(
  options: DrawingToolsOptions,
): Plugin<DrawingPane, DrawingToolsApi> {
  // The assembly door is a door too — `drawingTools(null)` or
  // `{plot: undefined}` could blow up later as a raw `TypeError` naming
  // our internal names, so this stops it here.
  if (typeof options !== "object" || options === null) {
    throw new ContractError(
      `drawingTools(options) must be an object, got ${describeValue(options)}`,
    );
  }
  /**
   * Options are a door too. `snap: "no"` reads as truthy internally and
   * turns snapping on when you meant to turn it off, and `snapping()`
   * then exports a string, breaking `aria-pressed`. `snapRadius: NaN` is
   * the opposite lie — `snapping()` says true but nothing ever snaps —
   * coming from the same sources that always hand you a string or `NaN`,
   * like a settings panel's `<input type=number>`.
   *
   * `zIndex` and `priority` have the same problem from the same sources:
   * `zIndex: NaN` makes both sides of the z comparison false, so the line
   * hides beneath the series, and `priority: NaN` makes the router's
   * insertion loop false every time, so it unconditionally claims the
   * front.
   */
  for (const key of ["zIndex", "priority"] as const) {
    const value = options[key];
    if (value !== undefined && !Number.isFinite(value)) {
      throw new ContractError(
        `drawingTools({ ${key} }) must be a finite number, got ${describeValue(value)}`,
      );
    }
  }
  if (options.snap !== undefined && typeof options.snap !== "boolean") {
    throw new ContractError(
      `drawingTools({ snap }) must be a boolean, got ${describeValue(options.snap)}`,
    );
  }
  if (
    options.snapRadius !== undefined &&
    (typeof options.snapRadius !== "number" ||
      !Number.isFinite(options.snapRadius) ||
      options.snapRadius <= 0)
  ) {
    throw new ContractError(
      `drawingTools({ snapRadius }) must be a positive number, got ${describeValue(options.snapRadius)}`,
    );
  }
  if (
    options.style !== undefined &&
    (typeof options.style !== "object" || options.style === null)
  ) {
    throw new ContractError(
      `drawingTools({ style }) must be an object, got ${describeValue(options.style)}`,
    );
  }
  /**
   * Checks the collaborator's shape too — `typeof === "object"` alone
   * would let a non-chart object through assembly. A common mistake:
   * installing onto the chart instead of a pane, like
   * `plot.use(drawingTools({ plot }))` — `add()` then throws
   * `pane.pixelAtValue is not a function`, but the drawing has already
   * landed in the list, so it shows up in `serialize()` while never
   * actually being drawn. Swapping the `plot` / `pane` slots is another
   * common slip.
   *
   * The type already rules out both shapes, so this check exists for
   * consumers who aren't using TypeScript.
   */
  if (typeof options.plot === "object" && options.plot !== null) {
    // `Reflect.get` returns `unknown` — the idiom for reading an
    // unfamiliar shape without an assertion.
    const host = options.plot;
    const missing = DRAWING_STAGE_MEMBERS.filter(
      (name) => typeof Reflect.get(host, name) !== "function",
    );
    if (missing.length > 0) {
      throw new ContractError(
        `drawingTools({ plot }) is not a chart — missing ${missing.join("·")}. ` +
          `Give it the plot, not the pane (the install goes on the pane, but the argument is the chart)`,
      );
    }
  }
  if (typeof options.plot !== "object" || options.plot === null) {
    throw new ContractError(
      `drawingTools({ plot }) has no plot — call this after mounting the chart, got ${describeValue(options.plot)}`,
    );
  }
  const plot = options.plot;

  return (pane) => {

    /** Internal state — a drag mutates these objects directly. */
    const drawings: Drawing[] = [];
    const changes = emitter<DrawingsChange>();
    const historyEmitter = emitter<DrawingHistoryChange>();

    /**
     * Notifications are queued and delivered after the outermost door
     * returns, in the order the state changed. A subscriber that calls
     * back in (`clear()` from a selection listener, `undo()` from a change
     * listener) therefore never runs while a door is half-done: its call
     * applies at once, and its own notifications line up behind the ones
     * already queued. Without this, every door needed its own "did a
     * subscriber pull the rug" check, and a mirror could see a `remove`
     * for a drawing that had already been put back.
     *
     * A notification that throws leaves the rest queued for the next
     * door — a listener's bug doesn't take the toolbox down with it.
     */
    const pending: (() => void)[] = [];
    let doorDepth = 0;
    let flushing = false;
    const notify = (deliver: () => void): void => {
      pending.push(deliver);
    };
    const flush = (): void => {
      if (flushing) return;
      flushing = true;
      try {
        for (let next = pending.shift(); next; next = pending.shift()) next();
      } finally {
        flushing = false;
      }
    };
    /** Every public entry that can change state runs inside one of these. */
    const door = <T,>(run: () => T): T => {
      doorDepth += 1;
      try {
        return run();
      } finally {
        doorDepth -= 1;
        if (doorDepth === 0) flush();
      }
    };
    type HistoryCommand =
      | {
          kind: "add";
          drawing: Drawing;
          index: number;
          selectionBefore: Drawing | null;
          selectedOnAdd: boolean;
        }
      | {
          kind: "remove";
          drawing: Drawing;
          index: number;
          wasSelected: boolean;
        }
      | {
          kind: "update";
          drawing: Drawing;
          before: Drawing;
          after: Drawing;
          reason: "move" | "update";
        };
    const undoStack: HistoryCommand[] = [];
    const redoStack: HistoryCommand[] = [];
    const recordCommand = (command: HistoryCommand): void => {
      undoStack.push(command);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
    };
    const resetHistory = (): void => {
      undoStack.length = 0;
      redoStack.length = 0;
    };
    let styleOverride = options.style;

    /**
     * Snapping — the state machine doesn't know about it. Only the seams
     * where a pointer becomes a domain position (`snappedAt`, and a
     * drag's anchor position) are decorated. Hit-testing stays on free
     * coordinates — the shape under the cursor has to actually be under
     * the cursor.
     */
    let snapping = options.snap ?? false;
    const snap: SnapContext = {
      enabled: () => snapping,
      radius: options.snapRadius ?? 8,
      probe: (x) => pane.probe(x),
    };

    /** Per-tool axis policy — a horizontal line snaps only y (no x), a vertical only x (no price), everything else point-wise. */
    const axesFor = (tool: Drawing["type"]): SnapAxes =>
      tool === "horizontal" ? "y" : tool === "vertical" ? "x" : "xy";

    /**
     * Where the last snap stuck, in domain coordinates — drawn as a ring
     * so the hand knows it snapped. Null when the last position was
     * free, and cleared when the gesture ends.
     */
    let snapMark: Anchor | null = null;

    const snappedAt = (point: Point, tool: Drawing["type"]): Anchor => {
      const hit = snappedDomainAt(snap, space, point, axesFor(tool));
      snapMark = hit.snapped ? { x: hit.x, price: hit.price } : null;
      return { x: hit.x, price: hit.price };
    };

    /**
     * A drag's cursor — only an endpoint (and a horizontal line's handle)
     * is on the snap path. Snaps "where the anchor would land" (the
     * offset added in) and converts it back to a cursor: it's the anchor,
     * not the fingertip, that sticks to the value. Moving the whole thing
     * uses the raw value — a move is expected to preserve relative
     * layout.
     */
    const dragCursor = (
      drag: DragState,
      point: Point,
    ): { x: number; price: number } => {
      const free = domainAt(space, point);
      const axes: SnapAxes | null =
        drag.grip.part !== "whole"
          ? "xy"
          : drag.grip.drawing.type === "horizontal"
            ? "y"
            : null;
      if (!axes) return free;

      const offset = drag.offsets[0];
      const anchorFree = {
        x: free.x + offset.x,
        price: free.price + offset.price,
      };
      const snapped = snapDomainPos(snap, space, anchorFree, axes);
      snapMark = snapped.snapped ? { x: snapped.x, price: snapped.price } : null;
      return { x: snapped.x - offset.x, price: snapped.price - offset.price };
    };
    /**
     * The selected drawing — session state, not part of the list. It
     * isn't serialized, and whatever replaces the whole list (`clear`,
     * `load`) clears it too.
     */
    let selected: Drawing | null = null;
    const selectionEmitter = emitter<DrawingSelectionChange>();

    /**
     * The one place the selection changes — scattering assignments across
     * many spots would mean repeating the notification logic every time,
     * and missing even one would leave an app's panel silently stale.
     *
     * The identity check on the first line does two jobs: picking the
     * same thing again stays quiet, and it stops the loop after one turn
     * even if a subscriber calls `select()` back (re-entrant is fine — an
     * Esc handler's whole job is changing state).
     */
    const setSelected = (next: Drawing | null): void => {
      if (selected === next) return;
      selected = next;
      plot.requestRender();
      const payload: DrawingSelectionChange = {
        selection: next ? structuredClone(next) : null,
        handle: next ? makeHandle(next) : null,
      };
      notify(() => selectionEmitter.emit(payload));
    };

    const deselect = (): void => {
      setSelected(null);
    };

    /**
     * The tool's input state machine — the union guarantees the
     * armed / drafting / dragging exclusion at the type level.
     *
     * Pointer ownership: the router's capture is per-pointer (a pinch
     * tracks two). An in-flight gesture belongs to the pointerId that
     * started it, and input from any other pointer is consumed but
     * ignored — letting it leak into pan would make a drag and a pinch
     * fight each other.
     *
     * The span where `drafting.pointerId` is `null` is the "move" of
     * click-move-click — the next `down`, from whoever, is the second
     * click.
     *
     * `draft` sits outside the list — invisible to `list` / `serialize`,
     * and it only enters the list the moment it completes, announcing
     * "add".
     */
    type ToolState =
      | { kind: "idle" }
      | { kind: "armed"; tool: Drawing["type"] }
      | {
          kind: "drafting";
          tool: Drawing["type"];
          draft: Drawing;
          pointerId: number | null;
          /** How many anchors are confirmed; the rest trail the cursor. */
          placed: number;
        }
      | { kind: "dragging"; drag: DragState; pointerId: number };

    let state: ToolState = { kind: "idle" };
    const modeEmitter = emitter<DrawingModeChange>();
    const historyState = (): DrawingHistoryChange => ({
      canUndo:
        state.kind === "dragging" ||
        state.kind === "drafting" ||
        undoStack.length > 0,
      canRedo:
        state.kind !== "dragging" &&
        state.kind !== "drafting" &&
        redoStack.length > 0,
    });
    const emitHistoryChange = (): void => {
      const snapshot = historyState();
      notify(() => historyEmitter.emit(snapshot));
    };
    const emitHistoryChangeIfChanged = (before: DrawingHistoryChange): void => {
      const after = historyState();
      if (before.canUndo !== after.canUndo || before.canRedo !== after.canRedo) {
        notify(() => historyEmitter.emit(after));
      }
    };

    const modeOf = (s: ToolState): Drawing["type"] | null =>
      s.kind === "armed" || s.kind === "drafting" ? s.tool : null;

    /** The cursor a state demands of the hand — drawing aims, dragging grabs. */
    const cursorOf = (s: ToolState): string | null => {
      if (s.kind === "dragging") return "grabbing";
      if (s.kind === "armed" || s.kind === "drafting") return "crosshair";
      return null;
    };

    let releaseCursor: (() => void) | null = null;

    /**
     * The signal that something's grabbable — hovering over a line shows
     * `grab`. State cursors alone (drawing's `crosshair`, dragging's
     * `grabbing`) gave no way to discover a shape before selecting it — a
     * user would've had to press down just to find out one was there.
     *
     * Managed separately from state cursors: hover is a function of
     * pointer position, not a state transition, so folding it into
     * `transition` would mean fabricating a state every frame.
     */
    let releaseHover: (() => void) | null = null;
    const hoverCursor = (on: boolean): void => {
      if (on === (releaseHover !== null)) return;
      if (on) {
        releaseHover = plot.claimCursor("grab");
      } else {
        releaseHover?.();
        releaseHover = null;
      }
    };

    /** State transition — announces it when the visible mode changes, and the cursor follows state too. */
    const transition = (next: ToolState, notifyHistory = true): void => {
      const historyBefore = notifyHistory ? historyState() : null;
      const before = modeOf(state);
      const cursorBefore = cursorOf(state);
      state = next;
      if (next.kind === "idle") snapMark = null;

      const cursorAfter = cursorOf(state);
      // Hover backs off when drawing or dragging claims the cursor — if
      // the two overlap, the top would flicker every frame.
      if (cursorAfter !== null) hoverCursor(false);
      if (cursorAfter !== cursorBefore) {
        // Claims the new one before releasing the old — the top doesn't
        // flicker in between (claimCursor's convention).
        const stale = releaseCursor;
        releaseCursor =
          cursorAfter === null ? null : plot.claimCursor(cursorAfter);
        stale?.();
      }

      const after = modeOf(state);
      if (before !== after) notify(() => modeEmitter.emit({ mode: after }));
      if (historyBefore) emitHistoryChangeIfChanged(historyBefore);
    };

    /** A canonical owned drawing has stable field order, so this compares exact persisted geometry and style. */
    const sameDrawing = (left: Drawing, right: Drawing): boolean =>
      JSON.stringify(toOwnedDrawing(left)) === JSON.stringify(toOwnedDrawing(right));

    /** Finishes a drag and records its final geometry as one command. */
    const commitDrag = (drag: DragState, notify = true): boolean => {
      const historyBefore = historyState();
      transition({ kind: "idle" }, false);
      const after = toOwnedDrawing(drag.grip.drawing);
      if (sameDrawing(drag.original, after)) {
        if (notify) emitHistoryChangeIfChanged(historyBefore);
        return false;
      }
      recordCommand({
        kind: "update",
        drawing: drag.grip.drawing,
        before: drag.original,
        after,
        reason: "move",
      });
      if (notify) emitHistoryChange();
      return true;
    };

    /** Restores a drag that was never released. Replacement/disposal can keep the intermediate restore quiet. */
    const cancelDrag = (drag: DragState, notify = true): boolean => {
      const historyBefore = historyState();
      transition({ kind: "idle" }, false);
      if (sameDrawing(drag.original, drag.grip.drawing)) {
        if (notify) emitHistoryChangeIfChanged(historyBefore);
        return false;
      }
      restoreDrawing(drag.grip.drawing, drag.original);
      plot.requestRender();
      if (notify) changed("move");
      if (notify) emitHistoryChangeIfChanged(historyBefore);
      return true;
    };

    const cancelPlacement = (notifyHistory = true): void => {
      const historyBefore = historyState();
      transition({ kind: "idle" }, false);
      plot.requestRender();
      if (notifyHistory) emitHistoryChangeIfChanged(historyBefore);
    };

    /**
     * Confirms the next anchor at `at` — finishing the draft when it was
     * the last one, otherwise handing the pointer (or the free "move"
     * span, when `pointerId` is null) to the anchor after it.
     */
    const confirmAnchor = (
      drafting: Extract<ToolState, { kind: "drafting" }>,
      at: Anchor,
      pointerId: number | null,
    ): void => {
      followCursor(drafting.draft, drafting.placed, at);
      const placed = drafting.placed + 1;
      if (placed >= drawingAnchors(drafting.draft).length) {
        finishPlacement(drafting.draft);
        return;
      }
      transition({ ...drafting, placed, pointerId });
      plot.requestRender();
    };

    /**
     * Whether the cursor is inside my pane — the value that decides who
     * owns the keyboard.
     *
     * When two toolboxes sit on different panes, selection is per-toolbox
     * state, but `]`, `[`, and Delete pass through the whole chart — so
     * "whoever registered last," not "whoever the user just touched,"
     * could hijack the keys. The pointer path is already mutually
     * exclusive via `ownsPoint`, so this uses where the cursor was last
     * seen as the keyboard-ownership gate.
     *
     * What's left over is input with no hover (touch) and a `pointerdown`
     * someone else consumed — that's territory that needs core's focus
     * concept.
     */
    let cursorInside: boolean | null = null;

    /**
     * This is three-valued. `null` means "the cursor's location isn't
     * known yet," and counts as mine — because on a chart with a single
     * toolbox, the keyboard-only path (Tab → `]`) is a legitimate way to
     * arrive.
     *
     * Over the price axis, time axis, or margins, you're on no pane at
     * all — if that state counted as "nobody's" (`false`), then even in
     * the default wiring with a single toolbox, brushing the axis once
     * would silently kill Delete, `]`, and `[`. So this only lets go when
     * ownership actually passed to someone else — a call the chart's
     * `claimFocusArea` answers.
     */
    const ownsKeyboard = (): boolean => cursorInside !== false;

    /**
     * Updates who owns the cursor — inside mine, it's mine; inside
     * someone else's pane, it's theirs; over an axis or margin, it's
     * nobody's, so the last owner stands. Reading a value off an axis and
     * then pressing Delete is a normal path, not a transfer of ownership.
     */
    const usableArea = (area: PlotArea): boolean =>
      area.right > area.left && area.bottom > area.top;

    /**
     * Two predicates, with different boundary handling:
     *
     * - `ownsPoint` — ownership (half-open). Panes butt up against each
     *   other vertically, so including both ends would make two panes
     *   both believe the boundary y is inside them. The bottom edge
     *   belongs to the neighbor below (the same rule as core's
     *   `containsFocus`).
     * - `insidePlot` — inside the plot (closed). This is the "inside the
     *   on-screen plot" that drawing and hit-testing look at, so the edge
     *   counts as inside too (the same rule as `hit.ts` / `geometry.ts`).
     */
    const ownsPoint = (point: Point): boolean => {
      const { area } = space;
      if (!usableArea(area)) return false;
      return (
        point.x >= area.left &&
        point.x <= area.right &&
        point.y >= area.top &&
        point.y < area.bottom
      );
    };

    const insidePlot = (point: Point): boolean => {
      const { area } = space;
      if (!usableArea(area)) return false;
      return (
        point.x >= area.left &&
        point.x <= area.right &&
        point.y >= area.top &&
        point.y <= area.bottom
      );
    };

    /**
     * Registers to contend for the keyboard. Simply asking "does someone
     * else have this area" would let a claimant with no interest in the
     * keyboard — a legend, a watermark — kill the toolbox's Delete, so
     * this contends with a dedicated claim instead.
     *
     * Before the first render, the pane may not have an area yet — in
     * that case, `null` (don't contend).
     */
    const focusClaim = plot.claimFocusArea(() =>
      usableArea(space.area) ? space.area : null,
    );

    const trackCursor = (point: Point): void => {
      if (ownsPoint(point)) cursorInside = true;
      else if (focusClaim.contestedAt(point)) cursorInside = false;
    };

    /** Completion — enters the list, gets selected, and the armed state releases. */
    const finishPlacement = (draft: Drawing): void => {
      const selectionBefore = selected;
      const owned = addOwned(draft);
      recordCommand({
        kind: "add",
        drawing: owned,
        index: drawings.length - 1,
        selectionBefore,
        selectedOnAdd: true,
      });
      transition({ kind: "idle" });
      setSelected(owned);
      changed("add");
      emitHistoryChange();
    };

    /** The list changed — redraw, and notify listeners. Always a pair. */
    const changed = (
      reason: DrawingsChange["reason"],
      via: DrawingsChange["via"] = "direct",
    ): void => {
      plot.requestRender();
      notify(() => changes.emit({ reason, via }));
    };

    /**
     * The coordinate system hit-testing and dragging see. Asks the chart
     * and pane fresh each time — caching the values would mean no
     * hit-testing is possible before the first render, and stale values
     * on the next frame. Before render, the pane's area is empty, so
     * hit-testing is naturally "outside."
     */
    const space: DrawingSpace = {
      get area() {
        return pane.area;
      },
      xAt: (pixel) => plot.xAt(pixel),
      pixelAtX: (x) => plot.pixelAtX(x),
      valueAt: (pixel) => pane.valueAt(pixel),
      pixelAtValue: (value) => pane.pixelAtValue(value),
    };

    const decoration: PaneDecoration = {
      draw(target, context) {
        const style = resolveStyle(
          DRAWING_STYLE_SPEC,
          context.readStyle,
          styleOverride,
        );

        // What the renderer needs beyond the space — built per frame,
        // since the formatter and the mapping are the frame's.
        const renderContext: DrawingRenderContext = {
          readStyle: context.readStyle,
          formatValue: context.formatY,
          barIndexAt: (x) => barSampleAt(pane.probe(x))?.index ?? null,
        };

        for (const drawing of drawings) {
          // The third resolution layer — a drawing's own override on top
          // of the toolbox's resolved style. Owned styles carry no
          // undefined leaves (the normalizer strips them), so a plain
          // spread can't erase a toolbox value.
          const effective = drawing.style
            ? { ...style, ...drawing.style }
            : style;
          const isSelected = drawing === selected;
          drawOne(
            target,
            space,
            renderContext,
            drawing,
            // The selected drawing is drawn one pixel heavier — handles
            // alone vanish in a crowd of thirteen kinds. Its own color
            // and dash are kept, so the vocabulary is "the same line,
            // bolder," not a new one.
            isSelected ? { ...effective, width: effective.width + 1 } : effective,
            isSelected,
          );
        }

        // The one being drawn right now — outside the list, but it has
        // to be visible to draw.
        if (state.kind === "drafting") {
          drawOne(target, space, renderContext, state.draft, style, false);
        }

        // The snap ring — where the anchor under the hand stuck. Only
        // while a gesture is in flight (the mark clears on idle).
        if (snapMark && state.kind !== "idle") {
          target.drawLine(snapRing(toPixel(space, snapMark)), {
            ...style,
            width: 1,
            dashArray: "",
          });
        }
      },
    };

    const removeDecoration = pane.addDecoration(decoration, {
      zIndex: options.zIndex,
    });

    type PointerInput = Extract<InputEvent, { pointerId: number }>;

    const onPointerDown = (event: PointerInput): boolean => {
      // For input with no hover (touch), this is the only ownership
      // signal there is. An in-flight gesture is the strongest ownership
      // signal, so it's frozen — otherwise a second finger touching
      // someone else's pane mid-drag would hand ownership away, and
      // Delete right after the drag would die.
      if (
        !(
          state.kind === "dragging" ||
          (state.kind === "drafting" && state.pointerId !== null)
        )
      ) {
        trackCursor(event.point);
      }

      /**
       * Doesn't claim a non-primary button — right-clicking a line is a
       * habit for opening a properties/delete menu, and any hand-tremor
       * while the button's held down would become a drag, pushing the
       * price line and possibly saving it.
       *
       * Lets it through (`false`) — a right-click comes back as
       * `contextmenu`, where `onContextMenu` hit-tests and claims it if
       * it's its own. Doesn't touch the drawing state either: a
       * right-click is a no-op, not a cancel (Esc is the cancel).
       */

      if (event.type === "pointerdown" && event.button !== undefined && event.button !== 0) {
        return false;
      }

      switch (state.kind) {
        case "armed": {
          if (!insidePlot(event.point)) return false;
          const at = snappedAt(event.point, state.tool);
          transition({
            kind: "drafting",
            tool: state.tool,
            draft: draftFor(state.tool, at),
            pointerId: event.pointerId,
            placed: 1,
          });
          plot.requestRender();
          return true;
        }

        case "drafting": {
          if (state.pointerId !== null) {
            // Another pointer while drawing — consumed but ignored.
            // Reacting to it would freeze the line where a pinch was
            // attempting to happen; letting it through would make pan
            // fight the gesture.
            return true;
          }
          if (!insidePlot(event.point)) return false;
          // The next click of click-move-click — where it's pressed
          // confirms the next anchor (and the ones after it keep
          // trailing until their own click).
          confirmAnchor(state, snappedAt(event.point, state.draft.type), event.pointerId);
          return true;
        }

        case "dragging":
          // Another pointer while dragging — consumed but ignored. This
          // used to let `drag` get overwritten here, so finger A's move
          // would end up moving finger B's drawing.
          return true;

        case "idle": {
          const grip = gripAt(drawings, space, event.point);
          if (!grip) {
            // Pressing empty space deselects — the input isn't consumed
            // (pan stays pan's own business). But someone else's
            // contended area is someone else's business: if pressing
            // another toolbox's pane deselected mine, `selection()`
            // would end up depending on registration order.
            if (!focusClaim.contestedAt(event.point)) deselect();
            return false;
          }

          setSelected(grip.drawing);
          transition({
            kind: "dragging",
            drag: {
              grip,
              offsets: gripOffsets(grip, space, event.point),
              // The material a cancel restores — `moveGrip` mutates the
              // original in place.
              original: toOwnedDrawing(grip.drawing),
              moved: false,
            },
            pointerId: event.pointerId,
          });
          return true;
        }
      }
    };

    const onPointerMove = (event: PointerInput): boolean => {
      /**
       * Counts before branching — drawing and dragging both return early
       * below, so skipping this count would mean even a line drawn right
       * after brushing the axis wouldn't respond to Delete.
       *
       * But it doesn't count while a gesture is in flight. While this
       * toolbox holds the router's capture, every move arrives only here,
       * and a sibling toolbox never sees it — if this handed ownership
       * away just because the cursor crossed into someone else's pane,
       * the sibling wouldn't pick it up either, and nobody would get
       * Delete. An in-flight gesture is the strongest ownership signal,
       * so the check stays frozen for its duration.
       */
      const gestureInFlight =
        state.kind === "dragging" ||
        (state.kind === "drafting" && state.pointerId !== null);
      if (!gestureInFlight) trackCursor(event.point);

      if (state.kind === "drafting") {
        if (state.pointerId !== null && event.pointerId !== state.pointerId) {
          return true; // Someone else's pointer, already consumed — capture routes it here.
        }
        followCursor(state.draft, state.placed, snappedAt(event.point, state.draft.type));
        // A consumed move would otherwise switch the crosshair off —
        // and drawing is exactly when you're reading prices.
        plot.crosshair(event.point);
        plot.requestRender();
        return true;
      }

      if (state.kind === "dragging") {
        if (event.pointerId !== state.pointerId) return true;
        moveGrip(state.drag, dragCursor(state.drag, event.point));
        state.drag.moved = true;
        plot.crosshair(event.point);
        changed("move");
        return true;
      }

      /**
       * Doesn't consume it (`false`) — returning `true` would kill the
       * crosshair. Claims only the cursor and lets the event through.
       *
       * Hover backs off when the state already holds the cursor.
       * `transition` only enforces this rule on a state change, so the
       * same check has to run here too, on plain pointer movement, to
       * stop `grab` from wrongly landing on top of `crosshair` when the
       * tool is armed and the cursor moves over a shape. Asks the same
       * predicate as `transition` (`cursorOf`) so the two spots never
       * drift apart.
       */
      if (cursorOf(state) === null) {
        hoverCursor(gripAt(drawings, space, event.point) !== null);
      }
      return false;
    };

    /**
     * A cancel is not a release — this is where palm rejection, an OS
     * gesture, or a scroll takeover reclaims the pointer. Folding it into
     * `pointerup` would commit a half-dragged shape even though the user
     * never pressed a key. Restores it with `DragState.original`.
     *
     * If it's mid-draw, discards the draft — it isn't in the list yet, so
     * just rewinding the state is enough.
     */
    const onPointerCancel = (event: PointerInput): boolean => {
      if (state.kind === "drafting" && state.pointerId !== null) {
        if (event.pointerId !== state.pointerId) return true;
        transition({ kind: "armed", tool: state.tool });
        plot.requestRender();
        return true;
      }

      if (state.kind === "dragging") {
        if (event.pointerId !== state.pointerId) return true;
        const { drag } = state;
        cancelDrag(drag);
        return true;
      }

      return false;
    };

    const onPointerUp = (event: PointerInput): boolean => {
      if (state.kind === "drafting" && state.pointerId !== null) {
        if (event.pointerId !== state.pointerId) return true;

        const anchors = drawingAnchors(state.draft);
        if (anchors.length === 0) {
          // One coordinate, so it's done the moment it's released.
          finishPlacement(state.draft);
          return true;
        }

        // "Was that a drag" is measured from the anchor this press
        // confirmed — the last one placed, not `a`. Measuring from `a`
        // would read a click on b as a drag and stamp c on top of it.
        const reference = toPixel(space, anchors[state.placed - 1]);
        const moved = distanceToPoint(event.point, reference) >= PLACEMENT_DRAG_MIN;
        if (moved) {
          // Drawn by dragging — the release point confirms the next
          // anchor (which finishes a two-anchor kind).
          confirmAnchor(state, snappedAt(event.point, state.draft.type), null);
        } else {
          // It was a click — releases the pointer and the next anchor
          // keeps following the cursor.
          transition({ ...state, pointerId: null });
        }
        return true;
      }

      if (state.kind === "dragging") {
        if (event.pointerId !== state.pointerId) return true;
        commitDrag(state.drag);
        return true;
      }

      return false;
    };

    const onKeyDown = (event: Extract<InputEvent, { key: string }>): boolean => {
      /**
       * Only Esc skips the ownership check — deliberately. The other
       * three (Delete, `]`, `[`) go through `ownsKeyboard()`. Esc is an
       * escape key, so "whatever's happening ends no matter where you
       * press it" is correct — gating it on ownership would mean you
       * couldn't discard a drawing in progress while the cursor sat over
       * someone else's pane.
       */
      if (event.key === "Escape") {
        // Drawing comes first — discards what's being drawn and releases
        // the armed state.
        if (state.kind === "armed" || state.kind === "drafting") {
          cancelPlacement();
          return true;
        }
        /**
         * If it's mid-drag, restores it — this is a cancel, not a
         * finish. The documented contract is "drag cancel"; recording an
         * unreleased position would turn cancellation into a committed edit.
         *
         * Reuses the existing "move" reason for the notification — a new
         * reason would break a consumer's exhaustive `switch`, and
         * either way a consumer has to re-read `list()` to know what
         * changed, so reusing it is enough.
         */
        if (state.kind === "dragging") {
          const { drag } = state;
          cancelDrag(drag);
          return true;
        }
        if (!selected) return false;
        /**
         * Only deselection goes through the cursor-ownership rule. The
         * reason the three branches above (drawing, drafting, dragging)
         * skip `ownsKeyboard()` is "whatever's happening ends no matter
         * where you press it" — but deselection isn't "whatever's
         * happening." Since the router stops at whichever consumer
         * returns `true` first, one toolbox's plain deselect could
         * swallow another toolbox's in-progress draw cancel.
         *
         * Delete, `]`, and `[` — actions in the same scope — already go
         * through `ownsKeyboard()`, so carving out an exception for
         * deselection alone would actually be the inconsistent choice.
         */
        if (!ownsKeyboard()) return false;
        deselect();
        return true;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selected) return false;
        // Even with mine selected, if the cursor's in someone else's
        // pane, the key isn't mine.
        if (!ownsKeyboard()) return false;
        removeOne(selected);
        return true;
      }

      // Cycling the selection — the path to reaching Delete/Esc without
      // a pointer. Doesn't steal Tab: focus movement belongs to the
      // browser.
      if (event.key === "]" || event.key === "[") {
        if (drawings.length === 0) return false;
        if (!ownsKeyboard()) return false;
        const step = event.key === "]" ? 1 : -1;
        const index = selected ? drawings.indexOf(selected) : -1;
        const next =
          index === -1
            ? step === 1
              ? 0
              : drawings.length - 1
            : (index + step + drawings.length) % drawings.length;
        setSelected(drawings[next]);
        return true;
      }

      return false;
    };

    /**
     * A double-click on a shape doesn't reset the viewport — without this
     * guard, the shell's `doubleClickReset` (on by default) would call
     * `fitDomains()`, and double-clicking a trend line you just drew
     * (genre convention: "open properties") would erase the zoomed range
     * you set up.
     *
     * All this does is point at it — the editing UI belongs to the app,
     * and the app listens for this selection through `selectionChanges`.
     */
    const onDoubleClick = (point: Point): boolean => {
      const grip = gripAt(drawings, space, point);
      // Same rule as right-click and idle-down — pressing empty space
      // deselects, but someone else's contended area is someone else's
      // business (doesn't quietly deselect another pane's selection).
      if (!grip) {
        if (!focusClaim.contestedAt(point)) deselect();
        return false;
      }

      setSelected(grip.drawing);
      return true;
    };

    /**
     * Right-click — selects but doesn't consume. Right-clicking a line
     * selects it, so an app can just read `tools.selection()` inside
     * `plot.on("contextmenu")`.
     *
     * Returning `false` is the whole point — consuming it would stop
     * `plot.contextMenu(point)` from firing, and the app couldn't open
     * its own menu. Also updates cursor ownership here: a right-click is
     * a path that arrives with no hover.
     */
    const onContextMenu = (point: Point): boolean => {
      trackCursor(point);
      const grip = gripAt(drawings, space, point);
      if (!grip) {
        /**
         * Pressing empty space deselects — the same rule as the left
         * button. If it only selected on a hit and left the selection
         * alone on a miss, right-clicking far away in empty space would
         * leave an app's delete menu pointing at a line drawn earlier (a
         * drawing nowhere near the cursor) — a destructive action landing
         * on something the user never picked, which this blocks with the
         * same rule as `onPointerDown`'s idle branch.
         *
         * This gate was once dropped to protect a handle from a
         * right-click over the axis, but that invariant never existed in
         * the first place, since axis dragging sees input before the
         * toolbox does — a recoverable error (deselection, just click
         * again) is the safer default over deleting a drawing you never
         * pointed at and then asking history to repair the wrong action.
         */
        if (!focusClaim.contestedAt(point)) deselect();
        return false;
      }
      setSelected(grip.drawing);
      return false;
    };

    const consumer: InputConsumer = {
      handle: (event: InputEvent): boolean => door(() => {
        switch (event.type) {
          case "pointerdown":
            return onPointerDown(event);
          case "pointermove":
            return onPointerMove(event);
          case "pointerup":
            return onPointerUp(event);
          case "pointercancel":
            return onPointerCancel(event);
          case "keydown":
            return onKeyDown(event);
          case "dblclick":
            return onDoubleClick(event.point);
          case "contextmenu":
            return onContextMenu(event.point);
          default:
            return false;
        }
      }),
    };

    const removeConsumer = plot.addInputConsumer(consumer, {
      priority: options.priority,
    });

    const removeOne = (drawing: Drawing): void => {
      const index = drawings.indexOf(drawing);
      if (index === -1) return;
      const wasSelected = selected === drawing;
      /**
       * Removal cuts off an in-flight gesture too — the same rule as
       * `clear` / `load`. Without this, a drag would keep pushing an
       * object that's fallen out of the list, and a removed shape's
       * `changes: "move"` would fire every frame.
       *
       * Only this shape's drag gets cut — cutting the draft too, the way
       * `clear` does, would let a side panel's delete button also erase
       * the line the user is mid-drawing.
       */
      if (state.kind === "dragging" && state.drag.grip.drawing === drawing) {
        commitDrag(state.drag, false);
      }
      drawings.splice(index, 1);
      const command: HistoryCommand = { kind: "remove", drawing, index, wasSelected };
      recordCommand(command);
      if (wasSelected) setSelected(null);
      changed("remove");
      emitHistoryChange();
    };

    const updateOne = (target: Drawing, patch: DrawingUpdate): void => {
      if (typeof patch !== "object" || patch === null) {
        throw new ContractError(
          `update(patch) must be an object, got ${describeValue(patch)}`,
        );
      }
      if (!drawings.includes(target)) {
        throw new ContractError(
          "Can't update a removed drawing — the handle no longer points at anything",
        );
      }
      const keys = Object.keys(patch);
      const allowed = PATCHABLE_FIELDS[target.type];
      for (const key of keys) {
        if (!allowed.includes(key)) {
          throw new ContractError(
            `update(patch) can't patch "${key}" on a ${target.type} — patchable fields are ${allowed.join("·")}`,
          );
        }
      }
      if (keys.length === 0) return;

      /**
       * Build first, assign after — the candidate goes through the same
       * normalizer as every door, and an unfit patch throws **before**
       * the target is touched. A key present with `undefined` survives
       * the spread deliberately: that's the documented way back to the
       * default (`style: undefined` → the theme's).
       */
      const before = toOwnedDrawing(target);
      const { id, ...shape } = target;
      const candidate = safeOwned({ ...shape, ...patch }, id);
      if (!isDrawing(candidate)) {
        throw new ContractError(
          `update(patch) would make the drawing unfit — got ${describeValue(patch)}`,
        );
      }

      /**
       * An outside change ends an in-flight gesture — the same rule as
       * `removeOne`. Committed at the current position, not restored:
       * restoring would snap the shape back on screen, and the next
       * pointermove or Esc would otherwise erase this very patch.
       */
      if (state.kind === "dragging" && state.drag.grip.drawing === target) {
        commitDrag(state.drag, false);
      }

      assignOwned(target, candidate);
      recordCommand({
        kind: "update",
        drawing: target,
        before,
        after: toOwnedDrawing(candidate),
        reason: "update",
      });
      changed("update");
      emitHistoryChange();
    };

    // Doesn't hold onto the caller's object — editing it from outside
    // would drift out of sync without the chart knowing.
    const addOwned = (drawing: DrawingInput): Drawing => {
      /**
       * Looks at the same predicate as the parser — whatever
       * `parseDrawings` rejects has to be rejected here too. Otherwise
       * `add` → `serialize` → save → `load` would reject the very string
       * it built, and the all-or-nothing rule would lose perfectly good
       * drawings along with it. Unlike the parser, this throws, because
       * this is an input API the consumer calls directly.
       *
       * Builds first, then checks what was built — calling
       * `isDrawing(drawing)` and `toOwnedDrawing(drawing)` separately
       * would make it a coincidence, not a structural guarantee, that
       * both predicates see the same value. A getter whose value changes
       * on read (returning `NaN`, say) could pass one and let the other
       * save a tainted value. Reversing the order means the object being
       * checked and the object being stored are the same one, so that
       * gap can't exist even in principle.
       */
      // The id is minted here, at the door — a consumer never invents
      // one, so a duplicate can't even arrive.
      const owned = safeOwned(drawing, mintDrawingId());
      if (!isDrawing(owned)) {
        throw new ContractError(
          `drawing must have finite coordinates, got ${describeValue(drawing)}`,
        );
      }
      drawings.push(owned);
      return owned;
    };

    /** Handle → owned drawing. Where `select(handle)` resolves what it's pointing at. */
    const handleTargets = new WeakMap<DrawingHandle, Drawing>();

    /**
     * Builds a handle pointing at one owned drawing.
     *
     * Fine to hand out a fresh object every time — `select` recovers the
     * drawing through `handleTargets`, and `remove` closes over `owned`,
     * so the contract is what it points at, not the handle's identity.
     * That property is what lets `handles()` answer by deriving on
     * request.
     */
    const makeHandle = (owned: Drawing): DrawingHandle => {
      const handle: DrawingHandle = {
        read: () => structuredClone(owned),
        /**
         * A write door, so it goes through `alive()` — otherwise, on a
         * disposed toolbox, `select(handle)` would throw while
         * `handle.remove()` succeeded quietly and fired `changes` — an
         * asymmetry.
         *
         * `read` stays open — reading after dispose is intentional, and
         * the normal path of saving the last state on unmount depends
         * on it.
         */
        remove: () => door(() => {
          alive();
          removeOne(owned);
        }),
        update: (patch) => door(() => {
          alive();
          updateOne(owned, patch);
        }),
      };
      handleTargets.set(handle, owned);
      return handle;
    };

    const add = (
      drawing: DrawingInput,
      options: AddDrawingOptions = {},
    ): DrawingHandle => {
      const selectionBefore = selected;
      const owned = addOwned(drawing);
      const command: HistoryCommand = {
        kind: "add",
        drawing: owned,
        index: drawings.length - 1,
        selectionBefore,
        selectedOnAdd: options.select === true,
      };
      recordCommand(command);
      // Announces the selection first — the same order as hand-drawing
      // (`finishPlacement`), so a consumer sees the same sequence
      // through both doors.
      if (options.select) setSelected(owned);
      changed("add");
      emitHistoryChange();
      return makeHandle(owned);
    };

    /**
     * A disposed toolbox does nothing. Throws instead of quietly
     * succeeding — adding to the list would be pointless with nobody
     * left to draw it, which is a failure that only looks like success.
     */
    const alive = (): void => {
      if (api.disposed) {
        throw new ContractError("This toolbox has been disposed");
      }
    };

    const api = pluginApi(
      {
        add: (drawing: DrawingInput, options: AddDrawingOptions = {}): DrawingHandle => door(() => {
          alive();
          // Options are a door too — the same source that made
          // `setSnap("no")` turn snapping on (`localStorage` /
          // `getAttribute` always hand you a string).
          if (typeof options !== "object" || options === null) {
            throw new ContractError(
              `add(drawing, options) must be an object, got ${describeValue(options)}`,
            );
          }
          if (
            options.select !== undefined &&
            typeof options.select !== "boolean"
          ) {
            throw new ContractError(
              `add(drawing, { select }) must be a boolean, got ${describeValue(options.select)}`,
            );
          }
          return add(drawing, options);
        }),

        list: () => drawings.map((drawing) => structuredClone(drawing)),

        handles: () => drawings.map(makeHandle),

        selection: () => (selected ? structuredClone(selected) : null),

        select: (handle: DrawingHandle | null): void => door(() => {
          alive();
          if (handle === null) {
            deselect();
            return;
          }
          // Distinguishes three malformed inputs: a value that isn't a
          // handle, another toolbox's handle, and a handle that's
          // already been removed — each gets its own error message to
          // help pin down the cause.
          if (typeof handle !== "object") {
            throw new ContractError(
              `select(handle) must be a handle from handles(), or null, got ${describeValue(handle)}`,
            );
          }
          const target = handleTargets.get(handle);
          if (!target) {
            throw new ContractError(
              "select(handle) is not this toolbox's handle — check whether it came from handles(), " +
                "and if you've mounted two charts, whether it's the same toolbox's",
            );
          }
          if (!drawings.includes(target)) {
            throw new ContractError("Can't select a removed drawing");
          }
          setSelected(target);
        }),

        begin: (kind: Drawing["type"]): void => door(() => {
          alive();
          // The kind exists only in the type, not at runtime. If
          // `begin(null)` went through, an app would have no way to
          // know what it armed, and the state machine could jam
          // afterward, killing pan and the crosshair.
          if (!DRAWING_KINDS.includes(kind)) {
            throw new ContractError(
              `begin(kind) must be one of ${DRAWING_KINDS.map((k) => `"${k}"`).join("|")}, got ${describeValue(kind)}`,
            );
          }
          const committed =
            state.kind === "dragging" ? commitDrag(state.drag, false) : false;
          // Discards whatever was being drawn — the newly armed one is the user's latest intent.
          transition({ kind: "armed", tool: kind });
          plot.requestRender();
          if (committed) emitHistoryChange();
        }),

        cancel: (): void => door(() => {
          alive();
          if (state.kind === "dragging") cancelDrag(state.drag);
          else cancelPlacement();
        }),

        mode: () => modeOf(state),

        modeChanges: modeEmitter as Observable<DrawingModeChange>,

        clear: (): void => door(() => {
          alive();
          // Cuts off an in-flight gesture before swapping out the list —
          // otherwise, pressing "clear all" with a trend line's first
          // point already placed would leave the rubber band and the
          // pressed toolbar behind, and the next click would draw a line
          // onto the canvas that was just cleared.
          if (state.kind === "dragging") cancelDrag(state.drag, false);
          else cancelPlacement(false);
          drawings.length = 0;
          setSelected(null);
          resetHistory();
          changed("clear");
          emitHistoryChange();
        }),

        undo: (): boolean => door(() => {
          alive();
          if (state.kind === "dragging") {
            cancelDrag(state.drag);
            return true;
          }
          if (state.kind === "drafting") {
            if (state.placed <= 1) {
              transition({ kind: "armed", tool: state.tool });
            } else {
              transition({ ...state, placed: state.placed - 1, pointerId: null });
            }
            plot.requestRender();
            return true;
          }
          const command = undoStack.pop();
          if (!command) return false;
          redoStack.push(command);

          if (command.kind === "add") {
            const index = drawings.indexOf(command.drawing);
            if (index !== -1) drawings.splice(index, 1);
            if (selected === command.drawing) {
              setSelected(
                command.selectionBefore && drawings.includes(command.selectionBefore)
                  ? command.selectionBefore
                  : null,
              );
            }
            changed("remove", "undo");
          } else if (command.kind === "remove") {
            drawings.splice(Math.min(command.index, drawings.length), 0, command.drawing);
            if (command.wasSelected) setSelected(command.drawing);
            changed("add", "undo");
          } else {
            // A fresh copy, not the snapshot itself — `assignOwned` hands
            // `style`/`levels` over by reference, and a live drawing that
            // shared them with the stack would let one in-place edit
            // rewrite history.
            assignOwned(command.drawing, toOwnedDrawing(command.before));
            changed(command.reason, "undo");
          }
          emitHistoryChange();
          return true;
        }),

        redo: (): boolean => door(() => {
          alive();
          if (state.kind === "dragging" || state.kind === "drafting") return false;
          const command = redoStack.pop();
          if (!command) return false;
          undoStack.push(command);

          if (command.kind === "add") {
            drawings.splice(Math.min(command.index, drawings.length), 0, command.drawing);
            if (command.selectedOnAdd) setSelected(command.drawing);
            changed("add", "redo");
          } else if (command.kind === "remove") {
            const index = drawings.indexOf(command.drawing);
            if (index !== -1) drawings.splice(index, 1);
            if (selected === command.drawing) setSelected(null);
            changed("remove", "redo");
          } else {
            assignOwned(command.drawing, toOwnedDrawing(command.after));
            changed(command.reason, "redo");
          }
          emitHistoryChange();
          return true;
        }),

        canUndo: () => historyState().canUndo,

        canRedo: () => historyState().canRedo,

        historyChanges: historyEmitter as Observable<DrawingHistoryChange>,

        changes: changes as Observable<DrawingsChange>,

        selectionChanges:
          selectionEmitter as Observable<DrawingSelectionChange>,

        applyOptions(patch: Partial<DrawingToolsStyleOptions>) {
          alive();
          if (typeof patch !== "object" || patch === null) {
            throw new ContractError(
              `applyOptions(patch) must be an object, got ${describeValue(patch)}`,
            );
          }
          // Checks the container too — if `style: "red"` went through,
          // `resolveStyle` would read `over["color"]` as undefined,
          // silently ignoring the color you specified and painting the
          // fallback instead.
          if (
            patch.style !== undefined &&
            (typeof patch.style !== "object" || patch.style === null)
          ) {
            throw new ContractError(
              `applyOptions({ style }) must be an object, got ${describeValue(patch.style)}`,
            );
          }
          // Merges one layer only → `ConfigurablePluginApi`
          if ("style" in patch) styleOverride = patch.style;
          plot.requestRender();
        },

        setSnap(on: boolean) {
          alive();
          // If `setSnap("no")` went through, `snap.enabled()` would read
          // it as truthy and turn snapping on when you meant to turn it
          // off — a door where the value flips is especially bad. The
          // source is things like `localStorage.getItem`, which always
          // hand you a string.
          if (typeof on !== "boolean") {
            throw new ContractError(
              `setSnap(on) must be a boolean, got ${describeValue(on)}`,
            );
          }
          snapping = on; // A property of the next input, not the drawing, so no re-render needed
        },
        snapping: () => snapping,

        serialize: () => serializeDrawings(drawings),

        load: (payload: string): boolean => door(() => {
          alive();
          const parsed = parseDrawings(payload);
          if (parsed === null) return false;

          // Cuts off an in-flight gesture for the same reason as `clear`
          // — otherwise, restoring mid-drag would leave the drag pushing
          // an object that's fallen out of the list, and
          // `changes: "move"` would keep firing.
          if (state.kind === "dragging") cancelDrag(state.drag, false);
          else cancelPlacement(false);
          drawings.length = 0;
          setSelected(null);
          drawings.push(...parsed);
          resetHistory();
          changed("load");
          emitHistoryChange();
          return true;
        }),
      },
      () => {
        removeConsumer();
        removeDecoration();
        // Releases the focus-contention registration too — otherwise a
        // disposed toolbox would permanently hijack the keyboard from
        // the toolboxes left behind (a dead pane's area would forever
        // count as "someone else's").
        focusClaim.release();
        /**
         * Teardown is quiet — a direct assignment, not `transition` or
         * `setSelected`. If a toolbox mid-dispose fired one last
         * selection notification, the subscriber could already be a
         * React component that's been unmounted.
         */
        // Only the cursor claim gets released — the chart outlives the tool.
        releaseCursor?.();
        releaseCursor = null;
        // Same for the hover claim. Disposing the tool while over a
        // line would leave `grab` stuck on the chart.
        hoverCursor(false);
        if (
          state.kind === "dragging" &&
          !sameDrawing(state.drag.original, state.drag.grip.drawing)
        ) {
          restoreDrawing(state.drag.grip.drawing, state.drag.original);
        }
        state = { kind: "idle" };
        selected = null;
        plot.requestRender();
      },
    );

    return api;
  };
}
