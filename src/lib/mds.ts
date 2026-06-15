// Classical MDS + 2D Procrustes alignment for the explore-page similarity
// map. Pure math — no React, no DOM.
//
// Input format: similarity matrices come in scipy `pdist` condensed form
// (upper triangle, no diagonal, length n*(n-1)/2).

export type XY = [number, number];

/** Expand a condensed length-n*(n-1)/2 array into a flat n×n row-major matrix
 *  with diagonal set to 1 (self-similarity). */
export function expandCondensed(flat: readonly number[], n: number): Float64Array {
  const out = new Float64Array(n * n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    out[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      out[i * n + j] = flat[k];
      out[j * n + i] = flat[k];
      k++;
    }
  }
  return out;
}

/** Min/max normalize a full n×n similarity matrix into a fresh Float32Array
 *  (diagonal excluded from the bounds). */
export function normalizeMatrix(flat: ArrayLike<number>, n: number): Float32Array {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = flat[i * n + j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  const r = mx - mn || 1;
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = (flat[i] - mn) / r;
  return out;
}

/** Rank/quantile-normalize a full n×n similarity matrix: replace each
 *  off-diagonal pair with its percentile rank in [0, 1] (diagonal set to 1).
 *
 *  Used instead of min/max for the explore map because the raw matrices —
 *  especially co-occurrence — are heavy-tailed: a few outlier pairs would
 *  otherwise hijack the min/max scale and crush ~90% of values into a narrow
 *  band, collapsing the layout to a blob. Ranking spreads values evenly so the
 *  embedding has structure to work with, and puts the two metrics on the same
 *  footing so the blend slider is genuinely balanced. It's monotonic, so the
 *  nearest-neighbor ordering within a single matrix is unchanged. */
export function rankNormalizeMatrix(flat: ArrayLike<number>, n: number): Float32Array {
  const pairs: { i: number; j: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) pairs.push({ i, j, v: flat[i * n + j] });
  }
  pairs.sort((a, b) => a.v - b.v);

  const out = new Float32Array(n * n);
  for (let i = 0; i < n; i++) out[i * n + i] = 1;
  const denom = pairs.length - 1 || 1;
  for (let r = 0; r < pairs.length; r++) {
    // Ties share the rank of the first equal value for a stable result.
    let r0 = r;
    while (r0 > 0 && pairs[r0 - 1].v === pairs[r].v) r0--;
    const p = r0 / denom;
    const { i, j } = pairs[r];
    out[i * n + j] = p;
    out[j * n + i] = p;
  }
  return out;
}

/** Classical MDS on a similarity matrix (Torgerson). Returns n 2D points.
 *
 *  Pipeline:
 *    1. Normalize similarities to [0, 1].
 *    2. Convert to squared dissimilarities: d²ᵢⱼ = 1 − sᵢⱼ (clamped, symmetrized).
 *    3. Double-center: B = −½ J D² J.
 *    4. Power-iterate the top two eigenvectors of B; scale by √λ. */
export function classicalMDS(simFlat: ArrayLike<number>, n: number): XY[] {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = simFlat[i * n + j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  const range = mx - mn || 1;

  const D2 = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { D2[i * n + j] = 0; continue; }
      let s = (simFlat[i * n + j] - mn) / range;
      if (s < 0) s = 0;
      if (s > 1) s = 1;
      D2[i * n + j] = 1 - s;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = 0.5 * (D2[i * n + j] + D2[j * n + i]);
      D2[i * n + j] = D2[j * n + i] = m;
    }
  }

  const rowSum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) rowSum[i] += D2[i * n + j];
  }
  const rowMean = new Float64Array(n);
  let grandSum = 0;
  for (let i = 0; i < n; i++) {
    rowMean[i] = rowSum[i] / n;
    grandSum += rowSum[i];
  }
  const grandMean = grandSum / (n * n);

  const B = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      B[i * n + j] = -0.5 * (D2[i * n + j] - rowMean[i] - rowMean[j] + grandMean);
    }
  }

  const matVec = (M: Float64Array, v: Float64Array): Float64Array => {
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += M[i * n + j] * v[j];
      r[i] = s;
    }
    return r;
  };
  const dot = (a: Float64Array, b: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  };
  const normalize = (v: Float64Array): Float64Array => {
    let s = 0;
    for (let i = 0; i < n; i++) s += v[i] * v[i];
    const k = 1 / (Math.sqrt(s) || 1);
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = v[i] * k;
    return r;
  };

  let v1: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) v1[i] = Math.sin(i * 1.7 + 0.3);
  v1 = normalize(v1);
  for (let it = 0; it < 400; it++) v1 = normalize(matVec(B, v1));
  const lam1 = dot(v1, matVec(B, v1));

  const Bd = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      Bd[i * n + j] = B[i * n + j] - lam1 * v1[i] * v1[j];
    }
  }

  let v2: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) v2[i] = Math.cos(i * 1.3 + 0.7);
  {
    const p = dot(v2, v1);
    for (let i = 0; i < n; i++) v2[i] -= p * v1[i];
    v2 = normalize(v2);
  }
  for (let it = 0; it < 400; it++) {
    v2 = matVec(Bd, v2);
    const pp = dot(v2, v1);
    for (let i = 0; i < n; i++) v2[i] -= pp * v1[i];
    v2 = normalize(v2);
  }
  const lam2 = dot(v2, matVec(B, v2));

  const s1 = Math.sqrt(Math.max(lam1, 0));
  const s2 = Math.sqrt(Math.max(lam2, 0));
  const coords: XY[] = new Array(n);
  for (let i = 0; i < n; i++) coords[i] = [v1[i] * s1, v2[i] * s2];
  return coords;
}

/** Force-directed refinement of an existing 2D layout (weighted Fruchterman–
 *  Reingold). Pulls each node toward its top-K most-similar neighbors so the
 *  visually-closest dots on the map are the true nearest neighbors — which a
 *  raw MDS projection (a lossy global 2D shadow) does not guarantee.
 *
 *  `simNorm` is a full n×n similarity matrix normalized to [0, 1]. `seed` is a
 *  starting layout (use a classical-MDS layout of the same matrix): the seed
 *  supplies stable global structure and keeps the result deterministic and
 *  continuous as the blend slider moves, while the force pass corrects local
 *  neighbor distances. Returns n 2D points (not centered/scaled). */
export function forceLayout(
  simNorm: ArrayLike<number>,
  n: number,
  seed: readonly XY[],
  opts: {
    neighbors?: number;
    iterations?: number;
    k?: number;
    gravity?: number;
    temp0?: number;
    attract?: number;
  } = {},
): XY[] {
  const K = opts.neighbors ?? 6;
  const iterations = opts.iterations ?? 300;

  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = seed[i][0];
    py[i] = seed[i][1];
  }

  // Symmetric weighted edges from each node's top-K similarities. Edge weight
  // is the blended similarity, so more-similar pairs attract more strongly.
  const edges: { a: number; b: number; w: number }[] = [];
  const seen = new Set<number>();
  const order: number[] = new Array(n - 1);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = 0; j < n; j++) if (j !== i) order[m++] = j;
    order.sort((p, q) => simNorm[i * n + q] - simNorm[i * n + p]);
    const lim = Math.min(K, order.length);
    for (let t = 0; t < lim; t++) {
      const j = order[t];
      const a = i < j ? i : j;
      const b = i < j ? j : i;
      const key = a * n + b;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, w: simNorm[i * n + j] });
    }
  }

  const k = opts.k ?? 0.4;           // ideal neighbor distance (seed ~unit-RMS)
  const k2 = k * k;
  const gravity = opts.gravity ?? 0.02;  // pull to center so weak nodes stay in
  const attract = opts.attract ?? 1.6;   // attraction strength multiplier
  let temp = opts.temp0 ?? 0.08;     // max per-iteration displacement, annealed

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);

    // Repulsion between every pair.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = px[i] - px[j];
        let ey = py[i] - py[j];
        let d2 = ex * ex + ey * ey;
        if (d2 < 1e-9) {
          // Deterministic nudge for coincident points (keeps layout stable).
          ex = Math.cos(i * 1.1 + j);
          ey = Math.sin(i * 1.1 + j);
          d2 = 1e-3;
        }
        const d = Math.sqrt(d2);
        const f = k2 / d;
        const fx = (ex / d) * f;
        const fy = (ey / d) * f;
        dx[i] += fx; dy[i] += fy;
        dx[j] -= fx; dy[j] -= fy;
      }
    }

    // Attraction along weighted neighbor edges.
    for (const { a, b, w } of edges) {
      const ex = px[a] - px[b];
      const ey = py[a] - py[b];
      let d = Math.sqrt(ex * ex + ey * ey);
      if (d < 1e-6) d = 1e-6;
      const f = attract * (d * d / k) * (0.3 + 0.7 * w);
      const fx = (ex / d) * f;
      const fy = (ey / d) * f;
      dx[a] -= fx; dy[a] -= fy;
      dx[b] += fx; dy[b] += fy;
    }

    // Gravity + integrate, capping each step at the current temperature.
    for (let i = 0; i < n; i++) {
      dx[i] -= gravity * px[i];
      dy[i] -= gravity * py[i];
      const dl = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (dl > 1e-9) {
        const step = Math.min(dl, temp) / dl;
        px[i] += dx[i] * step;
        py[i] += dy[i] * step;
      }
    }
    temp *= 0.985;
  }

  const out: XY[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = [px[i], py[i]];
  return out;
}

/** Angle (radians) of a layout's principal / max-variance axis.
 *
 *  Different similarity structures embed at different orientations —
 *  co-occurrence in particular lays out tall-and-narrow (principal axis
 *  near-vertical), so it would fill a portrait box and look squished inside the
 *  landscape map. Rotating a layout by -principalAngle brings its long axis
 *  horizontal so it fills the wide viewport. The map interpolates this angle
 *  between anchors so the orientation varies smoothly with the blend. */
export function principalAngle(coords: readonly XY[]): number {
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of coords) {
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Rotate a layout by `theta` radians. Pure rotation — preserves all distances,
 *  so nearest-neighbor structure is untouched. */
export function rotate(coords: readonly XY[], theta: number): XY[] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return coords.map<XY>(([x, y]) => [c * x - s * y, s * x + c * y]);
}

/** Catmull-Rom spline value at parameter t∈[0,1] for the segment p1→p2, using
 *  p0 and p3 as the surrounding control points. Gives a smooth (C1) curve that
 *  passes through every control point — used to interpolate dot positions and
 *  the map rotation between precomputed anchor layouts so motion is smooth and
 *  curved rather than straight-and-kinked. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/** Center to origin, scale to unit RMS distance. */
export function centerAndScale(coords: readonly XY[]): XY[] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of coords) {
    cx += x;
    cy += y;
  }
  cx /= coords.length;
  cy /= coords.length;
  let sum = 0;
  for (const [x, y] of coords) {
    sum += (x - cx) ** 2 + (y - cy) ** 2;
  }
  const norm = Math.sqrt(sum / coords.length) || 1;
  return coords.map<XY>(([x, y]) => [(x - cx) / norm, (y - cy) / norm]);
}

/** Align B to A by rotation + optional y-reflection (both inputs already
 *  centered + scaled). Picks the orientation that minimizes ‖A − R·B‖². */
export function procrustesAlign(A: readonly XY[], B: readonly XY[]): XY[] {
  const n = A.length;
  const fit = (Aa: readonly XY[], Bb: readonly XY[]): { coords: XY[]; res: number } => {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += Aa[i][1] * Bb[i][0] - Aa[i][0] * Bb[i][1];
      den += Aa[i][0] * Bb[i][0] + Aa[i][1] * Bb[i][1];
    }
    const t = Math.atan2(num, den);
    const c = Math.cos(t);
    const s = Math.sin(t);
    const Rb: XY[] = Bb.map<XY>(([x, y]) => [c * x - s * y, s * x + c * y]);
    let res = 0;
    for (let i = 0; i < n; i++) {
      res += (Aa[i][0] - Rb[i][0]) ** 2 + (Aa[i][1] - Rb[i][1]) ** 2;
    }
    return { coords: Rb, res };
  };
  const r1 = fit(A, B);
  const Bf: XY[] = B.map<XY>(([x, y]) => [x, -y]);
  const r2 = fit(A, Bf);
  return r1.res < r2.res ? r1.coords : r2.coords;
}
