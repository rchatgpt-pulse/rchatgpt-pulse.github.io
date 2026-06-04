import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data/useData';
import { useLiveData } from '../data/useLiveData';
import SimilarityMap, { TOP_K } from '../components/SimilarityMap';
import { categoryColor, featureColor } from '../lib/feature-colors';
import FeatureList from '../components/FeatureList';
import TimeSeriesChart from '../components/TimeSeriesChart';
import SiteInlineFooter from '../components/site/SiteInlineFooter';
import { expandCondensed, normalizeMatrix } from '../lib/mds';
import type { Feature, TimeseriesWeek } from '../types';

type View = 'map' | 'list';
type DateRange = 'paper' | 'today';
type Metric = 'label' | 'activation';
type SelectedLegendItem = { id: number; color: string; name: string };

const X_AXIS_START = '2023-01-01';
const EXPLORER_PANEL_HEIGHT = 520;
const COMPARISON_CHART_HEIGHT = 350;
const DESKTOP_COMPARISON_LEGEND_TOP = 100;
const LINE_REVEAL_MS = 1700;

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Sunday-anchored week start for the given date (matches historical_labels weeks).
function sundayOf(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return fmtLocal(d);
}

export default function ExploreSection() {
  const { features, timeseries, timeline, examples, similarities } = useData();
  const { featureSeries } = useLiveData();

  const [view, setView] = useState<View>('map');
  const [dateRange, setDateRange] = useState<DateRange>('paper');
  const [metric, setMetric] = useState<Metric>('label');
  const [blend, setBlend] = useState(0.5);
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(() => new Set());
  const [hoverFeatureId, setHoverFeatureId] = useState<number | null>(null);
  const [legendHoverId, setLegendHoverId] = useState<number | null>(null);
  const [lineAnimationActive, setLineAnimationActive] = useState(true);
  const [revealLineIds, setRevealLineIds] = useState<Set<number>>(() => new Set());
  const revealTimeoutsRef = useRef<number[]>([]);
  const rangeAnimationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      for (const timeout of revealTimeoutsRef.current) window.clearTimeout(timeout);
      if (rangeAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(rangeAnimationFrameRef.current);
      }
    };
  }, []);

  const revealLine = (id: number) => {
    setRevealLineIds((prev) => new Set(prev).add(id));
    const timeout = window.setTimeout(() => {
      setRevealLineIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, LINE_REVEAL_MS);
    revealTimeoutsRef.current.push(timeout);
  };

  const changeDateRange = (next: DateRange) => {
    if (next !== dateRange) {
      setLineAnimationActive(false);
      if (rangeAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(rangeAnimationFrameRef.current);
      }
      rangeAnimationFrameRef.current = window.requestAnimationFrame(() => {
        setLineAnimationActive(true);
        rangeAnimationFrameRef.current = null;
      });
    }
    setDateRange(next);
  };

  // Activation-frequency series, recomputed from the merged daily series as
  // Sunday-anchored weekly aggregates: share = sum(n_active)/sum(n_posts).
  // Spans the full available range (paper period + post-paper extension),
  // so the same series drives both date ranges when metric === 'activation'.
  const activationTimeseries = useMemo<TimeseriesWeek[]>(() => {
    if (!featureSeries) return [];
    const { dates, n_posts, features: liveFeatures } = featureSeries;
    const weekPosts = new Map<string, number>();
    const weekActive = new Map<string, Map<number, number>>();

    for (let i = 0; i < dates.length; i++) {
      const wk = sundayOf(dates[i]);
      if (wk < X_AXIS_START) continue;
      weekPosts.set(wk, (weekPosts.get(wk) ?? 0) + n_posts[i]);
      if (!weekActive.has(wk)) weekActive.set(wk, new Map());
    }
    for (const f of liveFeatures) {
      for (let i = 0; i < dates.length; i++) {
        const wk = sundayOf(dates[i]);
        if (wk < X_AXIS_START) continue;
        const bucket = weekActive.get(wk)!;
        bucket.set(f.idx, (bucket.get(f.idx) ?? 0) + f.n_active[i]);
      }
    }

    return Array.from(weekPosts.keys())
      .sort()
      .map((wk) => {
        const np = weekPosts.get(wk) ?? 0;
        const acts = weekActive.get(wk) ?? new Map<number, number>();
        const featRec: Record<string, number> = {};
        for (const [idx, n] of acts) {
          featRec[String(idx)] = np > 0 ? (n / np) * 100 : 0;
        }
        return { week: wk, features: featRec };
      });
  }, [featureSeries]);

  // Labels only cover the paper period (historical_labels.json). Through-today
  // always means activation; in paper-period mode the user picks.
  const hasActivation = activationTimeseries.length > 0;
  const lastActivationWeek = activationTimeseries.length
    ? activationTimeseries[activationTimeseries.length - 1].week
    : '';
  const lastPaperWeek = timeseries.length ? timeseries[timeseries.length - 1].week : '';
  const hasTodayExtension = hasActivation && lastActivationWeek > lastPaperWeek;
  const effectiveMetric: Metric = dateRange === 'today' ? 'activation' : metric;

  const paperActivationTimeseries = useMemo(
    () => activationTimeseries.filter((wk) => wk.week <= lastPaperWeek),
    [activationTimeseries, lastPaperWeek],
  );

  const chartTimeseries: TimeseriesWeek[] =
    effectiveMetric === 'activation'
      ? dateRange === 'paper'
        ? paperActivationTimeseries
        : activationTimeseries
      : timeseries;

  // Keep the visible x-axis independent of the selected metric. Paper mode
  // always shows the paper window for both labels and activations; through-
  // today mode shows the full activation window.
  const xDomainProp: [string, string] = dateRange === 'paper'
    ? [X_AXIS_START, lastPaperWeek || X_AXIS_START]
    : [X_AXIS_START, lastActivationWeek || lastPaperWeek || X_AXIS_START];

  const togglePin = (id: number) => {
    if (!pinnedIds.has(id)) revealLine(id);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Active features (any nonzero prevalence) for the list view.
  const activeFeatures = useMemo(
    () => features.filter((f) => f.early_pct > 0 || f.late_pct > 0),
    [features],
  );

  // Build the map inputs from the condensed similarities. If either matrix is
  // missing, the map mode is disabled and we fall back to list-only.
  const mapInputs = useMemo(() => {
    if (!similarities.trajectory || !similarities.co_occurrence) return null;
    const n = similarities.n;
    const traj = expandCondensed(similarities.trajectory, n);
    const cooc = expandCondensed(similarities.co_occurrence, n);
    return {
      n,
      featureIds: similarities.feature_ids,
      traj,
      cooc,
      simTrajNorm: normalizeMatrix(traj, n),
      simCoocNorm: normalizeMatrix(cooc, n),
    };
  }, [similarities]);

  const canShowMap = mapInputs !== null;
  const effectiveView: View = canShowMap ? view : 'list';

  // ── Side-panel focus: hover (in either view) > most recently pinned. ──
  // We track the hover by feature id so it works across views uniformly.
  const featureById = useMemo(() => {
    const m = new Map<number, Feature>();
    for (const f of features) m.set(f.id, f);
    return m;
  }, [features]);

  const pinnedIdList = useMemo(() => Array.from(pinnedIds), [pinnedIds]);
  const lastPinId = pinnedIdList.length ? pinnedIdList[pinnedIdList.length - 1] : null;
  const focusId = hoverFeatureId ?? lastPinId;
  const focusFeature = focusId != null ? featureById.get(focusId) ?? null : null;

  // Top-K neighbors of focus by current blend, from the similarities matrices.
  const neighbors = useMemo(() => {
    if (!mapInputs || focusId == null) return [] as { id: number; s: number; feature: Feature }[];
    const { n, featureIds, simTrajNorm, simCoocNorm } = mapInputs;
    const focusIdx = featureIds.indexOf(focusId);
    if (focusIdx < 0) return [];
    const arr: { id: number; s: number; feature: Feature }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === focusIdx) continue;
      const s =
        (1 - blend) * simTrajNorm[focusIdx * n + j] +
        blend * simCoocNorm[focusIdx * n + j];
      const id = featureIds[j];
      const f = featureById.get(id);
      if (!f) continue;
      if (f.category === 'other' || f.category === 'uncategorized') continue;
      arr.push({ id, s, feature: f });
    }
    arr.sort((a, b) => b.s - a.s);
    return arr.slice(0, TOP_K);
  }, [mapInputs, focusId, blend, featureById]);

  const selectedIds = useMemo(() => Array.from(pinnedIds), [pinnedIds]);
  const selectedLegendItems = useMemo<SelectedLegendItem[]>(
    () => selectedIds.map((id) => {
      const feature = featureById.get(id);
      return {
        id,
        color: featureColor(id, feature?.category),
        name: feature?.short_name ?? `f${id}`,
      };
    }),
    [featureById, selectedIds],
  );

  return (
    <section className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-3xl font-bold text-text-primary mb-1 pt-2">Explore all features</h2>
        <p className="text-sm text-text-secondary max-w-2xl">
          {/* Click features to see details and pin onto the shared comparison chart below.{' '} */}
          {/* {canShowMap && (
            <>
              In the map, nearby dots are similar — slide between{' '}
              <em>trajectory</em> (how they moved together over time) and{' '}
              <em>co-occurrence</em> (how often they appear in the same post).
            </>
          )} */}
        </p>
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-2 mb-3">
        <div className="inline-flex bg-surface border border-border rounded-lg overflow-hidden p-0.5 gap-0.5">
          <ViewBtn
            label="Map"
            active={effectiveView === 'map'}
            disabled={!canShowMap}
            onClick={() => setView('map')}
            icon={
              <svg width="14" height="14" viewBox="0 0 14 14" className="-mb-0.5">
                <circle cx="3.5" cy="4" r="2" fill="currentColor" opacity="0.7" />
                <circle cx="10.5" cy="5" r="1.4" fill="currentColor" opacity="0.5" />
                <circle cx="7" cy="10" r="1.8" fill="currentColor" opacity="0.8" />
                <circle cx="11" cy="11" r="1" fill="currentColor" opacity="0.4" />
              </svg>
            }
          />
          <ViewBtn
            label="List"
            active={effectiveView === 'list'}
            onClick={() => setView('list')}
            icon={
              <svg width="14" height="14" viewBox="0 0 14 14" className="-mb-0.5">
                <rect x="1" y="2.5" width="12" height="1.2" rx="0.6" fill="currentColor" />
                <rect x="1" y="6.4" width="12" height="1.2" rx="0.6" fill="currentColor" />
                <rect x="1" y="10.3" width="12" height="1.2" rx="0.6" fill="currentColor" />
              </svg>
            }
          />
        </div>
        {!canShowMap && (
          <span className="text-xs text-text-muted italic">
            Map view requires similarities.json — falling back to list.
          </span>
        )}
      </div>

      {/* Map-only help: explains the blend slider and dot encoding. */}
      {effectiveView === 'map' && (
        <p className="text-xs text-text-secondary leading-relaxed mb-3 max-w-2xl">
          <strong>Hover</strong> a dot to see its {TOP_K} nearest neighbors;{' '}
          <strong>click</strong> to pin onto the comparison chart below. Slide between{' '}
          <em>trajectory</em> (how features moved together over time) and{' '}
          <em>co-occurrence</em> (how often they appear in the same post). Dot size: average
          prevalence.
        </p>
      )}

      {/* Body + rail — kept in a two-column grid so the rail's Categories
          legend aligns with the top of the map/list pane (rather than the
          section title). */}
      <div className="grid lg:grid-cols-[1fr_290px] lg:items-start" style={{ gap: 24 }}>
        {/* Left column — map/list body */}
        <div className="h-[360px] min-h-0 md:h-[520px]">
          {effectiveView === 'map' && mapInputs ? (
            <SimilarityMap
              features={features}
              featureIdsInSim={mapInputs.featureIds}
              trajectory={mapInputs.traj}
              cooccurrence={mapInputs.cooc}
              simTrajNorm={mapInputs.simTrajNorm}
              simCoocNorm={mapInputs.simCoocNorm}
              pinnedIds={pinnedIds}
              togglePin={togglePin}
              blend={blend}
              setBlend={setBlend}
              hoverId={hoverFeatureId}
              setHoverId={setHoverFeatureId}
            />
          ) : (
            <div className="h-full">
              <FeatureList
                features={activeFeatures}
                pinnedIds={pinnedIds}
                togglePin={togglePin}
                hoverId={hoverFeatureId}
                setHoverId={setHoverFeatureId}
              />
            </div>
          )}
        </div>

        {/* Site rail — focus panel. Scrolls with the page rather than
            sticking, so the time series chart's release checkboxes below
            don't run into the rail's border. */}
        <aside
          style={{
            borderLeft: '1px solid var(--color-border)',
            padding: '8px 0 8px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            boxSizing: 'border-box',
            height: EXPLORER_PANEL_HEIGHT,
            minHeight: 0,
          }}
        >
          <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', paddingRight: 2 }}>
            {focusFeature ? (
              <FocusPanel
                feature={focusFeature}
                neighbors={neighbors}
                blend={blend}
                pinnedIds={pinnedIds}
                togglePin={togglePin}
                canShowMap={canShowMap}
              />
            ) : (
              <EmptyPanel />
            )}
          </div>
        </aside>
      </div>

      {/* Comparison chart — pinned feature time series. Desktop places the
          external legend outside the chart card on the left, while the card
          itself lines up with the map/list column above. */}
      <div className="relative mt-4 md:mr-44">
        <ComparisonLegend
          items={selectedLegendItems}
          highlightedId={legendHoverId}
          onHighlight={setLegendHoverId}
          onClear={() => setPinnedIds(new Set())}
        />

        <div className="bg-surface border border-border rounded-xl p-4">
          <TimeSeriesChart
            timeseries={chartTimeseries}
            features={features}
            selectedIds={selectedIds}
            timeline={timeline}
            examples={examples}
            showReleasesPanel
            onClearSelection={() => setPinnedIds(new Set())}
            height={COMPARISON_CHART_HEIGHT}
            legendVariant="mobile-floating"
            highlightedFeatureId={legendHoverId}
            headerControls={
            <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-start">
              <div className="grid min-w-0 grid-cols-2 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 sm:inline-flex sm:shrink-0">
                <button
                  onClick={() => changeDateRange('paper')}
                  className={`min-w-0 px-1.5 py-0.5 text-[10px] rounded-md transition-colors sm:px-2 ${
                    dateRange === 'paper'
                      ? 'bg-accent-100 text-accent-700 font-medium'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  Paper period
                </button>
                <button
                  onClick={() => changeDateRange('today')}
                  disabled={!hasTodayExtension}
                  title={hasTodayExtension ? undefined : 'Live data not available'}
                  className={`min-w-0 px-1.5 py-0.5 text-[10px] rounded-md transition-colors sm:px-2 ${
                    dateRange === 'today'
                      ? 'bg-accent-100 text-accent-700 font-medium'
                      : hasTodayExtension
                        ? 'text-text-muted hover:text-text-secondary'
                        : 'text-text-muted/50 cursor-not-allowed'
                  }`}
                >
                  Through today
                </button>
              </div>
              <div className="group relative grid min-w-0 grid-cols-2 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 sm:inline-flex sm:shrink-0">
                <button
                  onClick={() => setMetric('label')}
                  disabled={dateRange === 'today'}
                  className={`min-w-0 px-1.5 py-0.5 text-[10px] rounded-md transition-colors sm:px-2 ${
                    effectiveMetric === 'label'
                      ? 'bg-accent-100 text-accent-700 font-medium'
                      : dateRange === 'today'
                        ? 'text-text-muted/50 cursor-not-allowed'
                        : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  Labels
                </button>
                <button
                  onClick={() => setMetric('activation')}
                  disabled={!hasActivation}
                  className={`min-w-0 px-1.5 py-0.5 text-[10px] rounded-md transition-colors sm:px-2 ${
                    effectiveMetric === 'activation'
                      ? 'bg-accent-100 text-accent-700 font-medium'
                      : hasActivation
                        ? 'text-text-muted hover:text-text-secondary'
                        : 'text-text-muted/50 cursor-not-allowed'
                  }`}
                >
                  Activations
                </button>
                <div className="pointer-events-none absolute top-full left-0 mt-2 hidden w-72 px-3 py-2 rounded-md bg-text-primary text-surface text-[11px] leading-snug opacity-0 group-hover:opacity-100 transition-opacity z-20 md:block">
                  <div className="mb-1">
                    <span className="font-semibold">Labels:</span> share of posts labeled with this topic.
                  </div>
                  <div>
                    <span className="font-semibold">Activations:</span> share of posts where this SAE topic has nonzero activation (n_active / n_posts).
                  </div>
                </div>
              </div>
            </div>
            }
            xDomain={xDomainProp}
            lineAnimationActive={lineAnimationActive}
            revealLineIds={revealLineIds}
          />
        </div>
      </div>

      <SiteInlineFooter />
    </section>
  );
}

// ── Side-panel sub-components ───────────────────────────────────────────────

function ComparisonLegend({
  items,
  highlightedId,
  onHighlight,
  onClear,
}: {
  items: SelectedLegendItem[];
  highlightedId: number | null;
  onHighlight: (id: number | null) => void;
  onClear: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    canScroll: false,
    atTop: true,
    atBottom: true,
  });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const update = () => {
      const canScroll = el.scrollHeight > el.clientHeight + 1;
      setScrollState({
        canScroll,
        atTop: el.scrollTop <= 1,
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
      });
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [items.length]);

  return (
    <div
      className="absolute right-full mr-2 hidden w-32 md:block"
      style={{ top: DESKTOP_COMPARISON_LEGEND_TOP, maxHeight: COMPARISON_CHART_HEIGHT }}
      onMouseLeave={() => onHighlight(null)}
    >
      <div className="relative">
        <div
          ref={scrollerRef}
          className={`flex flex-col gap-1 overflow-y-auto pr-2 ${scrollState.canScroll ? 'pb-7' : ''}`}
          style={{
            maxHeight: COMPARISON_CHART_HEIGHT,
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--color-border-hover) transparent',
          }}
        >
          {items.map((item) => {
            const dimmed = highlightedId != null && highlightedId !== item.id;
            return (
            <div
              key={item.id}
              className={`flex items-center gap-1.5 transition-opacity ${dimmed ? 'opacity-30' : 'opacity-100'}`}
              onMouseEnter={() => onHighlight(item.id)}
            >
              <span className="h-0.5 w-3 shrink-0 rounded" style={{ backgroundColor: item.color }} />
              <span
                className={`text-[10px] leading-tight text-text-secondary ${highlightedId === item.id ? 'font-semibold' : ''}`}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {item.name}
              </span>
            </div>
            );
          })}
          {items.length > 0 && (
            <button
              onClick={onClear}
              className="mt-1.5 self-start text-[10px] text-text-muted underline hover:text-text-secondary"
            >
              Clear
            </button>
          )}
        </div>
        {scrollState.canScroll && !scrollState.atTop && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-bg to-transparent" />
        )}
        {scrollState.canScroll && !scrollState.atBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end justify-center bg-gradient-to-t from-bg via-bg/95 to-transparent pb-0.5">
            <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-[9px] leading-none text-text-muted shadow-sm">
              Scroll for more
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted mb-2">
        Categories (manually assigned)
      </div>
      <div className="flex flex-col gap-1.5">
        {Object.entries({
          Applications: '#d97757',
          Emotion: '#c45a8c',
          'Advanced usage': '#c98b2e',
          'Basic use and exploration': '#b4a04a',
          Customization: '#7b9558',
          'Model or product improvements': '#3f7fb3',
          Perspectives: '#7d6cb0',
          'Product updates': '#9c4f6f',
          'Short-term bugs': '#c25450',
          'Subreddit community': '#a48b3c',
          'Language and terminology': '#5e9ba8',
          'Jailbreaking & content policy': '#a13e3a',
        }).map(([cat, col]) => (
          <div key={cat} className="flex items-center gap-2 text-[13px]">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border border-text-muted/30"
              style={{ background: col }}
            />
            <span className="text-text-secondary">{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FocusPanel({
  feature,
  neighbors,
  blend,
  pinnedIds,
  togglePin,
  canShowMap,
}: {
  feature: Feature;
  neighbors: { id: number; s: number; feature: Feature }[];
  blend: number;
  pinnedIds: Set<number>;
  togglePin: (id: number) => void;
  canShowMap: boolean;
}) {
  const isUp = feature.observed_direction === 'increase';
  const volume = (feature.early_pct + feature.late_pct) / 2;
  return (
    <div>
      <span
        className="inline-block font-mono text-[10px] uppercase tracking-wider text-white font-semibold px-2 py-0.5 rounded mb-2.5"
        style={{ background: categoryColor(feature.category) }}
      >
        {feature.category}
      </span>
      <h3 className="text-xl font-mono text-text-primary leading-tight tracking-tight mb-1.5">
        {feature.short_name}
      </h3>
      <p className="text-[13px] text-text-secondary leading-snug mb-3">
        {feature.interpretation}
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="border border-border rounded-lg px-2.5 py-1.5 bg-accent-50">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Prevalence
          </div>
          <div className="font-bold text-[19px] tabular-nums">{volume.toFixed(2)}%</div>
        </div>
        <div className="border border-border rounded-lg px-2.5 py-1.5 bg-accent-50">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Change
          </div>
          <div
            className={`font-bold text-[19px] tabular-nums ${
              isUp ? 'text-increase-700' : 'text-decrease-700'
            }`}
          >
            {isUp ? '↑' : '↓'} ×{feature.relative_change.toFixed(2)}
          </div>
        </div>
      </div>

      {canShowMap && neighbors.length > 0 && (
        <>
          <div className="font-mono text-[11px] uppercase tracking-wider text-text-primary mb-1.5">
            Nearest {neighbors.length} ·{' '}
            <span className="text-text-muted">
              {blend === 0 ? 'trajectory' : blend === 1 ? 'co-occurrence' : 'blended'}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            {neighbors.map((nb) => {
              const nIsPinned = pinnedIds.has(nb.id);
              return (
                <button
                  key={nb.id}
                  onClick={() => togglePin(nb.id)}
                  className={`grid grid-cols-[12px_1fr_60px] items-center gap-2 px-1.5 py-1.5 text-left rounded-md text-[13px] ${
                    nIsPinned ? 'bg-accent-100 font-semibold' : 'hover:bg-accent-50'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-text-muted/30"
                    style={{ background: featureColor(nb.id, nb.feature.category) }}
                  />
                  <span className="truncate font-mono text-text-primary">
                    {nb.feature.short_name}
                  </span>
                  <span className="h-1.5 bg-accent-50 rounded border border-border overflow-hidden">
                    <span
                      className="block h-full bg-accent-700"
                      style={{ width: `${Math.round(nb.s * 100)}%` }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ViewBtn({
  label,
  active,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-xs uppercase tracking-wider font-semibold transition-colors ${
        active
          ? 'bg-accent-200 text-text-primary'
          : disabled
            ? 'text-text-muted cursor-not-allowed'
            : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
