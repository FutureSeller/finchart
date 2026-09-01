import type { Point } from "../primitives";
import {
  ContractError,
  describe,
  requireFinite,
  requireObject,
} from "../primitives";

/**
 * A single input event normalized to element-relative coordinates. Plain
 * data, not a DOM event — the consumer never needs to know about the DOM,
 * and a headless host can synthesize input.
 *
 * Why `pointerId` is carried from the start: a pinch tracks two pointers
 * at once. Adding it later would shake every consumer's signature.
 */
export type InputEvent =
  | {
      type: "pointerdown" | "pointermove" | "pointerup";
      point: Point;
      pointerId: number;
      /**
       * The button pressed (same numbering as DOM `PointerEvent.button`:
       * 0 primary, 1 wheel, 2 secondary). Absent means the primary button —
       * the same meaning as today for synthetic input that doesn't set it.
       *
       * This field prevents a right-click-drag misfire — without it, hand
       * tremor while holding the button during a right-click on a line
       * would read as a drag and shove the shape. Being an optional field
       * means adding it after release still leaves a consumer that doesn't
       * read it working exactly as before (unlike adding a new variant or
       * changing an existing field's meaning).
       */
      button?: number;
    }
  /**
   * the gesture was cancelled — not released.
   *
   * These are the spots where the browser reclaims a pointer: palm
   * rejection on a tablet, an OS gesture, scroll takeover, a window
   * switch. To a tool, `up` and `cancel` are opposites — folding cancel
   * into up would commit a half-dragged shape right at the moment it was
   * meant to be undone.
   *
   * Why this is a new variant instead of an optional field: an optional
   * field would silently hand a consumer that doesn't read it the old bug
   * (a release that isn't really a release) as the default. A new variant
   * makes an exhaustive switch raise the question at compile time.
   *
   * `dom` also uses this for pan/gesture cleanup, for the sake of
   * consumers that don't consume it.
   */
  | { type: "pointercancel"; point: Point; pointerId: number }
  | { type: "wheel"; point: Point; deltaY: number }
  | { type: "dblclick"; point: Point }
  /**
   * A right-click.
   *
   * `InputEvent` is a public union and consumers exhaustively switch over
   * it, so adding a variant after release would be breaking.
   *
   * Recipe (how `@finchart/tools` uses this gate):
   *
   * ```ts
   * plot.on("contextmenu", ({ position }) => {
   *   const target = tools.selection();   // the drawing under the cursor, null if none
   *   openMenu(position, target);
   * });
   * ```
   *
   * The toolbox selects on right-click but doesn't consume it — a hit
   * selects, a miss deselects. It returns `false`, so
   * `plot.contextMenu(point)` still fires and the app can open its own
   * menu.
   *
   * The pointer variant's `button` is this gesture's counterpart —
   * without it, the pointerdown that precedes a right-click would start a
   * drag and move the drawing.
   *
   * There's no capture — a right-click has nothing equivalent to "take
   * over the drag."
   */
  | { type: "contextmenu"; point: Point }
  /**
   * A single key with no modifiers (select, delete, and cancel all arrive
   * this way — 2026-08-10 review). There's no `point` — a key belongs to
   * focus, not the cursor. No capture either: a key has nothing
   * equivalent to "take over the drag," so like wheel it only passes
   * through the stack once.
   */
  | { type: "keydown"; key: string };

/**
 * Something that gets first look at input — this is where a drawing tool
 * or an axis drag belongs.
 *
 * When `handle` returns true, it **consumed** the event: that event never
 * reaches below it (other consumers, the default pan/zoom/crosshair). The
 * judgment call (is this over my shape?) belongs to the consumer — a
 * shared `hitTest` contract waits until two real consumers exist.
 */
export interface InputConsumer {
  handle(event: InputEvent): boolean;
}

export interface InputConsumerOptions {
  /**
   * Higher gets first look. Ties go to **whichever registered later** —
   * the convention that whatever's drawn on top grabs it first (the same
   * direction as z). Defaults to 0.
   */
  priority?: number;
}

interface InputEntry {
  readonly consumer: InputConsumer;
  readonly priority: number;
}

/**
 * The input stack. **Pointers pass through here, not
 * gestures** — once something has been translated into a pan, there's no
 * longer any way to say "this drag is mine."
 *
 * Capture is implemented right here: once a consumer consumes a
 * pointerdown, that same pointer's move/up **goes straight to it without
 * re-walking the stack**, and releases on up. This single rule is how a
 * drawing tool "takes over the drag" — no consumer needs to rewrite its
 * own state machine for it.
 */
export class InputRouter {
  /** Descending priority. Ties put whichever registered later in front. */
  private readonly entries: InputEntry[] = [];
  private readonly captures = new Map<number, InputConsumer>();

  add(consumer: InputConsumer, options: InputConsumerOptions = {}): () => void {
    const entry: InputEntry = {
      consumer,
      priority: options.priority ?? 0,
    };

    // Inserts at the front of the same priority — whichever registered later gets it first.
    let at = 0;
    while (at < this.entries.length && this.entries[at].priority > entry.priority) {
      at++;
    }
    this.entries.splice(at, 0, entry);

    return () => {
      const index = this.entries.indexOf(entry);
      if (index !== -1) this.entries.splice(index, 1);
      // Releases any pointer it had captured too — a consumer that's gone must not keep swallowing input.
      for (const [pointerId, captured] of this.captures) {
        if (captured === entry.consumer) this.captures.delete(pointerId);
      }
    };
  }

  /** true = the stack consumed it. The caller must not apply the default gesture. */
  route(event: InputEvent): boolean {
    checkInputEvent(event);
    if (
      event.type === "pointerdown" ||
      event.type === "pointermove" ||
      event.type === "pointerup" ||
      event.type === "pointercancel"
    ) {
      const captured = this.captures.get(event.pointerId);
      if (captured) {
        /**
         * A cancel releases the capture too — otherwise, once the browser
         * reclaims a pointer that will never come back, its capture would
         * linger, and that consumer would swallow the next drag on the
         * same `pointerId` whole.
         */
        if (event.type === "pointerup" || event.type === "pointercancel") {
          this.captures.delete(event.pointerId);
        }
        captured.handle(event);
        // An event during capture is unconditionally consumed — even if
        // the consumer returns false, letting pan take over would produce
        // a half-drag where the shape and the chart get dragged together.
        return true;
      }
    }

    /**
     * Iterates over a snapshot. Walking `this.entries` live would mean
     * that the instant one consumer removes another (or itself) from
     * inside its own `handle`, the very next consumer would miss this
     * event entirely — the array gets `splice`d mid-iteration and the
     * index skips one. An insertion has the same root cause.
     *
     * A snapshot alone is only half the fix — calling a removed consumer
     * as-is would send the event to a dead extension. So this checks it's
     * still in the list right before calling it.
     */
    // The spread is the point: a consumer that removes itself mid-iteration
    // shrinks the original and the next index gets skipped. What the lint
    // suggests — iterate the iterable directly — is that exact defect.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const entry of [...this.entries]) {
      if (!this.entries.includes(entry)) continue;
      const { consumer } = entry;
      if (!consumer.handle(event)) continue;

      if (event.type === "pointerdown") {
        this.captures.set(event.pointerId, consumer);
      }
      return true;
    }

    return false;
  }
}

/**
 * The finite set of recognized gestures. An array rather than a `Set`
 * because the `no-global-registry` machine treats a module-level
 * `Map`/`Set` as an accumulating container and blocks it — `includes` is
 * cheaper anyway for a lookup over seven elements.
 *
 * This is paired with the union — adding a variant means adding it here
 * too. Growing only the type would still compile, and the runtime gate
 * would then reject the new variant. The test below enforces that pairing.
 */
const INPUT_TYPES: readonly InputEvent["type"][] = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "wheel",
  "dblclick",
  "contextmenu",
  "keydown",
];

/**
 * Checks an event's shape and coordinates before it enters the stack.
 *
 * `routeInput` is a public contract, and a headless host can synthesize
 * input — synthetic coordinates come from RN gestures, a worker, a server,
 * a test harness, and aren't ours to trust. The browser path is safe.
 *
 * The cost of not checking this was quiet data destruction — grab a shape
 * with a normal pointerdown, then a single `{x: NaN, y: NaN}` move would
 * assign straight to the anchor with no check (a captured move skips the
 * boundary check), and that would reach a save, wiping out the ledger for
 * the next session.
 *
 * `type` and `deltaY` are checked too — a declaration with no check lets a
 * typo or an omission through silently, turning into a failure where the
 * consumer never learns why its own `handle` was never called.
 */
function checkInputEvent(event: InputEvent): void {
  requireObject(event, "routeInput(event)");

  // Actually checks `type` — without this, a typo (`{ type: "bogus" }`)
  // would pass through unchanged to every consumer, and the consumer would
  // never learn why its own `handle` never fires.
  if (!INPUT_TYPES.includes(event.type)) {
    throw new ContractError(
      `routeInput(event) type is not a recognized gesture, got ${describe(event.type)} — ` +
        `must be one of ${INPUT_TYPES.join(" · ")}`,
    );
  }

  if (event.type === "keydown") {
    if (typeof event.key !== "string") {
      throw new ContractError(
        `routeInput({ type: "keydown", key }) key must be a string, got ${describe(event.key)}`,
      );
    }
    return;
  }
  const point: Point = requireObject(event.point, `routeInput({ type: "${event.type}" }) point`);
  requireFinite(point.x, `routeInput point x`);
  requireFinite(point.y, `routeInput point y`);

  /**
   * `deltaY` is checked too. If a missing value, `NaN`, or a string got
   * through, `@finchart/dom`'s `event.deltaY < 0 ? zoomSpeed :
   * 1/zoomSpeed` would silently spin toward zoom-out only, since
   * `NaN < 0` is false — synthetic input (RN inertial scrolling, etc.) is
   * where such a value comes from.
   */
  if (event.type === "wheel") {
    requireFinite(event.deltaY, `routeInput({ type: "wheel" }) deltaY`);
  }

  /**
   * `pointerId` is checked too — it's both the capture map's key and the
   * value `@finchart/tools` uses with `!==` to decide who owns a gesture.
   * If it's missing, multi-touch protection is disabled (finger B's move
   * cancels finger A's line); if its type differs between down and move
   * (number vs. string), the state machine gets stuck in `dragging` and a
   * tool swallows every subsequent pointer input. Where such a value comes
   * from: RN gestures, a worker bridge, a custom host — the browser path
   * (`@finchart/dom`) is safe.
   *
   * `wheel` and `dblclick` have no `pointerId` — since they're never
   * captured, they don't need the key.
   */
  if (
    event.type === "pointerdown" ||
    event.type === "pointermove" ||
    event.type === "pointerup" ||
    // cancel is the capture-release key — a malformed cancel that slipped
    // this gate missed `captures.get`, the capture lingered, and that
    // consumer swallowed the next drag on the same pointerId whole.
    event.type === "pointercancel"
  ) {
    requireFinite(event.pointerId, `routeInput({ type: "${event.type}" }) pointerId`);
    /**
     * `button` is optional, so its absence means the primary button, but
     * if given it must be a finite number — a string would make every
     * `!== 0` comparison true, reading every click as a secondary button.
     * cancel carries no button at all — the type itself says so.
     */
    if (event.type !== "pointercancel" && event.button !== undefined) {
      requireFinite(event.button, `routeInput({ type: "${event.type}" }) button`);
    }
  }
}
