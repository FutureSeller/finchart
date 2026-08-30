import type { Pane, Plot } from '@finchart/core';
import { useContext, useEffect, useRef, useState } from 'react';
import { PaneContextValue, useChartApi } from '../components/chart-context';

/**
 * Mounts a plugin onto the chart and hands its lifetime to React — the
 * idiom for the imperative lane.
 *
 * `pane` arrives as the pane you're in, if inside a `<ChartPane>`, or
 * `mainPane` otherwise. Where it mounts is the caller's call — both
 * `plot.use(…)` and `pane.use(…)` come in through this same door:
 *
 * ```tsx
 * const maximize = usePlugin((plot) => plot.use(paneMaximize({ gestures: true })), []);
 * const tools = usePlugin((plot, pane) => pane.use(drawingTools({ plot })), []);
 * ```
 *
 * **`deps` decides reinstallation** — not the install function's
 * reference. An inline closure is fine to pass as-is. Changing `deps`
 * tears down and remounts, so for a plugin where you only want to change
 * options (one with `applyOptions`), it's cheaper to pin `deps` and push
 * options through the returned api instead — that's the shape
 * `<Crosshair>` takes.
 *
 * The return value is **`null` before commit.** Using it from an event
 * handler is the natural fit; initialization that needs to happen right
 * after install (a side effect like `tools.load(…)`) belongs inside the
 * install function itself — though StrictMode round-trips install/dispose
 * once (the dispose contract covers this), so that
 * initialization has to be safe to run twice.
 */
export function usePlugin<TApi extends { dispose(): void }>(
  install: (plot: Plot, pane: Pane) => TApi,
  deps: readonly unknown[],
): TApi | null {
  const { plot } = useChartApi('usePlugin');
  const pane = useContext(PaneContextValue);
  const target = pane ?? plot.mainPane;

  const [api, setApi] = useState<TApi | null>(null);

  const latestInstall = useRef(install);
  latestInstall.current = install;

  useEffect(() => {
    const installed = latestInstall.current(plot, target);
    setApi(installed);

    return () => {
      setApi(null);
      installed.dispose();
    };
    // The install function is read through a ref — per the contract above, only `deps` decides reinstallation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, target, ...deps]);

  return api;
}
