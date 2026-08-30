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
  "trend",
  "fib",
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

export interface HorizontalLine {
  type: "horizontal";
  price: number;
}

export interface TrendLine {
  type: "trend";
  a: Anchor;
  b: Anchor;
}

export interface FibRetracement {
  type: "fib";
  a: Anchor;
  b: Anchor;
}

export type Drawing = HorizontalLine | TrendLine | FibRetracement;

/** The Fibonacci retracement's conventional levels. a is 0, b is 1. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

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

// --- Serialization (the version belongs to the format; unreadable is null) ---

/** The serialization format's version. Bump it when the shape changes in a breaking way. */
const FORMAT_VERSION = 1;

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
          `type must be one of ${DRAWING_KINDS.join("·")} and coordinates must be finite, ` +
          `got ${describeValue(drawing)}`,
      );
    }
    return built;
  });
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
  if (version !== FORMAT_VERSION || !Array.isArray(drawings)) return null;
  /**
   * `Array.isArray` narrows to `any[]` — if that `any` leaks downward,
   * the check becomes a check in name only. Flatten it to `unknown[]`
   * right away, and only keep elements that pass the guard.
   */
  const items: unknown[] = drawings;
  const checked: Drawing[] = [];
  for (const item of items) {
    if (!isDrawing(item)) return null;
    checked.push(item);
  }

  /**
   * The parser is a normalizer too — it pairs with `add` rebuilding
   * field by field. Otherwise the same drawing could end up saved in a
   * different shape depending on which door it came through (`add` vs.
   * `load`).
   */
  return checked.map(toOwnedDrawing);
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
  switch (drawing.type) {
    case "horizontal":
      return { type: "horizontal", price: drawing.price };
    case "trend":
      return { type: "trend", a: ownAnchor(drawing.a), b: ownAnchor(drawing.b) };
    case "fib":
      return { type: "fib", a: ownAnchor(drawing.a), b: ownAnchor(drawing.b) };
  }

  // Adding a fourth kind to the union breaks the compile here.
  const unreachable: never = drawing;
  throw new ContractError(`unknown drawing: ${JSON.stringify(unreachable)}`);
}

const ownAnchor = (anchor: Anchor): Anchor => ({
  x: anchor.x,
  price: anchor.price,
});

export function isDrawing(value: unknown): value is Drawing {
  if (typeof value !== "object" || value === null) return false;
  const drawing = value as Drawing;

  switch (drawing.type) {
    case "horizontal":
      return Number.isFinite(drawing.price);
    case "trend":
    case "fib":
      return isAnchor(drawing.a) && isAnchor(drawing.b);
    default:
      return false;
  }
}
