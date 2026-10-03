import type { BaseDataPoint } from '@finchart/core';
import { useEffect } from 'react';
import { historyLink } from '../hooks/use-infinite-history';
import { useChartApi } from './chart-context';

export interface InfiniteHistoryProps {
  /** The value `useInfiniteHistory` returned. */
  history: { readonly data: readonly BaseDataPoint[] };
}

/**
 * Loads older data into a `useInfiniteHistory` as the view nears the left
 * edge of what it holds. Mounted again — the chart remounted under a
 * `key` — it resumes where the history stands.
 */
export function InfiniteHistory({ history }: InfiniteHistoryProps): null {
  const { plot } = useChartApi('InfiniteHistory');
  const link = historyLink(history);
  const epoch = link.epoch;

  useEffect(() => link.install(plot), [link, plot, epoch]);

  return null;
}
