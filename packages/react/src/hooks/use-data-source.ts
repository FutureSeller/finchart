import type { BaseDataPoint, Source } from '@finchart/core';
import { useMemo, useRef } from 'react';

/**
 * Turns a React state array into the core's `Source` — the bridge for the
 * indicator lane.
 *
 * `Source`'s whole contract is `read(): DataView<T>`: **if the reference changed,
 * the value changed.** React state lives by exactly that discipline (a new
 * array every tick), so the only job here is "let something with a stable
 * identity read the latest" — the `Source` this returns is the same object
 * for the whole mount, so putting it in `usePlugin`'s deps doesn't trigger
 * a reinstall.
 *
 * ```tsx
 * const source = useDataSource(bars);
 * usePlugin((plot) => plot.use(attachRsi({ source })), [source]);
 * ```
 *
 * Why this is the bridge instead of `SeriesHandle`: an `attach*`
 * indicator's `source:` asks for nothing but a `Source`, not the whole
 * handle, and this hook doesn't need to wait for commit — it exists from
 * the first render. Commands that need a handle (`updateLast` and the
 * like) are already covered the same way by declarative `data`.
 */
export function useDataSource<T extends BaseDataPoint>(data: T[]): Source<T> {
  const latest = useRef(data);
  latest.current = data;

  return useMemo(() => ({ read: () => latest.current }), []);
}
