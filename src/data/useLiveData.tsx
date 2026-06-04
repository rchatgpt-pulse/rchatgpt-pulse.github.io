import { useState, useEffect, createContext, useContext } from 'react';
import type { CVersion } from './cVersions';
import type {
  LiveToday,
  LiveReconHistory,
  LiveSummary,
  LiveAlert,
  LiveTopFeatures,
  LiveFeatureIndex,
  LiveExcludedFeatures,
  LiveFeatureSeries,
  LiveFeatureSeriesEntry,
} from '../types';

const BASE = import.meta.env.BASE_URL;

interface LiveData {
  today: LiveToday | null;
  history: LiveReconHistory | null;
  summary: LiveSummary | null;
  alerts: LiveAlert[];
  topFeatures: LiveTopFeatures | null;
  featureIndex: LiveFeatureIndex | null;
  /** Per-feature DAILY series spanning the full range: historical
   *  (feature_series_historical.json, Jan 2023 onwards) concatenated with
   *  the live daily monitor (feature_series.json). Both the combined chart
   *  and the simulator read this. Null if neither file loads. */
  featureSeries: LiveFeatureSeries | null;
  /** Historical per-day reconstruction error (Jan 2023 onwards), from
   *  feature_series_historical.json. Prepended to the recon-history chart's
   *  day_error line; the §4 wealth/rejection stays scoped to the live window
   *  (in `history`). Null if the historical file lacks day_error. */
  historicalReconError: { dates: string[]; day_error: (number | null)[] } | null;
  excludedIds: Set<number>;
  loading: boolean;
  error: string | null;
}

const LiveDataContext = createContext<LiveData | null>(null);

async function fetchLiveJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}data/live/${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Files directly under public/data/ (not /live/), e.g. the historical
 *  daily series. */
async function fetchPublicJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}data/${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Concatenate historical + live daily feature series into one chronological
 * series. Historical days strictly before the live window are kept; live
 * days follow. Per-feature `n_active` / `mean` arrays are aligned to the
 * combined `dates`, zero-padded where a feature is missing from one source.
 */
function mergeFeatureSeries(
  hist: LiveFeatureSeries | null,
  live: LiveFeatureSeries | null,
): LiveFeatureSeries | null {
  if (!hist && !live) return null;
  if (!hist) return live;
  if (!live) return hist;

  // Keep historical days strictly before the first live day (no overlap).
  const liveStart = live.dates[0];
  const histLen = liveStart
    ? hist.dates.findIndex((d) => d >= liveStart)
    : hist.dates.length;
  const cut = histLen === -1 ? hist.dates.length : histLen;

  const dates = [...hist.dates.slice(0, cut), ...live.dates];
  const n_posts = [...hist.n_posts.slice(0, cut), ...live.n_posts];
  const histZeros = () => new Array(cut).fill(0);
  const liveZeros = () => new Array(live.dates.length).fill(0);

  const byIdx = new Map<number, LiveFeatureSeriesEntry>();
  for (const f of hist.features) {
    byIdx.set(f.idx, {
      idx: f.idx,
      label: f.label,
      n_active: f.n_active.slice(0, cut),
      mean: (f.mean ?? []).slice(0, cut),
    });
  }
  for (const f of live.features) {
    const existing = byIdx.get(f.idx);
    if (existing) {
      existing.n_active = [...existing.n_active, ...f.n_active];
      existing.mean = [...existing.mean, ...(f.mean ?? liveZeros())];
      if (!existing.label) existing.label = f.label;
    } else {
      byIdx.set(f.idx, {
        idx: f.idx,
        label: f.label,
        n_active: [...histZeros(), ...f.n_active],
        mean: [...histZeros(), ...(f.mean ?? liveZeros())],
      });
    }
  }

  // Zero-pad any feature that only appeared in one source so every array
  // matches dates.length.
  const total = dates.length;
  for (const f of byIdx.values()) {
    if (f.n_active.length < total)
      f.n_active = [...f.n_active, ...new Array(total - f.n_active.length).fill(0)];
    if (f.mean.length < total)
      f.mean = [...f.mean, ...new Array(total - f.mean.length).fill(0)];
  }

  return {
    n_observations: total,
    as_of: dates[dates.length - 1] ?? null,
    dates,
    n_posts,
    features: [...byIdx.values()].sort((a, b) => a.idx - b.idx),
  };
}

export function LiveDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<LiveData>({
    today: null,
    history: null,
    summary: null,
    alerts: [],
    topFeatures: null,
    featureIndex: null,
    featureSeries: null,
    historicalReconError: null,
    excludedIds: new Set(),
    loading: true,
    error: null,
  });

  useEffect(() => {
    Promise.all([
      fetchLiveJson<LiveToday>('today.json'),
      fetchLiveJson<LiveReconHistory>('recon_history.json'),
      fetchLiveJson<LiveSummary>('summary.json'),
      fetchLiveJson<LiveAlert[]>('alerts.json'),
      fetchLiveJson<LiveTopFeatures>('top_features.json'),
      fetchLiveJson<LiveFeatureIndex>('feature_index.json'),
      fetchLiveJson<LiveExcludedFeatures>('excluded_features.json'),
      fetchLiveJson<LiveFeatureSeries>('feature_series.json'),
      fetchPublicJson<LiveFeatureSeries>('feature_series_historical.json'),
    ])
      .then(
        ([
          today,
          history,
          summary,
          alerts,
          topFeatures,
          featureIndex,
          excluded,
          liveSeries,
          histSeries,
        ]) => {
          setData({
            today,
            history,
            summary,
            alerts: alerts ?? [],
            topFeatures,
            featureIndex,
            featureSeries: mergeFeatureSeries(histSeries, liveSeries),
            historicalReconError:
              histSeries?.day_error && histSeries.dates
                ? { dates: histSeries.dates, day_error: histSeries.day_error }
                : null,
            excludedIds: new Set(excluded?.excluded_ids ?? []),
            loading: false,
            error: null,
          });
        },
      )
      .catch((err) => {
        setData((prev) => ({ ...prev, loading: false, error: String(err) }));
      });
  }, []);

  return <LiveDataContext value={data}>{children}</LiveDataContext>;
}

export function useLiveData(): LiveData {
  const ctx = useContext(LiveDataContext);
  if (!ctx) throw new Error('useLiveData must be used within LiveDataProvider');
  return ctx;
}

// Per-version cache so toggling back and forth doesn't refetch. A present key
// (even with `null` value) means "loaded"; `null` = loaded-but-missing.
const cArchiveCache = new Map<CVersion, LiveFeatureSeries | null>();

/**
 * Feature series for the /monitor simulator, parameterized by representation.
 *
 * `version == null` → the live 128-feature §3 series from the global
 * LiveDataProvider (merged historical+live), returned unchanged.
 *
 * `version in {c0..c3}` → the archive's own `feature_series.json`, fetched
 * directly from `public/data/live/{version}/`. The archive file already spans
 * the full range (Dec 2022 → ~2025-11-30), so it is NOT merged with the §3
 * historical series. A missing file resolves to `null` (the page then shows its
 * existing "no feature series yet" fallback).
 */
export function useVersionedFeatureSeries(version: CVersion | null): {
  featureSeries: LiveFeatureSeries | null;
  loading: boolean;
} {
  const live = useLiveData();
  // Bump to re-render once an async archive fetch resolves; the value itself
  // lives in the module-level cache and is read during render below.
  const [, bump] = useState(0);

  useEffect(() => {
    if (version == null || cArchiveCache.has(version)) return;
    let cancelled = false;
    fetchLiveJson<LiveFeatureSeries>(`${version}/feature_series.json`).then((fs) => {
      cArchiveCache.set(version, fs);
      if (!cancelled) bump((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (version == null) {
    return { featureSeries: live.featureSeries, loading: live.loading };
  }
  const loaded = cArchiveCache.has(version);
  return {
    featureSeries: loaded ? cArchiveCache.get(version) ?? null : null,
    loading: !loaded,
  };
}
