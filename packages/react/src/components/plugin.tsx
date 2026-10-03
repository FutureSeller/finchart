import type { Pane, Plot } from '@finchart/core';
import { useContext, useEffect, useRef } from 'react';
import { PaneContextValue, useChartApi } from './chart-context';

export interface PluginProps<TApi extends { dispose(): void }> {
  /**
   * Mounts the plugin — `(plot, pane) => plot.use(…)` or `pane.use(…)`,
   * the same function `usePlugin` takes. `pane` is the `<ChartPane>` this
   * sits in, else `mainPane`. `null` means nothing to install for these
   * `deps`.
   */
  install: (plot: Plot, pane: Pane) => TApi | null;
  /** What reinstalls it — not the identity of `install` or `onApi`. Omit to install once per mount. */
  deps?: readonly unknown[];
  /**
   * Hears the api once it's installed and `null` before it's disposed — on
   * unmount, on a `deps` change, and in StrictMode's round trip — so a
   * parent's state never holds a disposed api. Read at the moment it's
   * called, so an inline arrow is fine.
   */
  onApi?: (api: TApi | null) => void;
}

const ONCE: readonly unknown[] = [];

/**
 * A plugin install as a child — the declarative lane's way to put a tool
 * on the chart and hand its api up, where `usePlugin` would need a
 * component of its own just to call the hook inside the container:
 *
 * ```tsx
 * <Plugin install={(plot) => plot.use(paneMaximize({ gestures: true }))} />
 * <ChartPane>
 *   <Plugin install={(plot, pane) => pane.use(drawingTools({ plot }))} onApi={setTools} />
 * </ChartPane>
 * ```
 */
export function Plugin<TApi extends { dispose(): void }>({
  install,
  deps = ONCE,
  onApi,
}: PluginProps<TApi>): null {
  const { plot } = useChartApi('Plugin');
  const pane = useContext(PaneContextValue);
  const target = pane ?? plot.mainPane;

  const latest = useRef({ install, onApi });
  latest.current = { install, onApi };

  useEffect(() => {
    const installed = latest.current.install(plot, target);
    if (installed === null) return;
    latest.current.onApi?.(installed);

    return () => {
      // The parent lets go before the api is disposed.
      latest.current.onApi?.(null);
      installed.dispose();
    };
    // `install` and `onApi` are read through a ref — only `deps` decides reinstallation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, target, ...deps]);

  return null;
}
