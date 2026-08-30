/**
 * **A compiled copy of the TSDoc fences.**
 *
 * Reach monitoring (fence counting) nominates the candidates, and risk
 * triage (*"does copy-pasting it break? does the IDE autocomplete a
 * different name?"*) picks which ones get locked. The snippets kept here
 * are cross-checked both ways against the original TSDoc by
 * `snippet-drift.test.ts`'s `CODE_LOCKS` — this file exists because of the
 * `movingAverage(20)` incident in `chart-line.tsx` (the IDE autocompleting a
 * real export with a different signature).
 *
 * (Since the file isn't `.test.tsx`, vitest ignores it and only `tsc` looks
 * at it.)
 */
import { useMemo } from 'react';
import type { OHLC, Plot } from '@finchart/core';
import { paneMaximize } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import {
  ChartCandles,
  ChartContainer,
  ChartPane,
  SyncX,
  Tooltip,
  XAxis,
  YAxis,
} from '../components';
import { useDataSource, usePlugin, usePluginState } from '../hooks';

const dateLabel = (x: number): string => new Date(x).toLocaleDateString();

/** `sync-x.tsx` fence — the `plots` prop is the contract. */
export function Compare({ plots }: { plots: ReadonlyArray<Plot | null> }) {
  return <SyncX plots={plots} />;
}

/** `tooltip.tsx` fence — formatting is a single prop. */
export function Labeled({ data }: { data: OHLC[] }) {
  const deps = useMemo(() => browserDeps(), []);
  return (
    <ChartContainer deps={deps} data={data} width={800} height={400}>
      <XAxis />
      <Tooltip formatX={dateLabel} />
      <ChartPane>
        <YAxis />
        <ChartCandles />
      </ChartPane>
    </ChartContainer>
  );
}

/** `use-plugin.ts` fence — gestures are opted into explicitly. deps decides reinstalls. */
export function Maximizable() {
  const maximize = usePlugin((plot) => plot.use(paneMaximize({ gestures: true })), []);
  return <span>{maximize === null ? 'mounting' : 'ready'}</span>;
}

/** The shape from the `use-plugin-state.ts` fence — carries the stable-reference contract as-is. */
interface ToolsLike {
  dispose(): void;
  modeChanges: { subscribe(onChange: () => void): () => void };
  mode(): string;
}
const subscribeMode = (t: ToolsLike, cb: () => void) => t.modeChanges.subscribe(cb);
const readMode = (t: ToolsLike) => t.mode();

export function Moded({ tools }: { tools: ToolsLike | null }) {
  const mode = usePluginState(tools, subscribeMode, readMode, null);
  return <span>{mode}</span>;
}

/** `use-data-source.ts` fence. */
export function Feeding({ bars }: { bars: OHLC[] }) {
  const source = useDataSource(bars);
  return <span>{source.read().length}</span>;
}
