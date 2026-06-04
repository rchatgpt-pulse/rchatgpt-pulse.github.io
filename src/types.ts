export interface Changepoint {
  date: string;
  p_value: number;
  p_bonferroni: number;
}

export interface Feature {
  id: number;
  short_name: string;
  interpretation: string;
  category: string;
  early_pct: number;
  late_pct: number;
  relative_change: number;
  fitted_relative_change: number;
  observed_direction: 'increase' | 'decline';
  fitted_direction: 'increase' | 'decline';
  p_raw: number;
  p_bonferroni: number;
  is_peak: boolean;
  peak_month: string | null;
  significant: boolean;
  gray: boolean;
  dagger: boolean;
  changepoints?: Changepoint[];
}

export interface TimeseriesWeek {
  week: string;
  features: Record<string, number>;
}

export type PublicEventCategory = 'openai' | 'algorithm' | 'public';

export interface TimelineEvent {
  date: string;
  caption: string;
  event_type: string;
  is_major?: boolean;
  category?: PublicEventCategory;
}

export interface ExamplePost {
  title: string;
  date: string;
  period: string;
}

export interface ClusterCategory {
  name: string;
  feature_ids: number[];
}

export interface NarrativeGroup {
  name: string;
  description: string;
  feature_ids: number[];
}

export interface Clusters {
  categories: Record<string, ClusterCategory>;
  narrative_groups: Record<string, NarrativeGroup>;
}

export interface Similarities {
  n: number;
  feature_ids: number[];
  trajectory: number[] | null;
  co_occurrence: number[] | null;
}

// =============================================================================
// Live monitor types — mirror live/publish.py output schemas.
// =============================================================================

export type LiveWindowKey = '1d' | '7d' | '30d';
export type LiveMetricKey = 'count' | 'mean';

export interface LiveTodayFeature {
  idx: number;
  label: string;
  mean_activation: number;
  n_active: number;
}

export interface LiveToday {
  date: string;
  n_posts: number;
  n_posts_raw: number;
  day_error: number | null; // null on zero-post / degenerate single-post days
  training_error: number;
  factor: number;
  effective_baseline: number;
  model_version?: string | null;
  trained_through?: string | null;
  alert: boolean;
  top_features: LiveTodayFeature[];
}

export interface LiveReconObservation {
  date: string;
  day_error: number;
  wealth: number;
  log_wealth: number;
  rejected: boolean;
}

export interface LiveReconHistory {
  training_error: number;
  factor: number;
  alpha: number;
  effective_baseline: number;
  threshold_log: number;
  observations: LiveReconObservation[];
}

export interface LiveSummary {
  latest_date: string;
  first_observed_date: string | null;
  n_observations: number;
  training_error: number;
  factor: number;
  alpha: number;
  model_version?: string | null;
  current_rejected: boolean;
  ever_rejected: boolean;
}

export interface LiveAlert {
  date: string;
  n_observations: number;
  wealth_at_rejection: number;
}

export interface LiveTopFeatureEntry {
  idx: number;
  label: string;
  mean_activation: number;
  n_active: number;
  rank: number;
  baseline_mean: number | null;
}

export interface LiveBiggestChangeEntry {
  idx: number;
  label: string;
  current_mean: number;
  prior_mean: number;
  rel_change: number;
  current_n_active: number;
  prior_n_active: number;
  n_active_rel_change: number | null;
  baseline_mean: number | null;
  rank: number;
}

export interface LiveBaselineChangeEntry {
  idx: number;
  label: string;
  current_mean: number;
  current_n_active: number;
  baseline_mean: number;
  mean_rel_change: number;
  baseline_n_active_implied: number;
  n_active_rel_change: number | null;
  rank: number;
}

export interface LiveTopFeaturesWindow {
  top: LiveTopFeatureEntry[];
  biggest_change: LiveBiggestChangeEntry[];
  biggest_baseline_change: LiveBaselineChangeEntry[];
  n_posts: number;
  total_n_active: number;
  total_mean_activation: number;
}

export interface LiveTopFeatures {
  as_of: string | null;
  n_observations: number;
  windows: { [key: string]: LiveTopFeaturesWindow };
}

export interface LiveFeatureIndexEntry {
  idx: number;
  label: string;
  baseline_mean: number | null;
  current_1d: number | null;
  current_7d: number | null;
  current_30d: number | null;
  n_active_recent_7d: number;
  trajectory: number[];
}

export interface LiveFeatureIndex {
  model_version: string | null;
  n_observations: number;
  as_of: string | null;
  features: LiveFeatureIndexEntry[];
}

export interface LiveExcludedFeatures {
  excluded_ids: number[];
  rationale?: string;
}

export interface LiveFeatureSeriesEntry {
  idx: number;
  label: string;
  n_active: number[]; // per-day activation count, aligned with `dates`
  mean: number[];     // per-day mean activation magnitude, aligned with `dates`
}

export interface LiveFeatureSeries {
  n_observations: number;
  as_of: string | null;
  dates: string[]; // chronological
  n_posts: number[]; // posts scored per day, aligned with `dates`
  day_error?: (number | null)[]; // per-day recon error aligned with `dates`; null on degenerate (single-post) days (historical file only)
  features: LiveFeatureSeriesEntry[];
}
