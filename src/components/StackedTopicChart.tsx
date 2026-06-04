/* Stacked per-topic chart for the live dashboard. Stacks each topic's daily
   post count (attributed across each post's 4 active topics, so the full
   128-topic stack would equal posts/day) and overlays the total daily volume
   line on the SAME posts/day axis — the top-8 stack therefore reads as an
   honest fraction of total volume. Raw SVG with a custom hover tooltip;
   legend sits to the right of the plot. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { dayTick, monthYear } from '../lib/format';
import FeatureSwatch from './live/FeatureSwatch';

// Fallback layer palette used only when consumers don't pass `colors`. The
// live dashboard always passes per-topic featureColor() values keyed by idx,
// which lets each topic keep one color across the chart + legend + lists.
const FALLBACK_LAYER_COLORS: readonly string[] = [
  'oklch(0.72 0.12 60)',
  'oklch(0.66 0.13 35)',
  'oklch(0.60 0.13 320)',
  'oklch(0.74 0.10 130)',
  'oklch(0.68 0.10 200)',
  'oklch(0.62 0.13 25)',
  'oklch(0.70 0.11 285)',
  'oklch(0.78 0.09 95)',
];

interface ChartTopic {
  label: string;
}

export interface ChartEvent {
  /** Position within the window, 0..1. */
  x: number;
  label: string;
}

interface Pad {
  t: number;
  r: number;
  b: number;
  l: number;
}

interface StackedTopicChartProps {
  topics: ChartTopic[];
  /** [day][topic] attributed posts/day (7-day smoothed). */
  stacks: number[][];
  /** [day] total posts/day, 7-day smoothed (overlay line + hover total). */
  volume: number[];
  /** [day] ISO date strings. */
  dates: string[];
  /** Per-topic colors; falls back to the rank palette if omitted. */
  colors?: string[];
  width?: number;
  height?: number;
  pad?: Pad;
  /** Shared axis max in posts/day. */
  yMax?: number;
  events?: ChartEvent[];
  xTickCount?: number;
  /** Optional analysis-window brush. Indices are into `dates` (chart-window
   *  relative). When provided, the chart shades the band and lets the user
   *  drag a new range; `onSelectionChange` fires on mouseup with the new
   *  inclusive [start, end] indices, snapped up to `minSelectionDays`. */
  selection?: { startIdx: number; endIdx: number };
  onSelectionChange?: (startIdx: number, endIdx: number) => void;
  minSelectionDays?: number;
}

export default function StackedTopicChart({
  topics,
  stacks,
  volume,
  dates,
  colors,
  width = 980,
  height = 340,
  pad = { t: 18, r: 16, b: 36, l: 52 },
  yMax = 100,
  events = [],
  xTickCount = 7,
  selection,
  onSelectionChange,
  minSelectionDays = 30,
}: StackedTopicChartProps) {
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const days = stacks.length;

  const layerColors =
    colors || topics.map((_, i) => FALLBACK_LAYER_COLORS[i % FALLBACK_LAYER_COLORS.length]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ day: number; layer: number | null } | null>(null);
  const [drag, setDrag] = useState<{ startIdx: number; currentIdx: number } | null>(null);

  const xAt = (i: number) => pad.l + (innerW * i) / Math.max(1, days - 1);
  const yAt = (v: number) => pad.t + innerH * (1 - v / yMax);

  const idxFromClientX = (clientX: number): number => {
    const el = wrapRef.current;
    if (!el || days === 0) return 0;
    const rect = el.getBoundingClientRect();
    const sx = rect.width / width;
    const vx = (clientX - rect.left) / sx;
    let i = Math.round(((vx - pad.l) / innerW) * (days - 1));
    return Math.max(0, Math.min(days - 1, i));
  };

  // Window-level mouse listeners during drag so the gesture survives the
  // cursor leaving the chart bounds.
  useEffect(() => {
    if (!drag) return;
    const handleMove = (e: MouseEvent) => {
      const i = idxFromClientX(e.clientX);
      setDrag((prev) => (prev ? { ...prev, currentIdx: i } : null));
    };
    const handleUp = (e: MouseEvent) => {
      const endIdx = idxFromClientX(e.clientX);
      const startIdx = drag.startIdx;
      setDrag(null);
      if (!onSelectionChange) return;
      // Treat zero-length drags as clicks and ignore — don't collapse the
      // selection to a single day.
      if (endIdx === startIdx) return;
      let lo = Math.min(startIdx, endIdx);
      let hi = Math.max(startIdx, endIdx);
      if (hi - lo + 1 < minSelectionDays) {
        const mid = (lo + hi) / 2;
        lo = Math.round(mid - (minSelectionDays - 1) / 2);
        hi = lo + minSelectionDays - 1;
        if (lo < 0) {
          hi -= lo;
          lo = 0;
        }
        if (hi > days - 1) {
          lo -= hi - (days - 1);
          hi = days - 1;
        }
        lo = Math.max(0, lo);
      }
      onSelectionChange(lo, hi);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.startIdx, onSelectionChange, minSelectionDays, days, width, innerW, pad.l]);

  // Stacked area paths.
  const paths = useMemo(() => {
    const layers = topics.length;
    const cum = Array(days).fill(0);
    const polys: string[] = [];
    for (let layer = 0; layer < layers; layer++) {
      const top: [number, number][] = [];
      const bot: [number, number][] = [];
      for (let i = 0; i < days; i++) {
        const x = pad.l + (innerW * i) / Math.max(1, days - 1);
        const yBot = pad.t + innerH * (1 - cum[i] / yMax);
        cum[i] += stacks[i][layer] ?? 0;
        const yTop = pad.t + innerH * (1 - cum[i] / yMax);
        top.push([x, yTop]);
        bot.push([x, yBot]);
      }
      const path =
        top.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') +
        ' ' +
        bot.reverse().map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') +
        ' Z';
      polys.push(path);
    }
    return polys;
  }, [topics, stacks, days, innerW, innerH, pad, yMax]);

  const linePath = volume
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
    .join(' ');

  // X tick indices, evenly spaced.
  const tickIdxs: number[] = [];
  for (let i = 0; i < xTickCount; i++) {
    tickIdxs.push(Math.round(((days - 1) * i) / (xTickCount - 1)));
  }

  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];
  const multiYear =
    dates.length > 0 && dates[0].slice(0, 4) !== dates[dates.length - 1].slice(0, 4);
  const tickLabel = (iso: string) => (multiYear ? monthYear(iso) : dayTick(iso));

  function onMove(e: React.MouseEvent) {
    if (drag) return; // suppress hover while dragging a selection
    const el = wrapRef.current;
    if (!el || days === 0) return;
    const rect = el.getBoundingClientRect();
    const sx = rect.width / width;
    const sy = rect.height / height;
    const vx = (e.clientX - rect.left) / sx;
    const vy = (e.clientY - rect.top) / sy;
    let day = Math.round(((vx - pad.l) / innerW) * (days - 1));
    day = Math.max(0, Math.min(days - 1, day));
    // Which layer is the cursor inside (bottom-up cumulative)?
    let layer: number | null = null;
    let cum = 0;
    for (let k = 0; k < topics.length; k++) {
      const lo = yAt(cum);
      cum += stacks[day][k] ?? 0;
      const hi = yAt(cum);
      if (vy <= lo && vy >= hi) {
        layer = k;
        break;
      }
    }
    setHover({ day, layer });
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!onSelectionChange) return;
    e.preventDefault();
    const i = idxFromClientX(e.clientX);
    setHover(null);
    setDrag({ startIdx: i, currentIdx: i });
  }

  const hx = hover ? xAt(hover.day) : 0;

  // Active band — drag in progress takes precedence over a committed selection.
  const band = (() => {
    if (drag) {
      const lo = Math.min(drag.startIdx, drag.currentIdx);
      const hi = Math.max(drag.startIdx, drag.currentIdx);
      return { lo, hi, transient: true };
    }
    if (selection) {
      return {
        lo: Math.max(0, Math.min(days - 1, selection.startIdx)),
        hi: Math.max(0, Math.min(days - 1, selection.endIdx)),
        transient: false,
      };
    }
    return null;
  })();
  const bandX1 = band ? xAt(band.lo) : 0;
  const bandX2 = band ? xAt(band.hi) : 0;

  return (
    <div>
      {/* Plot */}
      <div
        ref={wrapRef}
        style={{
          position: 'relative',
          cursor: onSelectionChange ? (drag ? 'ew-resize' : 'crosshair') : 'default',
          userSelect: 'none',
        }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onMouseDown={onMouseDown}
      >
        <svg
          width="100%"
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10 }}
        >
          {/* Y grid + labels (posts/day) */}
          {yTicks.map((p, i) => {
            const y = yAt(p);
            return (
              <g key={`y-${i}`}>
                <line
                  x1={pad.l}
                  x2={pad.l + innerW}
                  y1={y}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={p === 0 ? 1 : 0.5}
                  opacity={0.7}
                />
                <text x={pad.l - 6} y={y + 3} textAnchor="end" fill="var(--color-text-muted)">
                  {Math.round(p)}
                </text>
              </g>
            );
          })}

          {/* X ticks */}
          {tickIdxs.map((idx) => (
            <text
              key={`x-${idx}`}
              x={xAt(idx)}
              y={height - pad.b + 14}
              textAnchor="middle"
              fill="var(--color-text-muted)"
            >
              {dates[idx] ? tickLabel(dates[idx]) : ''}
            </text>
          ))}

          {/* Axis label */}
          <text
            transform={`translate(12 ${pad.t + innerH / 2}) rotate(-90)`}
            textAnchor="middle"
            fill="var(--color-text-muted)"
          >
            posts / day
          </text>

          {/* Stacked layers */}
          {paths.map((d, i) => (
            <path
              key={`p-${i}`}
              d={d}
              fill={layerColors[i]}
              fillOpacity={hover && hover.layer != null && hover.layer !== i ? 0.45 : 0.82}
              stroke="white"
              strokeWidth="0.5"
            />
          ))}

          {/* Selection band — dim outside, mark edges */}
          {band && (
            <g pointerEvents="none">
              {band.lo > 0 && (
                <rect
                  x={pad.l}
                  y={pad.t}
                  width={Math.max(0, bandX1 - pad.l)}
                  height={innerH}
                  fill="var(--color-surface)"
                  opacity={0.55}
                />
              )}
              {band.hi < days - 1 && (
                <rect
                  x={bandX2}
                  y={pad.t}
                  width={Math.max(0, pad.l + innerW - bandX2)}
                  height={innerH}
                  fill="var(--color-surface)"
                  opacity={0.55}
                />
              )}
              <line
                x1={bandX1}
                x2={bandX1}
                y1={pad.t}
                y2={pad.t + innerH}
                stroke="var(--color-text-primary)"
                strokeWidth="1"
                opacity={band.transient ? 0.9 : 0.7}
              />
              <line
                x1={bandX2}
                x2={bandX2}
                y1={pad.t}
                y2={pad.t + innerH}
                stroke="var(--color-text-primary)"
                strokeWidth="1"
                opacity={band.transient ? 0.9 : 0.7}
              />
            </g>
          )}

          {/* Event markers */}
          {events.map((e, i) => {
            const x = pad.l + innerW * e.x;
            const top = pad.t + (i % 2) * 12;
            return (
              <g key={`e-${i}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={pad.t}
                  y2={pad.t + innerH}
                  stroke="var(--color-text-primary)"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  opacity={0.5}
                />
                <text x={x + 4} y={top + 10} fill="var(--color-text-primary)" fontSize="10" fontWeight="600">
                  {e.label}
                </text>
              </g>
            );
          })}

          {/* Total volume line */}
          <path d={linePath} fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.1" opacity={0.55} />

          {/* Hover guide */}
          {hover && (
            <line
              x1={hx}
              x2={hx}
              y1={pad.t}
              y2={pad.t + innerH}
              stroke="var(--color-text-primary)"
              strokeWidth="1"
              opacity={0.4}
            />
          )}
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <HoverTooltip
            topics={topics}
            colors={layerColors}
            stacks={stacks}
            total={volume[hover.day]}
            date={dates[hover.day]}
            day={hover.day}
            focus={hover.layer}
            xFrac={hx / width}
          />
        )}
      </div>

    </div>
  );
}

function HoverTooltip({
  topics,
  colors,
  stacks,
  total,
  date,
  day,
  focus,
  xFrac,
}: {
  topics: ChartTopic[];
  colors: string[];
  stacks: number[][];
  total: number;
  date: string;
  day: number;
  focus: number | null;
  xFrac: number;
}) {
  const flip = xFrac > 0.6;
  const fmtDate = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  // Show topics most-active-first for this day.
  const rows = topics
    .map((t, i) => ({ i, label: t.label, v: stacks[day]?.[i] ?? 0 }))
    .sort((a, b) => b.v - a.v);
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: flip ? undefined : `calc(${(xFrac * 100).toFixed(2)}% + 12px)`,
        right: flip ? `calc(${((1 - xFrac) * 100).toFixed(2)}% + 12px)` : undefined,
        pointerEvents: 'none',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
        padding: '8px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        minWidth: 180,
        zIndex: 5,
      }}
    >
      <div style={{ color: 'var(--color-text-muted)', marginBottom: 6 }}>{fmtDate}</div>
      {rows.map((r) => (
        <div
          key={r.i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: r.i === focus ? 700 : 400,
            color: 'var(--color-text-primary)',
            marginBottom: 2,
          }}
        >
          <FeatureSwatch color={colors[r.i]} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.label}</span>
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{r.v.toFixed(1)}</span>
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <span>total / day</span>
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{Math.round(total)}</span>
      </div>
    </div>
  );
}
