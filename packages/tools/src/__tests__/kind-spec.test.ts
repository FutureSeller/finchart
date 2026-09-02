import { describe, expect, it } from "vitest";
import {
  DRAWING_KINDS,
  isDrawing,
  parseDrawings,
  serializeDrawings,
  type Drawing,
} from "../drawings";

/**
 * The one table every kind must have a row in. `DRAWING_KINDS` is an
 * annotated array — tsc stays silent if a union member is missing from
 * it (measured: an array literal typed `readonly Drawing["type"][]`
 * accepts any subset). A `Record` keyed by the union is what actually
 * forces exhaustiveness: add a kind to the union without a row here and
 * TS2741 breaks the compile; the set assertion below closes the other
 * direction (a row whose kind fell out of `DRAWING_KINDS`).
 *
 * The table lives in a test file on purpose — zero runtime bytes (the
 * serialization-only entry point is a budgeted promise). Each wave adds
 * its row in the same commit as the union member, the renderer case,
 * and the hit case.
 */
interface KindSpec {
  /** Anchor objects the drawing owns (horizontal has none — price only). */
  anchors: 0 | 1 | 2 | 3;
  /** Pointer presses to complete a hand drawing. */
  clicks: 1 | 2 | 3;
  /** Which axes snapping locks while drawing/dragging an anchor. */
  snapAxes: "x" | "y" | "xy";
  /** A round-trip sample — exercises every field the kind owns. */
  sample: Drawing;
}

const TABLE: Record<Drawing["type"], KindSpec> = {
  horizontal: {
    anchors: 0,
    clicks: 1,
    snapAxes: "y",
    sample: { type: "horizontal", id: "h", price: 105, style: { color: "#f00" } },
  },
  vertical: {
    anchors: 0,
    clicks: 1,
    snapAxes: "x",
    sample: { type: "vertical", id: "v", x: 42, style: { width: 2 } },
  },
  ray: {
    anchors: 2,
    clicks: 2,
    snapAxes: "xy",
    sample: { type: "ray", id: "r", a: { x: 1, price: 100 }, b: { x: 5, price: 120 } },
  },
  extended: {
    anchors: 2,
    clicks: 2,
    snapAxes: "xy",
    sample: { type: "extended", id: "e", a: { x: 1, price: 100 }, b: { x: 5, price: 120 } },
  },
  arrow: {
    anchors: 2,
    clicks: 2,
    snapAxes: "xy",
    sample: { type: "arrow", id: "w", a: { x: 1, price: 100 }, b: { x: 5, price: 120 } },
  },
  trend: {
    anchors: 2,
    clicks: 2,
    snapAxes: "xy",
    sample: {
      type: "trend",
      id: "t",
      a: { x: 1, price: 100 },
      b: { x: 9, price: 130 },
      style: { width: 2, dashArray: "4,4" },
    },
  },
  fib: {
    anchors: 2,
    clicks: 2,
    snapAxes: "xy",
    sample: {
      type: "fib",
      id: "f",
      a: { x: 1, price: 90 },
      b: { x: 7, price: 140 },
      levels: [0, 0.5, 1, 1.618],
    },
  },
};

describe("the kind table", () => {
  it("matches DRAWING_KINDS exactly — both directions", () => {
    expect([...Object.keys(TABLE)].sort()).toEqual([...DRAWING_KINDS].sort());
  });

  const rows = Object.entries(TABLE);

  it.each(rows)("%s: the sample round-trips with every owned field", (_kind, spec) => {
    expect(parseDrawings(serializeDrawings([spec.sample]))).toEqual([
      spec.sample,
    ]);
  });

  it.each(rows)("%s: the predicate accepts the sample", (_kind, spec) => {
    expect(isDrawing(spec.sample)).toBe(true);
  });

  it("the predicate rejects a kind outside the table", () => {
    expect(isDrawing({ type: "mystery", id: "m", price: 1 })).toBe(false);
  });
});
