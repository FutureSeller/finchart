/**
 * The conditions under which a value crosses a boundary. What this file is
 * about is not "this is blocked right now" but "a new door does not just
 * open on its own." Inventing a check per door lets the same flaw leak
 * separately in multiple places, and the moment someone summarizes it as
 * "this file guards finiteness," the other half becomes invisible.
 *
 * `@finchart/tools` and `@finchart/dom` guard their own boundaries inside
 * their own packages — if the core imported those packages, the dependency
 * direction would invert.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rejectingFont as sharedRejectingFont } from "./dom-fakes";
import * as publicApi from "../index";
import { ContractError } from "../primitives";
import type { LinearScale, LogScale, Scale } from "../scale";
import { EXEMPT, GUARDED, SHAPE_EXEMPT, SHAPE_GUARDED } from "./exemptions";

/**
 * JSON cannot carry an `Infinity` literal. The path it arrives by from the
 * outside is an overflowing exponent —
 * `JSON.parse('{"v":1e999}').v === Infinity`.
 */
const HOSTILE_NUMBERS: readonly (readonly [string, number])[] = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["JSON 1e999", JSON.parse('{"v":1e999}').v],
  ["JSON -1e999", JSON.parse('{"v":-1e999}').v],
];

/**
 * A value shaped wrong. `HOSTILE_NUMBERS` is entirely `number`, but that
 * only holds when a TypeScript consumer has kept the type — a `.d.ts` is
 * advice, not enforcement, and a failed `fetch` hands back `undefined`. A
 * real measurement found 47 of 101 public functions threw a raw
 * `TypeError` (outside the error set the docs promise, and leaking
 * internal variable names).
 */
const HOSTILE_SHAPES: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["undefined", undefined],
  ["string", "x"],
  ["number", 1],
  ["empty object", {}],
];

/** An empty array is not here — it is a legitimate value (a series with no data yet, a pane with no markers). */

/** Is it within the contract vocabulary? A raw `TypeError` is not. */
function isContractual(error: unknown): boolean {
  return (
    error instanceof publicApi.ContractError ||
    error instanceof publicApi.DataError ||
    error instanceof publicApi.RenderError
  );
}

// Chokepoint 1 — the Scale implementations. The list is not hand-written.

type AnyScale = LinearScale | LogScale;

/** Finds anything shaped like a scale on the public surface — hardcoding the list would let a new scale slip through silently. */
function scaleConstructors(): [string, new () => AnyScale][] {
  const found: [string, new () => AnyScale][] = [];
  for (const [name, value] of Object.entries(publicApi)) {
    if (typeof value !== "function") continue;
    const proto: unknown = (value as { prototype?: unknown }).prototype;
    if (typeof proto !== "object" || proto === null) continue;
    if (!("setDomain" in proto) || !("setRange" in proto)) continue;
    found.push([name, value as new () => AnyScale]);
  }
  return found;
}

describe("chokepoint 1 — Scale does not hold a non-finite domain", () => {
  const scales = scaleConstructors();

  it("should discover every scale on the public surface", () => {
    // If this is 0, the describe below silently guards nothing.
    expect(scales.map(([name]) => name).sort()).toEqual([
      "LinearScale",
      "LogScale",
    ]);
  });

  describe.each(scales)("%s", (_name, Scale) => {
    it.each(HOSTILE_NUMBERS)("should reject %s as a domain end", (_l, bad) => {
      expect(() => new Scale().setDomain(bad, 100)).toThrow(ContractError);
      expect(() => new Scale().setDomain(1, bad)).toThrow(ContractError);
    });

    it.each(HOSTILE_NUMBERS)("should reject %s as a range end", (_l, bad) => {
      expect(() => new Scale().setRange(bad, 100)).toThrow(ContractError);
      expect(() => new Scale().setRange(1, bad)).toThrow(ContractError);
    });

    /** `-Infinity < Infinity` passes a `min >= max` check — looking at each end separately cannot catch it. */
    it("should reject the infinite span an ordering check lets through", () => {
      expect(() => new Scale().setDomain(-Infinity, Infinity)).toThrow(
        ContractError,
      );
    });
  });
});

// Chokepoint 1b — tick geometry conformance. Also not hand-written: any
// scale on the public surface that supplies `tickGeometry` gets held to
// the TickGeometry contract (ascending, finite, spaced, capped) — its
// output goes to the draw path without passing the linear axis's own
// defenses, so this suite is the only door.

describe("chokepoint 1b — tickGeometry honors the TickGeometry contract", () => {
  const geometric = scaleConstructors().filter(
    ([, Scale]) => "tickGeometry" in Scale.prototype,
  );

  it("should discover every geometry-bearing scale on the public surface", () => {
    // If this is 0, the describe below silently guards nothing.
    expect(geometric.map(([name]) => name)).toEqual(["LogScale"]);
  });

  const WINDOWS: readonly (readonly [number, number])[] = [
    [0.5011, 1995.3],
    [1, 1.0001],
    [Number.MIN_VALUE, 1],
    [1, Number.MAX_VALUE],
    [1e-300, 1e300],
  ];

  describe.each(geometric)("%s", (_name, Scale) => {
    it.each(WINDOWS)("conforms on [%f, %f]", (min, max) => {
      // Typed as the contract, not the union — `tickGeometry` is the
      // contract's optional member, and that's what's under test.
      const scale: Scale = new Scale();
      scale.setDomain(min, max);
      scale.setRange(572, 8); // [bottom, top] — the default reversed y range
      const geometry = scale.tickGeometry?.(40);
      expect(geometry).toBeDefined();
      if (geometry === undefined) return;

      const values = geometry.values();
      expect(values.length).toBeLessThanOrEqual(1000);
      for (let i = 0; i < values.length; i++) {
        expect(Number.isFinite(values[i])).toBe(true);
        if (i > 0) {
          expect(values[i]).toBeGreaterThan(values[i - 1]);
          const gap = Math.abs(
            scale.scale(values[i]) - scale.scale(values[i - 1]),
          );
          expect(gap).toBeGreaterThanOrEqual(40 - 1e-9);
        }
      }

      // stepAt answers positive-finite for hostile inputs too — badges
      // hand it whatever a legend row or priceLine holds.
      for (const [, bad] of HOSTILE_NUMBERS) {
        const step = geometry.stepAt(bad);
        expect(Number.isFinite(step)).toBe(true);
        expect(step).toBeGreaterThan(0);
      }
    });

    it.each(HOSTILE_NUMBERS)("should reject %s as minTickSpacing", (_l, bad) => {
      const scale: Scale = new Scale();
      scale.setDomain(1, 100);
      scale.setRange(572, 8);
      expect(() => scale.tickGeometry?.(bad)).toThrow(ContractError);
    });
  });
});

// Self-completeness — **the sixth door gets caught automatically**





// Chokepoints 2 and 6

/**
 * Two series on one stage — it has to be two to see whether damage spreads
 * to another pane. Because `barIndexX` builds the global index from the
 * union of every series's x values, one series's bad x can wipe out an
 * otherwise fine series on a different pane too.
 */
function twoSeriesStage() {
  const model = publicApi.createPlotModel({
    size: { width: 800, height: 600 },
    deps: { createXMapping: publicApi.barIndexX },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const main = model.plot.mainPane.addSeries({
    series: publicApi.candleSeries(),
    data: Array.from({ length: 10 }, (_, i) => ({
      x: i,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    })),
  });
  model.plot.addPane({ flex: 1 }).addSeries({
    series: publicApi.lineSeries(),
    data: Array.from({ length: 10 }, (_, i) => ({ x: i, y: i })),
  });
  const drawn = () => model.commands().length;
  return { model, main, drawn };
}

/** A single line series — where the contract that `null` in a value means a gap is measured. */
function lineStage() {
  const model = publicApi.createPlotModel({
    size: { width: 800, height: 600 },
    config: { showGrid: false },
  });
  return model.plot.mainPane.addSeries({
    series: publicApi.lineSeries(),
    data: [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ],
  });
}

describe("chokepoint 6 — the live path passes through the data door too", () => {
  /**
   * `updateLast` used to have its own separate ordering check — both
   * `newX > lastX` and `newX < lastX` are false on `NaN`, so a bad tick
   * fell silently into the replace path. The manager's `replaceLast` also
   * only checked `x < previousX`, so both layers were wide open.
   */
  it.each(HOSTILE_NUMBERS)("should reject %s as an updateLast x", (_l, bad) => {
    const { main } = twoSeriesStage();
    expect(() =>
      main.updateLast({ x: bad, open: 1, high: 2, low: 0, close: 1 }),
    ).toThrow(publicApi.DataError);
  });

  it("should keep every pane drawn when a bad tick is rejected", () => {
    const { main, drawn } = twoSeriesStage();
    const before = drawn();

    expect(() =>
      main.updateLast({ x: NaN, open: 1, high: 2, low: 0, close: 1 }),
    ).toThrow();

    // This matters more than the throw itself for this test — this used
    // to not throw at all, and a series on a different pane vanished
    // along with it.
    expect(drawn()).toBe(before);
  });

  it("should still accept a well-formed tick", () => {
    const { main, drawn } = twoSeriesStage();
    const before = drawn();
    main.updateLast({ x: 9, open: 10, high: 20, low: 5, close: 19 });
    expect(drawn()).toBe(before);
    expect(main.read().at(-1)).toEqual({
      x: 9,
      open: 10,
      high: 20,
      low: 5,
      close: 19,
    });
  });
});

/**
 * Counts every `number` field on the options types straight from their
 * declarations — a hand-written list tends to only list what a review
 * happened to report as a symptom, not what the type actually contains.
 * The same idiom as `module-boundaries.test.ts` walking the directory
 * tree.
 */
/** Doors actually verified with hostile values. The three `describe.each` blocks below run through this. */
const GUARDED_DOORS = new Set([
  "paneGap",
  "rightOffset",
  "minBarSpacing",
  "maxBarSpacing",
  "axis.x.size",
  "axis.y.size",
  "axis.minTickSpacing",
  "axis.x.minTickSpacing",
  "axis.y.minTickSpacing",
  "pane.flex",
  "pane.minHeight",
  "pane.valuePadding",
]);

/**
 * Exemptions. A reason is mandatory — the same discipline as `EXEMPT`.
 * `padding` is a `Padding` type, so it does not get caught as a `number`
 * field, but the `it.each` below bites all four sides directly.
 */
const EXEMPT_DOORS: Record<string, string> = {
  // canvas ignores a non-finite lineWidth per spec — no amplifier.
  // If the render target ever grows beyond canvas (SVG, native), this
  // reason stops holding.
  "style.grid.width": "canvas ignores a non-finite lineWidth — no amplifier",
};

function declaredNumberFields(source: string, name: string): string[] {
  // Some declarations (XAxisOptions) carry an `extends`, so the regex
  // reaches all the way to the opening brace. Looking for this spot by
  // name alone once came back empty-handed, and the throw below is what
  // caught it.
  const declaration = new RegExp(`export interface ${name}\\b[^{]*\\{`);
  const found = declaration.exec(source);
  if (!found) throw new Error(`could not find the ${name} declaration — this check comes back empty`);
  let depth = 0;
  let i = found.index + found[0].length - 1;
  const start = i;
  do {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  } while (depth > 0);
  return [...source.slice(start, i).matchAll(/^ {2}(\w+)\??:\s*number\b/gm)].map(
    (match) => match[1],
  );
}

describe("chokepoint 2 — Plot options' numeric doors", () => {
  const NUMERIC_DOORS = [
    "paneGap",
    "rightOffset",
    "minBarSpacing",
    "maxBarSpacing",
  ] as const;

  /** Checks not that every door has a check, but that every declared numeric field appears in one of the lists below. */
  it("should account for every declared numeric option", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const types = readFileSync(resolve(dir, "../plot/types.ts"), "utf8");
    const paneSource = readFileSync(resolve(dir, "../plot/pane-options.ts"), "utf8");

    const declared = [
      ...declaredNumberFields(types, "PlotOptionsPatch"),
      ...declaredNumberFields(types, "AxisOptions").map((f) => `axis.${f}`),
      ...declaredNumberFields(types, "XAxisOptions").map((f) => `axis.x.${f}`),
      ...declaredNumberFields(types, "YAxisOptions").map((f) => `axis.y.${f}`),
      ...declaredNumberFields(paneSource, "PaneOptions").map((f) => `pane.${f}`),
    ];

    // If this is 0, the parser above silently came back empty.
    expect(declared.length).toBeGreaterThan(8);

    const unaccounted = declared.filter(
      (field) => !GUARDED_DOORS.has(field) && !(field in EXEMPT_DOORS),
    );
    expect(unaccounted).toEqual([]);
  });

  /**
   * The pair is a door too — each field alone can be fine while the
   * combination locks zooming (a floor above the ceiling). The merged
   * config is what has to hold, so a patch that crosses the standing
   * value must be refused, and refused **whole**: a half-landed patch
   * would leave the config in the state the check exists to prevent.
   */
  it("should refuse a patch whose min crosses the standing max, whole", () => {
    const { model } = twoSeriesStage();
    model.plot.applyOptions({ maxBarSpacing: 50 });
    expect(() => model.plot.applyOptions({ minBarSpacing: 100 })).toThrow(
      ContractError,
    );
    expect(model.plot.getOptions().minBarSpacing).toBeUndefined();
    expect(model.plot.getOptions().maxBarSpacing).toBe(50);
  });

  describe.each(NUMERIC_DOORS)("%s", (field) => {
    it.each(HOSTILE_NUMBERS)("should reject %s", (_l, bad) => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.applyOptions({ [field]: bad })).toThrow(
        ContractError,
      );
    });
  });

  /**
   * `axis.y.size = Infinity` can drive the command count to 0 without
   * throwing — the chart goes permanently blank while the console stays
   * silent. The path that reaches it is `@finchart/react`'s
   * `<YAxis size={n} />`, a documented prop.
   */
  describe.each(["x", "y"] as const)("axis.%s", (side) => {
    it.each(HOSTILE_NUMBERS)("should reject %s as a size", (_l, bad) => {
      const { model } = twoSeriesStage();
      expect(() =>
        model.plot.applyOptions({ axis: { [side]: { size: bad } } }),
      ).toThrow(ContractError);
    });

    it.each(HOSTILE_NUMBERS)(
      "should reject %s as a minTickSpacing",
      (_l, bad) => {
        const { model } = twoSeriesStage();
        expect(() =>
          model.plot.applyOptions({ axis: { [side]: { minTickSpacing: bad } } }),
        ).toThrow(ContractError);
      },
    );
  });

  it("should keep every pane drawn when a bad axis size is rejected", () => {
    const { model, drawn } = twoSeriesStage();
    const before = drawn();
    expect(() =>
      model.plot.applyOptions({ axis: { y: { size: Infinity } } }),
    ).toThrow();
    // This matters more than the throw itself — this used to pass through and the command count went to 0.
    expect(drawn()).toBe(before);
  });

  it("should reject a non-finite minTickSpacing on a pane", () => {
    const { model } = twoSeriesStage();
    expect(() =>
      model.plot.mainPane.applyOptions({ axis: { minTickSpacing: NaN } }),
    ).toThrow(ContractError);
  });

  it.each(["top", "right", "bottom", "left"] as const)(
    "should reject a non-finite padding %s",
    (side) => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.applyOptions({ padding: { [side]: NaN } })).toThrow(
        ContractError,
      );
    },
  );

  /**
   * `rightOffset` is the textbook case of a delayed amplifier. If it
   * passes through, it sits in the config until the next refit, where it
   * becomes a domain value, and that is when the scale throws — a
   * consumer has no way to know that a slider in a settings panel is what
   * killed their data load.
   */
  it("should fail at the option door, not later at the scale", () => {
    const { model } = twoSeriesStage();
    let thrown: Error | null = null;
    try {
      model.plot.applyOptions({ rightOffset: NaN });
    } catch (error) {
      thrown = error instanceof Error ? error : null;
    }
    expect(thrown?.message).toContain("rightOffset");
    expect(thrown?.message).not.toContain("domain");
  });

  /**
   * `min`/`maxBarSpacing` might not even blow up — `x-viewport.ts` does
   * `minBarSpacing ? …`, so `NaN` gets swallowed as falsy and becomes "no
   * limit." This is where a consumer never finds out why the zoom limit
   * they set is not taking effect.
   */
  it("should keep an honest bar spacing limit", () => {
    const { model } = twoSeriesStage();
    model.plot.applyOptions({ minBarSpacing: 2 });
    expect(model.plot.getOptions().minBarSpacing).toBe(2);
    expect(() => model.plot.applyOptions({ minBarSpacing: NaN })).toThrow();
    // The rejected value did not overwrite the setting.
    expect(model.plot.getOptions().minBarSpacing).toBe(2);
  });
});

// Chokepoint 7 — assembly's trimming budget

describe("chokepoint 7 — createPlotDeps's trimming budget", () => {
  /**
   * This export's exemption reason used to be "assembly — takes a
   * collaborator" — a sentence that only counted the collaborator and
   * never counted the two numbers. With `maxPoints: -1` and
   * `pointsPerPixel: 0`, the budget drops to zero or below, and a
   * 500-point series's line command never comes out at all. It does not
   * throw either.
   */
  const required = {
    createLayers: () => ({ base: null, overlay: null }) as never,
    createRenderer: () => ({}) as never,
    createStyleReader: () => (() => "") as never,
  };

  describe.each(["maxPoints", "pointsPerPixel"] as const)("%s", (field) => {
    it.each(HOSTILE_NUMBERS)("should reject %s", (_l, bad) => {
      expect(() =>
        publicApi.createPlotDeps({ ...required, [field]: bad }),
      ).toThrow(ContractError);
    });

    /** 0 does not mean "no limit" — it becomes "draw nothing." */
    it("should reject zero", () => {
      expect(() =>
        publicApi.createPlotDeps({ ...required, [field]: 0 }),
      ).toThrow(ContractError);
    });

    it("should reject a negative budget", () => {
      expect(() =>
        publicApi.createPlotDeps({ ...required, [field]: -1 }),
      ).toThrow(ContractError);
    });
  });

  it("should accept a positive budget", () => {
    expect(() =>
      publicApi.createPlotDeps({
        ...required,
        maxPoints: 1000,
        pointsPerPixel: 2,
      }),
    ).not.toThrow();
  });
});

// Z1 — self-completeness on the shape axis. A consumer might not use TS.

/**
 * A blocking door where that one shape is nonetheless a legitimate input.
 * This is a list, not a reason — naming the shapes to let through makes
 * "this door blocks nothing" and "this door blocks three of five" show up
 * differently in the table.
 *
 * The six series factories take an optional argument: `lineSeries()` is a
 * normal call, and `lineSeries({})` means "nothing to override." The other
 * three (null, string, number) are blocked.
 */
const LEGITIMATE: Record<string, readonly string[]> = {
  lineSeries: ["undefined", "empty object"],
  stepLineSeries: ["undefined", "empty object"],
  areaSeries: ["undefined", "empty object"],
  barSeries: ["undefined", "empty object"],
  baselineSeries: ["undefined", "empty object"],
  candleSeries: ["undefined", "empty object"],
  histogramSeries: ["undefined", "empty object"],
  // `priceFormat()` gives the default format, and `priceFormat({})` gives
  // the same thing — all four options are optional.
  priceFormat: ["undefined", "empty object"],
};



describe("Z1 — the shape axis", () => {
  it("should classify every public runtime export", () => {
    const unclassified = Object.keys(publicApi)
      .filter((name) => !(name in SHAPE_GUARDED) && !(name in SHAPE_EXEMPT))
      .sort();

    // Failing here means a new name landed on the public surface. Separately
    // from the numeric axis, it needs to answer "what if a value shaped
    // wrong comes in?"
    expect(unclassified).toEqual([]);
  });

  /**
   * Moves the ban on the `〃` ("ditto") mark into a machine check — writing
   * `〃` in an exemption reason means the regex cannot read that line, so
   * it drops out of what gets checked. `styleVars` and `cssVarExpr`
   * inherited "does not throw, demotes to the fallback" via `〃`, and both
   * of them actually threw a raw `TypeError` at one point. Instead of
   * writing the rule in a comment, it is enforced here.
   */
  it("should not let any verdict lean on a ditto mark", () => {
    const dittos = [
      ...Object.entries(GUARDED),
      ...Object.entries(SHAPE_GUARDED),
      ...Object.entries(EXEMPT).map(
        ([name, exemption]) => [name, exemption.note] as const,
      ),
      ...Object.entries(SHAPE_EXEMPT).map(
        ([name, exemption]) => [name, exemption.note] as const,
      ),
    ]
      .filter(([, reason]) => reason.includes("〃"))
      .map(([name]) => name);

    expect(dittos).toEqual([]);
  });

  it("should give every shape exemption a reason", () => {
    const blank = Object.entries(SHAPE_EXEMPT)
      .filter(([, exemption]) => exemption.note.trim().length === 0)
      .map(([name]) => name);
    expect(blank).toEqual([]);
  });

  /**
   * A blocking door has to block with contract vocabulary — a raw
   * `TypeError` is outside the error set the docs define, and its message
   * leaks internal variable names. This is derived from the table — a
   * hand-written door list gets the classification right but the value it
   * actually feeds only lands in a field (`{ size: bad }`), so a spot like
   * `createPlotModel(null)` goes uncaught while still raising a raw
   * `TypeError`.
   */
  describe.each(Object.keys(SHAPE_GUARDED))("%s", (name) => {
    it.each(HOSTILE_SHAPES)("should refuse %s as its argument", (label, bad) => {
      const door = (publicApi as Record<string, unknown>)[name];
      if (typeof door !== "function") return;
      if (LEGITIMATE[name]?.includes(label)) return;

      let thrown: unknown;
      try {
        // A class with new, a function as-is — the argument itself is fed in.
        if (/^[A-Z]/.test(name)) {
          new (door as new (arg: unknown) => unknown)(bad);
        } else {
          (door as (arg: unknown) => unknown)(bad);
        }
      } catch (error) {
        thrown = error;
      }
      expect(isContractual(thrown)).toBe(true);
    });
  });

    /**
   * Keeps the exemption list from silently growing. To land a name in
   * `LEGITIMATE`, that name must actually be a blocking door
   * (`SHAPE_GUARDED`), and the shape being let through must actually be on
   * the hostile list. A lock against a single typo throwing a door wide
   * open.
   */
  it("should keep every legitimate shape anchored to a real door", () => {
    const hostile = HOSTILE_SHAPES.map(([label]) => label);
    const dangling = Object.entries(LEGITIMATE).flatMap(([name, shapes]) =>
      name in SHAPE_GUARDED
        ? shapes.filter((s) => !hostile.includes(s)).map((s) => `${name}:${s}`)
        : [`${name}: is not a blocking door`],
    );
    expect(dangling).toEqual([]);
  });

  /**
   * Actually measures the property an exemption reason claims. A fixing
   * hand introduced a new sibling, and that same hand recorded, to the
   * machine, that the sibling did not exist — in the same commit that
   * added leniency to `applyFont` by unconditionally calling `font.trim()`
   * and turned `undefined` into a crash, that function's exemption reason
   * was written as "demotes without throwing no matter what comes in."
   *
   * The existing machinery only counts whether a reason exists. Nobody
   * counted whether the reason was true — this moves from "is there a
   * reason" to "does it do what the reason says." The rule: if an
   * exemption reason says "does not throw" or "demotes," that name must
   * really not throw even when fed a hostile value.
   *
   * A machine cannot read `〃` — shortening a reason to `〃` drops it out
   * of the promise list entirely, so a regression can live on while
   * staying green. The words the check keys on are spelled out in full.
   */
  describe("is the exemption reason true — if it says it does not throw, it must not throw", () => {
    /**
     * Back when reason sentences were matched with a regex, even a
     * slightly different word (`priceFormat` writing "the result shows up
     * on the label immediately" while actually throwing) created a blind
     * spot. Now the promise is not a word in prose but a `tag: "safe"`
     * field — spell it however you like, tagging it is what makes this
     * probe bite.
     */

    /**
     * The promise is per-argument. What `applyColor` promised to demote is
     * `color`, not `context` — if context is `null`, the renderer is
     * broken, and that is not where a consumer value arrives. So when a
     * reason says "does not throw," it also has to say which argument.
     */
    /**
     * A rejecting fake. Handing it a plain object would let the setter
     * accept anything as-is, so the guard returns early without ever
     * reaching the demotion branch — the whole check becomes free. Only
     * accepting a value shaped like the real canvas makes the demotion
     * branch reachable.
     */
    // The check keeps exactly one copy of the fixture, from `dom-fakes`.
    const rejectingFont = () => sharedRejectingFont("11px sans-serif");
    const rejectingColor = () => {
      let fillStyle = "#000000";
      return {
        get fillStyle(): string {
          return fillStyle;
        },
        set fillStyle(next: string) {
          if (typeof next === "string" && /^(#|rgba?\()/.test(next.trim())) {
            fillStyle = next;
          }
        },
        strokeStyle: "#000000",
      };
    };

    const SAFE_ARG: Record<string, { index: number; rest: () => unknown[] }> = {
      // Two names that made the promise back in the regex days but sat outside the probe.
      isGap: { index: 0, rest: () => [] },
      validateSeriesData: { index: 0, rest: () => [] },
      validateSeriesPoint: { index: 0, rest: () => [] },
      tailDelta: { index: 0, rest: () => [[]] },
      reuseUnchanged: { index: 1, rest: () => [{ out: [] }] },
      applyColor: { index: 2, rest: () => [rejectingColor(), "fillStyle"] },
      applyFont: { index: 1, rest: () => [rejectingFont(), undefined, "11px sans-serif"] },
      isLinearGradientParams: { index: 0, rest: () => [undefined] },
      slotWidth: { index: 0, rest: () => [undefined, 10] },
      resolveStyle: {
        index: 2,
        rest: () => [
          { color: { css: "--c", fallback: "#000000" }, w: { css: "--w", fallback: 2 } },
          () => "",
          undefined,
        ],
      },
    };

    const promised = Object.entries(SHAPE_EXEMPT)
      .filter(([, exemption]) => exemption.tag === "safe")
      .map(([name]) => name);

    it("should have someone making that promise", () => {
      // If the regex catches nothing, everything below passes for free (the same idiom as style-vars).
      expect(promised.length).toBeGreaterThan(0);
    });

    it("should make every safety promise name its argument", () => {
      expect(promised.filter((name) => !(name in SAFE_ARG))).toEqual([]);
    });

    describe.each(promised)("%s", (name) => {
      it.each(HOSTILE_SHAPES)("should not throw on %s", (_label, bad) => {
        const door = (publicApi as Record<string, unknown>)[name];
        const spot = SAFE_ARG[name];
        if (typeof door !== "function" || spot === undefined) return;

        const args = spot.rest();
        args[spot.index] = bad;
        expect(() =>
          (door as (...rest: unknown[]) => unknown)(...args),
        ).not.toThrow();
      });
    });
  });

  /**
   * Measures the override door itself. If `coerceLeaf` only tames numeric
   * leaves and passes a string leaf through with a single `as string`,
   * then `dashArray: [4,4]` and `font: 12` reach all the way to the
   * renderer, where an uncaught `TypeError` punches through rAF. Where a
   * consumer's value gets there from:
   * `lineSeries({ line: { dashArray: [4,4] } })` — the array is not a typo,
   * it is the shape of the canvas API itself.
   */
  describe("the override door — tames both kinds of leaf", () => {
    const spec = {
      ratio: { css: "--r", fallback: 0.6, range: [0, 1] },
      width: { css: "--w", fallback: 2 },
      color: { css: "--c", fallback: "#000000" },
      dashArray: { css: "--d", fallback: "4,3" },
    };
    const read = () => "";

    it.each(HOSTILE_SHAPES)("should not throw on %s in any leaf", (_l, bad) => {
      for (const key of ["ratio", "width", "color", "dashArray"]) {
        expect(() =>
          publicApi.resolveStyle(spec as never, read, { [key]: bad } as never),
        ).not.toThrow();
      }
    });

    it("should fall back rather than pass a non-string to a string leaf", () => {
      const out = publicApi.resolveStyle(spec as never, read, {
        dashArray: [4, 4],
        color: 42,
      } as never);
      expect(out).toMatchObject({ dashArray: "4,3", color: "#000000" });
    });

    it("should clamp and coerce numeric leaves at the same door", () => {
      expect(
        publicApi.resolveStyle(spec as never, read, { ratio: 3 } as never),
      ).toMatchObject({ ratio: 1 });
      expect(
        publicApi.resolveStyle(spec as never, read, { ratio: "60%" } as never),
      ).toMatchObject({ ratio: 0.6 });
    });
  });

  /**
   * Method doors — a blind spot on the name axis. `SHAPE_GUARDED` counts
   * `Object.keys(publicApi)`, that is, export names. So a method on the
   * object a factory returns never gets caught by the census in the first
   * place, and a single `Plot` line has to stand in for all of it.
   *
   * The worst of these was `addDecoration`. A decoration is an object a
   * third-party author builds by hand, and other libraries name that hook
   * differently (`renderer`, `createPointFigures`) — get the name wrong
   * and it succeeds silently, then blows up inside rAF and kills the chart
   * permanently. Every frame, pan, and zoom throws the same exception, and
   * the stack never points at the call site. This is where a handful of
   * those doors get caught outside the name axis.
   */
  describe("method doors — spots outside the census", () => {
    const HOSTILE = HOSTILE_SHAPES.map(([label, value]) => [label, value] as const);
    type PlotLike = ReturnType<typeof twoSeriesStage>["model"]["plot"];

    it.each(HOSTILE)("pane.addDecoration(%s)", (_label, bad) => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.mainPane.addDecoration(bad as never)).toThrow(
        publicApi.ContractError,
      );
    });

    it.each(HOSTILE)("plot.addDecoration(%s)", (_label, bad) => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.addDecoration(bad as never)).toThrow(
        publicApi.ContractError,
      );
    });

    /**
     * A hook named wrong — the single most common mistake a hand coming
     * from another library makes. This used to pass through silently and
     * die on the next frame.
     */
    it("should refuse a decoration whose hook is named for another library", () => {
      const { model } = twoSeriesStage();
      for (const shape of [{ renderer() {} }, { createPointFigures() {} }, {}]) {
        expect(() => model.plot.addDecoration(shape as never)).toThrow(
          publicApi.ContractError,
        );
      }
    });

    /**
     * `zIndex: NaN` can land in the same spot as `BELOW_SERIES`, because
     * the `>` comparison in the insertion loop is false across the board
     * on NaN — a price line ends up hiding behind the candles while the
     * console stays silent.
     */
    it.each(HOSTILE_NUMBERS)("addDecoration(d, { zIndex: %s })", (_l, bad) => {
      const { model } = twoSeriesStage();
      expect(() =>
        model.plot.addDecoration(publicApi.watermark({ text: "x" }), {
          zIndex: bad,
        }),
      ).toThrow(publicApi.ContractError);
    });

    /**
     * The decimation budget at the registration layer. The wiring layer
     * (`presets`) got a guard, but the registration layer
     * (`decimation: { pointsPerPixel }`) can bypass that door — at a
     * budget of 0, that series's line disappears without a sound.
     */
    it.each(HOSTILE_NUMBERS)(
      "addSeries(decimation.pointsPerPixel: %s)",
      (_label, bad) => {
        const { model } = twoSeriesStage();
        expect(() =>
          model.plot.mainPane.addSeries({
            series: publicApi.lineSeries(),
            data: [{ x: 0, y: 1 }],
            decimation: { pointsPerPixel: bad },
          }),
        ).toThrow(publicApi.ContractError);
      },
    );

    /** 0 does not mean anything either — a budget of 0 is a mistake, not "draw nothing." */
    it("addSeries(decimation.pointsPerPixel: 0)", () => {
      const { model } = twoSeriesStage();
      expect(() =>
        model.plot.mainPane.addSeries({
          series: publicApi.lineSeries(),
          data: [{ x: 0, y: 1 }],
          decimation: { pointsPerPixel: 0 },
        }),
      ).toThrow(publicApi.ContractError);
    });

    /**
     * A raw TypeError undersells the failure even when it is
     * non-blocking — it leaks internal names and sits outside the
     * contract error set. Each door's legitimate shapes (no argument, an
     * empty options object, a null window) are excluded from the feed.
     */
    const VOCAB_DOORS: {
      door: string;
      feed: (plot: PlotLike, bad: unknown) => void;
      legit: readonly string[];
    }[] = [
      { door: "plot.applyOptions", feed: (plot, bad) => plot.applyOptions(bad as never), legit: ["empty object"] },
      { door: "plot.addPane", feed: (plot, bad) => plot.addPane(bad as never), legit: ["undefined", "empty object"] },
      { door: "plot.removePane", feed: (plot, bad) => plot.removePane(bad as never), legit: ["empty object"] },
      { door: "pane.applyOptions", feed: (plot, bad) => plot.mainPane.applyOptions(bad as never), legit: ["empty object"] },
      { door: "pane.setYScale", feed: (plot, bad) => plot.mainPane.setYScale(bad as never), legit: [] },
      { door: "pane.syncSeries", feed: (plot, bad) => plot.mainPane.syncSeries(bad as never), legit: [] },
      { door: "pane.valueExtent", feed: (plot, bad) => plot.mainPane.valueExtent(bad as never), legit: ["null", "undefined", "empty object"] },
      { door: "pane.fitValueDomain", feed: (plot, bad) => plot.mainPane.fitValueDomain(bad as never), legit: ["null", "undefined", "empty object"] },
    ];

    describe.each(VOCAB_DOORS)("$door", ({ feed, legit }) => {
      it.each(HOSTILE.filter(([label]) => !legit.includes(label)))(
        "should refuse %s with contract vocabulary",
        (_label, bad) => {
          const { model } = twoSeriesStage();
          expect(() => feed(model.plot, bad)).toThrow(publicApi.ContractError);
        },
      );
    });

    /**
     * The door names itself — `setSeries({data})`'s error message used to
     * read "addSeries…." That leads a consumer to suspect a door they
     * never called.
     */
    it("setSeries's rejection carries setSeries's own name", () => {
      const { model } = twoSeriesStage();
      expect(() =>
        model.plot.mainPane.setSeries({ data: [] } as never),
      ).toThrow(/setSeries/);
      expect(() =>
        model.plot.mainPane.setSeries({ data: [] } as never),
      ).not.toThrow(/addSeries/);
    });

    /** Control — a properly built decoration passes through. Shows that everything above is not free. */
    it("control: a properly built decoration passes through", () => {
      const { model } = twoSeriesStage();
      expect(() =>
        model.plot.addDecoration(publicApi.watermark({ text: "x" }), { zIndex: 5 }),
      ).not.toThrow();
    });

    /**
     * `use` is this library's front door — it gets called far more often
     * than `addDecoration`. The README, the docs, `@finchart/tools`, and
     * `@finchart/indicators` all pass through it.
     */
    it.each(HOSTILE)("plot.use(%s)", (_label, bad) => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.use(bad as never)).toThrow(publicApi.ContractError);
    });

    it.each(HOSTILE)("pane.use(%s)", (_label, bad) => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.mainPane.use(bad as never)).toThrow(
        publicApi.ContractError,
      );
    });

    /**
     * A missing `()` is this door's dominant failure — far more common
     * than a name typo, and the result is "the extension just does not
     * show up," so a consumer goes digging through CSS, themes, and
     * zIndex instead.
     */
    it("should name the missing call when the factory is passed uncalled", () => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.use(publicApi.crosshair as never)).toThrow(
        /use\(crosshair\(\)\)/,
      );
    });

    /** An api with no `dispose` — a spot a third-party extension author hand-building their own hits. */
    it("should refuse an extension without a lifecycle", () => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.use(() => ({}) as never)).toThrow(
        publicApi.ContractError,
      );
      // Since the install was rejected, teardown must be quiet too (a rejection leaves no state behind).
      expect(() => model.plot.destroy()).not.toThrow();
    });

    /** Control — an extension called correctly installs and tears down. */
    it("control: an extension called correctly installs and tears down", () => {
      const { model } = twoSeriesStage();
      const api = model.plot.use(publicApi.crosshair());
      expect(api.disposed).toBe(false);
      expect(() => model.plot.destroy()).not.toThrow();
    });

    /**
     * Four public paths that synthesize a coordinate — they do not pass
     * through the router, so input validation never reaches them. `null`
     * is the first value a consumer trying to clear the crosshair on
     * `pointerleave` tries, and that used to be a raw `TypeError` leaking
     * an internal field name.
     */
    it.each([
      ["crosshair", (p: PlotLike, at: unknown) => p.crosshair(at as never)],
      ["click", (p: PlotLike, at: unknown) => p.click(at as never)],
      ["doubleClick", (p: PlotLike, at: unknown) => p.doubleClick(at as never)],
      ["contextMenu", (p: PlotLike, at: unknown) => p.contextMenu(at as never)],
      [
        "claimFocusArea().contestedAt",
        (p: PlotLike, at: unknown) =>
          p.claimFocusArea(() => p.mainPane.area).contestedAt(at as never),
      ],
    ])("plot.%s(hostile coordinates)", (_door, call) => {
      const { model } = twoSeriesStage();
      for (const bad of [null, undefined, 42, { x: 1 }, { x: Number.NaN, y: 0 }]) {
        expect(() => call(model.plot, bad)).toThrow(publicApi.ContractError);
      }
    });

    /**
     * A registration with no `series` key. A hand coming from
     * lightweight-charts uses `chart.addLineSeries({ color, data })`. Our
     * door is named `addSeries`, so that habit carries straight over, and
     * if a registration object passes through pretending to be a Series,
     * it can either kill the chart permanently (`addSeries`) or silently
     * blank it forever (`setSeries` — which wipes out even a perfectly
     * fine series).
     */
    it.each([
      ["a habit from another library", { type: "line", data: [{ x: 0, y: 1 }] }],
      ["a typo'd series key", { seires: publicApi.lineSeries() }],
      ["data only", { data: [{ x: 0, y: 1 }] }],
      ["a missing factory call", publicApi.lineSeries],
    ])("addSeries(%s)", (_label, bad) => {
      const { model } = twoSeriesStage();
      expect(() => model.plot.mainPane.addSeries(bad as never)).toThrow(
        publicApi.ContractError,
      );
    });

    it("setSeries — a rejection does not wipe out the existing series", () => {
      const { model } = twoSeriesStage();
      const before = model.commands().length;

      expect(() =>
        model.plot.mainPane.setSeries({ data: [{ x: 0, y: 1 }] } as never),
      ).toThrow(publicApi.ContractError);

      model.plot.render();
      expect(model.commands().length).toBe(before);
      expect(() => model.plot.panByPixels(10)).not.toThrow();
    });

    /** Control — a fine coordinate passes through. */
    it("control: a fine coordinate passes through on all four", () => {
      const { model } = twoSeriesStage();
      const at = { x: 100, y: 100 };
      expect(() => model.plot.crosshair(at)).not.toThrow();
      expect(() => model.plot.click(at)).not.toThrow();
      expect(() => model.plot.doubleClick(at)).not.toThrow();
      expect(() => model.plot.contextMenu(at)).not.toThrow();
      const claim = model.plot.claimFocusArea(() => model.plot.mainPane.area);
      expect(typeof claim.contestedAt(at)).toBe("boolean");
      // With only myself present, there is no one to contest — it must not count itself.
      expect(claim.contestedAt(at)).toBe(false);
      claim.release();
    });
  });

  /** Also guards against the table going stale — the shape-axis counterpart of a check that exists on the numeric axis. */
  it("should not list names that left the public surface", () => {
    const known = [...Object.keys(SHAPE_GUARDED), ...Object.keys(SHAPE_EXEMPT)];
    const stale = known.filter((name) => !(name in publicApi));
    expect(stale).toEqual([]);
  });

  /**
   * What does a rejection leave behind. If all that gets asked is "does the
   * door block it," with no assertion on the state after it throws, this
   * is what survives:
   *
   * ```
   * try { handle.setData(await res.json()); }   // the exchange gives newest-first
   * catch (e) { toast(e.message); }
   * … the user pans once …
   * y domain [99, 111] -> [60430, 61270]
   * ```
   *
   * The chart draws the price axis from data it just declared it rejected
   * — a spot that is reachable even after throwing exactly the right
   * contract error, where the screen looks fine but is lying. This layer
   * derives "does the snapshot stay unchanged after a rejection" from the
   * door list and measures it.
   */
  describe("a rejection leaves nothing behind", () => {
    type PlotModelLike = ReturnType<typeof twoSeriesStage>["model"];
    type DataDoor = ReturnType<typeof lineStage>;
    type Stage = { model: PlotModelLike; main: DataDoor };

    const lineOnly = (): Stage => {
      const model = publicApi.createPlotModel({
        size: { width: 800, height: 600 },
        config: { showGrid: false },
      });
      const main = model.plot.mainPane.addSeries({
        series: publicApi.lineSeries(),
        data: Array.from({ length: 10 }, (_, i) => ({ x: i, y: 99 + i })),
      });
      model.plot.render();
      return { model, main };
    };

    /** Everything observable about the stage — if even one thing moves, the rejection leaked. */
    const snapshot = (stage: Stage) => ({
      read: JSON.stringify(stage.main.read()),
      state: JSON.stringify(stage.model.plot.getState()),
      commands: stage.model.commands().length,
    });

    /** The next frame must still be alive after a rejection — permanent death happens right here. */
    const stillDraws = (stage: Stage) => {
      expect(() => stage.model.plot.render()).not.toThrow();
      expect(() => stage.model.plot.panByPixels(10)).not.toThrow();
    };

    /** All shapes a consumer actually leaks in practice — an exchange response, a websocket tick, JSON.parse. */
    const DATA_DOORS = [
      ["setData out of order", (h: DataDoor) => h.setData([{ x: 5, y: 1 }, { x: 1, y: 2 }])],
      ["setData string y", (h: DataDoor) => h.setData([{ x: 0, y: 100 }, { x: 1, y: "110" }] as never)],
      ["setData NaN x", (h: DataDoor) => h.setData([{ x: Number.NaN, y: 1 }])],
      ["setData null point", (h: DataDoor) => h.setData([null] as never)],
      ["append backwards", (h: DataDoor) => h.append([{ x: 4, y: 1 }, { x: 4.5, y: Number.NaN }])],
      ["updateLast string", (h: DataDoor) => h.updateLast({ x: 9, y: "108" } as never)],
      ["setData non-array", (h: DataDoor) => h.setData(42 as never)],
    ] as const;

    it.each(DATA_DOORS)("%s — the ledger is unchanged after a rejection", (_door, call) => {
      const stage = lineOnly();
      const before = snapshot(stage);

      expect(() => call(stage.main)).toThrow();

      expect(snapshot(stage)).toEqual(before);
      stillDraws(stage);
    });

    /**
     * `swapSeries(candleSeries)` — a missing call. This used to swap the
     * series out already, so every subsequent frame, pan, and setData
     * raised the same raw `TypeError`.
     */
    it("swapSeries — a rejection does not swap out the representation", () => {
      const stage = lineOnly();
      const before = snapshot(stage);

      expect(() => stage.main.swapSeries(publicApi.candleSeries as never)).toThrow(
        publicApi.ContractError,
      );

      expect(snapshot(stage)).toEqual(before);
      stillDraws(stage);
    });

    /**
     * `setValueDomain(NaN, …)` can throw while permanently turning off
     * autoScale — a tick arrives and the y axis stops following it, with
     * no notification at all.
     */
    it("setValueDomain — a rejection does not turn off autoScale", () => {
      const stage = lineOnly();

      expect(() =>
        stage.model.plot.mainPane.setValueDomain(Number.NaN, 200),
      ).toThrow(publicApi.ContractError);

      // `getState()` is the observation point this digs at — the exact value an app saves and restores.
      expect(stage.model.plot.getState().panes[0].autoScale).toBe(true);
      stillDraws(stage);
    });

    /** Control — a fine value actually moves the snapshot. Everything above is not free. */
    it("control: proper data changes the ledger", () => {
      const stage = lineOnly();
      const before = snapshot(stage);
      stage.main.append([{ x: 20, y: 7 }]);
      expect(snapshot(stage)).not.toEqual(before);
    });
  });

  /**
   * Does the message report the value honestly? If `"800"` shows up as
   * `got 800`, a consumer stops at "but 800 is a finite non-negative
   * number?" and never suspects the type — the door's name is right, but
   * it steers debugging in the wrong direction.
   *
   * A string timestamp is not an edge case but a common default (Bithumb,
   * some of Upbit, `localStorage`, `URLSearchParams`). x and y can end up
   * with different honesty within the same error message:
   *
   * ```
   * setData([{x:"1620000000", y:1}])
   *   -> data x must be a finite number, but index 0 is 1620000000   <- looks like a number
   * setData([{x:0,y:1},{x:1,y:"110"}])
   *   -> data y must be … but index 1 is string "110"                <- the sibling on the same door got it right
   * ```
   *
   * Measured by actually feeding values, not scanning the source with a
   * regex — a machine that counts sentences cannot count whether a
   * sentence is true.
   */
  describe("a numeric door's message calls a string a string", () => {
    type DataDoor = ReturnType<typeof lineStage>;
    const STRINGY = "1620000000";

    it.each([
      ["setData x", (h: DataDoor) => h.setData([{ x: STRINGY, y: 1 }] as never)],
      ["updateLast x", (h: DataDoor) => h.updateLast({ x: STRINGY, y: 1 } as never)],
      [
        "append seam",
        (h: DataDoor) => {
          h.setData([{ x: 0, y: 1 }]);
          h.append([{ x: STRINGY, y: 1 }] as never);
        },
      ],
      [
        "prepend seam",
        (h: DataDoor) => {
          h.setData([{ x: 5, y: 1 }]);
          h.prepend([{ x: STRINGY, y: 1 }] as never);
        },
      ],
    ])("%s", (_door, call) => {
      const main = lineStage();
      let message = "";
      try {
        call(main as never);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toBe("");
      // If the value looks like a number, a consumer never suspects the type.
      expect(message).toContain("string");
    });

    /** Control — a real number comes out as-is, with no quotes. */
    it("control: a real number is written as a number", () => {
      expect(() => lineStage().setData([{ x: Number.NaN, y: 1 }])).toThrow(/NaN/);
      expect(() => lineStage().setData([{ x: Number.NaN, y: 1 }])).not.toThrow(
        /string/,
      );
    });
  });

  /** Four data doors — exactly where a failed `fetch` runs straight into. */
  describe("data doors throw a contract error", () => {
    const handle = () => {
      const { main } = twoSeriesStage();
      return main;
    };

    it.each(HOSTILE_SHAPES)("setData(%s)", (_label, bad) => {
      expect(() => handle().setData(bad as never)).toThrow(publicApi.DataError);
    });

    it.each(HOSTILE_SHAPES)("append(%s)", (_label, bad) => {
      expect(() => handle().append(bad as never)).toThrow(publicApi.DataError);
    });

    it.each(HOSTILE_SHAPES)("prepend(%s)", (_label, bad) => {
      expect(() => handle().prepend(bad as never)).toThrow(publicApi.DataError);
    });

    it.each(HOSTILE_SHAPES.filter(([label]) => label !== "empty object"))(
      "updateLast(%s)",
      (_label, bad) => {
        expect(() => handle().updateLast(bad as never)).toThrow(
          publicApi.DataError,
        );
      },
    );

    /**
     * The axis of a point's fields. `SHAPE_GUARDED` feeds an export's
     * top-level argument, and `HOSTILE_NUMBERS` feeds options and scales —
     * with nowhere that feeds a hostile value into a field inside a point,
     * a candle's `open`/`close` goes uncovered.
     *
     * The symptom here is not merely quiet — it is a wrong picture on
     * screen: `close: "102"` can draw an otherwise fine bar that looks
     * like a doji, or a single bar with `close: null` can produce a
     * 7140px red bar in a 600px pane — about the worst failure a financial
     * chart can produce.
     *
     * The field list is derived from the same source as the accessor's —
     * a hand-written one leaks one field.
     */
    describe("a point's fields also throw a contract error", () => {
      const CANDLE = { x: 0, open: 100, high: 105, low: 95, close: 101 };
      const OHLC_FIELDS = Object.keys(CANDLE).filter((f) => f !== "x");

      const feedCandle = (index: number, field: string, bad: unknown) => {
        const stage = twoSeriesStage().main;
        const data = [0, 1, 2].map((i) => ({ ...CANDLE, x: i }));
        (data[index] as Record<string, unknown>)[field] = bad;
        stage.setData(data);
      };

      /**
       * Excludes `number` — a number in a price slot is legitimate. The
       * shape axis's hostile list was built targeting a top-level
       * argument (a spot expecting an object), so for a numeric field
       * that one entry's meaning flips. The numeric side of hostility is
       * fed separately, by `HOSTILE_NUMBERS` (NaN, Infinity).
       */
      const HOSTILE_FIELD_SHAPES = HOSTILE_SHAPES.filter(
        ([label]) => label !== "number",
      );

      describe.each(OHLC_FIELDS)("candle %s", (field) => {
        it.each([...HOSTILE_FIELD_SHAPES, ...HOSTILE_NUMBERS])(
          "should refuse %s",
          (_label, bad) => {
            expect(() => feedCandle(1, field, bad)).toThrow(publicApi.DataError);
          },
        );
      });

      /** Also checks the last bar — exactly where a live tick attaches. */
      it("should refuse a bad field on the newest bar", () => {
        expect(() => feedCandle(2, "close", null)).toThrow(publicApi.DataError);
      });

      /** The message names the **field and index** — not `domain`. */
      it("should name the field and index, not the scale", () => {
        let thrown: unknown;
        try {
          feedCandle(1, "close", "102");
        } catch (error) {
          thrown = error;
        }
        const message = thrown instanceof Error ? thrown.message : "";
        expect(message).toContain("close");
        expect(message).toContain("index 1");
        // If OHL were also a string, `domain max ... got 140.4` could come
        // out instead — a finite-looking value attributed to a door the
        // consumer never called.
        expect(message).not.toContain("domain");
      });

      /** `null` in a line is a gap — if this door caught that too, the contract would break. */
      it("should keep null a gap for line data", () => {
        const line = lineStage();
        expect(() =>
          line.setData([
            { x: 0, y: 1 },
            { x: 1, y: null },
            { x: 2, y: 3 },
          ] as never),
        ).not.toThrow();
      });

      it("should refuse a non-finite line value that is not null", () => {
        const line = lineStage();
        expect(() =>
          line.setData([
            { x: 0, y: 1 },
            { x: 1, y: "102" },
          ] as never),
        ).toThrow(publicApi.DataError);
      });
    });

    it("should reject a non-object point inside the array", () => {
      expect(() => handle().setData([null] as never)).toThrow(publicApi.DataError);
    });
  });
});

describe("self-completeness — a new door cannot open without a judgment call", () => {
  const runtimeExports = Object.keys(publicApi).sort();

  it("should have every public runtime export either guarded or exempt", () => {
    const unclassified = runtimeExports.filter(
      (name) => !(name in GUARDED) && !(name in EXEMPT),
    );

    // Failing here means a new name landed on the public surface.
    // It must be registered in GUARDED (it is a chokepoint) or EXEMPT (no amplifier, plus a reason).
    expect(unclassified).toEqual([]);
  });

  it("should not list names that left the public surface", () => {
    const known = [...Object.keys(GUARDED), ...Object.keys(EXEMPT)];
    const stale = known.filter((name) => !runtimeExports.includes(name));

    // If the table goes stale, it leaves only the impression of guarding something while actually checking nothing.
    expect(stale).toEqual([]);
  });

  it("should give every exemption a reason", () => {
    const blank = Object.entries(EXEMPT)
      .filter(([, exemption]) => exemption.note.trim().length === 0)
      .map(([name]) => name);

    expect(blank).toEqual([]);
  });

  it("should find a non-trivial surface to check", () => {
    // If this is 0, this describe guards nothing.
    expect(runtimeExports.length).toBeGreaterThan(50);
  });
});
