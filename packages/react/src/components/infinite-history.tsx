import { useEffect } from 'react';
import type { HistoryLink } from '../hooks/use-infinite-history';
import { useChartApi } from './chart-context';

export interface InfiniteHistoryProps {
  /** The value `useInfiniteHistory` returned. */
  history: { readonly link: HistoryLink };
}

/**
 * Loads older data into a `useInfiniteHistory` as the view nears the left
 * edge of what it holds. Mounted again — the chart remounted under a
 * `key` — it resumes where the history stands.
 */
export function InfiniteHistory({ history }: InfiniteHistoryProps): null {
  const { plot } = useChartApi('InfiniteHistory');
  const { link } = history;

  useEffect(() => link.install(plot), [link, plot]);

  return null;
}
