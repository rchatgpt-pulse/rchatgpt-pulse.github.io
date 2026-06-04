import { useMemo } from 'react';
import { useLiveData } from '../data/useLiveData';
import type { LiveFeatureSeries, LiveToday } from '../types';

export interface LiveStats {
  /** ISO date of the most recent day with data (today.date if present). */
  lastDate: string;
  /** Posts scored on the most recent day. */
  postsToday: number;
  /** Sum of n_posts over the trailing 7 days. */
  last7d: number;
  /** Sum of n_posts over the trailing 30 days. */
  last30d: number;
}

function sumFromEnd(arr: number[], days: number): number {
  let sum = 0;
  for (let i = Math.max(0, arr.length - days); i < arr.length; i++) sum += arr[i];
  return sum;
}

/** Pure helper. Used by buildFrontPageData (which receives the series via
 *  props rather than a hook) so the same arithmetic doesn't live in two
 *  places. */
export function computeLiveStats(
  featureSeries: LiveFeatureSeries | null,
  today: LiveToday | null,
): LiveStats {
  const np = featureSeries?.n_posts ?? [];
  const dates = featureSeries?.dates ?? [];
  const N = np.length;
  return {
    lastDate: today?.date ?? dates[N - 1] ?? '',
    postsToday: today?.n_posts ?? np[N - 1] ?? 0,
    last7d: sumFromEnd(np, 7),
    last30d: sumFromEnd(np, 30),
  };
}

/** Hook for components that just need the masthead-style stats off the
 *  live feed (DashboardNav, AmbientToday). */
export function useLiveStats(): LiveStats {
  const { featureSeries, today } = useLiveData();
  return useMemo(() => computeLiveStats(featureSeries, today), [featureSeries, today]);
}
