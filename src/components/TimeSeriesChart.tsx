import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Label, ZIndexLayer,
  useXAxisScale, useOffset, usePlotArea,
  Curve,
} from 'recharts';
import type { CurveProps } from 'recharts';
import type { TimeseriesWeek, TimelineEvent, Feature, ExamplePost, PublicEventCategory } from '../types';
import { getFeatureColor } from '../lib/colors';

// Colors for category-tagged events overlaid on the chart. Each event is
// either CURRENT (the most-recently-revealed event in its stage) or PAST.
// Past events fade to a neutral gray; the current event renders in full
// color — black for ordinary events, green for the algorithm-alert pin.
const COLOR_CURRENT_DEFAULT = '#111827';   // gray-900 / near black
const COLOR_CURRENT_ALGORITHM = '#16a34a'; // green-600
const COLOR_PAST_ALGORITHM = '#16a34a7d';    // green-300 (faded green — keeps the algorithm pin visually distinct even when not current)
const COLOR_PAST = '#9ca3af';              // gray-400
const MOBILE_CHART_QUERY = '(max-width: 767px)';

function eventColor(category: PublicEventCategory | undefined, isCurrent: boolean): string {
  // Algorithm pin keeps its green color whether current or past — just
  // fades to a lighter green when past so it still stands out from the
  // grayed-out non-algorithm pins.
  if (category === 'algorithm') {
    return isCurrent ? COLOR_CURRENT_ALGORITHM : COLOR_PAST_ALGORITHM;
  }
  if (!isCurrent) return COLOR_PAST;
  return COLOR_CURRENT_DEFAULT;
}

type ScaleMode = 'absolute' | 'relative';

interface Changepoint {
  date: string;
  p_value: number;
  p_bonferroni: number;
}

interface Props {
  timeseries: TimeseriesWeek[];
  features: Feature[];
  selectedIds: number[];
  timeline?: TimelineEvent[];
  examples?: Record<string, ExamplePost[]>;
  changepoints?: Changepoint[];
  showReleasesPanel?: boolean;
  showEvents?: boolean;
  height?: number;
  smooth?: boolean;
  onClearSelection?: () => void;
  /**
   * ISO dates of category-tagged events from `timeline` to render as full
   * callout boxes above the plot area. Other category-tagged events render
   * as small dim dots on the top edge. When undefined or empty, no overlays
   * render and the chart behaves identically to before.
   */
  featuredEventDates?: string[];
  /**
   * Map of event date → callout row (0 = top row, 1 = second row). When
   * provided, overrides the default chronological-alternation row logic.
   */
  eventRows?: Record<string, number>;
  /**
   * Secondary markers rendered with the same callout style as the featured
   * events (box + guide + axis dot) but with a caller-supplied label and
   * row, and always in the past/gray style. Use rows below the featured
   * events to stack them underneath. `date` must match a timeline event.
   */
  minorEvents?: { date: string; label: string; row: number }[];
  /** When false, hides the absolute / relative scale toggle. Default true. */
  showScaleToggle?: boolean;
  /** Optional label rendered alongside the y-axis. */
  yAxisLabel?: string;
  /** Optional controls rendered in the chart card header, left of the scale toggle. */
  headerControls?: ReactNode;
  /** Display style for the selected-feature legend. */
  legendVariant?: 'inline' | 'floating' | 'mobile-floating' | 'external-desktop';
  /** Feature id to emphasize by dimming the other selected lines. */
  highlightedFeatureId?: number | null;
  /** Controls Recharts' line interpolation for mode changes. */
  lineAnimationActive?: boolean;
  /** Feature ids whose newly-added lines should keep the stroke-draw reveal. */
  revealLineIds?: ReadonlySet<number>;
  /**
   * Optional visible x-axis window as [startISO, endISO] (YYYY-MM-DD). When
   * present, the chart still receives the full `timeseries` data but only
   * renders the window in [start, end] (lines outside the window are clipped).
   * Toggling this prop animates as a horizontal compress/expand because the
   * underlying line points stay anchored to absolute timestamps.
   */
  xDomain?: [string, string];
}

// Parse a YYYY-MM-DD week string as a local-time Date so labels don't shift
// into the previous day in Western timezones (e.g. "2023-01-01" was being
// formatted as "Dec 22" because new Date(str) treats it as UTC midnight).
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function formatDateFromTs(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function isoDateFromTs(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type MorphingCurveProps = CurveProps & {
  preserveStrokeDasharray?: boolean;
};

function MorphingCurve({ preserveStrokeDasharray, strokeDasharray, ...props }: MorphingCurveProps) {
  return (
    <Curve
      {...props}
      strokeDasharray={preserveStrokeDasharray ? strokeDasharray : undefined}
    />
  );
}

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_CHART_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(MOBILE_CHART_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function weekToPeriod(weekStr: string): string {
  const d = parseLocalDate(weekStr);
  const half = d.getMonth() < 6 ? 'H1' : 'H2';
  return `${d.getFullYear()}-${half}`;
}

function snapToNearestWeek(eventDate: string, weeks: string[]): string | null {
  if (!weeks.length) return null;
  const target = new Date(eventDate).getTime();
  let best = weeks[0];
  let bestDiff = Math.abs(new Date(weeks[0]).getTime() - target);
  for (const w of weeks) {
    const diff = Math.abs(new Date(w).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = w;
    }
  }
  return best;
}

// ── Custom tooltip ──────────────────────────────────────────────────────────
// The tooltip finds the closest line by reading mouseYFraction from a ref.
// mouseYFraction is 0 at the top of the plot area and 1 at the bottom.
// Each payload value maps to yFraction = 1 - value/yMax.

interface CustomTooltipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  // With a numeric time x-axis, Recharts passes the x value as a number.
  label?: string | number;
  featureMap: Map<number, Feature>;
  scale: ScaleMode;
  yMax: number;
  mouseYFractionRef: React.RefObject<number | null>;
  examples?: Record<string, ExamplePost[]>;
  fontFamily: string;
}

function CustomChartTooltip({ active, payload, label, featureMap, scale, yMax, mouseYFractionRef, examples, fontFamily }: CustomTooltipProps) {
  if (!active || !payload?.length || label == null) return null;

  // With a numeric time x-axis, `label` is a millisecond timestamp.
  const weekIso = typeof label === 'number' ? isoDateFromTs(label) : String(label);
  const dateLabel = new Date(parseLocalDate(weekIso)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const period = weekToPeriod(weekIso);

  // Find the line closest to the cursor Y position. Recharts re-invokes this
  // tooltip on every cursor move, so reading the ref here always reflects the
  // current pointer — the alternative (per-mousemove React state) would re-render
  // the whole chart on each move.
  let focusFid = parseInt(payload[0].name?.replace('f', '') ?? '0');
  /* eslint-disable react-hooks/refs -- intentional ref read: Recharts re-invokes this tooltip on every cursor move, so .current is always current */
  const mouseYFrac = mouseYFractionRef.current;
  if (mouseYFrac != null && payload.length > 1) {
    let bestDist = Infinity;
    for (const entry of payload) {
      const v = Number(entry.value ?? 0);
      // Convert value to Y fraction (0 = top/yMax, 1 = bottom/0)
      const lineFrac = 1 - v / yMax;
      const dist = Math.abs(lineFrac - mouseYFrac);
      if (dist < bestDist) {
        bestDist = dist;
        focusFid = parseInt(entry.name?.replace('f', '') ?? '0');
      }
    }
  }
  /* eslint-enable react-hooks/refs */

  // Get examples for the focused feature in this period
  const focusExamples = examples?.[String(focusFid)]
    ?.filter((ex) => ex.period === period)
    ?.slice(0, 3) ?? [];

  return (
    <div
      className="bg-surface border border-border rounded-lg shadow-lg p-2.5 max-w-xs"
      style={{ fontFamily }}
    >
      <div className="text-[10px] text-text-muted mb-1.5">{dateLabel}</div>
      {payload.map((entry: { name?: string; value?: number; color?: string }) => {
        const fid = parseInt(entry.name?.replace('f', '') ?? '0');
        const feat = featureMap.get(fid);
        const name = feat?.short_name ?? entry.name;
        const v = Number(entry.value ?? 0);
        const formatted = scale === 'relative'
          ? `${Math.round(v * 100)}% of peak`
          : `${v.toFixed(2)}%`;
        const isFocus = fid === focusFid;
        return (
          <div key={entry.name} className={`flex items-center gap-1.5 text-xs ${isFocus ? 'font-semibold' : ''}`}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-text-primary truncate">{name}</span>
            <span className="text-text-muted ml-auto tabular-nums">{formatted}</span>
          </div>
        );
      })}
      {focusExamples.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="text-[9px] uppercase tracking-wide text-text-muted mb-1">
            Top posts ({period}) &mdash; {featureMap.get(focusFid)?.short_name}
          </div>
          {focusExamples.map((ex, i) => (
            <div key={i} className="text-[11px] text-text-secondary leading-snug mb-0.5 line-clamp-2">
              {ex.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

const CHART_MARGIN = { top: 60, right: 10, bottom: 4, left: 10 };
const X_AXIS_HEIGHT = 50;
const Y_AXIS_WIDTH = 50;
const MOBILE_Y_AXIS_WIDTH = 46;

// Start of the visible x-axis. Earlier weeks are filtered out everywhere.
const X_AXIS_START = '2023-01-01';

// ── Category callout overlay ────────────────────────────────────────────────
// Rendered via Recharts' <Customized> so we can look up the xAxis scale and
// compute pixel x-positions for arbitrary dates that exist in the chart data.

const CALLOUT_WIDTH = 168;
const CALLOUT_HEIGHT = 38;
const CALLOUT_TOP_GAP = 6;

interface SnappedEvent extends TimelineEvent {
  snappedWeek: string;
}

interface CategoryCalloutsProps {
  /**
   * Featured events with explicit row + currency pre-assigned by the caller.
   * `row` is fixed for the lifetime of the event; `isCurrent` is true for
   * the most-recently-revealed event in the active stage.
   */
  featured: (SnappedEvent & { row: number; isCurrent: boolean })[];
  /**
   * Secondary events rendered with the same callout style as `featured`
   * (box + guide + axis dot), just with caller-assigned rows and the
   * past/gray style. Merged into the same render pass as featured.
   */
  minor?: (SnappedEvent & { row: number; isCurrent: boolean })[];
}

// Renders inside the LineChart so the Recharts hooks below resolve to the
// active chart's axis scale and plot area (Recharts 3.x API — Customized is
// deprecated and no longer needed).
function CategoryCallouts({ featured, minor = [] }: CategoryCalloutsProps) {
  const xScale = useXAxisScale();
  const offset = useOffset();
  const plotArea = usePlotArea();
  if (!xScale || !offset || !plotArea) return null;

  const plotTop: number = offset.top;
  const plotBottom: number = plotTop + plotArea.height;
  const plotLeft: number = plotArea.x;
  const chartWidth: number = plotArea.x + plotArea.width;

  const ROW_GAP = 4;
  const ROW_HEIGHT = CALLOUT_HEIGHT + ROW_GAP;

  type FullEvent = SnappedEvent & { px: number; row: number; isCurrent: boolean };
  type Placed = { ev: FullEvent; boxLeft: number };
  // Minor markers share the featured render pass so they're styled identically.
  const placed: Placed[] = [...featured, ...minor]
    .map((e): Placed | null => {
      // xScale is a numeric time scale; feed it the snapped week as ms.
      const px = xScale(parseLocalDate(e.snappedWeek).getTime());
      if (typeof px !== 'number') return null;
      const naturalLeft = px - CALLOUT_WIDTH / 2;
      const boxLeft = Math.min(
        Math.max(naturalLeft, plotLeft),
        chartWidth - CALLOUT_WIDTH - 4,
      );
      return { ev: { ...e, px }, boxLeft };
    })
    .filter((p): p is Placed => p !== null);

  // Render past events first, then the current event. Within a row this means
  // the current event's box always overlaps any past event whose x-position
  // it crosses (predictable layering, regardless of date).
  const renderOrder = [...placed].sort((a, b) => {
    if (a.ev.isCurrent !== b.ev.isCurrent) return a.ev.isCurrent ? 1 : -1;
    return a.ev.date < b.ev.date ? -1 : 1;
  });

  const transition = 'stroke 300ms, fill 300ms';
  const boxTransition = 'border-color 300ms, color 300ms';

  return (
    <g pointerEvents="none">
      {/* Per-event vertical guides + axis dots, rendered first. */}
      {renderOrder.map(({ ev }) => {
        const color = eventColor(ev.category, ev.isCurrent);
        const guideTop = plotTop + CALLOUT_TOP_GAP + ev.row * ROW_HEIGHT;
        return (
          <g key={`guide-${ev.date}-${ev.caption}`}>
            <line
              x1={ev.px}
              y1={guideTop + CALLOUT_HEIGHT}
              x2={ev.px}
              y2={plotBottom}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="3 2"
              opacity={0.6}
              style={{ transition }}
            />
            <circle cx={ev.px} cy={plotBottom} r={3.5} fill={color} style={{ transition }} />
          </g>
        );
      })}

      {/* Featured callout boxes — rendered LAST so opaque backgrounds cover
          any data line they overlap. */}
      {renderOrder.map(({ ev, boxLeft }) => {
        const color = eventColor(ev.category, ev.isCurrent);
        const boxCenterX = boxLeft + CALLOUT_WIDTH / 2;
        const boxY = plotTop + CALLOUT_TOP_GAP + ev.row * ROW_HEIGHT;
        return (
          <g key={`callout-${ev.date}-${ev.caption}`}>
            {Math.abs(boxCenterX - ev.px) > 0.5 && (
              <line
                x1={boxCenterX}
                y1={boxY + CALLOUT_HEIGHT}
                x2={ev.px}
                y2={boxY + CALLOUT_HEIGHT}
                stroke={color}
                strokeWidth={1}
                style={{ transition }}
              />
            )}
            <foreignObject
              x={boxLeft}
              y={boxY}
              width={CALLOUT_WIDTH}
              height={CALLOUT_HEIGHT}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  border: `1.5px solid ${color}`,
                  borderRadius: 6,
                  padding: '2px 6px',
                  fontSize: 10,
                  lineHeight: 1.2,
                  fontFamily: 'var(--font-mono)',
                  backgroundColor: '#ffffff',
                  color,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  transition: boxTransition,
                }}
              >
                {ev.caption}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}

export default function TimeSeriesChart({
  timeseries, features, selectedIds, timeline = [], examples, changepoints,
  showReleasesPanel = false, showEvents = true, height = 400, smooth = true,
  onClearSelection, featuredEventDates, eventRows, minorEvents, showScaleToggle = true,
  yAxisLabel, headerControls, legendVariant = 'inline', highlightedFeatureId = null,
  xDomain, lineAnimationActive = true, revealLineIds,
}: Props) {
  const [scale, setScale] = useState<ScaleMode>('absolute');
  const [enabledReleases, setEnabledReleases] = useState<Set<string>>(new Set());
  const chartFontFamily = 'var(--font-mono)';
  const isMobile = useIsMobileViewport();

  // Track mouse Y as fraction of plot area via native mouse events + ref.
  // This avoids React state/memoization issues — the tooltip reads the ref
  // directly each time Recharts calls the content function.
  const mouseYFractionRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const hasCallouts = (featuredEventDates?.length ?? 0) > 0;
  const hasMinor = (minorEvents?.length ?? 0) > 0;
  // The top margin reserves space for release labels. On mobile, keep a
  // compact outside y-axis gutter so tick labels sit just left of the plot.
  const chartMargin = showScaleToggle
    ? (isMobile ? { ...CHART_MARGIN, left: 0, right: 4 } : CHART_MARGIN)
    : { ...CHART_MARGIN, top: 16, left: isMobile ? 0 : CHART_MARGIN.left, right: isMobile ? 4 : CHART_MARGIN.right };
  const legendTopPadding = chartMargin.top + 4;
  const yAxisWidth = isMobile ? MOBILE_Y_AXIS_WIDTH : yAxisLabel ? Y_AXIS_WIDTH + 20 : Y_AXIS_WIDTH;
  const yAxisTick = isMobile
    ? { fontSize: 10, fontFamily: chartFontFamily, fill: '#6b7280', textAnchor: 'end' as const }
    : { fontSize: 11, fontFamily: chartFontFamily };

  const handleNativeMouseMove = useCallback((e: React.MouseEvent) => {
    const container = chartContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const plotTop = chartMargin.top;
    const plotBottom = height - chartMargin.bottom - X_AXIS_HEIGHT;
    const plotHeight = plotBottom - plotTop;
    if (plotHeight <= 0) return;
    const relativeY = e.clientY - rect.top;
    const fraction = (relativeY - plotTop) / plotHeight;
    mouseYFractionRef.current = Math.max(0, Math.min(1, fraction));
  }, [height, chartMargin]);

  const handleNativeMouseLeave = useCallback(() => {
    mouseYFractionRef.current = null;
  }, []);

  const smoothedData = useMemo(() => {
    if (!timeseries.length) return [];
    const raw = timeseries.map((w) => {
      const row: Record<string, number | string> = {
        week: w.week,
        ts: parseLocalDate(w.week).getTime(),
      };
      for (const id of selectedIds) {
        row[`f${id}`] = w.features[String(id)] ?? 0;
      }
      return row;
    });
    let result = raw;
    if (smooth && raw.length >= 5) {
      const windowSize = 2;
      result = raw.map((row, i) => {
        const smoothed: Record<string, number | string> = { week: row.week, ts: row.ts };
        for (const id of selectedIds) {
          const key = `f${id}`;
          let sum = 0;
          let count = 0;
          for (let j = Math.max(0, i - windowSize); j <= Math.min(raw.length - 1, i + windowSize); j++) {
            sum += raw[j][key] as number;
            count++;
          }
          smoothed[key] = Math.round((sum / count) * 1000) / 1000;
        }
        return smoothed;
      });
    }
    // Drop pre-2023 weeks AFTER smoothing so the boundary value at Jan 2023
    // still benefits from neighbouring December 2022 context.
    return result.filter((row) => (row.week as string) >= X_AXIS_START);
  }, [timeseries, selectedIds, smooth]);

  const featureMaxes = useMemo(() => {
    const maxes = new Map<number, number>();
    for (const id of selectedIds) {
      let max = 0;
      for (const row of smoothedData) {
        const v = row[`f${id}`] as number;
        if (v > max) max = v;
      }
      maxes.set(id, max || 1);
    }
    return maxes;
  }, [smoothedData, selectedIds]);

  const chartData = useMemo(() => {
    if (scale === 'absolute') return smoothedData;
    return smoothedData.map((row) => {
      const normalized: Record<string, number | string> = { week: row.week, ts: row.ts };
      for (const id of selectedIds) {
        const key = `f${id}`;
        const max = featureMaxes.get(id) ?? 1;
        normalized[key] = Math.round(((row[key] as number) / max) * 1000) / 1000;
      }
      return normalized;
    });
  }, [smoothedData, selectedIds, scale, featureMaxes]);

  const featureMap = useMemo(() => {
    const map = new Map<number, Feature>();
    for (const f of features) map.set(f.id, f);
    return map;
  }, [features]);

  const majorEvents = useMemo(() => {
    if (!showEvents || !timeline.length || !chartData.length) return [];
    const weeks = chartData.map((d) => d.week as string);
    const start = weeks[0];
    const end = weeks[weeks.length - 1];
    return timeline
      .filter((e) => e.is_major)
      .map((e) => {
        const snapped = snapToNearestWeek(e.date, weeks);
        return snapped ? { ...e, date: snapped } : null;
      })
      .filter((e): e is TimelineEvent => e !== null && e.date >= start && e.date <= end);
  }, [timeline, chartData, showEvents]);

  const featuredCategoryEvents = useMemo<(SnappedEvent & { row: number; isCurrent: boolean })[]>(() => {
    if (!hasCallouts || !timeline.length || !chartData.length) return [];
    const weeks = chartData.map((d) => d.week as string);
    const start = weeks[0];
    const end = weeks[weeks.length - 1];

    // Fixed row assignment: prefer the caller-supplied `eventRows` map.
    // Falls back to alternating rows by chronological order across all
    // category-tagged events when no explicit map is provided.
    const rowByDate = new Map<string, number>();
    if (eventRows) {
      for (const [date, row] of Object.entries(eventRows)) rowByDate.set(date, row);
    } else {
      [...timeline]
        .filter((e) => e.category)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .forEach((ev, idx) => {
          rowByDate.set(ev.date, idx % 2);
        });
    }

    const order = featuredEventDates ?? [];
    const lastIdx = order.length - 1;
    const result: (SnappedEvent & { row: number; isCurrent: boolean })[] = [];
    for (let i = 0; i < order.length; i++) {
      const date = order[i];
      const ev = timeline.find((t) => t.date === date && t.category);
      if (!ev) continue;
      if (ev.date < start || ev.date > end) continue;
      const snapped = snapToNearestWeek(ev.date, weeks);
      if (!snapped) continue;
      result.push({
        ...ev,
        snappedWeek: snapped,
        row: rowByDate.get(date) ?? 0,
        isCurrent: i === lastIdx,
      });
    }
    return result;
  }, [hasCallouts, timeline, chartData, featuredEventDates, eventRows]);

  const snappedMinorEvents = useMemo<(SnappedEvent & { row: number; isCurrent: boolean })[]>(() => {
    if (!hasMinor || !timeline.length || !chartData.length) return [];
    const weeks = chartData.map((d) => d.week as string);
    const start = weeks[0];
    const end = weeks[weeks.length - 1];
    const result: (SnappedEvent & { row: number; isCurrent: boolean })[] = [];
    for (const m of minorEvents ?? []) {
      const ev = timeline.find((t) => t.date === m.date);
      if (!ev || ev.date < start || ev.date > end) continue;
      const snapped = snapToNearestWeek(ev.date, weeks);
      if (!snapped) continue;
      // Caller-supplied label overrides the raw timeline caption; always
      // rendered in the past/gray style (isCurrent: false, no category).
      result.push({ ...ev, caption: m.label, category: undefined, snappedWeek: snapped, row: m.row, isCurrent: false });
    }
    return result;
  }, [hasMinor, timeline, chartData, minorEvents]);

  const visibleFeaturedCategoryEvents = useMemo(() => {
    if (!isMobile) return featuredCategoryEvents;
    const current = featuredCategoryEvents.find((event) => event.isCurrent)
      ?? featuredCategoryEvents[featuredCategoryEvents.length - 1];
    return current ? [{ ...current, row: 0, isCurrent: true }] : [];
  }, [featuredCategoryEvents, isMobile]);

  const snappedChangepoints = useMemo(() => {
    if (!changepoints?.length || !chartData.length) return [];
    const weeks = chartData.map((d) => d.week as string);
    return changepoints.map((cp) => {
      const snapped = snapToNearestWeek(cp.date, weeks);
      return snapped ? { ...cp, date: snapped } : null;
    }).filter((cp): cp is Changepoint => cp !== null);
  }, [changepoints, chartData]);

  const yMax = useMemo(() => {
    if (scale === 'relative') return 1.05;
    let max = 0;
    for (const row of chartData) {
      for (const id of selectedIds) {
        const v = row[`f${id}`] as number;
        if (v > max) max = v;
      }
    }
    return Math.max(0.5, Math.ceil(max * 1.1 * 2) / 2);
  }, [chartData, selectedIds, scale]);

  // Numeric (millisecond) x-domain. When `xDomain` is supplied we use it as
  // the visible window; otherwise we infer it from the chart's own data range.
  // Lines outside the visible window are clipped (allowDataOverflow), so
  // toggling `xDomain` animates as a horizontal compress/expand with all
  // points staying anchored to their absolute timestamps.
  const xDomainTs = useMemo<[number, number] | undefined>(() => {
    if (xDomain) {
      return [parseLocalDate(xDomain[0]).getTime(), parseLocalDate(xDomain[1]).getTime()];
    }
    if (!chartData.length) return undefined;
    const first = chartData[0].ts as number;
    const last = chartData[chartData.length - 1].ts as number;
    return [first, last];
  }, [chartData, xDomain]);

  const toggleRelease = useCallback((caption: string) => {
    setEnabledReleases((prev) => {
      const next = new Set(prev);
      if (next.has(caption)) next.delete(caption);
      else next.add(caption);
      return next;
    });
  }, []);

  const toggleAllReleases = useCallback(() => {
    setEnabledReleases((prev) => {
      if (prev.size === majorEvents.length) return new Set();
      return new Set(majorEvents.map((e) => e.caption));
    });
  }, [majorEvents]);

  // Stable tooltip renderer — reads mouseYFractionRef directly (no state dep)
  const renderTooltip = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => (
      <CustomChartTooltip
        {...props}
        featureMap={featureMap}
        scale={scale}
        yMax={yMax}
        mouseYFractionRef={mouseYFractionRef}
        examples={examples}
        fontFamily={chartFontFamily}
      />
    ),
    [featureMap, scale, yMax, examples, chartFontFamily],
  );

  const isEmpty = !chartData.length || !selectedIds.length;

  const yTickFormatter = scale === 'absolute'
    ? (v: number) => `${v.toFixed(1)}%`
    : (v: number) => `${Math.round(v * 100)}%`;

  const legendItems = selectedIds.length >= 1
    ? selectedIds.map((id) => ({
        id,
        color: getFeatureColor(id),
        name: featureMap.get(id)?.short_name ?? `f${id}`,
      }))
    : [];

  const visibleEvents = majorEvents.filter((e) => enabledReleases.has(e.caption));
  const hasLegend = legendItems.length > 0;
  const desktopFloatingLegend = legendVariant === 'floating';
  const mobileFloatingLegend = legendVariant === 'floating' || legendVariant === 'mobile-floating';
  const hideDesktopLegend = legendVariant === 'mobile-floating' || legendVariant === 'external-desktop';
  const legendPlaceholder = 'Select features to view';
  const hasReleasePanel = showReleasesPanel && majorEvents.length > 0;
  const legendContent = hasLegend ? (
    <>
      {legendItems.map((item) => (
        <div key={item.id} className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 shrink-0 rounded" style={{ backgroundColor: item.color }} />
          <span className="text-[10px] text-text-secondary leading-tight" style={{ fontFamily: chartFontFamily }}>{item.name}</span>
        </div>
      ))}
      {onClearSelection && selectedIds.length > 0 && (
        <button
          onClick={onClearSelection}
          className="mt-1.5 self-start text-[10px] text-text-muted hover:text-text-secondary underline"
        >
          Clear
        </button>
      )}
    </>
  ) : (
    <div className="flex flex-1 items-center justify-center text-center text-[10px] text-text-muted leading-snug" style={{ fontFamily: chartFontFamily }}>
      {legendPlaceholder}
    </div>
  );

  return (
    <div className="relative">
      {(headerControls || showScaleToggle) && (
        <div
          className={`mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between ${desktopFloatingLegend ? 'md:pl-44' : hideDesktopLegend ? '' : 'md:pl-32'}`}
        >
          <div className="min-w-0 max-w-full">{headerControls}</div>
          {showScaleToggle && (
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 self-start md:ml-auto">
            <button
              onClick={() => setScale('absolute')}
              className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                scale === 'absolute' ? 'bg-accent-100 text-accent-700 font-medium' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Absolute
            </button>
            <button
              onClick={() => setScale('relative')}
              className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                scale === 'relative' ? 'bg-accent-100 text-accent-700 font-medium' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Relative
            </button>
            </div>
          )}
          </div>
      )}

      {/* Mobile: compact horizontal legend above the chart */}
      {(hasLegend || mobileFloatingLegend) && (
        <div
          className={
            mobileFloatingLegend
              ? 'md:hidden mb-2 flex min-h-16 w-full flex-col gap-1 rounded-lg border border-border bg-surface/95 px-2.5 py-2 shadow-sm'
              : 'md:hidden mb-2 flex flex-wrap gap-x-3 gap-y-1'
          }
        >
          {legendContent}
        </div>
      )}

      <div className="flex">
        {/* Desktop legend — always reserve the column so the chart width does not jump. */}
        {!hideDesktopLegend && (
          <div
            className={`hidden md:flex shrink-0 flex-col ${desktopFloatingLegend ? 'w-44 pr-1' : 'w-32 pr-3'}`}
            style={desktopFloatingLegend
              ? { height, paddingTop: legendTopPadding, boxSizing: 'border-box' }
              : { maxHeight: height, paddingTop: legendTopPadding }}
          >
            {(hasLegend || desktopFloatingLegend) && (
              <div
                className={
                  desktopFloatingLegend
                    ? 'flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-surface/95 px-2.5 py-2 shadow-sm'
                    : 'flex flex-col gap-1 overflow-y-auto'
                }
              >
                {legendContent}
              </div>
            )}
          </div>
        )}

        {/* Chart — native mouse tracking for closest-line detection */}
        <div
          ref={chartContainerRef}
          className="flex-1 min-w-0 relative"
          onMouseMove={isMobile ? undefined : handleNativeMouseMove}
          onMouseLeave={isMobile ? undefined : handleNativeMouseLeave}
        >
          {isEmpty && (
            <div
              className="absolute inset-0 flex items-center justify-center text-text-muted text-sm z-10 pointer-events-none"
              style={{ height }}
            >
              {legendPlaceholder}
            </div>
          )}
          <ResponsiveContainer width="100%" height={height}>
            <LineChart
              data={chartData.length ? chartData : [{ week: '', ts: parseLocalDate(X_AXIS_START).getTime() }]}
              margin={chartMargin}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={xDomainTs ?? ['dataMin', 'dataMax']}
                allowDataOverflow
                tickFormatter={(ts: number) => formatDateFromTs(ts)}
                tickCount={12}
                tick={{ fontSize: 11, fontFamily: chartFontFamily }}
                angle={-30}
                textAnchor="end"
                height={X_AXIS_HEIGHT}
              />
              <YAxis
                domain={[0, yMax]}
                tick={yAxisTick}
                tickFormatter={yTickFormatter}
                width={yAxisWidth}
                mirror={false}
                tickLine={!isMobile}
                axisLine={!isMobile}
                label={!isMobile && yAxisLabel ? {
                  value: yAxisLabel,
                  angle: -90,
                  position: 'insideLeft',
                  offset: 10,
                  style: {
                    textAnchor: 'middle',
                    fontFamily: chartFontFamily,
                    fontSize: 11,
                    fill: '#6b7280',
                  },
                } : undefined}
              />
              {!isMobile && <Tooltip content={renderTooltip} />}
              {selectedIds.map((id) => {
                const dimmed = highlightedFeatureId != null && id !== highlightedFeatureId;
                return (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={`f${id}`}
                    stroke={getFeatureColor(id)}
                    strokeOpacity={dimmed ? 0.16 : 1}
                    strokeWidth={highlightedFeatureId === id ? 2.5 : 2}
                    dot={false}
                    name={`f${id}`}
                    isAnimationActive={lineAnimationActive}
                    shape={(props: CurveProps) => (
                      <MorphingCurve
                        {...props}
                        preserveStrokeDasharray={revealLineIds?.has(id) ?? false}
                      />
                    )}
                  />
                );
              })}
              {visibleEvents.map((event) => (
                <ReferenceLine
                  key={event.date + event.caption}
                  x={parseLocalDate(event.date).getTime()}
                  stroke="#9ca3af"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                >
                  <Label
                    value={event.caption}
                    position="top"
                    fill="#6b7280"
                    fontSize={9}
                    fontFamily={chartFontFamily}
                    angle={-45}
                    offset={10}
                  />
                </ReferenceLine>
              ))}
              {snappedChangepoints.map((cp) => (
                <ReferenceLine
                  key={'cp-' + cp.date}
                  x={parseLocalDate(cp.date).getTime()}
                  stroke="#dc2626"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                >
                  <Label
                    value={`Changepoint (p=${cp.p_bonferroni < 0.001 ? cp.p_bonferroni.toExponential(1) : cp.p_bonferroni.toFixed(3)})`}
                    position="top"
                    fill="#dc2626"
                    fontSize={9}
                    fontFamily={chartFontFamily}
                    angle={-45}
                    offset={10}
                  />
                </ReferenceLine>
              ))}
              {(hasCallouts || hasMinor) && (
                <ZIndexLayer zIndex={1500}>
                  <CategoryCallouts featured={visibleFeaturedCategoryEvents} minor={snappedMinorEvents} />
                </ZIndexLayer>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Release date checkboxes — desktop only. Absolutely positioned
            against the outer relative div's right edge so the panel sits
            FLUSH outside the chart card's right border. Anchoring with
            `right: -192px` = (card right padding 16) + (panel width 176),
            so the panel renders from `card_right` to `card_right + 176`. */}
        {hasReleasePanel && (
          <div
            className="hidden md:flex absolute w-44 pl-3 flex-col gap-0.5 overflow-y-auto"
            style={{ top: legendTopPadding, right: -192, maxHeight: height }}
          >
            <div className="text-[9px] uppercase tracking-wide text-text-muted mb-1">Releases</div>
            <label className="flex items-center gap-1.5 cursor-pointer mb-1">
              <input
                type="checkbox"
                checked={enabledReleases.size === majorEvents.length && majorEvents.length > 0}
                onChange={toggleAllReleases}
                className="rounded w-2.5 h-2.5"
              />
              <span className="text-[10px] text-text-secondary font-medium">All</span>
            </label>
            {majorEvents.map((event) => (
              <label key={event.caption} className="flex items-start gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledReleases.has(event.caption)}
                  onChange={() => toggleRelease(event.caption)}
                  className="rounded w-2.5 h-2.5 mt-0.5 shrink-0"
                />
                <span className="text-[10px] text-text-secondary leading-tight">{event.caption}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Mobile: release checkboxes are always visible. */}
      {hasReleasePanel && (
        <div className="md:hidden mt-2">
          <div className="text-[11px] text-text-muted">
            Releases ({enabledReleases.size}/{majorEvents.length})
          </div>
          <div className="mt-2 p-2 bg-bg rounded-lg border border-border flex flex-wrap gap-x-3 gap-y-1">
            <label className="flex max-w-full items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enabledReleases.size === majorEvents.length && majorEvents.length > 0}
                onChange={toggleAllReleases}
                className="rounded w-3 h-3"
              />
              <span className="text-[11px] text-text-secondary font-medium">All</span>
            </label>
            {majorEvents.map((event) => (
              <label key={event.caption} className="flex min-w-0 max-w-full items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledReleases.has(event.caption)}
                  onChange={() => toggleRelease(event.caption)}
                  className="rounded w-3 h-3 shrink-0"
                />
                <span className="min-w-0 break-words text-[11px] text-text-secondary leading-tight">{event.caption}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
