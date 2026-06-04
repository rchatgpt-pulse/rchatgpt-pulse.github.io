/**
 * Client-side port of the §4 sequential wealth-process test
 * (`live/_vendor/sequential_test.py::SequentialMeanTest`).
 *
 * Only the core recursion is ported — no confidence-bound / history
 * machinery. The simulator recomputes the trajectory on every control
 * change, so this must stay numerically faithful to the Python class:
 * see `scripts/sim_parity.py` for the cross-language check.
 *
 * H0: mean rate <= μ₀·β   (direction 'increase')
 * H0: mean rate >= μ₀/β   (direction 'decrease')
 *
 * The decrease case is the increase test on the sign-flipped stream
 * (y = -obs) against -μ₀/β. Substituting gives g = effBase - obs with
 * effBase = μ₀/β; the ONS λ-update is the gradient of log(1 + λg) either
 * way, so a single branch on `g` covers both tails.
 */

export type Direction = 'increase' | 'decrease';

export interface SimOptions {
  alpha: number; // Type-I level in (0, 1)
  beta: number; // change factor, ≥ 1
  bonferroni: number; // # simultaneous tests, ≥ 1 (per-test α = α / bonferroni)
  direction: Direction;
  baselineStart?: string; // inclusive; restricts μ₀ to days in [baselineStart, baselineEnd]
  baselineEnd?: string; // inclusive; must be < startDate to leave post-start days untouched
}

export interface SimResult {
  dates: string[]; // post-start dates, chronological
  logWealth: number[]; // ωₜ per post-start day (−Infinity if wealth collapsed)
  threshold: number; // log(bonferroni / alpha)
  rejected: boolean;
  rejectionIndex: number | null; // index into `dates`
  rejectionDate: string | null;
  baseline: number; // μ₀ — pre-start empirical mean rate (NaN if none)
  effectiveBaseline: number; // β·μ₀ (increase) or μ₀/β (decrease)
  nPreStart: number; // days strictly before startDate (full pre-test span)
  nBaseline: number; // days actually used to estimate μ₀ (= nPreStart unless a baseline window was supplied)
  nPostStart: number; // days the test ran over
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Run the sequential test over the daily `rate` series, splitting at
 * `startDate`: days strictly before it estimate μ₀, days on/after it are
 * the monitored observations. `series.dates` must be chronological and
 * aligned with `series.rate`.
 */
export function simulate(
  series: { dates: string[]; rate: number[] },
  startDate: string,
  opts: SimOptions,
): SimResult {
  const { alpha, beta, bonferroni, direction, baselineStart, baselineEnd } = opts;
  const threshold = Math.log(bonferroni / alpha);

  const useWindow = baselineStart != null && baselineEnd != null;
  const lo = useWindow && baselineStart! > baselineEnd! ? baselineEnd! : baselineStart;
  const hi = useWindow && baselineStart! > baselineEnd! ? baselineStart! : baselineEnd;

  // `nPreStartDays` counts every day strictly before `startDate` so callers
  // can offset post-start outputs (`logWealth`) into the full date axis.
  // `preRates` is the (possibly smaller) sample used to estimate μ₀.
  let nPreStartDays = 0;
  const preRates: number[] = [];
  const postDates: string[] = [];
  const postRates: number[] = [];
  for (let i = 0; i < series.dates.length; i++) {
    const d = series.dates[i];
    if (d < startDate) {
      nPreStartDays++;
      if (!useWindow || (d >= lo! && d <= hi!)) preRates.push(series.rate[i]);
    } else {
      postDates.push(d);
      postRates.push(series.rate[i]);
    }
  }

  const baseline =
    preRates.length > 0
      ? preRates.reduce((a, b) => a + b, 0) / preRates.length
      : NaN;
  const effectiveBaseline =
    direction === 'increase' ? baseline * beta : baseline / beta;

  // Mirrors SequentialMeanTest.reset()
  let lambda = 0.5;
  let sumSqGrads = 1e-8;
  let logWealth = 0;
  let rejected = false;
  let rejectionIndex: number | null = null;

  const logWealthSeries: number[] = [];

  for (let t = 0; t < postRates.length; t++) {
    const obs = postRates[t];

    // Mirrors the np.isinf(observation) skip-path.
    if (!Number.isFinite(obs)) {
      logWealthSeries.push(logWealth);
      continue;
    }

    const g = direction === 'increase' ? obs - effectiveBaseline : effectiveBaseline - obs;

    const wealthFactor = 1 + lambda * g;
    if (wealthFactor <= 0) {
      logWealth = -Infinity;
    } else {
      logWealth += Math.log(wealthFactor);
    }

    if (!rejected && logWealth > threshold) {
      rejected = true;
      rejectionIndex = t;
    }

    // _update_lambda_ons(g)
    const denom = 1 + lambda * g;
    const grad = denom > 1e-8 ? g / denom : 0;
    sumSqGrads += grad * grad;
    lambda = clamp(lambda + grad / Math.sqrt(sumSqGrads), 0, 1);

    logWealthSeries.push(logWealth);
  }

  return {
    dates: postDates,
    logWealth: logWealthSeries,
    threshold,
    rejected,
    rejectionIndex,
    rejectionDate: rejectionIndex != null ? postDates[rejectionIndex] : null,
    baseline,
    effectiveBaseline,
    nPreStart: nPreStartDays,
    nBaseline: preRates.length,
    nPostStart: postRates.length,
  };
}
