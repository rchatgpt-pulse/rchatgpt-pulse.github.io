import { useState, useEffect, createContext, useContext } from 'react';
import type { Feature, TimeseriesWeek, TimelineEvent, ExamplePost, Clusters, Similarities } from '../types';
// Small JSONs are inlined at build time so they're available synchronously
// — no fetch round-trip, no loading flash for anything that only depends on
// these. The heavier JSONs (timeseries, examples) stay async in public/data
// and are fetched at runtime via the BASE_URL.
import featuresJson from './features.json';
import timelineJson from './timeline.json';
import { initFeatureColors } from '../lib/feature-colors';

const STATIC_FEATURES = featuresJson as unknown as Feature[];
const STATIC_TIMELINE = timelineJson as unknown as TimelineEvent[];

// Populate the feature → color map at module load. STATIC_FEATURES is inlined
// at build time, so this runs synchronously before any component renders and
// `featureColor(id)` resolves correctly from the first paint.
initFeatureColors(STATIC_FEATURES);

const BASE = import.meta.env.BASE_URL;

const EMPTY_SIMILARITIES: Similarities = { n: 0, feature_ids: [], trajectory: null, co_occurrence: null };

interface AppData {
  features: Feature[];
  timeseries: TimeseriesWeek[];
  timeline: TimelineEvent[];
  examples: Record<string, ExamplePost[]>;
  clusters: Clusters;
  similarities: Similarities;
  loading: boolean;
  error: string | null;
}

const DataContext = createContext<AppData | null>(null);

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}data/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

/** Fetch that returns a fallback value on failure instead of rejecting. */
async function fetchJsonOptional<T>(path: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(path);
  } catch {
    return fallback;
  }
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>({
    features: STATIC_FEATURES,
    timeseries: [],
    timeline: STATIC_TIMELINE,
    examples: {},
    clusters: { categories: {}, narrative_groups: {} },
    similarities: EMPTY_SIMILARITIES,
    loading: true,
    error: null,
  });

  useEffect(() => {
    Promise.all([
      fetchJson<TimeseriesWeek[]>('historical_labels.json'),
      fetchJson<Record<string, ExamplePost[]>>('examples.json'),
      fetchJson<Clusters>('clusters.json'),
      fetchJsonOptional<Similarities>('similarities.json', EMPTY_SIMILARITIES),
    ])
      .then(([timeseries, examples, clusters, similarities]) => {
        setData((prev) => ({
          ...prev,
          timeseries,
          examples,
          clusters,
          similarities,
          loading: false,
          error: null,
        }));
      })
      .catch((err) => {
        setData((prev) => ({ ...prev, loading: false, error: err.message }));
      });
  }, []);

  return <DataContext value={data}>{children}</DataContext>;
}

export function useData(): AppData {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
