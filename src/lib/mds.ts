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
