// Shared chart color helpers. `getFeatureColor(idx)` / `getFeatureTextColor`
// are stable feature_idx → color mappings so the same feature reads as the
// same color across the pie chart, bar chart, trajectory plots, and the
// site-wide TimeSeriesChart. Both delegate to the per-feature palette in
// `feature-colors.ts` so live `idx` (= feature `id`) lands on the same color
// as the static-site dot for that feature.

import { featureColor, featureTextColor } from './feature-colors';

export function getFeatureColor(idx: number): string {
  return featureColor(idx);
}

export function getFeatureTextColor(idx: number): string {
  return featureTextColor(idx);
}
