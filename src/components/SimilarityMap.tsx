import { useEffect, useMemo, useState } from 'react';
import type { Feature } from '../types';
import {
  classicalMDS,
  centerAndScale,
  procrustesAlign,
  forceLayout,
  principalAngle,
  rotate,
  catmullRom,
  type XY,
} from '../lib/mds';
import { categoryColor, featureColor } from '../lib/feature-colors';

// Re-export so existing imports from this module keep working.
export { categoryColor };

const TOP_K = 5;

// Blends at which a full force layout is precomputed. In-between slider
// positions interpolate (Catmull-Rom) between these fixed anchors, so dot paths
// are smooth and continuous rather than re-solved (and jittery) every frame.
const ANCHOR_BLENDS = [0, 0.2, 0.4, 0.6, 0.8, 1];

// Fraction of each anchor's "lay the long axis horizontal" rotation to apply.
// Full (1) keeps every blend landscape but spins the map ~72° toward the
// co-occurrence end (which embeds rotated ~90° from trajectory); 0 leaves
// co-occurrence portrait/squished. 0.5 splits the difference: co-occurrence
// settles roughly square while halving the spin.
const ORIENT_DAMPING = 0.3;

interface Props {
  features: Feature[];                   // all features (typically 128)
  featureIdsInSim: number[];             // matrix order from similarities.feature_ids
  simTrajNorm: Float32Array;             // n×n rank-normalized [0,1]
  simCoocNorm: Float32Array;             // n×n rank-normalized [0,1]
  pinnedIds: Set<number>;
  togglePin: (id: number) => void;
  blend: number;
  setBlend: (v: number) => void;
  hoverId: number | null;
  setHoverId: (id: number | null) => void;
}

interface MapFeature {
  id: number;
  feature: Feature;
  volume: number;
}

// SVG layout. Use viewBox so the map scales with its container.
const W = 880;
const H = 540;
const PAD = 48;
const MOBILE_MAP_QUERY = '(max-width: 767px)';

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MAP_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(MOBILE_MAP_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}

export default function SimilarityMap({
  features,
  featureIdsInSim,
  simTrajNorm,
  simCoocNorm,
  pinnedIds,
  togglePin,
  blend,
  setBlend,
  hoverId,
  setHoverId,
}: Props) {
  const n = featureIdsInSim.length;
  const isMobile = useIsMobileViewport();

  // Precompute a force layout at each anchor blend (once per dataset, not per
  // slider frame). Each anchor refines the blended similarity so the visually
  // closest dots match the "most similar" list on hover — which a raw MDS
  // projection can't guarantee (it's a lossy global 2D shadow). Anchors are
  // warm-started from the previous one so consecutive layouts stay close,
  // aligned into a common frame so interpolation paths are short, and tagged
  // with the rotation that lays their long axis horizontal (co-occurrence
  // otherwise embeds tall-and-narrow and squishes in the landscape map).
  const { mapFeatures, anchors, anchorAngles } = useMemo(() => {
    const byId = new Map<number, Feature>();
    for (const f of features) byId.set(f.id, f);
    const mf: MapFeature[] = featureIdsInSim.map((id) => {
      const f = byId.get(id);
      return {
        id,
        feature: f ?? ({} as Feature),
        volume: ((f?.early_pct ?? 0) + (f?.late_pct ?? 0)) / 2,
      };
    });

    // MDS of the rank-normalized matrices seeds the first anchor (rank-norm
    // keeps heavy-tailed co-occurrence from collapsing to a blob).
    const seedT = centerAndScale(classicalMDS(simTrajNorm, n));
    const seedC = procrustesAlign(seedT, centerAndScale(classicalMDS(simCoocNorm, n)));

    const raw: XY[][] = [];
    for (let a = 0; a < ANCHOR_BLENDS.length; a++) {
      const bl = ANCHOR_BLENDS[a];
      const sim = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) {
        sim[i] = (1 - bl) * simTrajNorm[i] + bl * simCoocNorm[i];
      }
      const seed =
        a === 0
          ? seedT.map<XY>((p, i) => [
              (1 - bl) * p[0] + bl * seedC[i][0],
              (1 - bl) * p[1] + bl * seedC[i][1],
            ])
          : raw[a - 1];
      raw.push(centerAndScale(forceLayout(sim, n, seed)));
    }

    // Align every anchor into the first anchor's frame (rotation/flip only) so a
    // feature's position changes little between adjacent anchors.
    const aligned: XY[][] = [raw[0], ...raw.slice(1).map((L) => procrustesAlign(raw[0], L))];

    // Orientation angle per anchor, unwrapped (principal axis is a line, so it's
    // only defined mod π) so the interpolated rotation sweeps continuously.
    const angles = aligned.map(principalAngle);
    for (let k = 1; k < angles.length; k++) {
      while (angles[k] - angles[k - 1] > Math.PI / 2) angles[k] -= Math.PI;
      while (angles[k] - angles[k - 1] < -Math.PI / 2) angles[k] += Math.PI;
    }
    // Apply only a fraction of each rotation (see ORIENT_DAMPING) so the map
    // turns less toward the co-occurrence end.
    for (let k = 0; k < angles.length; k++) angles[k] *= ORIENT_DAMPING;

    return { mapFeatures: mf, anchors: aligned, anchorAngles: angles };
  }, [features, featureIdsInSim, simTrajNorm, simCoocNorm, n]);

  // Interpolate dot positions and the map rotation between the surrounding
  // anchors with a Catmull-Rom spline. This is cheap (O(n)) and runs each frame,
  // giving smooth, curved, continuous dot paths as the slider moves.
  const coords: XY[] = useMemo(() => {
    const m = ANCHOR_BLENDS.length;
    let k = 0;
    while (k < m - 2 && blend > ANCHOR_BLENDS[k + 1]) k++;
    const t = (blend - ANCHOR_BLENDS[k]) / (ANCHOR_BLENDS[k + 1] - ANCHOR_BLENDS[k]);
    const i0 = Math.max(0, k - 1);
    const i1 = k;
    const i2 = k + 1;
    const i3 = Math.min(m - 1, k + 2);
    const [a0, a1, a2, a3] = [anchors[i0], anchors[i1], anchors[i2], anchors[i3]];
    const c: XY[] = a1.map((_, i) => [
      catmullRom(a0[i][0], a1[i][0], a2[i][0], a3[i][0], t),
      catmullRom(a0[i][1], a1[i][1], a2[i][1], a3[i][1], t),
    ]);
    const theta = catmullRom(
      anchorAngles[i0], anchorAngles[i1], anchorAngles[i2], anchorAngles[i3], t,
    );
    // Rotate by -theta to lay the interpolated layout's long axis horizontal.
    return rotate(c, -theta);
  }, [anchors, anchorAngles, blend]);

  // External hover (set by either view) → local matrix index for rendering.
  const hoverIdx = useMemo(() => {
    if (hoverId == null) return null;
    const i = featureIdsInSim.indexOf(hoverId);
    return i >= 0 ? i : null;
  }, [hoverId, featureIdsInSim]);

  const pinnedIdxList = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < mapFeatures.length; i++) {
      if (pinnedIds.has(mapFeatures[i].id)) out.push(i);
    }
    return out;
  }, [mapFeatures, pinnedIds]);

  const lastPinIdx = pinnedIdxList.length ? pinnedIdxList[pinnedIdxList.length - 1] : null;
  const focusIdx = hoverIdx ?? lastPinIdx;

  // Hide "other" / "uncategorized" buckets from the map — their MDS positions
  // remain part of the layout, but they're not rendered as dots, labels, or
  // neighbor edges.
  const isVisible = (i: number) => {
    const cat = mapFeatures[i]?.feature?.category;
    return cat !== 'other' && cat !== 'uncategorized';
  };

  const neighbors = useMemo(() => {
    if (focusIdx == null) return [] as { j: number; s: number }[];
    const arr: { j: number; s: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === focusIdx) continue;
      if (!isVisible(j)) continue;
      const s = (1 - blend) * simTrajNorm[focusIdx * n + j] + blend * simCoocNorm[focusIdx * n + j];
      arr.push({ j, s });
    }
    arr.sort((a, b) => b.s - a.s);
    return arr.slice(0, TOP_K);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, blend, n, simTrajNorm, simCoocNorm, mapFeatures]);

  const neighborSet = useMemo(() => new Set(neighbors.map((nb) => nb.j)), [neighbors]);

  // Project MDS coords → viewBox space
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (const [x, y] of coords) {
    if (x < mnx) mnx = x;
    if (x > mxx) mxx = x;
    if (y < mny) mny = y;
    if (y > mxy) mxy = y;
  }
  const sc = Math.min(
    (W - 2 * PAD) / (mxx - mnx || 1),
    (H - 2 * PAD) / (mxy - mny || 1),
  );
  const offX = (W - (mxx - mnx) * sc) / 2 - mnx * sc;
  const offY = (H - (mxy - mny) * sc) / 2 - mny * sc;
  const project = (i: number): XY => [offX + coords[i][0] * sc, offY + coords[i][1] * sc];

  const maxVol = Math.max(1e-9, ...mapFeatures.map((f) => f.volume));
  const radius = (i: number) => {
    const base = 4 + 22 * Math.sqrt(mapFeatures[i].volume / maxVol);
    return isMobile ? base * 1.08 : base;
  };

  // Labels: every pinned, plus focus + its neighbors
  const labelIdxs = new Set<number>(pinnedIdxList);
  if (focusIdx != null) {
    labelIdxs.add(focusIdx);
    for (const nb of neighbors) labelIdxs.add(nb.j);
  }

  const handleNodeClick = (id: number) => {
    if (isMobile) setHoverId(null);
    togglePin(id);
  };

  return (
    <div className="relative h-full min-h-0 bg-surface border border-border rounded-xl overflow-visible">
      <div className="absolute inset-0 overflow-hidden rounded-xl">
        <svg
          viewBox={isMobile ? `130 0 620 ${H}` : `0 0 ${W} ${H}`}
          width="100%"
          height="100%"
          className="block"
        >
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(233,203,66,0.05)" />
            <stop offset="100%" stopColor="rgba(233,203,66,0)" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#bgGlow)" />

        {/* Edges to top-K neighbors */}
        {focusIdx != null && isVisible(focusIdx) && (
          <g>
            {neighbors.map(({ j }, i) => {
              const [x1, y1] = project(focusIdx);
              const [x2, y2] = project(j);
              const t = 1 - i / TOP_K;
              return (
                <line
                  key={`e-${j}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#c96442"
                  strokeOpacity={0.18 + 0.55 * t}
                  strokeWidth={1 + 2.2 * t}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        )}

        {/* Nodes */}
        {mapFeatures.map((mf, i) => {
          if (!isVisible(i)) return null;
          const [x, y] = project(i);
          const r = radius(i);
          const isFocus = i === focusIdx;
          const isPinned = pinnedIds.has(mf.id);
          const isNeighbor = neighborSet.has(i);
          const dim = focusIdx != null && !isFocus && !isNeighbor && !isPinned;
          return (
            <circle
              key={mf.id}
              cx={x} cy={y} r={r}
              fill={featureColor(mf.id, mf.feature.category)}
              fillOpacity={dim ? 0.18 : 0.88}
              stroke={isPinned || isFocus ? '#1f1b14' : 'rgba(31,27,20,0.25)'}
              strokeWidth={isPinned ? 2.5 : isFocus ? 2 : 1}
              className="cursor-pointer transition-[fill-opacity,stroke-width] duration-200"
              onMouseEnter={isMobile ? undefined : () => setHoverId(mf.id)}
              onMouseLeave={isMobile ? undefined : () => setHoverId(null)}
              onClick={() => handleNodeClick(mf.id)}
            />
          );
        })}

        {/* Labels */}
        <g pointerEvents="none">
          {Array.from(labelIdxs)
            .sort((a, b) => (a === focusIdx ? 1 : 0) - (b === focusIdx ? 1 : 0))
            .map((i) => {
            if (!isVisible(i)) return null;
            const [x, y] = project(i);
            const r = radius(i);
            const mf = mapFeatures[i];
            const name = mf.feature.short_name ?? `Feature ${mf.id}`;
            const maxLabelLength = isMobile ? 30 : 38;
            const label =
              name.length > maxLabelLength ? name.slice(0, maxLabelLength - 2) + '…' : name;
            const isFocus = i === focusIdx;
            const isPinned = pinnedIds.has(mf.id);
            const labelFontSize = isFocus || isPinned
              ? (isMobile ? 18 : 13)
              : (isMobile ? 15.5 : 11.5);
            return (
              <text
                key={`l-${i}`}
                x={x} y={y - r - 6}
                textAnchor="middle"
                style={{ fontFamily: 'var(--font-body)' }}
                fontSize={labelFontSize}
                fontWeight={isFocus || isPinned ? 600 : 500}
                fill="#1f1b14"
                stroke="rgba(252,250,243,0.95)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {label}
              </text>
            );
          })}
        </g>
        </svg>
      </div>

      {/* Blend slider — sits over the bottom-left corner of the map */}
      <div className="absolute left-3 bottom-3 z-10 w-56 bg-surface/90 backdrop-blur rounded-lg border border-border shadow-sm px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-primary transition-opacity"
            style={{ opacity: 1 - blend * 0.55 }}
          >
            Trajectory
          </span>
          <span className="group relative flex shrink-0">
            <button
              type="button"
              aria-label="Explain trajectory and co-occurrence"
              className="flex h-4 w-4 items-center justify-center rounded-full border border-border bg-bg text-[10px] font-semibold leading-none text-text-muted transition-colors hover:border-border-hover hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent-200"
            >
              ?
            </button>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-md bg-text-primary px-3 py-2 text-[11px] leading-snug text-surface shadow-lg group-hover:block group-focus-within:block">
              <span className="font-semibold">Trajectory:</span> how features moved together over time.{' '}
              <span className="font-semibold">Co-occurrence:</span> how often they appear in the same post.
            </span>
          </span>
          <span
            className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-primary transition-opacity"
            style={{ opacity: 0.45 + blend * 0.55 }}
          >
            Co-occurrence
          </span>
        </div>
        <input
          type="range" min={0} max={100} value={Math.round(blend * 100)}
          onChange={(e) => setBlend(parseFloat(e.target.value) / 100)}
          className="block w-full h-1.5 accent-accent-600 mt-1"
        />
      </div>
    </div>
  );
}

// Re-export for ExploreSection to render a side-panel that mirrors the SVG.
export { TOP_K };
