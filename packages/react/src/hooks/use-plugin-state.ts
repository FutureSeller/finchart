import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * Turns a plugin's snapshot-plus-subscription state into React state — the
 * subscription idiom for the imperative lane.
 *
 * The target is a pair like `drawingTools`'s `mode()`/`selection()` — "a
 * door that reads the current value + a door that notifies on change." If
 * the api changes (a focus switch, say), the subscription switches along
 * with it.
 *
 * ```tsx
 * const mode = usePluginState(tools, subscribeMode, readMode, null);
 * // module constants: const subscribeMode = (t, cb) => t.modeChanges.subscribe(cb);
 * //                   const readMode = (t) => t.mode();
 * ```
 *
 * **Two contracts.** ① `subscribe` and `read` must be stable references (a
 * module constant or `useCallback`) — pass a new function every render and
 * it resubscribes every render. ② `read` must return a primitive or a
 * stable reference — return a new object on every call and
 * `useSyncExternalStore` reads it forever without settling.
 *
 * **Provide `getServerSnapshot`.** Without it, `renderToString` throws
 * *"Missing getServerSnapshot"* — call this hook outside
 * `<ChartContainer>` (a toolbar that lifts the tool mode up to a parent,
 * say) and the whole server render dies. The server has no api, so the
 * same function used on the client already answers.
 *
 * **`fallback` is pinned to whatever the first render's was** —
 * stabilizing `getSnapshot` with `useCallback` also drops the
 * store-consistency check and passive effect that would otherwise run on
 * every commit.
 */
export function usePluginState<TApi, T>(
  api: TApi | null,
  subscribe: (api: TApi, onChange: () => void) => () => void,
  read: (api: TApi) => T,
  /**
   * The value to use while there's no api yet.
   *
   * **Whatever the first render's value was keeps being used** — a
   * different value given later is ignored. Pass a value that can change
   * and you'll keep seeing the first one until the api attaches, so in
   * that case give a constant here and swap it in from outside instead.
   */
  fallback: T,
): T {
  const subscribeToApi = useCallback(
    (onChange: () => void) =>
      api ? subscribe(api, onChange) : () => undefined,
    [api, subscribe],
  );

  // Pinned to the first render's value.
  const pinnedFallback = useRef(fallback);

  const getSnapshot = useCallback(
    () => (api ? read(api) : pinnedFallback.current),
    [api, read],
  );

  return useSyncExternalStore(subscribeToApi, getSnapshot, getSnapshot);
}
