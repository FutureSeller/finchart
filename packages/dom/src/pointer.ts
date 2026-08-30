import type {
  InteractionHandler,
  InteractionTarget,
  Point,
  Scope,
} from "@finchart/core";
import { createScope } from "@finchart/core";
import { listen } from "./listen";

export interface PointerInteractionsOptions {
  pan?: boolean;
  zoom?: boolean;
  crosshair?: boolean;
  /** Double-click resets to the full view. Default true. */
  doubleClickReset?: boolean;
  /**
   * Releasing a drag lets it flow with inertia. **Off by default** — it
   * gets in the way of precise manipulation (lining up a backtest range),
   * so this is opt-in.
   */
  kineticScroll?: boolean;
  /**
   * Basic keyboard gestures — ←→ pans by 5% of the screen width each, +/−
   * zooms about the center. Default true. Doesn't remove the focus ring —
   * that's accessibility.
   *
   * Only these two are what this turns off. The `tabIndex` and keydown
   * listener attach regardless of this option, so even with it off the
   * element still takes focus, and keys that go to the input stack
   * (Delete, Esc, `]`, `[` for drawing tools) still work.
   *
   * To take the chart out of tab order, set `tabindex="-1"` on the element
   * directly — an existing `tabindex` attribute is left alone whatever its
   * value. This option isn't the place for that.
   */
  keyboard?: boolean;
  /**
   * Zoom factor per wheel notch. 1.1 means 10% at a time. Default 1.1.
   *
   * The domain is finite positive numbers, and three ranges behave
   * differently:
   *
   * - `> 1` — the zoom step
   * - `= 1` — nothing happens (×1 either direction). No error, no log
   * - `< 1` — direction flips (wheel up zooms out). Not a defect — this
   *   could be a natural-scroll preference, so the guard is deliberately
   *   left out
   * - `0`, negative, `NaN`, `Infinity` — not blocked here. Setting it
   *   succeeds silently, and the core rejects with `ContractError` on the
   *   first wheel event. Because the throw site is inside a DOM listener,
   *   it goes to `window.onerror`, not the consumer's try/catch
   *
   * The usual source is a settings panel's `valueAsNumber` (`NaN` if
   * blank) or `Number(localStorage.getItem(...))`.
   */
  zoomSpeed?: number;
}

/**
 * The contract factory for the default pointer interactions — hides the
 * implementation class and hands back an `InteractionHandler`. The
 * fine-grained toggles (pan, zoom, crosshair, doubleClickReset,
 * kineticScroll, keyboard, zoomSpeed) all come in through this door:
 *
 * ```ts
 * const deps = browserDeps({ pointer: { kineticScroll: true } });
 * ```
 *
 * The element is received when this is created — `connect(target)` has no
 * element (the core contract has no element type). `browserDeps` binds the
 * container in here.
 */
export function pointerInteractions(
  element: HTMLElement,
  options: PointerInteractionsOptions = {},
): InteractionHandler {
  return new PointerInteractions(element, options);
}

/**
 * Translates mouse/touch input into pan/zoom/crosshair.
 *
 * Events are received from the document during a drag — that way the drag
 * doesn't break when the pointer leaves the chart, and setPointerCapture,
 * which jsdom lacks, isn't needed.
 */
export class PointerInteractions implements InteractionHandler {
  private target: InteractionTarget | null = null;
  /**
   * Pointers currently mid-gesture — id → last clientX. One means pan, two
   * means pinch. The pinch scale is the ratio of x distances — pinch on a
   * financial chart zooms the x-axis, and y is autoscale's territory.
   */
  private readonly panPointers = new Map<number, number>();
  /** Whether this drag passed 5px — if it did, the click on release gets swallowed. */
  private dragged = false;
  private downX = 0;
  /** Velocity of the last pan move (px/ms) — the initial value for inertia. */
  private velocity = 0;
  private lastMoveAt = 0;
  private inertiaFrame: number | null = null;
  /**
   * Pointers whose down event the stack consumed. Their move/up go through
   * `routeInput`, not the gesture path — here they only count as "a reason
   * to keep listening on document."
   */
  private readonly stackPointers = new Set<number>();
  /** Owns everything connect() attaches. `null` means not connected. */
  private connection: Scope | null = null;
  /** Owns the document listeners of the drag in flight. One per gesture. */
  private dragScope: Scope | null = null;
  private readonly options: Required<PointerInteractionsOptions>;

  constructor(
    private readonly element: HTMLElement,
    options: PointerInteractionsOptions = {},
  ) {
    this.options = {
      pan: options.pan ?? true,
      zoom: options.zoom ?? true,
      crosshair: options.crosshair ?? true,
      doubleClickReset: options.doubleClickReset ?? true,
      kineticScroll: options.kineticScroll ?? false,
      keyboard: options.keyboard ?? true,
      zoomSpeed: options.zoomSpeed ?? 1.1,
    };
  }

  connect(target: InteractionTarget): void {
    this.disconnect();

    this.target = target;
    const { element } = this;
    const scope = createScope();
    this.connection = scope;

    // Keeps touch drags from being consumed by page scroll.
    element.style.touchAction = "none";
    listen(scope, element, "pointerdown", this.onPointerDown);
    listen(scope, element, "pointermove", this.onHover);
    listen(scope, element, "wheel", this.onWheel, { passive: false });
    listen(scope, element, "dblclick", this.onDoubleClick);
    listen(scope, element, "click", this.onClick);
    listen(scope, element, "contextmenu", this.onContextMenu);

    /**
     * The listener and focus attach regardless of the `keyboard` option —
     * stack routing lives inside `onKeyDown`, so without a listener a
     * tool's Delete/Esc/`]`/`[` never even reaches `routeInput`, and if
     * `tabIndex` were gated the same way the container couldn't take
     * focus, making the whole chart inaccessible to keyboard users.
     *
     * The only thing this option turns off is the basic gestures (←→ pan,
     * +/− zoom) — that check happens inside `onKeyDown`.
     */
    /**
     * Checked with `hasAttribute` — `element.tabIndex < 0` can't tell "no
     * attribute" from "explicitly -1" apart (a `div`'s default is -1, so
     * both read as -1). An existing `tabindex` is respected whatever its
     * value, because an accessibility audit may require `tabindex="-1"`
     * exactly where a focusable element has no accessible name, and that
     * value must never be overwritten. This is a contract in the published
     * `.d.ts`, so from here on it can only change additively.
     */
    if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
    listen(scope, element, "keydown", this.onKeyDown);

    // Registered last, so it runs first on dispose: a drag or inertia still
    // in flight stops before the element listeners come off — the same
    // order disconnect always kept.
    scope.add(() => this.endDrag());
  }

  disconnect(): void {
    this.connection?.dispose();
    this.connection = null;
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

  /** Coordinates relative to the element. Computed by hand because offsetX varies by browser. */
  private localPoint(event: MouseEvent): Point {
    const rect = this.element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  /** jsdom's synthetic events can lack a pointerId — treated as a single mouse. */
  private pointerIdOf(event: { pointerId?: number }): number {
    return event.pointerId ?? 1;
  }

  private onPointerDown = (event: PointerEvent): void => {
    const pointerId = this.pointerIdOf(event);

    // A new finger touching down ends any inertia already flowing.
    this.stopInertia();

    // Stack first. If it's consumed, this drag belongs to the
    // consumer — document keeps feeding it move/up, and pan never starts.
    if (
      this.target?.routeInput({
        type: "pointerdown",
        point: this.localPoint(event),
        pointerId,
        button: event.button,
      })
    ) {
      this.stackPointers.add(pointerId);
      this.listenForDrag();
      return;
    }

    /**
     * Only the primary button pans — without this check, a right-button
     * drag would move the chart too, so a user trying to open a context
     * menu ends up shifting the axes instead. The stack was already
     * checked above (a tool receives `button` and decides for itself).
     */

    if (event.button !== 0) return;

    if (!this.options.pan && !this.options.zoom) return;

    this.panPointers.set(pointerId, event.clientX);
    this.dragged = false;
    this.downX = event.clientX;
    // Inertia's clock starts at the moment of capture — otherwise the first move's elapsed time becomes the epoch.
    this.lastMoveAt = Date.now();
    this.velocity = 0;
    this.listenForDrag();
  };

  private listenForDrag(): void {
    if (this.dragScope || !this.connection) return;

    const scope = this.connection.child();
    const document = this.element.ownerDocument;
    if (document) {
      listen(scope, document, "pointermove", this.onDragMove);
      listen(scope, document, "pointerup", this.onDragEnd);
      listen(scope, document, "pointercancel", this.onDragEnd);
    }
    this.dragScope = scope;
  }

  private onDragMove = (event: PointerEvent): void => {
    if (!this.target) return;

    // Movement of a pointer the consumer has captured — the router sends it straight through.
    if (this.stackPointers.has(this.pointerIdOf(event))) {
      this.target.routeInput({
        type: "pointermove",
        point: this.localPoint(event),
        pointerId: this.pointerIdOf(event),
      });
      return;
    }

    const pointerId = this.pointerIdOf(event);
    if (!this.panPointers.has(pointerId)) return;

    const { clientX } = event;

    if (this.panPointers.size >= 2) {
      this.pinch(pointerId, clientX);
      return;
    }

    // The crosshair follows the pointer even mid-pan — it's not a pan
    // side-effect but an echo of the pointer itself, so it comes before the
    // pan guard. Touch is excluded (a crosshair under a finger carries no
    // information). A synthetic event with no pointerType is treated as a
    // mouse.
    if (
      this.options.crosshair &&
      event.pointerType !== "touch"
    ) {
      this.target.crosshair(this.localPoint(event));
    }

    if (!this.options.pan) return;
    const last = this.panPointers.get(pointerId)!;
    this.panPointers.set(pointerId, clientX);
    if (Math.abs(clientX - this.downX) > 5) this.dragged = true;
    const dx = clientX - last;
    this.target.panByPixels(dx);

    if (this.options.kineticScroll) {
      const now = Date.now();
      const elapsed = Math.max(now - this.lastMoveAt, 1);
      this.lastMoveAt = now;
      this.velocity = dx / elapsed;
    }
  };

  /**
   * The ratio of the two pointers' x distances is the scale factor, and
   * their midpoint is the fixed point. Each move multiplies in a small
   * ratio, so there's no need to keep separate state for the starting
   * distance.
   */
  private pinch(moved: number, clientX: number): void {
    if (!this.options.zoom || !this.target) {
      this.panPointers.set(moved, clientX);
      return;
    }

    const [a, b] = [...this.panPointers.keys()];
    const other = moved === a ? b : a;
    const before = Math.abs(
      this.panPointers.get(moved)! - this.panPointers.get(other)!,
    );
    this.panPointers.set(moved, clientX);
    const after = Math.abs(clientX - this.panPointers.get(other)!);

    // If the fingers overlap the ratio spikes to 0/∞ — that frame is discarded.
    if (before < 8 || after < 8) return;

    const midClient = (clientX + this.panPointers.get(other)!) / 2;
    const rect = this.element.getBoundingClientRect();
    this.target.zoomAtPixel(after / before, midClient - rect.left);
  }

  private onDragEnd = (event: PointerEvent): void => {
    const pointerId = this.pointerIdOf(event);

    if (this.stackPointers.has(pointerId)) {
      this.stackPointers.delete(pointerId);
      /**
       * Cancel (`pointercancel`) is forwarded as cancel, release
       * (`pointerup`) as release — both need capture released, so
       * `listenForDrag` wires them to the same handler, but for a tool
       * cancel and release are opposites (a pointer reclaimed by palm
       * rejection that gets reported as a release would confirm a
       * half-drawn shape). Releasing capture and cleaning up listeners
       * still flow through below the same way — only what's told to the
       * stack diverges.
       */
      this.target?.routeInput({
        type: event.type === "pointercancel" ? "pointercancel" : "pointerup",
        point: this.localPoint(event),
        pointerId,
      });
      this.stopDragListening();
      return;
    }

    this.panPointers.delete(pointerId);
    if (
      this.options.kineticScroll &&
      this.panPointers.size === 0 &&
      /**
       * Cancel isn't release — the same goes for inertia. If a pan
       * reclaimed by palm rejection or a browser gesture takeover fired
       * inertia at its last velocity, the chart would fly off on its own —
       * only what the user actually threw should flow.
       */
      event.type !== "pointercancel" &&
      // Only when still moving right up to release — release after stopping has no inertia.
      Date.now() - this.lastMoveAt < 80
    ) {
      this.startInertia();
    }
    this.stopDragListening();
  };

  /**
   * The decay loop — loses 5% of velocity every frame (half-life ≈ 220ms).
   * In an environment with no rAF (node), it simply doesn't flow — inertia
   * is decoration, not a contract.
   */
  private startInertia(): void {
    const view = this.element.ownerDocument?.defaultView;
    if (!view?.requestAnimationFrame || Math.abs(this.velocity) < 0.05) return;

    let last = Date.now();
    const step = (): void => {
      if (!this.target) return;
      const now = Date.now();
      const elapsed = now - last;
      last = now;

      this.velocity *= 0.95 ** (elapsed / 16);
      const dx = this.velocity * elapsed;
      if (Math.abs(this.velocity) < 0.02) {
        this.inertiaFrame = null;
        return;
      }

      this.target.panByPixels(dx);
      this.inertiaFrame = view.requestAnimationFrame(step);
    };

    this.inertiaFrame = view.requestAnimationFrame(step);
  }

  private stopInertia(): void {
    if (this.inertiaFrame === null) return;
    this.element.ownerDocument?.defaultView?.cancelAnimationFrame(
      this.inertiaFrame,
    );
    this.inertiaFrame = null;
    this.velocity = 0;
  }

  /** Reverts the document listeners only once neither pan nor a stack drag remains. */
  private stopDragListening(): void {
    if (this.panPointers.size > 0 || this.stackPointers.size > 0) return;

    this.dragScope?.dispose();
    this.dragScope = null;
  }

  private endDrag(): void {
    this.stopInertia();
    this.panPointers.clear();
    this.stackPointers.clear();
    this.stopDragListening();
  }

  /** Only movement while not dragging counts as a crosshair. */
  private onHover = (event: PointerEvent): void => {
    if (
      this.panPointers.size > 0 ||
      this.stackPointers.size > 0 ||
      !this.target
    ) {
      return;
    }

    const point = this.localPoint(event);

    // Even unconsumed movement passes through the stack — this is the path
    // for a tool's hover highlight. If it was consumed, there's no reason
    // for the crosshair to draw over it.
    if (
      this.target.routeInput({
        type: "pointermove",
        point,
        pointerId: this.pointerIdOf(event),
      })
    ) {
      return;
    }

    if (!this.options.crosshair) return;
    this.target.crosshair(point);
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (!this.target) return;

    const point = this.localPoint(event);
    // Stack first — a tool needs to be able to use double-click (e.g. deleting a drawing).
    if (this.target.routeInput({ type: "dblclick", point })) return;

    this.target.doubleClick(point);
    if (!this.options.doubleClickReset) return;
    this.target.fitDomains();
  };

  /** The click at the end of a drag is swallowed — that was a drag-and-release, not a click. */
  private onClick = (event: MouseEvent): void => {
    if (!this.target || this.dragged) return;
    this.target.click(this.localPoint(event));
  };

  private onContextMenu = (event: MouseEvent): void => {
    if (!this.target) return;

    const point = this.localPoint(event);
    // Stack first — if a tool consumes it, the browser menu is blocked
    // too. For a tool that uses right-click as a delete gesture, the
    // native menu popping up alongside it would be a half-measure.
    if (this.target.routeInput({ type: "contextmenu", point })) {
      event.preventDefault();
      return;
    }
    this.target.contextMenu(point);
  };

  /**
   * ←→ = pan by 5% of the screen width, +/− = zoom about the center.
   * Combinations with a modifier key belong to the browser — not
   * intercepted.
   */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.target || event.ctrlKey || event.metaKey || event.altKey) return;

    // Stack first — editing keys like Delete/Esc belong to the tool.
    if (this.target.routeInput({ type: "keydown", key: event.key })) {
      event.preventDefault();
      return;
    }

    /**
     * This is where the `keyboard` option actually turns things off — the
     * basic gestures only. Stack routing above has already run, so a tool's
     * editing keys (Delete, Esc, `]`, `[`) survive regardless of the
     * option.
     */
    if (!this.options.keyboard) return;

    const width = this.element.getBoundingClientRect().width;
    const step = Math.max(width * 0.05, 16);
    const center = width / 2;

    switch (event.key) {
      case "ArrowLeft":
        if (!this.options.pan) return;
        this.target.panByPixels(step);
        break;
      case "ArrowRight":
        if (!this.options.pan) return;
        this.target.panByPixels(-step);
        break;
      case "+":
      case "=":
        if (!this.options.zoom) return;
        this.target.zoomAtPixel(this.options.zoomSpeed, center);
        break;
      case "-":
        if (!this.options.zoom) return;
        this.target.zoomAtPixel(1 / this.options.zoomSpeed, center);
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.target) return;

    const point = this.localPoint(event);

    // preventDefault is only called by whichever side actually used the
    // event — page scroll must not be blocked over a chart with zoom off
    // and no consumer.
    if (this.target.routeInput({ type: "wheel", point, deltaY: event.deltaY })) {
      event.preventDefault();
      return;
    }

    if (!this.options.zoom) return;
    event.preventDefault();

    // Scrolling up (deltaY < 0) zooms in.
    const factor =
      event.deltaY < 0 ? this.options.zoomSpeed : 1 / this.options.zoomSpeed;

    this.target.zoomAtPixel(factor, point.x);
  };
}
