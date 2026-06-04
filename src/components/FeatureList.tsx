import { useMemo, useState } from 'react';
import type { Feature } from '../types';
import { categoryColor } from './SimilarityMap';
import { formatChange, changeStyle } from '../lib/featureStyle';

// Category order chosen to match the existing ExploreSection conventions
// — biggest functional groups first.
const CATEGORY_ORDER = [
  'Applications',
  'emotion',
  'Advanced usage',
  'Basic use and exploration',
  'Customization',
  'Model or product improvements',
  'Perspectives',
  'Product updates',
  'Short-term bugs',
  'Subreddit community',
  'Language and terminology',
  'Jailbreaking & content policy',
  'uncategorized',
  'other',
];

const CATEGORY_LABELS: Record<string, string> = {
  emotion: 'Emotional Engagement',
  other: 'Other',
  uncategorized: 'Uncategorized',
};

interface Props {
  features: Feature[];                       // already filtered to active set (in matrix order or full set)
  pinnedIds: Set<number>;
  togglePin: (id: number) => void;
  hoverId: number | null;
  setHoverId: (id: number | null) => void;
}

export default function FeatureList({ features, pinnedIds, togglePin, hoverId, setHoverId }: Props) {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? features.filter(
          (f) =>
            f.short_name.toLowerCase().includes(q) ||
            (f.interpretation ?? '').toLowerCase().includes(q),
        )
      : features;

    const byCat = new Map<string, Feature[]>();
    for (const f of filtered) {
      const cat = f.category || 'other';
      const list = byCat.get(cat) ?? [];
      list.push(f);
      byCat.set(cat, list);
    }
    for (const list of byCat.values()) {
      // Biggest movers first: |relative_change − 1| descending.
      list.sort(
        (a, b) =>
          Math.abs(b.relative_change - 1) - Math.abs(a.relative_change - 1),
      );
    }
    return CATEGORY_ORDER
      .filter((c) => byCat.has(c))
      .map((c) => ({ category: c, items: byCat.get(c)! }));
  }, [features, query]);

  const totalMatches = grouped.reduce((s, g) => s + g.items.length, 0);

  return (
    <div className="bg-surface border border-border rounded-xl flex flex-col h-full min-h-0 overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border shrink-0">
        <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-text-muted">
          <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search features…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-text-primary py-0.5"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="text-text-muted hover:text-text-secondary text-lg leading-none px-1"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
        <span className="font-mono text-[11px] text-text-muted tabular-nums shrink-0">
          {totalMatches} / {features.length}
        </span>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-1">
        {grouped.length === 0 ? (
          <div className="px-1 py-6 text-text-muted italic">No features match "{query}".</div>
        ) : (
          grouped.map(({ category, items }) => (
            <div key={category} className="pt-3">
              <div className="sticky top-0 bg-surface flex items-center gap-2 px-1 py-1.5 border-b border-border z-10 mb-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full border border-text-muted/30 shrink-0"
                  style={{ background: categoryColor(category) }}
                />
                <span className="font-semibold text-sm text-text-primary flex-1">
                  {CATEGORY_LABELS[category] ?? category}
                </span>
                <span className="font-mono text-[11px] text-text-muted">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                {items.map((f) => (
                  <FeatureRow
                    key={f.id}
                    feature={f}
                    pinned={pinnedIds.has(f.id)}
                    hovered={hoverId === f.id}
                    onClick={() => togglePin(f.id)}
                    onMouseEnter={() => setHoverId(f.id)}
                    onMouseLeave={() => setHoverId(null)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FeatureRow({
  feature,
  pinned,
  hovered,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  feature: Feature;
  pinned: boolean;
  hovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const style = changeStyle(feature);
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`grid grid-cols-[14px_1fr_auto_auto] items-center gap-2 w-full px-1.5 py-1.5 text-left rounded-md text-[13px] border-b border-border/40 min-w-0 transition-colors ${
        pinned ? 'bg-accent-100 font-semibold' : hovered ? 'bg-accent-50' : ''
      }`}
    >
      <span className={`text-center font-mono text-[13px] leading-none ${pinned ? 'text-accent-700' : 'text-accent-700/60'}`}>
        {pinned ? '●' : '○'}
      </span>
      <span className="truncate font-mono text-text-primary">{feature.short_name}</span>
      <span className="font-mono text-[11.5px] text-text-muted tabular-nums">
        {feature.late_pct}%
      </span>
      <span className={`font-mono text-[10.5px] px-1.5 py-0.5 rounded ${style.text} ${style.bg}`}>
        {formatChange(feature.relative_change)}
      </span>
    </button>
  );
}
