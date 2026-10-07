/**
 * The decoration list's stacking order (z), and how a walk behaves when
 * the list changes under it. Everything draws onto a single canvas, so a
 * drawing test can't tell which entry landed where — the list itself has
 * to be checked directly.
 */
import { describe, expect, it } from "vitest";
import {
  ABOVE_SERIES,
  addDecoration,
  BELOW_SERIES,
  type DecorationList,
  emptyDecorations,
  forEachAboveSeries,
  forEachBelowSeries,
  SERIES_Z,
} from "../decoration";

/**
 * This file checks the list's arithmetic — not what a decoration is, but
 * whether the z ordering is correct. Since addDecoration requires a draw,
 * a real-shaped decoration with a name tag is used — if a fixture only
 * guesses at the contract, what it upholds can diverge from what actually runs.
 */
interface Named {
  name: string;
  draw(): void;
}
const named = (name: string): Named => ({ name, draw() {} });

/** The names in the list, in order. */
const order = (list: DecorationList<Named>) =>
  list.map((entry) => entry.decoration.name);

describe("addDecoration", () => {
  it("should keep the list sorted by z as it grows", () => {
    const list = emptyDecorations<Named>();

    addDecoration(list, named("mid"), { zIndex: 0 });
    addDecoration(list, named("high"), { zIndex: 100 });
    addDecoration(list, named("low"), { zIndex: -100 });

    expect(order(list)).toEqual(["low", "mid", "high"]);
  });

  it("should put equal z in registration order", () => {
    const list = emptyDecorations<Named>();

    addDecoration(list, named("a"), { zIndex: 5 });
    addDecoration(list, named("b"), { zIndex: 5 });
    addDecoration(list, named("c"), { zIndex: 5 });

    expect(order(list)).toEqual(["a", "b", "c"]);
  });

  it("should insert after equals, not before", () => {
    const list = emptyDecorations<Named>();

    addDecoration(list, named("first"), { zIndex: 0 });
    addDecoration(list, named("after"), { zIndex: 0 });
    addDecoration(list, named("below"), { zIndex: -1 });

    expect(order(list)).toEqual(["below", "first", "after"]);
  });

  it("should default to sitting above the series", () => {
    const list = emptyDecorations<Named>();

    addDecoration(list, named("plain"));

    expect(list[0].zIndex).toBe(ABOVE_SERIES);
    expect(ABOVE_SERIES).toBeGreaterThan(SERIES_Z);
  });

  it("should remove the entry it added, leaving the rest in order", () => {
    const list = emptyDecorations<Named>();

    addDecoration(list, named("low"), { zIndex: -1 });
    const remove = addDecoration(list, named("mid"), { zIndex: 0 });
    addDecoration(list, named("high"), { zIndex: 1 });

    remove();

    expect(order(list)).toEqual(["low", "high"]);
  });

  it("should remove only its own registration when the same value is added twice", () => {
    const list = emptyDecorations<Named>();

    const removeFirst = addDecoration(list, named("same"), { zIndex: 0 });
    addDecoration(list, named("same"), { zIndex: 0 });

    removeFirst();

    // Removes the registration, not the value — with a Set, both would have vanished here.
    expect(order(list)).toEqual(["same"]);
  });
});

describe("splits relative to the series' own z", () => {
  function mixed(): DecorationList<Named> {
    const list = emptyDecorations<Named>();
    addDecoration(list, named("grid"), { zIndex: BELOW_SERIES });
    addDecoration(list, named("band"), { zIndex: -1 });
    addDecoration(list, named("at-series"), { zIndex: SERIES_Z });
    addDecoration(list, named("marker"), { zIndex: 1 });
    addDecoration(list, named("crosshair"), { zIndex: ABOVE_SERIES });
    return list;
  }

  it("should draw everything below the series first", () => {
    const seen: string[] = [];

    forEachBelowSeries(mixed(), (entry) => seen.push(entry.name));

    expect(seen).toEqual(["grid", "band"]);
  });

  it("should treat the series z itself as above", () => {
    const seen: string[] = [];

    forEachAboveSeries(mixed(), (entry) => seen.push(entry.name));

    // z === SERIES_Z counts as above the series. Putting it below would mix it in with the grid.
    expect(seen).toEqual(["at-series", "marker", "crosshair"]);
  });

  it("should visit every entry exactly once across the two halves", () => {
    const list = mixed();
    const seen: string[] = [];

    forEachBelowSeries(list, (entry) => seen.push(entry.name));
    forEachAboveSeries(list, (entry) => seen.push(entry.name));

    expect(seen).toEqual(order(list));
  });

  it("should visit nothing when the list is empty", () => {
    const seen: string[] = [];
    const list = emptyDecorations<Named>();

    forEachBelowSeries(list, (entry) => seen.push(entry.name));
    forEachAboveSeries(list, (entry) => seen.push(entry.name));

    expect(seen).toEqual([]);
  });
});

describe("a decoration that adds another while it draws", () => {
  it("defers a replacement for a removed last entry until the next walk", () => {
    for (const [each, z] of [[forEachBelowSeries, BELOW_SERIES], [forEachAboveSeries, ABOVE_SERIES]] as const) {
      const list = emptyDecorations<Named>();
      const visits: string[] = [];
      addDecoration(list, named("first"), { zIndex: z });
      const removeLast = addDecoration(list, named("last"), { zIndex: z + 2 });

      each(list, (decoration) => {
        visits.push(decoration.name);
        if (decoration.name === "first") {
          removeLast();
          addDecoration(list, named("new"), { zIndex: z + 1 });
        }
      });

      expect(visits).toEqual(["first"]);
      visits.length = 0;
      each(list, (decoration) => visits.push(decoration.name));
      expect(visits).toEqual(["first", "new"]);
    }
  });

  it("is visited once even when the new one lands before it", () => {
    for (const [each, z] of [[forEachBelowSeries, BELOW_SERIES], [forEachAboveSeries, ABOVE_SERIES]] as const) {
      const list = emptyDecorations<Named>();
      const visits: string[] = [];
      addDecoration(list, named("a"), { zIndex: z });
      let added = false;

      each(list, (decoration) => {
        visits.push(decoration.name);
        if (!added) {
          added = true;
          addDecoration(list, named("lower"), { zIndex: z - 1 });
        }
      });

      expect(visits).toEqual(["a"]);
    }
  });
});

describe("a decoration that removes itself and adds a lower one while it draws", () => {
  it("does not draw the entry before it again", () => {
    for (const [each, z] of [[forEachBelowSeries, BELOW_SERIES], [forEachAboveSeries, ABOVE_SERIES]] as const) {
      const list = emptyDecorations<Named>();
      const visits: string[] = [];
      addDecoration(list, named("a"), { zIndex: z });
      const removeB = addDecoration(list, named("b"), { zIndex: z + 1 });
      addDecoration(list, named("c"), { zIndex: z + 2 });

      each(list, (decoration) => {
        visits.push(decoration.name);
        if (decoration.name === "b") {
          removeB();
          addDecoration(list, named("lower"), { zIndex: z - 1 });
        }
      });

      expect(visits).toEqual(["a", "b", "c"]);
    }
  });
});
