/**
 * **Do the doc's snippets stay in sync with the compiled copies?**
 *
 * `readme.types.ts` compiles the snippets. But compiling alone only
 * tells you **the copy is correct** — it says nothing about whether the
 * source still matches it. This is exactly the gap a past incident fell
 * through: the copy was right while two sources were wrong, and they
 * shipped that way in the published `.d.ts`.
 *
 * So this file checks the opposite direction. It looks for the snippet
 * string in the source document and fails if it's missing. Edit the doc
 * and this test breaks; move the edited form into `readme.types.ts` and
 * the compiler checks it. **The lock only holds when both directions
 * exist.**
 *
 * It only reads text, so it doesn't blur package boundaries — the same
 * idiom as the core's `style-vars.test.ts` reading `@finchart/dom`'s
 * source.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOUNT_LINE } from "./readme.types";

/**
 * The registry **lives outside the compiled-copy file** — putting it
 * inside that file would let the registry's own string literal satisfy
 * its own check, killing the test's discriminating power entirely (an
 * earlier draft of this file actually did that, and it was caught).
 * This file itself sits outside the tsc target pattern, so it can never
 * be a `compiledIn` — the structure rules out self-reference.
 */
const COPIES = "packages/tools/src/__tests__/readme.types.ts";
const SPARKLINE = "packages/dom/src/__tests__/sparkline.types.ts";

/**
 * **Code locks — the pairing is the contract** (see
 * `dts-fence-approach-2026-08-23.md`).
 *
 * A mutation test proved the hole in an earlier design: `SNIPPETS` only
 * checked the source direction, so **registering a fake recipe still
 * came up green** — this file said, in its own words, "the lock only
 * holds when both directions exist," and nothing enforced the pairing.
 * Now every code snippet requires a `compiledIn`: the machine checks
 * three things — (1) the source has the snippet, (2) the compiled copy
 * has the same snippet, and (3) that copy is actually a tsc target
 * (`.types.ts(x)` or `snippets/`). Edit either side and the other one
 * screams.
 */
export const CODE_LOCKS: readonly {
  file: string;
  contains: string;
  compiledIn: string;
}[] = [
  /**
   * **The first lock on the published `.d.ts` fence** (one confirmed
   * false recipe). The TSDoc in `chart-line.tsx` was selling
   * `derive={movingAverage(20)}` — `@finchart/indicators` actually
   * exports a function by that same name with a different signature
   * (exactly what an IDE's auto-import would pick).
   */
  {
    file: "packages/react/src/components/chart-line.tsx",
    contains: "derive={sma20}",
    compiledIn: "packages/react/src/__tests__/minimal-service.types.tsx",
  },
  { file: "packages/tools/README.md", contains: MOUNT_LINE, compiledIn: COPIES },
  { file: "packages/core/src/plot/pane.ts", contains: MOUNT_LINE, compiledIn: COPIES },
  { file: "packages/core/src/primitives/emitter.ts", contains: MOUNT_LINE, compiledIn: COPIES },
  { file: "apps/docs/guide/interaction.md", contains: MOUNT_LINE, compiledIn: COPIES },
  // The stage-layer example uses `pane.use` -- a different shape, not
  // the same line.
  {
    file: "apps/docs/guide/extensions.md",
    contains: "pane.use(drawingTools({ plot }))",
    compiledIn: COPIES,
  },
  // The snap option requires `plot` too (this line was missing).
  {
    file: "packages/tools/README.md",
    contains: "drawingTools({ plot, snap: true })",
    compiledIn: COPIES,
  },
  /**
   * **Two docs that claimed "the machine enforces this" were actually
   * outside the machine** (flagged in a design review). Only the copy
   * was compiled; nobody was checking the source — exactly the same trap
   * as before, and `react/README.md` ships in the tarball as the npm
   * page.
   */
  {
    file: "packages/react/README.md",
    contains: "derive={sma20}",
    compiledIn: "packages/react/src/__tests__/minimal-service.types.tsx",
  },
  {
    file: "packages/react/README.md",
    contains: "deriveKey={[20]}",
    compiledIn: "packages/react/src/__tests__/minimal-service.types.tsx",
  },
  /**
   * The sparkline recipe's lock is **gone, not moved**. `docs/sparkline.md`
   * left the site and now lives in the private development repository, so this
   * test — which ships in the published repo — cannot read it. Leaving the
   * entry in made `pnpm test` fail on any clean checkout with an ENOENT, which
   * is how the private-document dependency was found.
   *
   * The recipe itself is still compiled by
   * `packages/dom/src/__tests__/sparkline.types.ts`. What is no longer held is
   * the equality between that fixture and the prose, because one side of the
   * pair is not in this repository.
   */
  /**
   * **The snippet where `.find()` picked out the grid line** (raised in
   * a senior review; a later pass folded the landing page's source into
   * this table). Three published surfaces plus the landing page share
   * the same two lines.
   */
  { file: "packages/core/README.md", contains: "showGrid: false", compiledIn: SPARKLINE },
  { file: "packages/core/src/plot/model.ts", contains: "showGrid: false", compiledIn: SPARKLINE },
  { file: "README.md", contains: "showGrid: false", compiledIn: SPARKLINE },
  /**
   * **Risk-based triage of react's TSDoc** — five snippets picked out of
   * forty reachability-watch candidates by asking "does copy-pasting
   * this break?" and "would an IDE auto-import a different name here?"
   * These are the fragments that end up in the published `.d.ts` and
   * surface as editor tooltips.
   */
  {
    file: "packages/react/src/components/sync-x.tsx",
    contains: "<SyncX plots={plots} />",
    compiledIn: "packages/react/src/__tests__/tsdoc-fences.types.tsx",
  },
  {
    file: "packages/react/src/components/tooltip.tsx",
    contains: "<Tooltip formatX={dateLabel} />",
    compiledIn: "packages/react/src/__tests__/tsdoc-fences.types.tsx",
  },
  {
    file: "packages/react/src/hooks/use-plugin.ts",
    contains:
      "usePlugin((plot) => plot.use(paneMaximize({ gestures: true })), [])",
    compiledIn: "packages/react/src/__tests__/tsdoc-fences.types.tsx",
  },
  {
    file: "packages/react/src/hooks/use-plugin-state.ts",
    contains: "usePluginState(tools, subscribeMode, readMode, null)",
    compiledIn: "packages/react/src/__tests__/tsdoc-fences.types.tsx",
  },
  {
    file: "packages/react/src/hooks/use-data-source.ts",
    contains: "useDataSource(bars)",
    compiledIn: "packages/react/src/__tests__/tsdoc-fences.types.tsx",
  },
  /**
   * The save recipe — four apps hand-copied `reason !== "move"` and none
   * of them was machine-checked; when `reason: "update"` joined the
   * union, the recipe's premise ("only move is high-frequency") had to be
   * re-stated in every copy. This lock makes the next such change scream
   * in five places at once.
   */
  { file: "packages/tools/README.md", contains: 'reason !== "move"', compiledIn: COPIES },
  { file: "apps/examples/src/trading.ts", contains: 'reason !== "move"', compiledIn: COPIES },
  { file: "apps/examples/src/cases/drawing.ts", contains: 'reason !== "move"', compiledIn: COPIES },
  { file: "apps/showcase/src/chart-instance.ts", contains: 'reason !== "move"', compiledIn: COPIES },
  { file: "apps/showcase-react/src/rail.tsx", contains: 'reason !== "move"', compiledIn: COPIES },
  {
    file: "packages/tools/README.md",
    contains: "tools.historyChanges.subscribe(syncHistory)",
    compiledIn: "packages/tools/src/__tests__/readme.types.ts",
  },
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("doc snippets vs. compiled copies", () => {
  it("should have something to check", () => {
    // If this were 0, the assertion below would pass for free.
    expect(CODE_LOCKS.length).toBeGreaterThan(8);
  });


  it.each(CODE_LOCKS)(
    "$file should contain $contains",
    ({ file, contains }) => {
      expect(readFileSync(resolve(ROOT, file), "utf8")).toContain(contains);
    },
  );

  /**
   * **Enforcing the pairing.** A mutation test proved the hole: checking
   * only the source direction lets a fake recipe register as green. The
   * lock only holds with all three: the source direction, the copy
   * direction, and "is the copy actually a tsc target."
   */
  it.each(CODE_LOCKS)(
    "$compiledIn compiles $contains",
    ({ compiledIn, contains }) => {
      // The tsc-target convention -- this must be a file the compiler
      // sees, not vitest.
      expect(compiledIn).toMatch(/\.types\.tsx?$|snippets\/[\w-]+\.ts$/);
      expect(readFileSync(resolve(ROOT, compiledIn), "utf8")).toContain(
        contains,
      );
    },
  );


});
