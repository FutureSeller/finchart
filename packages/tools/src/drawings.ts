import type { LineStyle } from "@finchart/core";
import { ContractError } from "@finchart/core";

/**
 * A drawing is pure data in domain coordinates: x is the data's x —
 * serialization crosses sessions even under a bar-index coordinate
 * system — and the vertical is price. Pixels only show up at the moment
 * you draw and the moment you hit-test.
 */

/**
 * The runtime list of drawing kinds. `Drawing["type"]` is a type and
 * doesn't exist at runtime — if this list drifts from it, what `begin`
 * accepts and what `toOwnedDrawing` knows how to build fall out of sync.
 * That's why it lives next to `Drawing`.
 */
export const DRAWING_KINDS: readonly Drawing["type"][] = [
  "horizontal",
  "vertical",
  "trend",
  "ray",
  "extended",
  "arrow",
  "fib",
  "rectangle",
  "ellipse",
  "priceMeasure",
  "barMeasure",
  "parallelChannel",
  "pitchfork",
];

/** Safely describes a value for error messages — `JSON.stringify` throws on cycles. */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "object") return Array.isArray(value) ? "array" : "object";
  if (kind === "string") return JSON.stringify(value);
  if (kind === "function" || kind === "symbol" || kind === "bigint") return kind;
  return String(value);
}

/** A point on the time–price plane. */
export interface Anchor {
  /** The data's x. */
  x: number;
  price: number;
}

/**
 * Every drawing carries a stable identity. It's minted at the door
 * (`add`, or the moment hand-drawing starts) — a consumer never invents
 * one — and survives save/load, so a side panel can key its own state by
 * it. Two drawings with identical geometry stay distinguishable.
 */
interface DrawingIdentity {
  id: string;
  /**
   * Per-drawing override — the third layer of the same resolution the
   * toolbox already does (theme variables → toolbox override → this).
   * The same `Partial<LineStyle>` shape, deliberately: one leaf
   * vocabulary (`width`·`color`·`dashArray`), not a second one.
   *
   * The values are literals, not theme tokens — a canvas can't read
   * `var()`, and this is a **saved** value. A drawing colored by hand
   * keeps its color across a theme switch; absent means "the theme's".
   */
  style?: Partial<LineStyle>;
}

export interface HorizontalLine extends DrawingIdentity {
  type: "horizontal";
  price: number;
}

/** horizontal의 쌍대 — one x, spanning the pane's full height. */
export interface VerticalLine extends DrawingIdentity {
  type: "vertical";
  /** The data's x. Serialized like `Anchor.x` — same landing rules. */
  x: number;
}

export interface TrendLine extends DrawingIdentity {
  type: "trend";
  a: Anchor;
  b: Anchor;
}

/** A half-line: starts at `a`, passes through `b`, and keeps going. */
export interface Ray extends DrawingIdentity {
  type: "ray";
  a: Anchor;
  b: Anchor;
}

/** A full line through `a` and `b`, extended in both directions. */
export interface ExtendedLine extends DrawingIdentity {
  type: "extended";
  a: Anchor;
  b: Anchor;
}

/** A trend segment with an arrowhead at `b`. */
export interface ArrowLine extends DrawingIdentity {
  type: "arrow";
  a: Anchor;
  b: Anchor;
}

export interface FibRetracement extends DrawingIdentity {
  type: "fib";
  a: Anchor;
  b: Anchor;
  /**
   * Which levels to draw. Absent means the conventional seven
   * (`FIB_LEVELS`) — the screen today's consumers already have. Values
   * outside [0, 1] are legal (extension levels, negative retracements);
   * the normalizer sorts and dedupes but never clamps.
   */
  levels?: number[];
}

/**
 * An axis-aligned box with `a` and `b` as opposite corners. Which corner
 * is which doesn't matter — the outline is derived from the two. Only
 * the boundary is grabbable; the interior stays the chart's (a filled
 * shape you can pick up by its body is a separate decision).
 */
export interface Rectangle extends DrawingIdentity {
  type: "rectangle";
  a: Anchor;
  b: Anchor;
}

/** An ellipse inscribed in the box whose opposite corners are `a` and `b`. Boundary-only, like the rectangle. */
export interface Ellipse extends DrawingIdentity {
  type: "ellipse";
  a: Anchor;
  b: Anchor;
}

/**
 * A segment from `a` to `b` that reports the price move between them —
 * the delta and, when `a` isn't zero, the percent. The label is
 * presentation: the hit target is the segment.
 */
export interface PriceMeasure extends DrawingIdentity {
  type: "priceMeasure";
  a: Anchor;
  b: Anchor;
}

/**
 * A segment from `a` to `b` that reports how many bars lie between them
 * — the pane's nearest bar at each end, counted by index in the data.
 * The x mapping can't answer this: under a continuous mapping its domain
 * is time, and time between two bars is not a bar count.
 */
export interface BarMeasure extends DrawingIdentity {
  type: "barMeasure";
  a: Anchor;
  b: Anchor;
}

/**
 * Two parallel lines: `a`–`b`, and a second line through `c` with the
 * same price-per-x slope, over the same x span. "Parallel" is a
 * price-space statement — on a log axis the two are not parallel on
 * screen, deliberately, so the saved bytes mean the same thing under
 * every scale. `c` is an absolute anchor (its distance from the first
 * line is derived, never stored).
 */
export interface ParallelChannel extends DrawingIdentity {
  type: "parallelChannel";
  a: Anchor;
  b: Anchor;
  c: Anchor;
}

/**
 * Andrews' pitchfork: a median ray from `a` through the midpoint of
 * `b`–`c`, and two tines from `b` and `c` carrying the median's
 * price-space direction. Only the standard fork today; a variant would
 * be an optional field on this kind, not a new kind.
 */
export interface Pitchfork extends DrawingIdentity {
  type: "pitchfork";
  a: Anchor;
  b: Anchor;
  c: Anchor;
}

export type Drawing =
  | HorizontalLine
  | VerticalLine
  | TrendLine
  | Ray
  | ExtendedLine
  | ArrowLine
  | FibRetracement
  | Rectangle
  | Ellipse
  | PriceMeasure
  | BarMeasure
  | ParallelChannel
  | Pitchfork;

export type AnchorKey = "a" | "b" | "c";

/**
 * Which anchor fields each kind owns, in placement order — the runtime
 * twin of the union's shape. Drafting reads it to know how many clicks
 * a kind takes; the kind table in the tests pins each row against the
 * sample. A `Record` keyed by the union, so a new kind can't skip it.
 */
export const ANCHOR_KEYS: Record<Drawing["type"], readonly AnchorKey[]> = {
  horizontal: [],
  vertical: [],
  trend: ["a", "b"],
  ray: ["a", "b"],
  extended: ["a", "b"],
  arrow: ["a", "b"],
  fib: ["a", "b"],
  rectangle: ["a", "b"],
  ellipse: ["a", "b"],
  priceMeasure: ["a", "b"],
  barMeasure: ["a", "b"],
  parallelChannel: ["a", "b", "c"],
  pitchfork: ["a", "b", "c"],
};

/**
 * A drawing's anchors as **live references**, in `ANCHOR_KEYS` order —
 * the one enumeration that dragging, restoring and in-place copying all
 * walk, so their indices can't disagree. A horizontal or vertical line
 * has none (its one coordinate isn't an anchor).
 */
export function drawingAnchors(drawing: Drawing): Anchor[] {
  if (!("a" in drawing)) return [];
  const anchors = [drawing.a, drawing.b];
  if ("c" in drawing) anchors.push(drawing.c);
  return anchors;
}

/**
 * Omit distributed over a union — a plain `Omit<Drawing, "id">` would
 * collapse the union to its common fields and lose the discriminant.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * What a consumer hands to `add` (and what hand-drawing produces before
 * the door stamps it): a drawing without its identity. The id is minted
 * at the door, so a duplicate can't even arrive through this type.
 */
export type DrawingInput = DistributiveOmit<Drawing, "id">;

/**
 * Mints an id. `crypto.randomUUID` where it exists; a time-and-entropy
 * fallback elsewhere — `randomUUID` is secure-context only, and an
 * intranet dashboard served over plain http is a real consumer.
 */
export function mintDrawingId(): string {
  const generator = globalThis.crypto;
  if (generator && typeof generator.randomUUID === "function") {
    return generator.randomUUID();
  }
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The Fibonacci retracement's conventional levels. a is 0, b is 1. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/**
 * The one interpreter of a retracement's level list. Hit-testing and
 * rendering both read this — the same rule as `fibLevelPrice`: two
 * copies would let the lines you see and the lines you can grab drift.
 */
export function fibLevels(
  drawing: Pick<FibRetracement, "levels">,
): readonly number[] {
  return drawing.levels ?? FIB_LEVELS;
}

/**
 * A level's price — a is 0, b is 1; the retracement reads from b toward a.
 *
 * Hit-testing and rendering read **the same formula**. Two copies could
 * drift apart, and the moment they do, the line you see and the line you
 * can grab stop matching.
 */
export function fibLevelPrice(drawing: FibRetracement, level: number): number {
  return drawing.b.price + (drawing.a.price - drawing.b.price) * level;
}

/**
 * The move a price measure reports — `b` minus `a`, in price space (the
 * same rule as `fibLevelPrice`: derived values are price arithmetic, and
 * the label reads this one function).
 */
export function priceMeasureDelta(drawing: Pick<PriceMeasure, "a" | "b">): number {
  return drawing.b.price - drawing.a.price;
}

/**
 * The channel's second line — through `c`, with `a`–`b`'s price-per-x
 * slope, at `a`'s and `b`'s x. When `a` and `b` share an x the slope has
 * no meaning, so the line is the same vertical span shifted to `c`'s x.
 * Price space, one formula: hit-testing and rendering both read this.
 */
export function channelParallel(
  drawing: Pick<ParallelChannel, "a" | "b" | "c">,
): [Anchor, Anchor] {
  const { a, b, c } = drawing;
  if (a.x === b.x) {
    return [
      { x: c.x, price: a.price },
      { x: c.x, price: b.price },
    ];
  }
  const slope = (b.price - a.price) / (b.x - a.x);
  return [
    { x: a.x, price: c.price + (a.x - c.x) * slope },
    { x: b.x, price: c.price + (b.x - c.x) * slope },
  ];
}

/**
 * The pitchfork's three lines as `[from, through]` pairs, in price
 * space: the median from `a` through the midpoint of `b`–`c`, and a
 * tine from each of `b` and `c` carrying the same direction. Each pair
 * is a ray on screen — the renderer and hit-testing both extend it with
 * `infiniteEndpoints`.
 */
export function pitchforkLines(
  drawing: Pick<Pitchfork, "a" | "b" | "c">,
): [Anchor, Anchor][] {
  const { a, b, c } = drawing;
  const dx = (b.x + c.x) / 2 - a.x;
  const dprice = (b.price + c.price) / 2 - a.price;
  const along = (from: Anchor): [Anchor, Anchor] => [
    { x: from.x, price: from.price },
    { x: from.x + dx, price: from.price + dprice },
  ];
  return [along(a), along(b), along(c)];
}

// --- Serialization (the version belongs to the format; unreadable is null) ---

/**
 * The serialization format's version. Bump it when the **envelope or a
 * shared field** changes in a breaking way — adding a drawing kind does
 * NOT bump it: an older reader rejects an unknown kind outright either
 * way, so a bump would change nothing but cost a migration.
 */
const FORMAT_VERSION = 2;

/**
 * v1 drawings get their ids here, derived from position — deliberately
 * deterministic, not random. The save recipe consumers use
 * (`reason !== "move"`) never fires on a session that only loads, so a
 * random id would change on every refresh until the first save — and a
 * side panel keying by id would orphan its state each time. Position is
 * stable for a frozen payload, so parsing the same string twice yields
 * the same ledger.
 */
function migratedV1Id(index: number): string {
  return `v1-${index}`;
}

/**
 * Turns an array of drawings into a string. Rebuilds each one from our own
 * fields before saving — what a consumer passes in might be an object from
 * their own store, and handing it to `JSON.stringify` without normalizing
 * it would let a getter-only class instance save as `{}` — which the next
 * session's parser then rejects outright (a quiet, total loss of the
 * ledger) — or would let a circular reference or a throwing getter leak
 * straight through.
 *
 * The same `toOwnedDrawing` normalization as `add` / `load` applies here
 * too. This is an input API, so an unfit element throws `ContractError`
 * (the parser's null policy belongs to the read side).
 */
export function serializeDrawings(drawings: readonly Drawing[]): string {
  if (!Array.isArray(drawings)) {
    throw new ContractError(
      `serializeDrawings(drawings) must be an array, got ${describeValue(drawings)}`,
    );
  }
  const owned = drawings.map((drawing, i) => {
    const built = safeOwn(drawing);
    if (built === null || !isDrawing(built)) {
      throw new ContractError(
        `serializeDrawings(drawings)[${i}] is not a drawing — ` +
          `type must be one of ${DRAWING_KINDS.join("·")}, coordinates must be finite, ` +
          `and id must be a non-empty string, got ${describeValue(drawing)}`,
      );
    }
    return built;
  });

  /**
   * Ids are a list-level invariant no per-element predicate can see. A
   * duplicate here comes from the consumer's own store (our door mints
   * unique ids), and their id is a key on their side — silently reissuing
   * it would rewire their store behind their back. An input API throws.
   */
  const seen = new Set<string>();
  for (const drawing of owned) {
    if (seen.has(drawing.id)) {
      throw new ContractError(
        `serializeDrawings(drawings) has two drawings with id "${drawing.id}" — ids must be unique within a ledger`,
      );
    }
    seen.add(drawing.id);
  }

  return JSON.stringify({ version: FORMAT_VERSION, drawings: owned });
}

/** Keeps a consumer's throwing getter from leaking into our stack (the same discipline as `tools.add`). */
function safeOwn(drawing: Drawing): Drawing | null {
  try {
    return toOwnedDrawing(drawing);
  } catch {
    return null;
  }
}

/**
 * The other side of the round trip. Unreadable is null — it doesn't
 * throw. A string coming from a URL or `localStorage` might belong to
 * someone else's session or an old version, and an unfamiliar version or
 * a broken shape means "nothing to restore," not "kill the app."
 *
 * It's a normalizer too — it returns only our own fields. If a consumer
 * saved a drawing with their own `id` or `label` tacked on, that falls
 * away. Same rule as `add` / `serializeDrawings`, so all three doors save
 * the identical thing.
 */
export function parseDrawings(payload: string): Drawing[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, drawings } = parsed as {
    version?: unknown;
    drawings?: unknown;
  };
  if ((version !== FORMAT_VERSION && version !== 1) || !Array.isArray(drawings)) {
    return null;
  }
  /**
   * `Array.isArray` narrows to `any[]` — if that `any` leaks downward,
   * the check becomes a check in name only. Flatten it to `unknown[]`
   * right away, and only keep elements that pass the guard.
   */
  const items: unknown[] = drawings;
  const checked: Drawing[] = [];
  for (const [index, item] of items.entries()) {
    if (version === 1) {
      // v1 has no ids — geometry is checked with the same per-kind rules,
      // and the id is derived from position (see migratedV1Id).
      if (!hasDrawingShape(item)) return null;
      checked.push(ownWithId(item, migratedV1Id(index)));
      continue;
    }
    if (!isDrawing(item)) return null;
    checked.push(item);
  }

  /**
   * The parser is a normalizer too — it pairs with `add` rebuilding
   * field by field. Otherwise the same drawing could end up saved in a
   * different shape depending on which door it came through (`add` vs.
   * `load`).
   */
  return dedupeIds(checked.map(toOwnedDrawing));
}

/**
 * A duplicate id in a payload is a repairable defect, not an unreadable
 * one — every drawing's geometry is intact, only the name tags clash. The
 * all-or-nothing rule is for shapes that can't be read; throwing the whole
 * ledger away over a name would hand a recoverable error an unrecoverable
 * outcome (the same judgment `onContextMenu` wrote down). The reissue is
 * **deterministic** — derived from the clashing id and its position — so
 * parsing the same payload twice yields the same ledger.
 */
function dedupeIds(drawings: Drawing[]): Drawing[] {
  /**
   * Reissues dodge every id in the envelope, not just the ones seen so
   * far — checking only backwards would let a reissue steal a later
   * drawing's legitimate name, renaming the original owner instead.
   */
  const taken = new Set(drawings.map((drawing) => drawing.id));
  const seen = new Set<string>();
  return drawings.map((drawing) => {
    if (!seen.has(drawing.id)) {
      seen.add(drawing.id);
      return drawing;
    }
    let suffix = 2;
    let candidate = `${drawing.id}#${suffix}`;
    while (taken.has(candidate)) {
      suffix += 1;
      candidate = `${drawing.id}#${suffix}`;
    }
    taken.add(candidate);
    seen.add(candidate);
    return ownWithId(drawing, candidate);
  });
}

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== "object" || value === null) return false;
  const anchor = value as Anchor;
  return Number.isFinite(anchor.x) && Number.isFinite(anchor.price);
}

/**
 * The drawing's shape-and-numeric contract. The parser and the input API
 * look at the same predicate — if the contract drifted between the front
 * door and the back door, `add({price: NaN})` would go through and get
 * saved, and when a later session tries to `load` that save, the
 * all-or-nothing rule would reject the entire ledger.
 *
 * Only the policy differs: the parser returns null, `add` throws
 * `ContractError`.
 */
/**
 * Builds the drawing's own copy — rebuilds it field by field instead of
 * cloning the argument.
 *
 * `structuredClone` alone only keeps own enumerable data properties, so a
 * getter or a class instance would save as `{}` (passing the check, yet
 * `load` rejecting its own output — a silent total loss of the ledger); a
 * function field would throw `DOMException`; a circular reference would
 * only throw `TypeError` later, in `serialize()`. Rebuilding field by
 * field closes all three in one place — and any extra field falls away
 * here too, as a bonus.
 */
export function toOwnedDrawing(drawing: Drawing): Drawing {
  return ownWithId(drawing, drawing.id);
}

/**
 * The one place a drawing's own shape is built — `add` stamps a fresh id
 * onto a `DrawingInput` here, `toOwnedDrawing` carries an existing one,
 * and the v1 migration derives one. A single builder keeps all three
 * doors saving the identical shape.
 */
export function ownWithId(drawing: DrawingInput, id: string): Drawing {
  const style = ownStyle(drawing.style);
  switch (drawing.type) {
    case "horizontal": {
      const owned: Drawing = { type: "horizontal", id, price: drawing.price };
      if (style) owned.style = style;
      return owned;
    }
    case "vertical": {
      const owned: Drawing = { type: "vertical", id, x: drawing.x };
      if (style) owned.style = style;
      return owned;
    }
    case "trend":
    case "ray":
    case "extended":
    case "arrow":
    case "rectangle":
    case "ellipse":
    case "priceMeasure":
    case "barMeasure": {
      const owned: Drawing = {
        type: drawing.type,
        id,
        a: ownAnchor(drawing.a),
        b: ownAnchor(drawing.b),
      };
      if (style) owned.style = style;
      return owned;
    }
    case "parallelChannel":
    case "pitchfork": {
      const owned: Drawing = {
        type: drawing.type,
        id,
        a: ownAnchor(drawing.a),
        b: ownAnchor(drawing.b),
        c: ownAnchor(drawing.c),
      };
      if (style) owned.style = style;
      return owned;
    }
    case "fib": {
      const owned: FibRetracement = {
        type: "fib",
        id,
        a: ownAnchor(drawing.a),
        b: ownAnchor(drawing.b),
      };
      if (style) owned.style = style;
      const levels = normalizedLevels(drawing.levels);
      if (levels) owned.levels = levels;
      return owned;
    }
  }

  // Adding a fourth kind to the union breaks the compile here.
  const unreachable: never = drawing;
  throw new ContractError(`unknown drawing: ${JSON.stringify(unreachable)}`);
}

/**
 * Rebuilds the style leaf by leaf — same discipline as the drawing
 * itself, and only the three leaves the renderer reads. An empty result
 * normalizes to "absent", so `{}` and no style save identically.
 */
function ownStyle(
  style: Partial<LineStyle> | undefined,
): Partial<LineStyle> | undefined {
  if (style === undefined) return undefined;
  const owned: Partial<LineStyle> = {};
  if (style.width !== undefined) owned.width = style.width;
  if (style.color !== undefined) owned.color = style.color;
  if (style.dashArray !== undefined) owned.dashArray = style.dashArray;
  return owned.width !== undefined ||
    owned.color !== undefined ||
    owned.dashArray !== undefined
    ? owned
    : undefined;
}

/** Sorted, deduped copy — never clamped (extension levels live outside [0, 1]). */
function normalizedLevels(levels: number[] | undefined): number[] | undefined {
  if (levels === undefined) return undefined;
  return [...new Set(levels)].sort((left, right) => left - right);
}

/**
 * What `handle.update` accepts — everything a drawing owns except its
 * identity and its kind. `Partial` distributes over the union, so each
 * kind patches only its own fields — **at the type level only loosely**:
 * TypeScript's excess-property check on a union admits any property that
 * appears in *some* member, so a literal mixing kinds (`{ price, levels }`)
 * compiles. The runtime check against `PATCHABLE_FIELDS` is the real
 * door; a handle isn't generic over its kind, so the type can't be
 * tighter without widening the handle contract.
 */
export type DrawingUpdate = Partial<DistributiveOmit<Drawing, "id" | "type">>;

/** The runtime twin of `DrawingUpdate` — which keys a patch may carry, per kind. */
export const PATCHABLE_FIELDS: Record<Drawing["type"], readonly string[]> = {
  horizontal: ["price", "style"],
  vertical: ["x", "style"],
  trend: ["a", "b", "style"],
  ray: ["a", "b", "style"],
  extended: ["a", "b", "style"],
  arrow: ["a", "b", "style"],
  fib: ["a", "b", "style", "levels"],
  rectangle: ["a", "b", "style"],
  ellipse: ["a", "b", "style"],
  priceMeasure: ["a", "b", "style"],
  barMeasure: ["a", "b", "style"],
  parallelChannel: ["a", "b", "c", "style"],
  pitchfork: ["a", "b", "c", "style"],
};

/**
 * Copies an owned result onto the existing object — never swaps it out.
 * Identity is the plugin's backbone (handles, `selected`, a drag's grip
 * all point at the object), the same rule `restoreDrawing` wrote down.
 * Anchors are mutated in place too, for the same reason. Absent optional
 * fields are deleted — `update({ style: undefined })` is the documented
 * way back to the theme.
 */
export function assignOwned(target: Drawing, source: Drawing): void {
  if (target.type === "horizontal" && source.type === "horizontal") {
    target.price = source.price;
  } else if (target.type === "vertical" && source.type === "vertical") {
    target.x = source.x;
  } else if (source.type === target.type) {
    const sources = drawingAnchors(source);
    drawingAnchors(target).forEach((anchor, index) => {
      anchor.x = sources[index].x;
      anchor.price = sources[index].price;
    });
  }
  if (source.style) {
    target.style = source.style;
  } else {
    delete target.style;
  }
  if (target.type === "fib" && source.type === "fib") {
    if (source.levels) {
      target.levels = source.levels;
    } else {
      delete target.levels;
    }
  }
}

const ownAnchor = (anchor: Anchor): Anchor => ({
  x: anchor.x,
  price: anchor.price,
});

/**
 * The per-kind geometry rules, without the identity — what a v1 payload
 * (no ids yet) and a `DrawingInput` at the `add` door both have to
 * satisfy. `isDrawing` is this plus a valid id.
 */
export function hasDrawingShape(value: unknown): value is DrawingInput {
  if (typeof value !== "object" || value === null) return false;
  const drawing = value as DrawingInput;
  if (!hasValidStyle(drawing.style)) return false;

  switch (drawing.type) {
    case "horizontal":
      return Number.isFinite(drawing.price);
    case "vertical":
      return Number.isFinite(drawing.x);
    case "trend":
    case "ray":
    case "extended":
    case "arrow":
    case "rectangle":
    case "ellipse":
    case "priceMeasure":
    case "barMeasure":
      return isAnchor(drawing.a) && isAnchor(drawing.b);
    case "parallelChannel":
    case "pitchfork":
      return isAnchor(drawing.a) && isAnchor(drawing.b) && isAnchor(drawing.c);
    case "fib":
      return (
        isAnchor(drawing.a) &&
        isAnchor(drawing.b) &&
        hasValidLevels(drawing.levels)
      );
    default:
      return false;
  }
}

/**
 * Text leaves are capped for the storage medium (localStorage, a URL),
 * not for the renderer — `parseDashArray` already absorbs any malformed
 * dash string by falling back to a solid line, and writing that grammar
 * a second time here would be the duplicate rulebook this repo forbids.
 */
const MAX_STYLE_TEXT = 64;

function hasValidStyle(style: unknown): boolean {
  if (style === undefined) return true;
  if (typeof style !== "object" || style === null) return false;
  const { width, color, dashArray } = style as Partial<LineStyle>;
  if (width !== undefined && !(Number.isFinite(width) && width > 0)) {
    return false;
  }
  if (
    color !== undefined &&
    !(typeof color === "string" && color.length > 0 && color.length <= MAX_STYLE_TEXT)
  ) {
    return false;
  }
  if (
    dashArray !== undefined &&
    !(typeof dashArray === "string" && dashArray.length <= MAX_STYLE_TEXT)
  ) {
    return false;
  }
  return true;
}

/** Present means drawable: a non-empty, all-finite list (order and duplicates are the normalizer's job). */
function hasValidLevels(levels: unknown): boolean {
  if (levels === undefined) return true;
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 100) {
    return false;
  }
  return levels.every((level) => Number.isFinite(level));
}

export function isDrawing(value: unknown): value is Drawing {
  if (!hasDrawingShape(value)) return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 && id.length <= 128;
}
