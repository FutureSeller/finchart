import type {
  DecorationHost,
  PlotEventSource,
  RenderRequester,
  ViewportControl,
} from "../plot/capabilities";
import { timeCursor } from "./crosshair";

/** What the side being linked needs — one gate to listen and one gate to set. */
type XSync = PlotEventSource & ViewportControl;

/** A single strand connecting two charts — the material a star wiring is built from. */
function syncPair(a: XSync, b: XSync): () => void {
  let applying = false;

  const follow = (target: XSync) => (change: { startX: number; endX: number }) => {
    if (applying) return;
    applying = true;
    try {
      target.setVisibleRange(change.startX, change.endX);
    } finally {
      applying = false;
    }
  };

  const offA = a.on("xDomainChange", follow(b));
  const offB = b.on("xDomainChange", follow(a));

  return () => {
    offA();
    offB();
  };
}

/**
 * Links the visible x range across charts — the wiring behind a symbol
 * comparison screen.
 *
 * Everything it's built from is an existing contract: `xDomainChange`
 * (announces in data x) + `setVisibleRange` (sets in data x). Feedback is
 * cut off with a per-strand flag — since the propagation is synchronous,
 * the flag never has to survive past a single frame.
 *
 * ```ts
 * const release = syncX(btcPlot, ethPlot);            // two
 * const release = syncX(btcPlot, ethPlot, xrpPlot);   // three or more — star wiring
 * ```
 *
 * With three or more, the first chart becomes the hub of a star. A change
 * from a leaf propagates to the hub synchronously, and the hub's
 * `xDomainChange` pulls the remaining leaves along.
 */
export function syncX(a: XSync, b: XSync, ...more: XSync[]): () => void {
  const releases = [b, ...more].map((leaf) => syncPair(a, leaf));

  return () => {
    for (const release of releases) release();
  };
}

/** What the side receiving the cursor time needs — a gate to listen, a gate to mount, a gate to draw. */
type CursorSync = PlotEventSource & DecorationHost & RenderRequester;

/**
 * Links the cursor time across charts — hovering one chart raises a
 * time-ghost cursor (`timeCursor`: a vertical line + x badge) on the rest.
 *
 * The only thing carried over is the data x: y has no meaning since each
 * chart has its own scale, and magnet snapping is a drawing concern, so
 * the raw x is sent — the receiving chart speaks in its own bar grid and
 * its own wording (pointing at the same moment even across different
 * timeframes).
 *
 * The ghost never emits anything, so there's no feedback problem — it
 * doesn't even need the flag `syncX` uses. Everything clears once the
 * cursor leaves a chart (pane is `null`).
 *
 * ```ts
 * const release = syncCrosshair(btcPlot, ethPlot, xrpPlot);
 * ```
 */
export function syncCrosshair(
  a: CursorSync,
  b: CursorSync,
  ...more: CursorSync[]
): () => void {
  const members = [a, b, ...more];
  const ghosts = members.map((member) => {
    const ghost = timeCursor();
    const remove = member.addDecoration(ghost);
    return { member, ghost, remove };
  });

  const paint = (from: number, x: number | null) => {
    for (const [i, entry] of ghosts.entries()) {
      entry.ghost.follow(i === from ? null : x); // the sending chart already has a real line
      entry.member.requestRender();
    }
  };

  const subs = members.map((member, self) =>
    member.on("crosshair", (payload) => paint(self, payload?.pane ? payload.x : null)),
  );

  return () => {
    for (const off of subs) off();
    for (const { member, remove } of ghosts) {
      remove();
      member.requestRender();
    }
  };
}
