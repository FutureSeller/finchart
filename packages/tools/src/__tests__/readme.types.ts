/**
 * The docs' drawing-tools snippets compile here.
 *
 * This file does two things:
 * 1. Compiles the snippets (`tsc --noEmit` looks at this file)
 * 2. Lets `snippet-drift.test.ts` check that the strings below actually
 *    exist in the source docs
 *
 * The lock only holds with both together — compiling alone tells you
 * the copy is correct, and checking alone tells you nothing about
 * whether the source compiles.
 *
 * (It isn't `.test.ts`, so vitest doesn't pick it up — only tsc sees it.)
 */
import type { Plot } from "@finchart/core";
import { drawingTools } from "../tools";

/**
 * The mount one-liner as it appears in the docs. The string here must
 * match the source exactly — `snippet-drift.test.ts` checks it.
 */
export const MOUNT_LINE = "plot.mainPane.use(drawingTools({ plot }))";



/**
 * Consumer-facing docs must sell today's truth. While unpublished on
 * npm, what this list requires isn't "no clone step" but "an
 * unpublished notice is present" — that reverts on the day of
 * publication. The rule and the reopening condition live in
 * `snippet-drift.test.ts`.
 *
 * (Contributor procedure — the root README's "Development" section — is
 * outside this list and isn't checked.)
 */
export function readmeSnippet(plot: Plot): void {
  // ---- must match the README's "Mounting" section ----
  const tools = plot.mainPane.use(drawingTools({ plot }));

  tools.begin("trend"); // the next two clicks make a trend line
  tools.add({ type: "horizontal", price: 105 }); // add it programmatically
  tools.dispose(); // tears down all the wiring at once
}

/** The README's magnet (snap) section -- this fails to compile without `plot`. */
export function snapSnippet(plot: Plot): void {
  plot.mainPane.use(drawingTools({ plot, snap: true }));
}

/**
 * The subscription example from the core `emitter.ts` JSDoc --
 * **the guard is part of the recipe.**
 */
export function subscribeSnippet(plot: Plot, save: (s: string) => void): void {
  const tools = plot.mainPane.use(drawingTools({ plot }));
  const off = tools.changes.subscribe(({ reason }) => {
    // load and clear are echoes of something I called myself -- feeding
    // them back into save would overwrite the source of truth.
    if (reason === "load" || reason === "clear") return;
    save(tools.serialize());
  });
  off();
}

/**
 * The README's save recipe -- the four app copies carry the same
 * `reason !== "move"` line, and the snippet-drift lock holds them all to
 * this compiled form.
 */
export function saveRecipeSnippet(
  plot: Plot,
  saveDrawings: () => void,
): void {
  const tools = plot.mainPane.use(drawingTools({ plot }));
  tools.changes.subscribe((change) => {
    if (change.reason !== "move") saveDrawings();
  });
}

/**
 * The stage-layer example from `extensions.md` -- the lowercase `pane`
 * variable form is the original.
 */
export function paneUseSnippet(pane: Plot["mainPane"], plot: Plot): void {
  pane.use(drawingTools({ plot }));
}
