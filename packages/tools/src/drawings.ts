import type { LineStyle } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { midpoint, translatedDifference } from "./numeric";

/**
 * A drawing is pure data in domain coordinates: x is the data's x —
 * serialization crosses sessions under a time or a bar-index coordinate
 * system, because the data's x is the same x next session — and the
 * vertical is price. On an ordinal axis (a price-axis transform such as
 * Renko) the data's x is a brick number, valid for one transform, one set
 * of options and one source: reloading such a drawing onto that same triple
 * means translating the nearest brick inside the span (round, then clamp)
 * to its `closedAt` plus its rank among the bricks sharing it (one candle
 * can close several), keeping the signed remainder (a free-placed anchor
 * can sit between bricks or beyond either end), and back — across a
 * parameter change there is no faithful mapping. Pixels only show up at the
 * moment you draw and the moment you hit-test.
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
  "fibExtension",
];

/** Safely describes a value for error messages — `JSON.stringify` throws on cycles. */
export function describeValue(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "object") {
    try {
      return Array.isArray(value) ? "array" : "object";
    } catch {
      // A revoked proxy throws even at `Array.isArray` — and this runs while an error is being built.
      return "object";
    }
  }
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

/**
 * `"log"` spreads a Fibonacci drawing's levels evenly in **log price** instead
 * of evenly in price: a retracement's level sits at `b·(a/b)^level` rather than
 * `b + (a − b)·level`, an extension's at `c·(b/a)^level` rather than
 * `c + (b − a)·level`. On a log axis that is what looks even; price-linear
 * levels bunch toward one end there.
 *
 * It belongs to the drawing, not to the axis: the arithmetic needs only the
 * anchors' prices, so the same saved drawing puts its lines at the same prices
 * whatever axis shows it. (TradingView's option of the same name takes effect
 * only while the chart is on a log scale; this one does not look at the scale,
 * on purpose — a stored drawing that changed shape when the axis is toggled is
 * what the price-space rule for derived geometry exists to prevent.) Seen on a
 * linear axis, log-spaced levels are the ones that bunch.
 *
 * There is no `"linear"`: absence is the one spelling of the default.
 */
export type LevelSpacing = "log";

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
  /** How the levels are spread between the anchors — see `LevelSpacing`. Absent is price-linear. */
  levelSpacing?: LevelSpacing;
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

/**
 * A trend-based Fibonacci extension: the a→b swing, retraced to `c`,
 * projected from `c` — level 0 sits at `c`, level 1 at `c + (b − a)`
 * (at `c·b/a` when the levels are log-spaced — see `LevelSpacing`).
 * Its default levels and its formula are its own, not the retracement's:
 * levels past 1 are the point of this tool.
 */
export interface FibExtension extends DrawingIdentity {
  type: "fibExtension";
  a: Anchor;
  b: Anchor;
  c: Anchor;
  /** Absent means `FIB_EXTENSION_LEVELS`. Sorted and deduped, never clamped. */
  levels?: number[];
  /** How the levels are spread — see `LevelSpacing`. Absent is price-linear. */
  levelSpacing?: LevelSpacing;
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
  | Pitchfork
  | FibExtension;

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
  fibExtension: ["a", "b", "c"],
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
 * A level's price — a is 0, b is 1; the retracement reads from b toward a:
 * `b + (a − b)·level`, or `b·(a/b)^level` when the levels are log-spaced
 * (`NaN` where that is not defined — see `logSpaced`).
 *
 * Hit-testing and rendering read **the same formula**. Two copies could
 * drift apart, and the moment they do, the line you see and the line you
 * can grab stop matching.
 */
export function fibLevelPrice(drawing: FibRetracement, level: number): number {
  const { a, b } = drawing;
  if (drawing.levelSpacing !== "log") {
    if (level === 1) return a.price;
    return translatedDifference(b.price, a.price, b.price, level);
  }
  // The anchors' own levels are the anchors, whatever their prices are.
  if (level === 0) return b.price;
  if (level === 1) return a.price;
  return logSpaced(b.price, a.price, b.price, level);
}

/**
 * The levels a drawing **draws**, each with its price — the ones its spacing
 * defines, in list order. Rendering and hit-testing both walk this, so the
 * line you see and the line you can grab are the same set: a level without a
 * price (log spacing over a price that is not positive, a result outside the
 * doubles) is in neither. The filter runs **before** anything is projected — a
 * consumer's `pixelAtValue` has never been promised a `NaN`.
 */
export function fibLevelLines(drawing: FibRetracement): { level: number; price: number }[] {
  return pricedLevels(fibLevels(drawing), (level) => fibLevelPrice(drawing, level));
}

/** The extension's counterpart of `fibLevelLines`. */
export function fibExtensionLines(
  drawing: Pick<FibExtension, "a" | "b" | "c" | "levels" | "levelSpacing">,
): { level: number; price: number }[] {
  return pricedLevels(fibExtensionLevels(drawing), (level) => fibExtensionPrice(drawing, level));
}

function pricedLevels(levels: readonly number[], priceOf: (level: number) => number) {
  return levels.map((level) => ({ level, price: priceOf(level) })).filter((line) => Number.isFinite(line.price));
}

/**
 * `base · (over / under)^level` — a level spaced in log price.
 *
 * Defined only where log price is: every price positive, and a result that is
 * a positive finite number. Anywhere else this is `NaN` and the level is **not
 * drawn** — never a price-linear stand-in, which would put a line at a price
 * the drawing does not mean (and jump: with b at 100, the 50% level would go
 * from 0.0001 to 50 as a moves from 1e-10 to 0). A result that underflows to
 * zero is no more a log level than one that overflows.
 *
 * The ratio is never formed: `1e300 / 1e-300` leaves the doubles while the
 * level between them is an ordinary 1. And a large level multiplies whatever
 * the swing's logarithm got wrong, so that logarithm is kept good to its last
 * digits at any magnitude:
 *
 * - Close prices: `log1p` of the relative offset. `log(1e16 + 2) − log(1e16)`
 *   is 0 in doubles, and a large level would then return an endpoint.
 * - Far prices: each is split into a power of two and a factor next to 1
 *   (`halved`), and the two parts are carried apart to the end. Subtracting
 *   `log(5e299)` from `log(1e300)` rounds both near 690 and keeps thirteen
 *   digits of a difference of 0.69; the logarithms of the factors are small and
 *   exact to their own last digit, and the powers of two are integers.
 *
 * The result is put together the same way — a factor times a power of two — so
 * a level that is exactly `2^1024` overflows instead of landing a hair under
 * the largest double.
 */
function logSpaced(base: number, over: number, under: number, level: number): number {
  if (!(base > 0 && over > 0 && under > 0)) return Number.NaN;
  if (over === under) return base;
  const offset = (over - under) / under;
  const from = halved(base);
  let swing: [number, number] = [Math.log1p(offset), 0];
  if (Math.abs(offset) >= 0.5) {
    const [top, bottom] = [halved(over), halved(under)];
    swing = [top[0] - bottom[0], top[1] - bottom[1]];
  }
  const natural = from[0] + level * swing[0];
  const binary = from[1] + level * swing[1];
  const power = Math.round(binary + natural / Math.LN2);
  const price = scaled(Math.exp(natural + (binary - power) * Math.LN2), power);
  return price > 0 && Number.isFinite(price) ? price : Number.NaN;
}

/**
 * `price · over / under`, for moving several prices by the factor between two
 * others. The ratio is not formed (it can leave the doubles while every product
 * stays an ordinary price), and the prices are not sent through a logarithm
 * and back one by one: that rounds each on its own, and two prices one double
 * apart come out equal. One factor for all of them, applied to each price
 * **lifted next to 1** — the smallest doubles have a bit or two to round, and
 * `2m · 0.75` and `3m · 0.75` are the same double — then the powers of two
 * together. `over === under` is exactly the price given.
 *
 * Good to a few units in the last place — which is also how wide the edge of
 * the doubles is here: a product within that of the largest double (7 moved
 * from 7 to `MAX_VALUE`) may come out as infinity. Callers refuse what is not
 * finite, so at that edge a move is not applied rather than applied wrong.
 */
export function scaledByRatio(price: number, over: number, under: number): number {
  const [top, bottom] = [halved(over), halved(under)];
  const power = Math.round(Math.log2(price));
  return scaled(scaled(price, -power) * Math.exp(top[0] - bottom[0]), power + top[1] - bottom[1]);
}

/** `value` as `[ln(factor), power]` with `value = factor · 2^power` exactly and the factor next to 1. */
function halved(value: number): [number, number] {
  const power = Math.round(Math.log2(value));
  return [Math.log(scaled(value, -power)), power];
}

/**
 * `value · 2^power` in two steps, for the two uses here: lifting a price next
 * to 1, and taking a value next to 1 out to its price. `2^power` alone leaves
 * the doubles before the product does (`2^-1074` is a double, `2^1074` is not),
 * while half of any power between a double and 1 is itself a double — and the
 * step in between lies between the two ends, so only the last multiplication
 * can round. A power no price can carry gives zero or infinity, which the
 * callers refuse.
 */
function scaled(value: number, power: number): number {
  const half = Math.trunc(power / 2);
  return value * 2 ** half * 2 ** (power - half);
}

/**
 * The extension's conventional levels — the TradingView set, reaching
 * past 1 because projecting beyond the swing is what the tool is for.
 * Separate from `FIB_LEVELS` on purpose: one list for both would hand
 * the extension a retracement's screen.
 */
export const FIB_EXTENSION_LEVELS = [
  0, 0.236, 0.382, 0.5, 0.618, 1, 1.618, 2.618, 3.618, 4.236,
] as const;

/** The one interpreter of an extension's level list — hit-testing and rendering both read it. */
export function fibExtensionLevels(
  drawing: Pick<FibExtension, "levels">,
): readonly number[] {
  return drawing.levels ?? FIB_EXTENSION_LEVELS;
}

/**
 * A level's price: the a→b move, scaled by the level, laid from `c` —
 * `c + (b − a)·level`, or `c·(b/a)^level` when the levels are log-spaced
 * (`NaN` where that is not defined — see `logSpaced`). Price space, never
 * clamped — a down-swing projects down.
 */
export function fibExtensionPrice(
  drawing: Pick<FibExtension, "a" | "b" | "c" | "levelSpacing">,
  level: number,
): number {
  const { a, b, c } = drawing;
  if (drawing.levelSpacing !== "log") return translatedDifference(c.price, b.price, a.price, level);
  // Level 0 is c itself. Level 1 is `c·b/a` — a log level like any other.
  if (level === 0) return c.price;
  return logSpaced(c.price, b.price, a.price, level);
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
  const ratio = (x: number): number => {
    const span = b.x - a.x;
    const offset = x - c.x;
    return Number.isFinite(span) && Number.isFinite(offset)
      ? offset / span
      : (x / 2 - c.x / 2) / (b.x / 2 - a.x / 2);
  };
  return [
    { x: a.x, price: translatedDifference(c.price, b.price, a.price, ratio(a.x)) },
    { x: b.x, price: translatedDifference(c.price, b.price, a.price, ratio(b.x)) },
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
  const midX = midpoint(b.x, c.x);
  const midPrice = midpoint(b.price, c.price);
  const along = (from: Anchor): [Anchor, Anchor] => [
    { x: from.x, price: from.price },
    { x: translatedDifference(from.x, midX, a.x, 1), price: translatedDifference(from.price, midPrice, a.price, 1) },
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
 * A `levelSpacing` this build does not know is read the way a field it does
 * not know is: dropped, and the drawing kept. It is the one known field whose
 * unknown *value* is repaired rather than refused — a later build that adds a
 * spacing would otherwise have every drawing in the ledger rejected here over
 * one fib (the parse is all-or-nothing), while a *renamed* field would have
 * been dropped without a murmur: the careful change would break old readers
 * and the careless one would not. The loss is real and the same as an unknown
 * field's: that drawing reads with the default spacing, so its level prices
 * differ from what was saved.
 */
function withoutUnknownSpacing(item: unknown): unknown {
  if (typeof item !== "object" || item === null || !("levelSpacing" in item) || item.levelSpacing === "log") {
    return item;
  }
  const { levelSpacing: _unknown, ...rest } = item;
  return rest;
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
  if (version !== FORMAT_VERSION || !Array.isArray(drawings)) {
    return null;
  }
  /**
   * `Array.isArray` narrows to `any[]` — if that `any` leaks downward,
   * the check becomes a check in name only. Flatten it to `unknown[]`
   * right away, and only keep elements that pass the guard.
   */
  const items: unknown[] = drawings;
  const checked: Drawing[] = [];
  for (const stored of items) {
    const item = withoutUnknownSpacing(stored);
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
    const renamed = (): string => {
      const tail = `#${suffix}`;
      return `${drawing.id.slice(0, 128 - tail.length)}${tail}`;
    };
    let candidate = renamed();
    while (taken.has(candidate)) {
      suffix += 1;
      candidate = renamed();
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
 * onto a `DrawingInput` here and `toOwnedDrawing` carries an existing one.
 * A single builder keeps both doors saving the identical shape.
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
    case "fibExtension": {
      const owned: FibExtension = {
        type: "fibExtension",
        id,
        a: ownAnchor(drawing.a),
        b: ownAnchor(drawing.b),
        c: ownAnchor(drawing.c),
      };
      if (style) owned.style = style;
      const levels = normalizedLevels(drawing.levels);
      if (levels) owned.levels = levels;
      copySpacing(owned, drawing);
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
      copySpacing(owned, drawing);
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

/**
 * Copies the spacing **as it is** — judging it is the predicate's job, the way
 * `normalizedLevels` copies and `hasValidLevels` judges. A copy that kept only
 * `"log"` would let `update({ levelSpacing: "LOG" })` through the predicate
 * with the field gone, and silently switch off the `"log"` that was there.
 */
function copySpacing(
  owned: FibRetracement | FibExtension,
  drawing: Pick<FibRetracement, "levelSpacing">,
): void {
  if (drawing.levelSpacing !== undefined) owned.levelSpacing = drawing.levelSpacing;
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
  fib: ["a", "b", "style", "levels", "levelSpacing"],
  rectangle: ["a", "b", "style"],
  ellipse: ["a", "b", "style"],
  priceMeasure: ["a", "b", "style"],
  barMeasure: ["a", "b", "style"],
  parallelChannel: ["a", "b", "c", "style"],
  pitchfork: ["a", "b", "c", "style"],
  fibExtension: ["a", "b", "c", "style", "levels", "levelSpacing"],
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
  if (
    (target.type === "fib" && source.type === "fib") ||
    (target.type === "fibExtension" && source.type === "fibExtension")
  ) {
    if (source.levels) {
      target.levels = source.levels;
    } else {
      delete target.levels;
    }
    // Undo and redo restore through here — leave this out and "switch it on,
    // then Ctrl+Z" does nothing, quietly, because no geometry moved.
    if (source.levelSpacing) {
      target.levelSpacing = source.levelSpacing;
    } else {
      delete target.levelSpacing;
    }
  }
}

const ownAnchor = (anchor: Anchor): Anchor => ({
  x: anchor.x,
  price: anchor.price,
});

/**
 * The per-kind geometry rules, without the identity — what a
 * `DrawingInput` at the `add` door has to satisfy. `isDrawing` is this plus
 * a valid id.
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
    case "fibExtension":
      return (
        isAnchor(drawing.a) &&
        isAnchor(drawing.b) &&
        isAnchor(drawing.c) &&
        hasValidLevels(drawing.levels) &&
        hasValidSpacing(drawing.levelSpacing)
      );
    case "fib":
      return (
        isAnchor(drawing.a) &&
        isAnchor(drawing.b) &&
        hasValidLevels(drawing.levels) &&
        hasValidSpacing(drawing.levelSpacing)
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

/** Absent, or the one value there is. */
function hasValidSpacing(spacing: unknown): boolean {
  return spacing === undefined || spacing === "log";
}

/**
 * The drawing's shape-and-numeric contract. The parser and the input API
 * look at the same predicate — if the contract drifted between the front
 * door and the back door, `add({ type: "horizontal", price: NaN })` would go
 * through and get saved, and when a later session tries to `load` that
 * save, the all-or-nothing rule would reject the entire ledger.
 *
 * Only the policy differs: the parser returns null, `add` throws
 * `ContractError`. One repair comes before the predicate on the parser's side
 * only: a `levelSpacing` it does not know is dropped like an unknown field
 * (see `withoutUnknownSpacing`), while `add` and `update` refuse it.
 */
export function isDrawing(value: unknown): value is Drawing {
  if (!hasDrawingShape(value)) return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 && id.length <= 128;
}
