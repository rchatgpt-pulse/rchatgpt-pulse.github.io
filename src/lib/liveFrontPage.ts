// Derives everything the live front page ("The r/ChatGPT Pulse") renders, from
// the existing data hooks — `useData()` (paper-period features.json + timeline)
// and `useLiveData()` (merged historical+live daily series + today snapshot).
// No JSON is fetched here; the page passes the hook outputs in.

import type { Feature, TimelineEvent, LiveFeatureSeries, LiveToday } from '../types';
import type { ChartEvent } from '../components/StackedTopicChart';
import { computeLiveStats } from './useLiveStats';

// Selection window into the merged daily series. Both indices are inclusive
// into series.dates; the page drives this from a brush gesture on the chart.
export interface SelectionWindow {
  sIdx: number;
  eIdx: number;
}

export const MIN_SELECTION_DAYS = 30;

export interface FrontPageTopic {
  idx: number;
  label: string;
  /** Mean share over the list window, as a percent (e.g. 5.21). */
  share: number;
  /** Mean share over the immediately preceding equal-length window, percent.
   *  Populated for movers so the sidebar can show change vs baseline. */
  baselineShare?: number;
}

export interface FrontPageChange {
  idx: number;
  name: string;
  ratio: number; // recent / paper-baseline
  baselinePct: number; // paper-period mean share, percent
  recentPct: number; // recent mean share, percent
}

export interface FrontPageData {
  lastDate: string;
  postsToday: number;
  nPostsLast7d: number;
  nPostsLast30d: number;
  windowDates: string[];
  /** Total posts/day over the chart window, 7-day smoothed (overlay line + hover). */
  windowVolume: number[];
  topTopics: FrontPageTopic[];
  topMovers: FrontPageTopic[];
  /** [day][topic] attributed post counts over the chart window. */
  topTopicsStacks: number[][];
  topMoversStacks: number[][];
  topTopicsMaxStack: number;
  topMoversMaxStack: number;
  changesIncreasing: FrontPageChange[];
  changesDeclining: FrontPageChange[];
  events: ChartEvent[];
  /** Selection band position relative to `windowDates` (so the chart can shade
   *  [S, E] without re-deriving it from absolute series indices). */
  selStartInWindow: number;
  selEndInWindow: number;
  /** Index of windowDates[0] within the full series, so callers can convert
   *  chart-relative indices reported by the brush back to absolute. */
  winStart: number;
  /** Absolute selection bounds (into series.dates). */
  selectionStart: string;
  selectionEnd: string;
  selectionDays: number;
}

const PAPER_CUTOFF = '2025-11-30'; // fallback paper-period end (today.trained_through)
const TOP_NOISE_FLOOR = 0.4; // %, top-topics only
const CHANGE_FLOOR = 0.0005; // 0.05% as a fraction — avoids degenerate paper-baseline ratios
const PLACEHOLDER = /^Feature \d+$/i;
const PLACEHOLDER_SNAKE = /^feature_\d+$/i;

function isPlaceholderLabel(label: string): boolean {
  return PLACEHOLDER.test(label) || PLACEHOLDER_SNAKE.test(label);
}

/** Fraction of posts on day `d` in which the feature is active. */
function dailyShare(nActive: number, nPosts: number): number {
  return nPosts > 0 ? nActive / nPosts : 0;
}

/** Mean daily share over the half-open index range [from, to). */
function meanShare(nActive: number[], nPosts: number[], from: number, to: number): number {
  const lo = Math.max(0, from);
  const hi = Math.min(nPosts.length, to);
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += dailyShare(nActive[i], nPosts[i]);
  return sum / (hi - lo);
}

/** Trailing 7-day rolling mean across the whole series. */
function rollingMean7(arr: number[]): number[] {
  return arr.map((_, i) => {
    const lo = Math.max(0, i - 6);
    let sum = 0;
    for (let j = lo; j <= i; j++) sum += arr[j];
    return sum / (i - lo + 1);
  });
}

export function buildFrontPageData(
  features: Feature[],
  series: LiveFeatureSeries,
  today: LiveToday | null,
  timeline: TimelineEvent[],
  selection: SelectionWindow,
  excludedIds: Set<number> = new Set(),
  /** Override the chart x-axis range. Used to show the full series on the
   *  initial unbrushed view; otherwise the chart spans
   *  [max(0, 2·S − E), min(N−1, 2·E − S)] around the selection. */
  chartWindow?: { winStart: number; winEnd: number },
): FrontPageData {
  const { dates, n_posts } = series;
  const N = dates.length;
  const sIdx = Math.max(0, Math.min(N - 1, selection.sIdx));
  const eIdx = Math.max(sIdx, Math.min(N - 1, selection.eIdx));
  const listDays = eIdx - sIdx + 1;

  // Chart window: caller-supplied (e.g. full history) or, by default, one
  // selection-length of context on each side of [S, E] (clipped).
  const winStart = chartWindow
    ? Math.max(0, Math.min(N - 1, chartWindow.winStart))
    : Math.max(0, 2 * sIdx - eIdx);
  const winEnd = chartWindow
    ? Math.max(winStart, Math.min(N - 1, chartWindow.winEnd))
    : Math.min(N - 1, 2 * eIdx - sIdx);
  const windowDates = dates.slice(winStart, winEnd + 1);
  const windowLen = windowDates.length;

  const byId = new Map<number, Feature>(features.map((f) => [f.id, f]));

  // Paper-period baseline cutoff (mean share Dec 2022 → ~Nov 2025).
  const cutoff = today?.trained_through ?? PAPER_CUTOFF;
  let cutoffIdx = dates.findIndex((d) => d > cutoff);
  if (cutoffIdx === -1) cutoffIdx = N;

  // A post activates exactly 4 SAE features, but most are "gray"/placeholder
  // (non-topics the site hides) — only ~1.7 REAL topics per post on average.
  // Give each post a weight of 1 split across its real topics, so the full
  // real-topic stack sums to posts/day (each post counted exactly once;
  // fractions arise only when a post spans multiple real topics).
  const isReal = (f: { idx: number; label: string }): boolean =>
    !isPlaceholderLabel(f.label) && !byId.get(f.idx)?.gray && !excludedIds.has(f.idx);
  const realAct = new Array(N).fill(0);
  for (const f of series.features) {
    if (!isReal(f)) continue;
    for (let i = 0; i < N; i++) realAct[i] += f.n_active[i];
  }
  const effectiveCount = (nActive: number[], day: number): number =>
    realAct[day] > 0 ? (nActive[day] * n_posts[day]) / realAct[day] : 0;

  // ── Masthead numbers ────────────────────────────────────────────────
  const { lastDate, postsToday, last7d: nPostsLast7d, last30d: nPostsLast30d } =
    computeLiveStats(series, today);

  // ── Total volume over the chart window (7-day smoothed) ──────────────
  const windowVolume = rollingMean7(n_posts).slice(winStart, winEnd + 1);

  // ── Candidate features ──────────────────────────────────────────────
  interface Cand {
    idx: number;
    label: string;
    nActive: number[];
    recent: number; // mean share over the list window
    moversBaseline: number; // mean share over the preceding list window
    paperBaseline: number; // mean share over the paper period
  }

  const candidates: Cand[] = [];
  for (const f of series.features) {
    if (!isReal(f)) continue;
    candidates.push({
      idx: f.idx,
      label: f.label,
      nActive: f.n_active,
      recent: meanShare(f.n_active, n_posts, sIdx, eIdx + 1),
      moversBaseline: meanShare(f.n_active, n_posts, sIdx - listDays, sIdx),
      paperBaseline: meanShare(f.n_active, n_posts, 0, cutoffIdx),
    });
  }

  // ── Top topics: top 8 by mean share over the list window ────────────
  const topTopics: FrontPageTopic[] = candidates
    .filter((c) => c.recent * 100 > TOP_NOISE_FLOOR)
    .sort((a, b) => b.recent - a.recent)
    .slice(0, 8)
    .map((c) => ({ idx: c.idx, label: c.label, share: c.recent * 100 }));

  // ── Top movers: top 8 by largest change in either direction ─────────
  const moverScore = (c: Cand): number => {
    if (c.recent <= 0 && c.moversBaseline <= 0) return 0;
    if (c.recent <= 0 || c.moversBaseline <= 0) return Infinity;
    return Math.max(c.recent / c.moversBaseline, c.moversBaseline / c.recent);
  };
  const topMovers: FrontPageTopic[] = candidates
    .slice()
    .sort((a, b) => moverScore(b) - moverScore(a))
    .slice(0, 8)
    .map((c) => ({
      idx: c.idx,
      label: c.label,
      share: c.recent * 100,
      baselineShare: c.moversBaseline * 100,
    }));

  // ── Per-topic attributed counts, 7-day smoothed, over the chart window ─
  const byIdxSeries = new Map(series.features.map((f) => [f.idx, f]));
  const stacksFor = (topics: FrontPageTopic[]): { matrix: number[][]; maxStack: number } => {
    // Smooth the full series before slicing so the window edge isn't biased.
    const smoothed = topics.map((t) => {
      const f = byIdxSeries.get(t.idx);
      if (!f) return new Array(N).fill(0);
      return rollingMean7(f.n_active.map((_, day) => effectiveCount(f.n_active, day)));
    });
    const matrix: number[][] = [];
    let maxStack = 0;
    for (let d = 0; d < windowLen; d++) {
      const day = winStart + d;
      let stack = 0;
      const row = smoothed.map((s) => {
        stack += s[day];
        return s[day];
      });
      if (stack > maxStack) maxStack = stack;
      matrix.push(row);
    }
    return { matrix, maxStack };
  };

  const top = stacksFor(topTopics);
  const movers = stacksFor(topMovers);

  // ── Biggest changes: live recent share vs paper-period mean share ───
  const withRatio = candidates
    .filter((c) => c.paperBaseline >= CHANGE_FLOOR && c.recent >= CHANGE_FLOOR)
    .map((c) => ({
      idx: c.idx,
      name: c.label,
      ratio: c.recent / c.paperBaseline,
      baselinePct: c.paperBaseline * 100,
      recentPct: c.recent * 100,
    }));
  const changesIncreasing = withRatio
    .filter((c) => c.ratio > 1)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);
  const changesDeclining = withRatio
    .filter((c) => c.ratio < 1)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 5);

  // ── Event annotations within the chart window ───────────────────────
  const winFrom = windowDates[0] ?? '';
  const winTo = windowDates[windowLen - 1] ?? '';
  const events: ChartEvent[] = timeline
    .filter(
      (e) =>
        e.is_major &&
        e.category === 'openai' &&
        e.caption !== 'GPT-4o' &&
        e.date >= winFrom &&
        e.date <= winTo,
    )
    .map((e) => {
      let i = windowDates.findIndex((d) => d >= e.date);
      if (i < 0) i = windowLen - 1;
      return { x: windowLen > 1 ? i / (windowLen - 1) : 0, label: e.caption };
    })
    .slice(0, 4);

  return {
    lastDate,
    postsToday,
    nPostsLast7d,
    nPostsLast30d,
    windowDates,
    windowVolume,
    topTopics,
    topMovers,
    topTopicsStacks: top.matrix,
    topMoversStacks: movers.matrix,
    topTopicsMaxStack: top.maxStack,
    topMoversMaxStack: movers.maxStack,
    changesIncreasing,
    changesDeclining,
    events,
    selStartInWindow: sIdx - winStart,
    selEndInWindow: eIdx - winStart,
    winStart,
    selectionStart: dates[sIdx],
    selectionEnd: dates[eIdx],
    selectionDays: listDays,
  };
}
