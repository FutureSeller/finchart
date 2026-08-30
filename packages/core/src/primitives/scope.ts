import { runAll, throwable } from "./errors";

/** Releases one acquired resource. Must be safe to call more than once. */
export type Disposer = () => void;

/**
 * Owns the release of whatever was acquired under it, so the acquiring line
 * of code registers the releasing line right next to it — the two never
 * live in separate files with only a checklist holding them together.
 *
 * Rules a consumer can rely on:
 *
 * - `dispose()` runs disposers in **reverse registration order** — what was
 *   acquired last is released first, matching dependency direction.
 * - `dispose()` is **safe to call twice**; the second call does nothing.
 * - One disposer throwing does not stop the rest. Everything runs, then the
 *   failures are thrown — one failure unwrapped, several as an
 *   `AggregateError` (the same reporting shape as `Plot.destroy`).
 * - `add()` on a scope that is already disposed runs the disposer
 *   **immediately.** An acquisition that races past teardown must not leak
 *   forever just because it arrived late.
 */
export interface Scope {
  readonly disposed: boolean;
  add(disposer: Disposer): void;
  /**
   * A scope that closes when this one closes, but can also close early on
   * its own — a drag gesture inside a connection, a subscription inside a
   * chart. A child disposed early removes itself from the parent, so a
   * parent that outlives many short gestures does not grow with them.
   */
  child(): Scope;
  dispose(): void;
}

export function createScope(): Scope {
  let disposed = false;
  const disposers: Disposer[] = [];

  const scope: Scope = {
    get disposed() {
      return disposed;
    },

    add(disposer) {
      if (disposed) {
        disposer();
        return;
      }
      disposers.push(disposer);
    },

    child() {
      const born = createScope();
      const entry: Disposer = () => born.dispose();
      scope.add(entry);
      born.add(() => {
        // Runs on either path. Disposing via the parent hits an already
        // emptied list (`splice` below), so this only bites on an early
        // child dispose — which is exactly when the entry must go.
        const index = disposers.lastIndexOf(entry);
        if (index !== -1) disposers.splice(index, 1);
      });
      return born;
    },

    dispose() {
      if (disposed) return;
      disposed = true;

      // Emptied before running: a disposer may add to this scope again
      // (it runs immediately, see `add`) or remove from it (a child's
      // self-removal) — neither may disturb this sweep.
      const pending = disposers.splice(0).reverse();
      const failures = runAll(pending, (disposer) => disposer());
      if (failures) throw throwable(failures, "disposing scope failed");
    },
  };

  return scope;
}
