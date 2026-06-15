import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useVersionedFeatureSeries, useLiveData } from '../data/useLiveData';
import { C_VERSIONS, C_TRAINED_THROUGH, type CVersion } from '../data/cVersions';
import { useData } from '../data/useData';
import { simulate, type Direction } from '../lib/sequentialTest';
import { getFeatureColor } from '../lib/colors';
import DashboardNav from '../components/live/DashboardNav';
import SiteInlineFooter from '../components/site/SiteInlineFooter';

const DEFAULT_ALPHA = 0.1; // live_config.ALPHA
const DEFAULT_BETA = 1.05; // live_config.BETA
const DISPLAY_SMOOTH_WINDOW = 28;

function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// `?model=c{0..3}` selects a §4 PuLSE archive representation; anything else
// (including no param) is the live 128-feature §3 model.
function parseModel(raw: string | null): CVersion | null {
  return raw && (C_VERSIONS as string[]).includes(raw) ? (raw as CVersion) : null;
}

// Centered rolling mean used purely for the chart trace — the sequential test
// always runs on the raw daily series. For even windows we take
// `window/2 - 1` days before and `window/2` days after each index. Edges use
// whatever days are available.
function centeredRollingMean(values: number[], window: number): number[] {
  const after = Math.floor(window / 2);
  const before = window - 1 - after;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - before);
    const hi = Math.min(values.length - 1, i + after);
    let sum = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      const v = values[j];
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    out[i] = n > 0 ? sum / n : NaN;
  }
  return out;
}

export default function LiveSimulatorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const version = parseModel(searchParams.get('model'));
  const { featureSeries, loading } = useVersionedFeatureSeries(version);
  const { today } = useLiveData();
  const { features: catalogFeatures } = useData();

  const [search, setSearch] = useState('');
  // Seed from ?feature=<idx> on first mount so popover CTAs from /live can
  // deep-link to a specific feature.
  const [featureIdx, setFeatureIdx] = useState<number | null>(() => {
    const raw = searchParams.get('feature');
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  });
  // User-driven feature selection clears the URL param so a refresh after
  // changing features doesn't snap back to the deep-linked one.
  const selectFeature = (idx: number | null) => {
    setFeatureIdx(idx);
    if (searchParams.has('feature')) {
      const next = new URLSearchParams(searchParams);
      next.delete('feature');
      setSearchParams(next, { replace: true });
    }
  };
  const [startIdx, setStartIdx] = useState<number | null>(null);
  const [alpha, setAlpha] = useState(String(DEFAULT_ALPHA));
  const [beta, setBeta] = useState(String(DEFAULT_BETA));
  const [bonferroni, setBonferroni] = useState('');
  const [direction, setDirection] = useState<Direction>('increase');
  // Which daily per-feature series the §4 test runs on:
  //   'count' → n_active / n_posts (fraction of posts where the feature fired)
  //   'mean'  → mean activation magnitude across all posts that day
  const [metric, setMetric] = useState<'count' | 'mean'>('count');
  const [showWealth, setShowWealth] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [baselineStartIdx, setBaselineStartIdx] = useState<number | null>(null);
  const [baselineEndIdx, setBaselineEndIdx] = useState<number | null>(null);

  // Switch representation (live 128f vs a c{0..3} archive). The feature-index
  // space and date range differ between models, so reset the feature selection
  // and all date/window state; the start-date defaults below recompute and the
  // existing clamp snaps `startIdx` into the (shorter) archive range.
  const selectModel = (v: CVersion | null) => {
    if (v === version) return;
    const next = new URLSearchParams(searchParams);
    if (v) next.set('model', v);
    else next.delete('model');
    next.delete('feature');
    setSearchParams(next, { replace: true });
    setFeatureIdx(null);
    setStartIdx(null);
    setBaselineStartIdx(null);
    setBaselineEndIdx(null);
    setSearch('');
  };

  const features = useMemo(() => featureSeries?.features ?? [], [featureSeries]);
  const dates = useMemo(() => featureSeries?.dates ?? [], [featureSeries]);

  // The representation's training cutoff: archives carry an explicit date; the
  // live model is trained through `today.trained_through` (falling back to the
  // paper-period end). Days on/after the cutoff are out-of-sample.
  const trainedThrough = version ? C_TRAINED_THROUGH[version] : today?.trained_through ?? '2025-11-30';

  // Start date must leave ≥1 pre-start day (for μ₀) and ≥1 post-start day.
  const startOptions = useMemo(() => dates.slice(1), [dates]);
  // Default the test start to the training cutoff (first option on/after it), so
  // the simulation runs on the out-of-sample period. Falls back to the last
  // option if the cutoff is at/after the end of the available range.
  const defaultStartIdx = useMemo(() => {
    if (startOptions.length === 0) return 0;
    const i = startOptions.findIndex((d) => d >= trainedThrough);
    return i === -1 ? startOptions.length - 1 : i;
  }, [startOptions, trainedThrough]);
  const curStartIdx = startIdx == null ? defaultStartIdx : Math.min(startIdx, startOptions.length - 1);
  const effectiveStart = startOptions[curStartIdx] || '';
  // Warn when the chosen start predates the training cutoff: those days were seen
  // during training, so apparent shifts there can reflect in-sample fit.
  const startBeforeCutoff = effectiveStart !== '' && effectiveStart < trainedThrough;

  // Baseline-window candidate dates: every `dates` index strictly before the
  // test-start day. `startOptions` is `dates.slice(1)`, so the absolute
  // `dates` index of the test-start day is `curStartIdx + 1`, and the last
  // legal pre-start index is `curStartIdx`.
  const baselineOptions = useMemo(
    () => dates.slice(0, Math.max(0, curStartIdx + 1)),
    [dates, curStartIdx],
  );
  const curBaselineEndIdx =
    baselineEndIdx == null
      ? Math.max(0, baselineOptions.length - 1)
      : Math.min(Math.max(0, baselineEndIdx), Math.max(0, baselineOptions.length - 1));
  const curBaselineStartIdx =
    baselineStartIdx == null ? 0 : Math.min(Math.max(0, baselineStartIdx), curBaselineEndIdx);
  const effectiveBaselineStart = baselineOptions[curBaselineStartIdx] ?? '';
  const effectiveBaselineEnd = baselineOptions[curBaselineEndIdx] ?? '';
  // Only treat the window as "custom" when the user has dragged at least one
  // endpoint away from the default full-pre-start range. Drives the chart
  // shading so the default visual matches the prior simulator behavior.
  const baselineWindowCustomized = baselineStartIdx != null || baselineEndIdx != null;

  const filtered = useMemo(() => {
    if (!search.trim()) return features.slice(0, 200);
    const q = search.toLowerCase();
    return features
      .filter((f) => f.label.toLowerCase().includes(q) || String(f.idx).includes(q))
      .slice(0, 200);
  }, [features, search]);

  const selected = featureIdx == null ? null : features.find((f) => f.idx === featureIdx);
  // The §3 feature catalog is keyed on the live 128f index space; it would
  // mislabel archive (64f) features, so only consult it for the live model.
  // For archives the c-feature `label` already carries the interpretation.
  const selectedInterpretation =
    selected && version == null
      ? catalogFeatures.find((f) => f.id === selected.idx)?.interpretation ?? null
      : null;

  const effBonferroni = bonferroni === '' ? 1 : Math.max(1, Math.round(num(bonferroni, 1)));
  const effAlpha = Math.min(0.999, Math.max(1e-6, num(alpha, DEFAULT_ALPHA)));
  const effBeta = Math.max(1, num(beta, DEFAULT_BETA));

  const rate = useMemo(() => {
    if (!featureSeries || !selected) return null;
    if (metric === 'mean') {
      // Per-day mean activation magnitude (already averaged over all posts that
      // day in the published series); fall back to 0 where absent.
      return selected.n_active.map((_, d) => selected.mean?.[d] ?? 0);
    }
    return selected.n_active.map((n, d) =>
      featureSeries.n_posts[d] > 0 ? n / featureSeries.n_posts[d] : 0,
    );
  }, [featureSeries, selected, metric]);

  // 14-day centered rolling mean of the daily rate — used only for the chart
  // trace; the test below still consumes the raw `rate`.
  const displayRate = useMemo(
    () => (rate ? centeredRollingMean(rate, DISPLAY_SMOOTH_WINDOW) : null),
    [rate],
  );

  const result = useMemo(() => {
    if (!featureSeries || !rate || !effectiveStart) return null;
    return simulate({ dates: featureSeries.dates, rate }, effectiveStart, {
      alpha: effAlpha,
      beta: effBeta,
      bonferroni: effBonferroni,
      direction,
      baselineStart: effectiveBaselineStart || undefined,
      baselineEnd: effectiveBaselineEnd || undefined,
    });
  }, [
    featureSeries,
    rate,
    effectiveStart,
    effAlpha,
    effBeta,
    effBonferroni,
    direction,
    effectiveBaselineStart,
    effectiveBaselineEnd,
  ]);

  // Always plot the full series so the visible x-range never shifts with the
  // start date: frequency is shown for every day; log-wealth is null before
  // the test starts so the wealth line begins at the start-date marker.
  const chartData = useMemo(() => {
    if (!result || !displayRate || !featureSeries) return [];
    return featureSeries.dates.map((date, d) => {
      const i = d - result.nPreStart;
      const lw = i >= 0 && i < result.logWealth.length ? result.logWealth[i] : null;
      const f = displayRate[d];
      return {
        date,
        logWealth: lw != null && Number.isFinite(lw) ? lw : null,
        freq: Number.isFinite(f) ? f : null,
      };
    });
  }, [result, displayRate, featureSeries]);

  // Long horizon → YY-MM; short → MM-DD. Keyed off total history length, so
  // it does not change with the start date.
  const fmtX = useMemo(() => {
    const longSpan = (featureSeries?.dates.length ?? 0) > 120;
    return (d: string) => (longSpan ? d.slice(2, 7) : d.slice(5));
  }, [featureSeries]);

  const featColor = selected ? getFeatureColor(selected.idx) : 'var(--color-accent-700)';
  const metricLabel = metric === 'count' ? 'frequency' : 'mean activation';
  // Frequency (left axis) is always shown, so x reference lines anchor there.
  const vAxis = 'left';

  // Rather than predict recharts' label geometry (plot width, font metrics,
  // and which way each label is anchored), measure the rendered label rects
  // directly and drop the rejection label to a second row only when the two
  // actually overlap horizontally. Since the drop is purely vertical, the
  // horizontal measurement is unaffected by it — so this can't oscillate.
  const chartCardRef = useRef<HTMLDivElement>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [dropRejectionLabel, setDropRejectionLabel] = useState(false);
  useEffect(() => {
    const el = chartCardRef.current;
    if (!el) return;
    const bump = () => setResizeTick((t) => t + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selected, result]);
  useLayoutEffect(() => {
    const root = chartCardRef.current;
    if (!root || !result?.rejectionDate) {
      setDropRejectionLabel(false);
      return;
    }
    const texts = Array.from(root.querySelectorAll('text'));
    const startEl = texts.find((t) => t.textContent?.startsWith('test start'));
    const rejEl = texts.find((t) => t.textContent?.startsWith('yes (PuLSE alerts)'));
    if (!startEl || !rejEl) {
      setDropRejectionLabel(false);
      return;
    }
    const a = startEl.getBoundingClientRect();
    const b = rejEl.getBoundingClientRect();
    const pad = 4;
    setDropRejectionLabel(a.left < b.right + pad && b.left < a.right + pad);
  }, [result, effectiveStart, showWealth, metric, resizeTick]);

  if (loading) return <div className="text-text-muted">Loading…</div>;

  if (!featureSeries || dates.length < 2) {
    // Keep the representation picker visible so a missing/empty archive doesn't
    // trap the user — they can always switch back to the live model.
    return (
      <>
        <DashboardNav />
        <div className="space-y-6" style={{ marginTop: 24 }}>
          <div className="bg-surface rounded-xl border border-border p-4">
            <ModelPicker version={version} onChange={selectModel} />
          </div>
          <div className="bg-surface rounded-xl border border-border p-6 text-text-secondary">
            <h1 className="font-heading text-2xl font-bold text-text-primary mb-2">
              No feature series {version ? `for ${version}` : 'yet'}
            </h1>
            <p>
              {version ? (
                <>
                  This archive's{' '}
                  <code className="font-mono text-text-primary">
                    data/live/{version}/feature_series.json
                  </code>{' '}
                  isn't available yet. Pick the live model above, or another archive.
                </>
              ) : (
                <>
                  <code className="font-mono text-text-primary">feature_series.json</code> needs at
                  least two days of history. It is published by the daily-monitor workflow.
                </>
              )}
            </p>
          </div>
        </div>
        <SiteInlineFooter />
      </>
    );
  }

  return (
    <>
      <DashboardNav />
      <div className="space-y-6" style={{ marginTop: 24 }}>
      <header>
        <p className="text-sm text-text-secondary">
          Monitor in "real time," both counterfactually and with new data. See{" "}
          <a
            href="https://arxiv.org/pdf/2606.05750v1#page=10.64"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Section 4
          </a>{" "}
          for method details.
        </p>
      </header>

      <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
        <ModelPicker
          version={version}
          onChange={selectModel}
        />

        <div className="border-t border-border pt-4 space-y-2">
          <label className="text-xs text-text-muted uppercase tracking-wide">
            2 · Pick a topic
          </label>
          <input
            type="text"
            placeholder="Search by label…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 border border-border rounded-lg text-sm bg-bg focus:outline-none focus:ring-2 focus:ring-accent-100"
          />
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-bg divide-y divide-border">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-text-muted">No matches</div>
            )}
            {filtered.map((f) => (
              <button
                key={f.idx}
                type="button"
                onClick={() => selectFeature(f.idx)}
                className={`block w-full text-left px-3 py-1.5 text-sm font-mono transition-colors ${
                  featureIdx === f.idx
                    ? 'bg-accent-600 text-white'
                    : 'text-text-secondary hover:bg-surface'
                }`}
              >
                #{f.idx} · {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <label className="text-xs text-text-muted uppercase tracking-wide">3 · Ask a question</label>
          <div className="text-[15px] leading-8 text-text-secondary">
            Does the{' '}
            <InlineSelect
              value={metric}
              onChange={(v) => setMetric(v as 'count' | 'mean')}
              options={[
                { value: 'count', label: 'frequency' },
                { value: 'mean', label: 'mean activation' },
              ]}
            />{' '}
            of{' '}
            <span className="font-medium" style={{ color: selected ? featColor : undefined }}>
              {selected ? `#${selected.idx} ${selected.label}` : '(pick a feature above)'}
            </span>{' '}
            go{' '}
            <InlineSelect
              value={direction}
              onChange={(v) => setDirection(v as Direction)}
              options={[
                { value: 'increase', label: 'up' },
                { value: 'decrease', label: 'down' },
              ]}
            />{' '}
            after{' '}
            <DatePopover
              startOptions={startOptions}
              curIdx={curStartIdx}
              onChange={setStartIdx}
              value={effectiveStart}
              sub={result ? `${result.nPreStart} pre · ${result.nPostStart} post days` : ''}
            />{' '}
            by a factor of{' '}
            <InlineNum value={beta} onChange={setBeta} step="0.01" min="1" maxDecimals={3} />?
          </div>
          {startBeforeCutoff && (
            <p className="text-xs rounded-md px-2.5 py-1.5 bg-badge-marginal-bg text-badge-marginal-text italic">
              Heads up: the start date is before this representation's training date (
              <span className="font-mono">{trainedThrough}</span>). 
              {/* It wouldn't have "counterfactually" been possible to use these representations for a test at this start date, but  */}
              These results should be thought of as answering the question of what would have happened if we <strong>did</strong> have access to these representations at this start date.
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowAdvanced((o) => !o)}
            className="text-xs text-text-muted hover:text-accent-700 font-mono uppercase tracking-wide"
          >
            {showAdvanced ? '▾' : '▸'} advanced
          </button>
          {showAdvanced && (
            <div className="text-[15px] leading-8 text-text-secondary">
              I want level{' '}
              <InlineNum value={alpha} onChange={setAlpha} step="0.01" min="0" max="1" /> type-I
              error control while Bonferroni-correcting for{' '}
              <InlineNum
                value={bonferroni}
                onChange={setBonferroni}
                step="1"
                min="1"
                placeholder="1"
              />{' '}
              tests, computing the baseline from days{' '}
              <DatePopover
                startOptions={baselineOptions.slice(0, curBaselineEndIdx + 1)}
                curIdx={curBaselineStartIdx}
                onChange={setBaselineStartIdx}
                value={effectiveBaselineStart}
                sub={`${curBaselineEndIdx - curBaselineStartIdx + 1} days`}
              />{' '}
              through{' '}
              <DatePopover
                startOptions={baselineOptions.slice(curBaselineStartIdx)}
                curIdx={curBaselineEndIdx - curBaselineStartIdx}
                onChange={(i) => setBaselineEndIdx(i + curBaselineStartIdx)}
                value={effectiveBaselineEnd}
                sub={`${curBaselineEndIdx - curBaselineStartIdx + 1} days`}
              />
              .
            </div>
          )}
        </div>
      </div>

      {!selected && (
        <div className="bg-surface rounded-xl border border-border p-6 text-text-secondary">
          Pick a topic to run the simulation.
        </div>
      )}

      {selected && result && (
        <>
          <div ref={chartCardRef} className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="min-w-0">
                <h3 className="font-mono font-semibold text-lg text-text-primary">
                  #{selected.idx} {selected.label}
                </h3>
                {selectedInterpretation && (
                  <p className="font-heading text-sm text-text-secondary mt-0.5">
                    {selectedInterpretation}
                  </p>
                )}
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showWealth}
                  onChange={(e) => setShowWealth(e.target.checked)}
                  className="accent-accent-600"
                />
                <span className="text-accent-700">Show test statistic</span>
              </label>
            </div>
            {/* <p className="text-xs text-text-muted mb-2">
              {metricLabel} → left axis{showWealth ? ' · log-wealth ωₜ → right axis' : ''}
            </p> */}
            {result.nPreStart === 0 ? (
              <p className="text-sm text-text-secondary">
                No pre-start days for this start date — move the slider right so μ₀ can be
                estimated.
              </p>
            ) : !Number.isFinite(result.baseline) || result.baseline === 0 ? (
              <p className="text-sm text-text-secondary">
                μ₀ = {result.baseline} — the feature never activated before the start date, so
                {direction === 'decrease'
                  ? ' there is no baseline signal to detect a decrease against.'
                  : ' any post-start activity trivially rejects.'}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={chartData} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtX}
                    tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                    stroke="var(--color-text-muted)"
                    minTickGap={24}
                  />
                  {/* Both axes keep a fixed reserved width so toggling the
                      log-wealth series never shifts the plot area. */}
                  <YAxis
                    yAxisId="left"
                    width={64}
                    tick={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      fill: 'var(--color-text-muted)',
                    }}
                    stroke="var(--color-text-muted)"
                    domain={[0, 'auto']}
                    tickFormatter={(v: number) => v.toFixed(3)}
                    label={{
                      value: metricLabel,
                      angle: -90,
                      position: 'insideLeft',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      fill: featColor,
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    width={64}
                    tick={
                      showWealth
                        ? {
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                            fill: 'var(--color-text-muted)',
                          }
                        : false
                    }
                    axisLine={showWealth}
                    tickLine={showWealth}
                    stroke="var(--color-text-muted)"
                    domain={['auto', 'auto']}
                    label={
                      showWealth
                        ? {
                            value: 'log-wealth ωₜ',
                            angle: 90,
                            position: 'insideRight',
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                            fill: 'var(--color-accent-700)',
                          }
                        : undefined
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.5rem',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-mono)',
                    }}
                    formatter={(value, name) =>
                      typeof value === 'number' ? [value.toFixed(4), name] : [String(value), name]
                    }
                  />
                  {showWealth && (
                    <ReferenceLine
                      yAxisId="right"
                      y={result.threshold}
                      stroke="var(--color-accent-700)"
                      strokeDasharray="3 3"
                      label={{
                        value: `reject ω > log(B/α) = ${result.threshold.toFixed(2)}`,
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                        fill: 'var(--color-accent-700)',
                        position: result.rejected ? 'insideTopLeft' : 'insideTopRight',
                      }}
                    />
                  )}
                  <ReferenceLine
                    yAxisId="left"
                    y={result.effectiveBaseline}
                    stroke={featColor}
                    strokeDasharray="2 4"
                    label={{
                      value: `baseline · ${(result.effectiveBaseline / result.baseline).toFixed(2)} = ${result.effectiveBaseline.toFixed(3)}`,
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      fill: featColor,
                      position: 'insideBottomLeft',
                    }}
                  />
                  {baselineWindowCustomized && effectiveBaselineStart && effectiveBaselineEnd && (
                    <ReferenceArea
                      yAxisId="left"
                      x1={effectiveBaselineStart}
                      x2={effectiveBaselineEnd}
                      fill={featColor}
                      fillOpacity={0.08}
                      stroke="none"
                      label={{
                        value: 'baseline μ₀ window',
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                        fill: featColor,
                        position: 'insideTopLeft',
                      }}
                    />
                  )}
                  <ReferenceLine
                    yAxisId={vAxis}
                    x={effectiveStart}
                    stroke="var(--color-text-secondary)"
                    strokeDasharray="4 4"
                    label={{
                      value: `test start ${effectiveStart}`,
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      fill: 'var(--color-text-secondary)',
                      position: 'insideTopRight',
                    }}
                  />
                  {result.rejectionDate && (
                    <ReferenceLine
                      yAxisId={vAxis}
                      x={result.rejectionDate}
                      stroke="var(--color-text-secondary)"
                      label={{
                        value: `yes (PuLSE alerts) ${result.rejectionDate}`,
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                        fill: 'var(--color-text-secondary)',
                        position: 'insideTopRight',
                        dy: dropRejectionLabel ? 14 : 0,
                      }}
                    />
                  )}
                  {showWealth && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="logWealth"
                      name="log-wealth ωₜ"
                      stroke="var(--color-accent-700)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  )}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="freq"
                    name={metricLabel}
                    stroke={featColor}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
      </div>
      <SiteInlineFooter />
    </>
  );
}

function ModelPicker({
  version,
  onChange,
}: {
  version: CVersion | null;
  onChange: (v: CVersion | null) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-text-muted uppercase tracking-wide">1 · Pick a set of topics</label>
        {/* <p className="text-[13px] text-text-secondary leading-snug mt-1">
          Which featurization to test. The{' '}
          <strong className="text-text-primary font-semibold">live</strong> model updates daily; the{' '}
          <strong className="text-text-primary font-semibold">archives</strong> are frozen snapshots,
          each named by its training-cutoff date.
        </p> */}
      </div>

      {/* Two-tier segmented control */}
      <div className="flex flex-wrap items-stretch gap-3 p-[5px] border border-border rounded-lg bg-bg">
        {/* Live hero segment */}
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={version == null}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-md border transition-colors ${
            version == null
              ? 'border-accent-600 bg-surface shadow-sm'
              : 'border-transparent bg-transparent hover:bg-surface'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full bg-increase-600 ${version == null ? 'rep-live-pulse' : ''}`}
          />
          <span className="flex items-baseline gap-1.5 text-left leading-tight">
            <span className="font-heading text-[15px] font-bold text-text-primary">Live</span>
            <span className="font-mono text-[10.5px] text-text-muted">data up to 2025-11-30</span>
          </span>
        </button>

        <div className="w-px bg-border self-stretch my-1" />

        {/* Archive chip group */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted leading-tight self-center">
            Archives
            <br />
          </span>
          {C_VERSIONS.map((cv) => {
            const active = version === cv;
            return (
              <button
                key={cv}
                type="button"
                onClick={() => onChange(cv)}
                aria-pressed={active}
                title={`${cv} · trained through ${C_TRAINED_THROUGH[cv]}`}
                className={`flex flex-col items-center gap-px px-3 py-1.5 rounded-md border transition-colors ${
                  active
                    ? 'border-accent-600 bg-accent-600'
                    : 'border-border bg-surface hover:border-accent-200'
                }`}
              >
                <span className={`font-mono text-[10px] ${active ? 'text-accent-100' : 'text-text-muted'}`}>
                  data up to
                </span>
                <span
                  className={`font-mono text-[12.5px] font-bold leading-tight ${
                    active ? 'text-white' : 'text-text-primary'
                  }`}
                >
                  {C_TRAINED_THROUGH[cv]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Status caption */}
      <p className="text-xs text-text-muted italic">
        {version == null ? (
          <>
            Topics from retrospective analysis (see{' '}
            <Link to="/explore" className="font-mono text-accent-700 underline hover:text-accent-800">
              EXPLORE
            </Link>
            ); computed with data up to November 30, 2025.
          </>
        ) : (
          <>
            Topics from representation {version} · computed with data through {C_TRAINED_THROUGH[version]}
            {(() => {
              // Each archive stays accurate until the next archive's cutoff; the
              // last archive has no successor, so no upper bound is shown.
              const i = C_VERSIONS.indexOf(version);
              const next = i < C_VERSIONS.length - 1 ? C_TRAINED_THROUGH[C_VERSIONS[i + 1]] : null;
              return next ? ` · accurate through ${next}` : '';
            })()}
          </>
        )}
      </p>
    </div>
  );
}

function DatePopover({
  startOptions,
  curIdx,
  onChange,
  value,
  sub,
}: {
  startOptions: string[];
  curIdx: number;
  onChange: (i: number) => void;
  value: string;
  sub: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Click to change the test start date"
        className="mx-0.5 px-1 py-0.5 font-medium font-mono text-sm text-accent-700 bg-transparent border-0 border-b-2 border-dashed border-accent-300 hover:border-accent-600 focus:outline-none focus:border-accent-600"
      >
        {value}
      </button>
      {open && (
        <div className="absolute z-40 mt-1 left-1/2 -translate-x-1/2 w-64 bg-surface border border-border rounded-lg shadow-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span className="uppercase tracking-wide">Start date</span>
            <span className="font-mono">{sub}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(startOptions.length - 1, 0)}
            step={1}
            value={curIdx}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-accent-600"
          />
          <div className="flex justify-between text-[11px] text-text-muted font-mono">
            <span>{startOptions[0]}</span>
            <span className="text-text-primary font-medium">{value}</span>
            <span>{startOptions[startOptions.length - 1]}</span>
          </div>
        </div>
      )}
    </span>
  );
}

function InlineNum({
  value,
  onChange,
  step,
  min,
  max,
  placeholder,
  maxDecimals,
}: {
  value: string;
  onChange: (v: string) => void;
  step: string;
  min: string;
  max?: string;
  placeholder?: string;
  maxDecimals?: number;
}) {
  // Round to `maxDecimals` only when MORE places are entered, so shorter values
  // pass through untouched (e.g. "1.05" isn't padded to "1.050").
  const handleChange = (raw: string) => {
    if (maxDecimals != null && raw !== '') {
      const dot = raw.indexOf('.');
      if (dot >= 0 && raw.length - dot - 1 > maxDecimals) {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          const f = Math.pow(10, maxDecimals);
          onChange(String(Math.round(n * f) / f));
          return;
        }
      }
    }
    onChange(raw);
  };
  // Clamp into [min, max] on blur rather than on change, so intermediate
  // keystrokes aren't fought (the `min` attribute alone doesn't stop typing a
  // smaller value). Empty/non-numeric input is left for the consumer's fallback.
  const clampOnBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const lo = Number(min);
    const hi = max == null ? Infinity : Number(max);
    const clamped = Math.min(hi, Math.max(lo, n));
    if (clamped !== n) onChange(String(clamped));
  };
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={clampOnBlur}
      className="w-16 mx-0.5 px-1 py-0.5 text-center font-mono text-sm text-accent-700 bg-transparent border-0 border-b-2 border-accent-300 focus:outline-none focus:border-accent-600"
    />
  );
}

function InlineSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mx-0.5 px-1 py-0.5 font-medium text-sm text-accent-700 bg-transparent border-0 border-b-2 border-accent-300 focus:outline-none focus:border-accent-600"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
