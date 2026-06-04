import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../../data/useData';
import { useLiveData } from '../../data/useLiveData';
import { getFeatureColor } from '../../lib/colors';
import Eyebrow from '../site/Eyebrow';
import TopicSparkline from './TopicSparkline';

interface Props {
  idx: number;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Viewport coords of the click that opened the popover. */
  clickPos: { x: number; y: number };
  onClose: () => void;
}

/** Years to surface in the example posts section, in order. */
const EXAMPLE_YEARS = ['2023', '2024', '2025'] as const;

const POPOVER_WIDTH = 320;
const POPOVER_GAP = 12;
const VIEWPORT_MARGIN = 16;
const MIN_MAX_HEIGHT = 120;

interface Placement {
  maxHeight: number;
  /** Viewport coords for `position: fixed`. Exactly one of top/bottom and one
   *  of left/right is set, depending on the chosen alignment. */
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** Positions the popover next to the click point with viewport coords for
 *  `position: fixed`. Picks left/right and above/below based on which side
 *  of the click has more room, and clamps max-height so the popover never
 *  extends beyond the viewport. Using fixed positioning means the popover
 *  can't grow the document by being anchored to a low-down row. */
function usePopoverPlacement(clickPos: { x: number; y: number }): Placement {
  const initialMax =
    typeof window === 'undefined' ? 600 : window.innerHeight - 2 * VIEWPORT_MARGIN;
  const [placement, setPlacement] = useState<Placement>({ maxHeight: initialMax });
  useLayoutEffect(() => {
    const recompute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const { x, y } = clickPos;
      // Horizontal: prefer to the right of the click; flip to the left if
      // that would put the popover outside the viewport.
      const fitsRight = x + POPOVER_GAP + POPOVER_WIDTH <= vw - VIEWPORT_MARGIN;
      const horizontal: Pick<Placement, 'left' | 'right'> = fitsRight
        ? { left: x + POPOVER_GAP }
        : { right: Math.max(VIEWPORT_MARGIN, vw - x + POPOVER_GAP) };
      // Vertical: pick the side of the click with more room and cap maxHeight
      // accordingly. Below-aligned: top at `y + GAP`. Above-aligned: bottom at
      // `y - GAP` (so popover top = y - GAP - height).
      const spaceBelow = vh - VIEWPORT_MARGIN - (y + POPOVER_GAP);
      const spaceAbove = y - POPOVER_GAP - VIEWPORT_MARGIN;
      const placeBelow = spaceBelow >= spaceAbove;
      const maxHeight = Math.max(MIN_MAX_HEIGHT, placeBelow ? spaceBelow : spaceAbove);
      const vertical: Pick<Placement, 'top' | 'bottom'> = placeBelow
        ? { top: y + POPOVER_GAP }
        : { bottom: vh - y + POPOVER_GAP };
      setPlacement({ maxHeight, ...horizontal, ...vertical });
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('resize', recompute);
    };
  }, [clickPos]);
  return placement;
}

/** Topic context popover anchored to a ranked-list row. Shows the feature's
 *  category, full name, interpretation, a 90-day daily-share sparkline, up to
 *  three example posts, and a prominent CTA into the simulator. */
export default function TopicPopover({ idx, triggerRef, clickPos, onClose }: Props) {
  const { features, examples } = useData();
  const { featureSeries } = useLiveData();
  const popRef = useRef<HTMLDivElement>(null);
  const placement = usePopoverPlacement(clickPos);

  const feature = features.find((f) => f.id === idx);

  // Daily share series for the sparkline — last 90 days from the live series.
  const series = useMemo(() => {
    if (!featureSeries) return [] as number[];
    const f = featureSeries.features.find((ff) => ff.idx === idx);
    if (!f) return [] as number[];
    const N = featureSeries.n_posts.length;
    const start = Math.max(0, N - 90);
    const out: number[] = [];
    for (let i = start; i < N; i++) {
      const np = featureSeries.n_posts[i];
      out.push(np > 0 ? f.n_active[i] / np : 0);
    }
    return out;
  }, [featureSeries, idx]);

  // Up to 3 example posts: one each from 2023, 2024, 2025 — picked as the
  // earliest post in the array that starts with the matching year.
  const yearExamples = useMemo(() => {
    const all = examples[String(idx)] ?? [];
    const picked: typeof all = [];
    for (const year of EXAMPLE_YEARS) {
      const p = all.find((post) => post.date.startsWith(year));
      if (p) picked.push(p);
    }
    return picked;
  }, [examples, idx]);

  // Close on Escape / outside click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insidePop = popRef.current?.contains(target);
      const insideTrigger = triggerRef.current?.contains(target);
      if (!insidePop && !insideTrigger) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose, triggerRef]);

  // Move focus into the popover on open; restore to the trigger on close.
  useEffect(() => {
    const trigger = triggerRef.current;
    popRef.current?.focus();
    return () => {
      trigger?.focus();
    };
  }, [triggerRef]);

  if (!feature) return null;

  const positionStyles: React.CSSProperties = {
    position: 'fixed',
    width: POPOVER_WIDTH,
    zIndex: 50,
    maxHeight: placement.maxHeight,
    overflowY: 'auto',
    top: placement.top,
    bottom: placement.bottom,
    left: placement.left,
    right: placement.right,
  };

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label={feature.short_name}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      style={{
        ...positionStyles,
        padding: 14,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-text-primary)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        outline: 'none',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 22,
          height: 22,
          background: 'transparent',
          border: 'none',
          fontSize: 14,
          lineHeight: 1,
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ✕
      </button>

      {/* Category chip */}
      <div
        style={{
          display: 'inline-block',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          background: 'var(--color-text-primary)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: 3,
          marginBottom: 8,
        }}
      >
        {feature.category.replace(/_/g, ' ')}
      </div>

      {/* Full name */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 16,
          color: 'var(--color-text-primary)',
          lineHeight: 1.25,
          marginBottom: 6,
          paddingRight: 20,
        }}
      >
        {feature.short_name}
      </div>

      {/* Interpretation */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.4,
          marginBottom: 12,
        }}
      >
        {feature.interpretation}
      </div>

      {/* Sparkline */}
      {series.length >= 2 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>
            <Eyebrow size={9}>90-day trajectory</Eyebrow>
          </div>
          <TopicSparkline series={series} color={getFeatureColor(idx)} width={POPOVER_WIDTH - 28} />
        </div>
      )}

      {/* Example posts */}
      {yearExamples.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ marginBottom: 6 }}>
            <Eyebrow size={9}>Example posts</Eyebrow>
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {yearExamples.map((ex, i) => (
              <li
                key={i}
                style={{
                  fontSize: 11.5,
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.35,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 500,
                    color: 'var(--color-accent-700)',
                    background: 'var(--color-accent-50)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                >
                  {ex.date}
                </span>
                <span style={{ flex: 1 }}>{ex.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Primary CTA */}
      <Link
        to={`/monitor?feature=${idx}`}
        onClick={onClose}
        style={{
          display: 'block',
          textAlign: 'center',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          background: 'var(--color-accent-200)',
          border: '1px solid var(--color-accent-700)',
          borderRadius: 6,
          padding: '8px 0',
          textDecoration: 'none',
        }}
      >
        Test in simulator →
      </Link>
    </div>
  );
}
