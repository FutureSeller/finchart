/**
 * Door-by-door self-completeness -- the verdict table for
 * `@finchart/tools`. Copying the core's name-based table verbatim would
 * not work: tools has only six public runtime names, and most of its
 * actual doors are methods on the object a factory returns, so counting
 * by name would show only a single `drawingTools` line and miss
 * everything else entirely.
 *
 * So the list is derived from the type declarations instead -- if a new
 * method shows up without a verdict, this file screams.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ContractError } from "@finchart/core";
import {
  distanceToPoint,
  distanceToSegment,
  drawingTools,
  parseDrawings,
  serializeDrawings,
} from "../index";
import type { Drawing } from "../drawings";
import type { DrawingSelectionChange } from "../tools";
import { mountDrawingStage } from "./drawing-stage.fixture";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where an inherited interface lives. Without following `extends`,
 * doors declared **in another file** -- like `dispose` and `disposed`
 * -- would be missing from the table entirely. A door is a door
 * regardless of which interface declared it.
 */
const INHERITED: Record<string, string> = {
  PluginApi: "../../core/src/primitives/plugin.ts",
};

/** Pulls the **top-level** member names out of an interface body -- by their two-space indent, so a nested declaration's own members (`defaults: { fib, ... }`) are not taken for doors. */
function membersOf(file: string, name: string): string[] {
  const source = readFileSync(resolve(SRC, file), "utf8");
  const start = source.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`could not find the ${name} declaration`);
  const heading = source.slice(start, source.indexOf("{", start));
  const base = /extends\s+(\w+)/.exec(heading)?.[1];
  const inherited =
    base === undefined
      ? []
      : membersOf(INHERITED[base] ?? file, base);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    if (source[end] === "{") depth++;
    else if (source[end] === "}" && --depth === 0) break;
  }
  const body = source.slice(open + 1, end);
  return [
    ...new Set([
      ...inherited,
      ...[...body.matchAll(/^ {2}(?:readonly )?(\w+)[?(:<]/gm)].map((m) => m[1]),
    ]),
  ].sort();
}

/** Three axes. An exemption's reason must say "where the value comes from," not "who calls it." */
interface Verdict {
  /** Is the argument that shape? */
  shape: string;
  /** Is it finite and positive? */
  value: string;
  /** Throws, or returns null. */
  policy: string;
}

const OPTIONS: Record<string, Verdict> = {
  plot: {
    shape:
      "Blocks it -- is it an object, and does it have all five of the " +
      "stage's methods. If it only checked whether it's an object, " +
      "assembly would succeed quietly, and a drawing could enter the " +
      "ledger but never get drawn",
    value:
      "Where the value comes from is the wiring -- both plot and pane " +
      "are in the name, installation happens on the pane, and the " +
      "argument is plot. Our .d.ts tooltip taught the wrong shape for a " +
      "long time",
    policy: "throws (an input API)",
  },
  zIndex: {
    shape: "blocks it",
    value: "blocks it -- NaN would put the line in the slot below the series",
    policy: "throws",
  },
  priority: {
    shape: "blocks it",
    value: "blocks it -- NaN would always land it at the very front",
    policy: "throws",
  },
  style: {
    shape: "blocks only the container -- is it an object",
    value:
      "The leaves (width, color, dashArray) belong to the renderer -- a " +
      "consumer's value travels all the way to the DrawCommand, and " +
      "applyColor, usableWidth, and coerceLeaf catch it there. This " +
      "layer does not double-check them",
    policy: "throws",
  },
  snap: {
    shape: "blocks it -- is it a boolean",
    value: "n/a",
    policy: "throws",
  },
  snapRadius: {
    shape: "blocks it",
    value: "blocks it -- NaN would make snapping() report true while nothing actually snaps",
    policy: "throws",
  },
  defaults: {
    shape: "blocks it -- an object, and each kind's entry an object",
    value:
      "blocks it -- judged by the predicate the drawings themselves pass: a " +
      "kind's defaults are valid exactly when a drawing of that kind carrying " +
      "them is. Read once into an owned copy, so a later edit of the caller's " +
      "object cannot slip an unjudged value into a draft",
    policy: "throws",
  },
};

const API: Record<string, Verdict> = {
  add: {
    shape: "blocks it -- built via safeOwned and checked with isDrawing (no TOCTOU gap)",
    value: "blocks it -- a non-finite coordinate would corrupt the ledger",
    policy: "throws (an input API)",
  },
  load: {
    shape: "does not throw -- it's a parser. No matter what comes in as argument 0, it returns false",
    value: "returns false on rejection -- a URL or localStorage value might belong to someone else's session",
    policy: "returns false",
  },
  begin: {
    shape: "blocks it -- against the runtime DRAWING_KINDS list",
    value: "n/a",
    policy: "throws",
  },
  setSnap: {
    shape: "blocks it -- boolean",
    value: "n/a",
    policy: "throws",
  },
  applyOptions: {
    shape: "blocks it -- an object, plus the style container",
    value: "the leaves belong to the renderer (same reason as style)",
    policy: "throws",
  },
  select: {
    shape:
      "blocks it -- splits into four branches: not an object / not this " +
      "toolbox's handle / already removed / null means deselect. Even a " +
      "value that was never actually removed must be split and blocked " +
      "separately",
    value: "n/a",
    policy: "throws. Only `null` is a normal call (deselect)",
  },
  serialize: {
    shape: "no argument -- uses our own list",
    value: "the list was already filtered by add and load",
    policy: "does not throw",
  },
  mode: { shape: "no argument", value: "--", policy: "reads a value" },
  list: { shape: "no argument", value: "--", policy: "reads a value" },
  handles: { shape: "no argument", value: "--", policy: "reads a value" },
  selection: { shape: "no argument", value: "--", policy: "reads a value" },
  snapping: { shape: "no argument", value: "--", policy: "reads a value" },
  cancel: {
    shape: "no argument",
    value: "--",
    policy: "does not throw over its argument. Throws ContractError after dispose",
  },
  clear: {
    shape: "no argument",
    value: "--",
    policy:
      "does not throw over its argument. Throws ContractError after " +
      "dispose. **Fires changes even when the list is already empty** " +
      "-- feeding that notification straight back into a save would " +
      "overwrite the source",
  },
  undo: {
    shape: "no argument",
    value: "--",
    policy:
      "returns whether a command or draft/drag cancellation was consumed. " +
      "Throws ContractError after dispose",
  },
  redo: {
    shape: "no argument",
    value: "--",
    policy:
      "returns whether a command was replayed. Refuses an in-flight draft/drag, " +
      "and throws ContractError after dispose",
  },
  canUndo: {
    shape: "no argument",
    value: "--",
    policy: "mirrors whether undo consumes a command, drag, or draft; stays open after dispose",
  },
  canRedo: {
    shape: "no argument",
    value: "--",
    policy: "mirrors whether redo can replay now; stays open after dispose",
  },
  dispose: { shape: "no argument", value: "--", policy: "safe to call twice" },
  changes: {
    shape: "a value -- a subscription channel",
    value: "--",
    policy:
      "carries `reason` plus the required direct/undo/redo origin; selection is session state, not the list, so it split off into `selectionChanges`",
  },
  historyChanges: {
    shape: "a value -- a subscription channel",
    value: "canUndo/canRedo -- enough to render history controls",
    policy: "fires when a command, boundary, draft, or drag changes availability",
  },
  modeChanges: {
    shape: "a value -- a subscription channel",
    value: "--",
    policy: "one observable channel per concern",
  },
  selectionChanges: {
    shape: "a value -- a subscription channel",
    value: "a copy plus a handle -- carries identity as well",
    policy:
      "does not fire on re-picking the same thing; disposal is quiet; reentrancy stops after one round",
  },
  disposed: { shape: "a value", value: "--", policy: "read" },
};

const HANDLE: Record<string, Verdict> = {
  read: {
    shape: "no argument",
    value: "returns a copy -- a consumer cannot touch our ledger",
    policy: "does not throw",
  },
  remove: { shape: "no argument", value: "--", policy: "safe to call twice" },
  update: {
    shape: "blocks it -- non-object patches, unknown keys, type/id",
    value:
      "goes through the same normalizer as every door; an unfit patch throws before the target is touched",
    policy: "throws (input API); a removed target throws too",
  },
};

const MODULE: Record<string, Verdict> = {
  drawingTools: {
    shape: "blocks it -- every option field (see the table above)",
    value: "see the table above",
    policy: "throws",
  },
  parseDrawings: {
    shape: "does not throw -- it's a parser. No matter what comes in, it returns null",
    value: "a non-finite coordinate returns null",
    policy: "null. **It's a normalizer -- any unknown field a consumer tacked on is dropped**",
  },
  serializeDrawings: {
    shape:
      "blocks it -- this is the spot where a getter-only class instance " +
      "used to get stored as {}, wiping out the whole ledger next " +
      "session. The value comes from an app's store",
    value: "blocks it -- runs through the same one normalizer as add",
    policy: "throws (an input API)",
  },
  distanceToPoint: {
    shape: "does not block -- pure geometry. Demotes any argument to NaN",
    value: "a non-finite input produces NaN -- hit-testing then comes back false",
    policy: "does not throw (for both argument 0 and 1)",
  },
  distanceToSegment: {
    shape: "does not block -- pure geometry. Demotes any argument to NaN",
    value: "a non-finite input produces NaN -- hit-testing then comes back false",
    policy: "does not throw (for arguments 0, 1, and 2 alike)",
  },
  FIB_LEVELS: { shape: "a constant", value: "--", policy: "--" },
  FIB_EXTENSION_LEVELS: { shape: "a constant", value: "--", policy: "--" },
  DRAWING_STYLE_SPEC: {
    shape: "a constant -- the style spec. Made public because there's no other way to reach the defaults",
    value: "--",
    policy: "--",
  },
};

/**
 * Hostile values -- the same list as the core's `HOSTILE_SHAPES` in
 * `boundary-values.test.ts`. Also what the truth layer feeds in to
 * measure whether a reason is actually true.
 */
const HOSTILE: readonly unknown[] = [
  undefined,
  null,
  42,
  "x",
  true,
  Symbol("x"),
  {},
  [],
  () => {},
  Number.NaN,
  {
    toString() {
      throw new Error("boom");
    },
  },
];

/** The doors the truth layer actually calls -- name and implementation are wired together here, once. */
const MODULE_DOORS: Record<string, (args: unknown[]) => unknown> = {
  // `Reflect.apply` bypasses the signature -- the truth layer's whole job
  // is feeding in **values the declaration forbids**, so satisfying the
  // types here would make the check entirely free (i.e. vacuous).
  distanceToPoint: (args) => Reflect.apply(distanceToPoint, undefined, args),
  distanceToSegment: (args) => Reflect.apply(distanceToSegment, undefined, args),
};

describe("self-completeness -- the door-by-door verdict table", () => {
  /**
   * The notification's own fields -- the first public shape that is
   * neither an option nor an api member, so `membersOf` would never see a
   * field added here (the `via` day proved it: "carries only reason" went
   * stale with nothing red).
   */
  const CHANGE: Record<string, Verdict> = {
    reason: {
      shape: "a closed union -- add|remove|move|update|clear|load",
      value: "undo/redo emit the inverse operation's reason, never a new member",
      policy: "--",
    },
    via: {
      shape: "required -- direct|undo|redo",
      value: "every producer fills it (one emit site); a gesture cancel is direct",
      policy: "--",
    },
  };

  const TABLES = [
    ["options", OPTIONS],
    ["api", API],
    ["handle", HANDLE],
    ["change", CHANGE],
    ["module", MODULE],
  ] as const;

  const cases: [string, string, string, Record<string, Verdict>][] = [
    ["the assembly door's option fields", "tools.ts", "DrawingToolsOptions", OPTIONS],
    ["the api's methods and values", "tools.ts", "DrawingToolsApi", API],
    ["the handle", "tools.ts", "DrawingHandle", HANDLE],
    ["the change notification", "tools.ts", "DrawingsChange", CHANGE],
  ];

  it.each(cases)("should judge every door of %s", (_l, file, name, table) => {
    // Derived from the type declaration -- writing this by hand makes it easy to miss an entry.
    const unjudged = membersOf(file, name).filter((door) => !(door in table));
    expect(unjudged).toEqual([]);
  });

  /** Derived from the barrel file -- writing this by hand would let a new export slip through silently. */
  const exported = [
    ...readFileSync(resolve(SRC, "index.ts"), "utf8").matchAll(
      /^export \{([^}]*)\}/gm,
    ),
  ]
    .flatMap((m) => m[1].split(","))
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !name.startsWith("type "));

  it("should judge every module-level export", () => {
    expect(exported.filter((name) => !(name in MODULE))).toEqual([]);
    expect(Object.keys(MODULE).filter((name) => !exported.includes(name))).toEqual(
      [],
    );
  });

  /** Also guards against the table going stale -- a door that no longer exists must not leave the impression it is still "guarded." */
  it.each(cases)("should not list doors that left %s", (_l, file, name, table) => {
    const real = membersOf(file, name);
    expect(Object.keys(table).filter((d) => !real.includes(d))).toEqual([]);
  });

  /** No `〃` (ditto mark) allowed -- it's a notation a machine can't read, so the verdict table blocks it. A lint of the table's text, not of any door's behaviour. */
  it("table lint: no verdict text uses a ditto mark", () => {
    const dittos: string[] = [];
    for (const [group, table] of TABLES) {
      for (const [door, verdict] of Object.entries(table)) {
        for (const axis of ["shape", "value", "policy"] as const) {
          if (verdict[axis].includes("〃")) dittos.push(`${group}.${door}.${axis}`);
        }
      }
    }
    expect(dittos).toEqual([]);
  });

  /**
   * The truth of a reason -- the table must not merely assert that a
   * reason exists; any door documented as "does not throw" gets
   * actually fed hostile input here to check. Only a reason that names
   * the argument position is checkable -- if the promise is
   * per-argument but doesn't say which position, it can't be verified.
   */
  describe("when a reason says it does not throw, it actually does not throw", () => {
    const CLAIMS_SAFE = /does not throw|demotes|no matter what/i;

    /** The argument position a promise points at, plus the rest of the arguments -- the tools version of the core's `SAFE_ARG`. */
    const SAFE_ARG: Record<string, { index: number; rest: () => unknown[] }> = {
      distanceToPoint: { index: 0, rest: () => [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      distanceToSegment: {
        index: 0,
        rest: () => [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
      },
    };

    const promised = Object.entries(MODULE)
      .filter(([, v]) => CLAIMS_SAFE.test(`${v.shape} ${v.value} ${v.policy}`))
      .map(([name]) => name)
      .filter((name) => name in SAFE_ARG);

    it("should have someone making that promise", () => {
      expect(promised.length).toBeGreaterThan(0);
    });

    describe.each(promised)("%s", (name) => {
      it("should not throw on any hostile value at the promised argument", () => {
        const door = MODULE_DOORS[name];
        const spot = SAFE_ARG[name];
        for (const bad of HOSTILE) {
          const args = spot.rest();
          args[spot.index] = bad;
          expect(() => door(args)).not.toThrow();
        }
      });
    });

  });

  /** A lint of the table's text, not of any door's behaviour. */
  it("table lint: every verdict has non-blank text on all three axes", () => {
    const blank: string[] = [];
    for (const [group, table] of TABLES) {
      for (const [door, verdict] of Object.entries(table)) {
        for (const axis of ["shape", "value", "policy"] as const) {
          if (verdict[axis].trim().length === 0) blank.push(`${group}.${door}.${axis}`);
        }
      }
    }
    expect(blank).toEqual([]);
  });

  /** Does the verdict match reality -- a table alone could claim "blocks it" while the code doesn't actually block anything. */
  describe("the table's claims actually hold in practice", () => {
    /**
     * The real shape of a `DrawingStage` -- both names and return
     * types. If the mock diverges from the real contract
     * (`requestRender`, `addInputConsumer`, `claimCursor`, `xAt`,
     * `pixelAtX`; `addInputConsumer`/`claimCursor` return a disposer
     * `() => void`), the rejection checks below throw at the factory
     * first, so the mock's return shape might never actually run while
     * everything still comes up green. That's why a separate mounting
     * control test exists -- if this mock drifts, that control test
     * screams first.
     */
    const stage = () => ({
      plot: {
        requestRender: () => {},
        addInputConsumer: () => () => {},
        claimCursor: () => () => {},
        xAt: () => 0,
        pixelAtX: () => 0,
        claimFocusArea: () => ({ contestedAt: () => false, release: () => {} }),
        crosshair: () => {},
      },
    });

    /**
     * The pane a toolbox actually lives on. `probe` supplies snap
     * candidates, and the rest supply coordinates. `addDecoration` also
     * returns a disposer -- the mock has to copy the contract, not
     * guess at it, for this file's checks to actually run.
     *
     * `DrawingPane` requires `ValueCoordinates.area`. Without it,
     * assembly, `add`, and `list` all pass, and it blows up on the
     * first `pointermove`.
     */
    const pane = () => ({
      addDecoration: () => () => {},
      probe: () => null,
      valueAt: () => 0,
      pixelAtValue: () => 0,
      area: { left: 0, right: 400, top: 0, bottom: 300 },
      use: <T,>(plugin: (host: unknown) => T): T => plugin(pane()),
    });

    /** Control: a properly formed assembly passes, and `dispose()` actually calls the disposer. */
    it("control: a proper stage mounts and tears down cleanly", () => {
      const api = drawingTools(stage())(pane() as never);
      expect(api.disposed).toBe(false);
      expect(() => api.dispose()).not.toThrow();
      expect(api.disposed).toBe(true);
    });

    it.each([
      ["a pane shape", { addDecoration: () => {}, probe: () => {}, valueAt: () => 0 }],
      ["an empty object", {}],
      ["partial", { requestRender: () => {}, xAt: () => 0 }],
    ])("drawingTools({ plot }) -- %s is not a stage", (_label, plot) => {
      expect(() => drawingTools({ plot } as never)).toThrow(ContractError);
    });

    // snap, snapRadius, style, and defaults are refused in their own
    // suites (zero-trust and log-fib-defaults); only the ordering options
    // have no other home.
    it.each([
      ["zIndex", { zIndex: Number.NaN }],
      ["priority", { priority: "high" }],
    ])("drawingTools({ %s })", (_door, bad) => {
      expect(() => drawingTools({ ...stage(), ...bad } as never)).toThrow(
        ContractError,
      );
    });

    it("serializeDrawings does not store what its own parser would reject", () => {
      class Line {
        get type(): string {
          return "horizontal";
        }
      }
      expect(() => serializeDrawings([new Line()] as never)).toThrow(ContractError);
    });

    it.each([
      ["a number", 42],
      ["a string", "handle"],
      ["a random object", {}],
      ["another toolbox's handle", "OTHER"],
    ])("select(%s) is a contract error", (_label, bad) => {
      const api = drawingTools(stage())(pane() as never);
      const value =
        bad === "OTHER"
          ? drawingTools(stage())(pane() as never)
              .add({ type: "horizontal", price: 1 })
          : bad;
      expect(() => api.select(value as never)).toThrow(ContractError);
    });

    it("select(null) is a normal call -- deselect", () => {
      const api = drawingTools(stage())(pane() as never);
      expect(() => api.select(null)).not.toThrow();
    });

    /**
     * "Returns a copy" -- every value handed out (a handle's read, the
     * list, a selection notification) is the consumer's to edit. If any
     * of them were the owned object, the edit would reach the ledger
     * without passing a door, and the next save would store it.
     */
    describe("handed-out drawings are copies -- editing one leaves the ledger alone", () => {
      const editPrice = (drawing: Drawing | null): void => {
        if (drawing?.type !== "horizontal") throw new Error("expected a horizontal line");
        drawing.price = 999;
      };

      it("handle.read()", () => {
        const { api } = mountDrawingStage();
        const handle = api.add({ type: "horizontal", price: 50 });
        editPrice(handle.read());
        expect(api.list()).toMatchObject([{ price: 50 }]);
        expect(handle.read()).toMatchObject({ price: 50 });
        api.dispose();
      });

      it("list()", () => {
        const { api } = mountDrawingStage();
        api.add({ type: "horizontal", price: 50 });
        editPrice(api.list()[0]);
        expect(api.list()).toMatchObject([{ price: 50 }]);
        api.dispose();
      });

      it("the selectionChanges payload", () => {
        const { api } = mountDrawingStage();
        const seen: DrawingSelectionChange[] = [];
        const off = api.selectionChanges.subscribe((change) => seen.push(change));
        api.add({ type: "horizontal", price: 50 }, { select: true });
        off();
        expect(seen).toHaveLength(1);
        editPrice(seen[0].selection);
        expect(api.list()).toMatchObject([{ price: 50 }]);
        expect(api.selection()).toMatchObject({ price: 50 });
        api.dispose();
      });
    });

    it("both parser doors do not throw no matter what comes in as the argument", () => {
      const api = drawingTools(stage())(pane() as never);
      for (const bad of HOSTILE) {
        expect(parseDrawings(bad as never)).toBeNull();
        expect(api.load(bad as never)).toBe(false);
      }
    });

    it("both geometry functions return NaN on non-finite input, not an exception", () => {
      expect(distanceToPoint({ x: Number.NaN, y: 0 }, { x: 0, y: 0 })).toBeNaN();
      expect(
        distanceToSegment({ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }),
      ).toBeNaN();
    });
  });
});
