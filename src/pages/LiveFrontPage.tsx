import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data/useData';
import { useLiveData } from '../data/useLiveData';
import StackedTopicChart from '../components/StackedTopicChart';
import DashboardNav from '../components/live/DashboardNav';
import SiteInlineFooter from '../components/site/SiteInlineFooter';
import FeatureSwatch from '../components/live/FeatureSwatch';
import TopicPopover from '../components/live/TopicPopover';
import {
  buildFrontPageData,
  MIN_SELECTION_DAYS,
  type FrontPageChange,
} from '../lib/liveFrontPage';
import { getFeatureColor } from '../lib/colors';
import { formatPct, formatX, shortDate } from '../lib/format';

type View = 'top' | 'movers';
type PresetKey = '30d' | '90d' | '1y' | 'full';

const NICE_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceCeil(x: number): number {
  if (x <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / mag;
  const step = NICE_STEPS.find((s) => s >= n - 1e-9) ?? 10;
  return step * mag;
}

type Dir = 'up' | 'down';

/** Mover sidebar display: ratio of recent share to the preceding window's
 *  baseline share, with edge cases for topics that went from zero (or to zero). */
function formatMoverChange(
  share: number,
  baselineShare: number | undefined,
): { text: string; dir: Dir } {
  const baseline = baselineShare ?? 0;
  if (baseline <= 0 && share > 0) return { text: 'new', dir: 'up' };
  if (share <= 0 && baseline > 0) return { text: '×0', dir: 'down' };
  if (baseline <= 0) return { text: '—', dir: 'up' };
  const r = share / baseline;
  return { text: formatX(r), dir: r >= 1 ? 'up' : 'down' };
}

export default function LiveFrontPage() {
  const { features, timeline } = useData();
  const { featureSeries, today, excludedIds, loading } = useLiveData();
  const [view, setView] = useState<View>('top');
  // Selection is in absolute indices into `featureSeries.dates`.
  const [selection, setSelection] = useState<{ sIdx: number; eIdx: number } | null>(null);
  // Active preset drives both the selection (highlighted band) and the chart's
  // x-axis range. `null` means the user manually brushed — the brushed range
  // is in `selection` and the chart falls back to its 2S−E/2E−S rule.
  const [activePreset, setActivePreset] = useState<PresetKey | null>('30d');
  useEffect(() => {
    if (!featureSeries) return;
    const N = featureSeries.dates.length;
    if (N === 0) return;
    if (activePreset === null || activePreset === 'full') {
      // 'full' keeps whatever selection was last in effect; if there's still
      // none (first load straight into 'full' is impossible today, but guard
      // anyway), seed it to the last 30 days.
      if (!selection) {
        const eIdx = N - 1;
        setSelection({ sIdx: Math.max(0, eIdx - 30 + 1), eIdx });
      }
      return;
    }
    const days = activePreset === '30d' ? 30 : activePreset === '90d' ? 90 : 365;
    const eIdx = N - 1;
    setSelection({ sIdx: Math.max(0, eIdx - days + 1), eIdx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureSeries, activePreset]);
  // At most one topic popover open across the entire page. The key is
  // source-prefixed (`top:<idx>` / `inc:<idx>` / `dec:<idx>`) so that the
  // same feature appearing in two lists doesn't render two popovers.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Viewport coords of the click that opened the current popover, used to
  // anchor it next to the cursor instead of the row's edge.
  const [clickPos, setClickPos] = useState<{ x: number; y: number } | null>(null);
  const toggleOpen = (key: string, e?: React.MouseEvent<HTMLElement>) => {
    if (openKey === key) {
      setOpenKey(null);
      setClickPos(null);
      return;
    }
    if (e) {
      // Keyboard activation reports (0, 0); fall back to the trigger row's
      // right edge so the popover still has a meaningful anchor.
      const fromKeyboard = e.clientX === 0 && e.clientY === 0;
      if (fromKeyboard) {
        const r = e.currentTarget.getBoundingClientRect();
        setClickPos({ x: r.right, y: r.top + r.height / 2 });
      } else {
        setClickPos({ x: e.clientX, y: e.clientY });
      }
    }
    setOpenKey(key);
  };
  const closeOpen = () => {
    setOpenKey(null);
    setClickPos(null);
  };

  // Chart x-axis override. '30d' pins to the last 90 days (selection + 60d
  // context); 'full' shows the whole series. Other presets and brushed state
  // fall through to the chart's default 2S−E/2E−S framing.
  const chartWindowOverride = useMemo(() => {
    if (!featureSeries) return undefined;
    const N = featureSeries.dates.length;
    if (N === 0) return undefined;
    if (activePreset === 'full') return { winStart: 0, winEnd: N - 1 };
    if (activePreset === '30d') return { winStart: Math.max(0, N - 90), winEnd: N - 1 };
    return undefined;
  }, [featureSeries, activePreset]);
  const data = useMemo(
    () =>
      featureSeries && selection
        ? buildFrontPageData(
            features,
            featureSeries,
            today,
            timeline,
            selection,
            excludedIds,
            chartWindowOverride,
          )
        : null,
    [features, featureSeries, today, timeline, selection, excludedIds, chartWindowOverride],
  );

  if (loading) {
    return <div className="max-w-[1280px] mx-auto px-6 py-12 text-text-muted">Loading…</div>;
  }

  if (!data) {
    return (
      <div className="max-w-[1280px] mx-auto px-6 py-12">
        <div className="bg-surface rounded-xl border border-border p-6 text-text-secondary">
          <h1 className="font-heading text-2xl font-bold text-text-primary mb-2">No data yet</h1>
          <p>The daily feature series hasn't been published yet.</p>
        </div>
      </div>
    );
  }

  const topics = view === 'top' ? data.topTopics : data.topMovers;
  const stacks = view === 'top' ? data.topTopicsStacks : data.topMoversStacks;
  const maxStack = view === 'top' ? data.topTopicsMaxStack : data.topMoversMaxStack;
  const colors = topics.map((t) => getFeatureColor(t.idx));
  const maxVolume = data.windowVolume.length ? Math.max(...data.windowVolume) : 0;
  const yMax = niceCeil(Math.max(maxStack, maxVolume) * 1.06);

  const selLabel = `${shortDate(data.selectionStart)} – ${shortDate(data.selectionEnd)} · ${data.selectionDays}-day window`;
  const handleBrush = (start: number, end: number) => {
    setSelection({ sIdx: data.winStart + start, eIdx: data.winStart + end });
    setActivePreset(null);
  };

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-9 md:px-12">
      <DashboardNav />

      <div style={{ marginTop: 24 }}>
      {/* Lead chart card */}
      <section className="bg-surface border border-border rounded-xl mb-7" style={{ padding: '18px 20px 14px' }}>
        <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
          <div>
            <h2
              className="font-heading font-bold text-text-primary"
              style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.01em' }}
            >
              {view === 'top'
                ? 'Top topics by daily post volume'
                : 'Topics with the biggest recent change, by daily post volume'}
            </h2>
            <div
              className="italic text-text-muted"
              style={{ fontSize: 13, marginTop: 4, maxWidth: 640 }}
            >
              {selLabel} · posts/day · line: total posts/day
            </div>
          </div>
          <ViewToggle value={view} onChange={setView} />
        </div>

        <div className="flex flex-col lg:flex-row gap-5">
          {/* Plot + brush hint */}
          <div className="flex-1 min-w-0">
            <StackedTopicChart
              topics={topics}
              stacks={stacks}
              volume={data.windowVolume}
              dates={data.windowDates}
              colors={colors}
              yMax={yMax}
              events={data.events}
              xTickCount={7}
              selection={{ startIdx: data.selStartInWindow, endIdx: data.selEndInWindow }}
              onSelectionChange={handleBrush}
              minSelectionDays={MIN_SELECTION_DAYS}
            />
            <div
              className="mt-3 flex items-center justify-between gap-3 font-mono text-text-muted"
              style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              <span>drag on chart to set window (min {MIN_SELECTION_DAYS} days)</span>
              <PresetRow active={activePreset} onChange={setActivePreset} />
            </div>
          </div>

          {/* Ranked top-8 list */}
          <div className="shrink-0 lg:w-[340px]">
            {topics.map((t, i) => {
              const key = `top:${t.idx}`;
              const moverDisplay =
                view === 'movers' ? formatMoverChange(t.share, t.baselineShare) : null;
              return (
                <TopRow
                  key={t.idx}
                  idx={t.idx}
                  rank={i + 1}
                  name={t.label}
                  value={moverDisplay ? moverDisplay.text : formatPct(t.share)}
                  valueDir={moverDisplay ? moverDisplay.dir : null}
                  isOpen={openKey === key}
                  clickPos={openKey === key ? clickPos : null}
                  onToggle={(e) => toggleOpen(key, e)}
                  onClose={closeOpen}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Biggest changes — carded to match the lead panel above */}
      <section
        className="bg-surface border border-border rounded-xl"
        style={{ padding: '18px 20px 14px' }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h3
              className="font-heading font-bold text-text-primary"
              style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.01em' }}
            >
              Biggest changes vs paper baseline
            </h3>
            <div
              className="italic text-text-muted"
              style={{ fontSize: 13, marginTop: 4, maxWidth: 540 }}
            >
              share over the selected window vs mean share over the paper period (Dec 2022 – Nov 2025)
            </div>
          </div>
          <Link
            to="/monitor"
            className="italic text-text-secondary hover:text-text-primary transition-colors"
            style={{
              fontSize: 13,
              textDecoration: 'underline',
              textDecorationColor: 'var(--color-border)',
              textUnderlineOffset: 3,
            }}
          >
            → Simulator tab to test a specific topic
          </Link>
        </div>
        <div className="grid md:grid-cols-2 gap-x-7">
          <div>
            <SubLabel dir="up">Increasing</SubLabel>
            {data.changesIncreasing.map((c) => {
              const key = `inc:${c.idx}`;
              return (
                <ChangeRow
                  key={c.idx}
                  change={c}
                  dir="up"
                  isOpen={openKey === key}
                  clickPos={openKey === key ? clickPos : null}
                  onToggle={(e) => toggleOpen(key, e)}
                  onClose={closeOpen}
                />
              );
            })}
          </div>
          <div>
            <SubLabel dir="down">Declining</SubLabel>
            {data.changesDeclining.map((c) => {
              const key = `dec:${c.idx}`;
              return (
                <ChangeRow
                  key={c.idx}
                  change={c}
                  dir="down"
                  isOpen={openKey === key}
                  clickPos={openKey === key ? clickPos : null}
                  onToggle={(e) => toggleOpen(key, e)}
                  onClose={closeOpen}
                />
              );
            })}
          </div>
        </div>
      </section>
      </div>

      <SiteInlineFooter />
    </div>
  );
}

const PRESET_OPTIONS: { value: PresetKey; label: string }[] = [
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y', label: '1y' },
  { value: 'full', label: 'full window' },
];

function PresetRow({
  active,
  onChange,
}: {
  active: PresetKey | null;
  onChange: (v: PresetKey) => void;
}) {
  return (
    <div className="flex gap-1.5" style={{ fontSize: 11, letterSpacing: '0.06em' }}>
      {PRESET_OPTIONS.map((o) => {
        const isActive = o.value === active;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`font-mono uppercase rounded-md border px-3 py-1.5 cursor-pointer transition-colors ${
              isActive
                ? 'bg-text-primary text-surface border-text-primary'
                : 'bg-surface text-text-secondary border-border hover:border-text-primary'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <Segmented
      options={[
        { value: 'top', label: 'Top topics' },
        { value: 'movers', label: 'Top movers' },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5" style={{ fontSize: 11, letterSpacing: '0.06em' }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`font-mono uppercase rounded-md border px-3 py-1.5 cursor-pointer transition-colors ${
              active
                ? 'bg-text-primary text-surface border-text-primary'
                : 'bg-surface text-text-secondary border-border hover:border-text-primary'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SubLabel({ dir, children }: { dir: 'up' | 'down'; children: React.ReactNode }) {
  return (
    <div className="pb-1 mb-1">
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color:
            dir === 'up'
              ? 'var(--color-increase-700)'
              : 'var(--color-decrease-700)',
        }}
      >
        {children}
      </span>
    </div>
  );
}

interface TriggerRowProps {
  idx: number;
  isOpen: boolean;
  /** Viewport coords of the click that opened the popover; null when closed. */
  clickPos: { x: number; y: number } | null;
  onToggle: (e: React.MouseEvent<HTMLElement>) => void;
  onClose: () => void;
  /** Extra flex classes for the inner button — TopRow uses items-start
   *  gap-2.5, ChangeRow uses items-center gap-3. */
  flexClass: string;
  /** Optional bottom rule. 'none' = no rule (default for the top-8 list,
   *  where rank numbers + swatches carry the visual rhythm). 'light' =
   *  ~55% border, used by the changes lists as an alignment grid. */
  divider?: 'none' | 'light';
  children: React.ReactNode;
}

function TriggerRow({
  idx,
  isOpen,
  clickPos,
  onToggle,
  onClose,
  flexClass,
  divider = 'none',
  children,
}: TriggerRowProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const borderBottom =
    divider === 'light'
      ? '1px solid color-mix(in oklab, var(--color-border) 55%, transparent)'
      : '0';
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`flex w-full text-left bg-transparent hover:bg-bg transition-colors cursor-pointer ${flexClass}`}
        style={{ padding: '7px 0', border: 0, borderBottom }}
      >
        {children}
      </button>
      {isOpen && clickPos && (
        <TopicPopover idx={idx} triggerRef={triggerRef} clickPos={clickPos} onClose={onClose} />
      )}
    </div>
  );
}

interface RowPopoverProps {
  isOpen: boolean;
  clickPos: { x: number; y: number } | null;
  onToggle: (e: React.MouseEvent<HTMLElement>) => void;
  onClose: () => void;
}

function TopRow({
  idx,
  rank,
  name,
  value,
  valueDir,
  ...row
}: {
  idx: number;
  rank: number;
  name: string;
  value: string;
  /** When set, render `value` as a direction-colored badge (mover view). */
  valueDir?: Dir | null;
} & RowPopoverProps) {
  const badgeClass =
    valueDir === 'up'
      ? 'bg-increase-50 text-increase-700 rounded'
      : valueDir === 'down'
        ? 'bg-decrease-50 text-decrease-700 rounded'
        : 'text-text-primary';
  const badgeStyle: React.CSSProperties = valueDir
    ? { fontSize: 12, padding: '2px 5px' }
    : { fontSize: 12, marginTop: 1 };
  return (
    <TriggerRow idx={idx} flexClass="items-start gap-2.5" {...row}>
      <span
        className="font-mono tabular-nums text-text-muted text-right shrink-0"
        style={{ width: 14, fontSize: 12, marginTop: 1 }}
      >
        {rank}
      </span>
      <FeatureSwatch idx={idx} style={{ marginTop: 5 }} />
      <span className="flex-1 font-mono text-text-primary" style={{ fontSize: 13, lineHeight: 1.25 }}>
        {name}
      </span>
      <span
        className={`font-mono tabular-nums font-semibold shrink-0 ${badgeClass}`}
        style={badgeStyle}
      >
        {value}
      </span>
    </TriggerRow>
  );
}

function ChangeRow({
  change,
  dir,
  ...row
}: { change: FrontPageChange; dir: 'up' | 'down' } & RowPopoverProps) {
  return (
    <TriggerRow idx={change.idx} flexClass="items-center gap-3" divider="light" {...row}>
      <FeatureSwatch idx={change.idx} />
      <span className="flex-1">
        <div className="font-mono text-text-primary" style={{ fontSize: 14 }}>
          {change.name}
        </div>
        <div className="font-mono text-text-muted" style={{ fontSize: 11 }}>
          {change.baselinePct.toFixed(2)}% → {change.recentPct.toFixed(2)}%
        </div>
      </span>
      <span
        className={`font-mono tabular-nums rounded ${
          dir === 'up' ? 'bg-increase-50 text-increase-700' : 'bg-decrease-50 text-decrease-700'
        }`}
        style={{ fontSize: 13, padding: '4px 6px' }}
      >
        {formatX(change.ratio)}
      </span>
    </TriggerRow>
  );
}
