/**
 * The cursor claim stack — who gets to say what shape the pointer is.
 *
 * **The later claim wins.** A drag naturally lands on top of a hover, and
 * releasing it falls back to whatever's underneath (the same direction as
 * the input stack's "later registration goes first"). A consumer that
 * changes shape mid-drag must **push the new one before releasing the
 * old** so the top of the stack never flickers in between.
 *
 * Values are plain CSS `cursor` vocabulary — not re-typed as a union.
 * A headless layer has no cursor to show, so claims still stack, there's
 * just no screen. Release is idempotent.
 */

export interface CursorClaims {
  /** Claims a cursor shape. Returns its release, safe to call twice. */
  claim(cursor: string): () => void;
}

/**
 * `apply` is the layer's `setCursor` — `undefined` on a headless stage.
 * It's only called when the top of the stack changes shape, so the DOM is
 * touched on transitions, not on every claim.
 */
export function cursorClaims(
  apply: ((cursor: string | null) => void) | undefined,
): CursorClaims {
  /** Erased by entry identity, not value — two claims can share a shape. */
  const claims: { cursor: string }[] = [];
  /** The last value applied to the layer. */
  let applied: string | null = null;

  const sync = (): void => {
    const top = claims.at(-1)?.cursor ?? null;
    if (top === applied) return;
    applied = top;
    apply?.(top);
  };

  return {
    claim(cursor) {
      const claim = { cursor };
      claims.push(claim);
      sync();
      return () => {
        const index = claims.indexOf(claim);
        if (index === -1) return;
        claims.splice(index, 1);
        sync();
      };
    },
  };
}
