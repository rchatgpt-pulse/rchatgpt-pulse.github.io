"""Write public-safe JSONs to public/data/live/ for the frontend to read.

Reads:
  - data/day_summary.json (today's score_daily output)
  - data/release_cache/baseline.json (training_error, feature_means)
  - data/release_cache/recon_history.jsonl (full per-day recon-error history)
  - data/release_cache/feature_history.jsonl (full per-day per-feature history)
  - data/release_cache/features.json (idx → label)
  - public/data/live/excluded_features.json (hand-edited; read here and also
                                              fetched directly by the frontend)

Writes:
  - public/data/live/today.json         (snapshot of today)
  - public/data/live/recon_history.json (chronological recon-error trajectory)
  - public/data/live/summary.json       (site-wide meta info)
  - public/data/live/alerts.json        (list of rejection events)
  - public/data/live/top_features.json  (top + biggest-change per {1d, 7d, 30d})
  - public/data/live/feature_index.json (full feature list with baseline +
                                          current_{1d,7d,30d} + trajectory)
  - public/data/live/feature_series.json (raw, parameter-free per-feature daily
                                          n_active + per-day n_posts; feeds the
                                          client-side per-feature simulator)
  - live/alert_body.md                  (issue body for Phase 8, only when alerting)

No raw post text is written; outputs are aggregates and feature labels only.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from live.live_config import (
    ALPHA,
    BETA,
    DAY_SUMMARY_PATH,
    LIVE_PUBLIC_DIR,
    RELEASE_CACHE_DIR,
)
from live.release_io import ReleaseCache

DEFAULT_ALERT_BODY = "live/alert_body.md"
DEFAULT_EXCLUDED_FEATURES = "public/data/live/excluded_features.json"
TOP_K_DASHBOARD = 20
TRAJECTORY_LEN = 30
WINDOWS = (("1d", 1), ("7d", 7), ("30d", 30))
MIN_NONZERO = 1e-6  # treat means below this as effectively zero


def load_jsonl(path: Path) -> list:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # allow_nan=False: never emit Infinity/NaN, which the frontend's JSON.parse
    # rejects. Non-finite day_error is sanitized to null upstream; this is the
    # backstop that fails loudly if anything else slips through.
    path.write_text(json.dumps(data, indent=2, allow_nan=False))


def _finite_or_none(x):
    """Map NaN/Inf -> None so emitted JSON stays valid. Zero-post days (NaN)
    and degenerate single-post days (Inf) produce non-finite day_error."""
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return None
    return xf if math.isfinite(xf) else None


def load_excluded_ids(path: Path) -> set:
    if not path.exists():
        return set()
    raw = json.loads(path.read_text())
    return {int(i) for i in raw.get("excluded_ids", [])}


def load_feature_labels(path: Path) -> dict:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        return {}
    return {int(k): str(v) for k, v in raw.items()}


def build_today(summary: dict, training_error: float, alert: bool) -> dict:
    return {
        "date": summary["date"],
        "n_posts": summary.get("n_posts_scored", 0),
        "n_posts_raw": summary.get("n_posts_raw", 0),
        "day_error": _finite_or_none(summary["day_error"]),
        "training_error": training_error,
        "factor": BETA,
        "effective_baseline": training_error * BETA,
        "model_version": summary.get("model_version"),
        "trained_through": summary.get("trained_through"),
        "alert": alert,
        "top_features": summary.get("top_features", []),
    }


def build_recon_history(history: list, training_error: float) -> dict:
    return {
        "training_error": training_error,
        "factor": BETA,
        "alpha": ALPHA,
        "effective_baseline": training_error * BETA,
        "threshold_log": math.log(1 / ALPHA),
        "observations": [
            {
                "date": r["date"],
                "day_error": r["day_error"],
                "wealth": r["wealth"],
                "log_wealth": r["log_wealth"],
                "rejected": r["rejected"],
            }
            for r in history
        ],
    }


def build_summary(history: list, today: dict, training_error: float, alert: bool) -> dict:
    n = len(history)
    return {
        "latest_date": today["date"],
        "first_observed_date": history[0]["date"] if n > 0 else None,
        "n_observations": n,
        "training_error": training_error,
        "factor": BETA,
        "alpha": ALPHA,
        "model_version": today.get("model_version"),
        "current_rejected": alert,
        "ever_rejected": any(r["rejected"] for r in history),
    }


def build_alerts(history: list) -> list:
    out = []
    prev = False
    for r in history:
        if r["rejected"] and not prev:
            out.append({
                "date": r["date"],
                "n_observations": r["n_observations"],
                "wealth_at_rejection": r["wealth"],
            })
        prev = r["rejected"]
    return out


def build_alert_body(today: dict, history: list) -> str:
    lines = [
        f"# Recon-error drift alert — {today['date']}",
        "",
        f"The §4 sequential test rejected H0 "
        f"(mean recon error <= {today['training_error']:.4f} × {BETA}).",
        "",
        f"- Day error: **{today['day_error']:.4f}**",
        f"- Effective baseline: {today['effective_baseline']:.4f}",
        f"- Observations: {len(history)}",
        f"- Model version: {today.get('model_version', 'unknown')}",
        "",
        "## Recent observations",
        "",
        "| Date | day_error | wealth | rejected |",
        "|---|---|---|---|",
    ]
    for r in history[-14:]:
        lines.append(
            f"| {r['date']} | {r['day_error']:.4f} | {r['wealth']:.2f} | "
            f"{'✓' if r['rejected'] else ''} |"
        )
    lines.append("")
    lines.append("Run `gh workflow run retrain.yml` to refresh the SAE.")
    return "\n".join(lines)


def windowed_means(feature_history: list, window_days: int, end_offset: int = 0) -> dict:
    """Mean of each feature's daily means over a window of `window_days` ending
    `end_offset` days before the latest day.

    end_offset=0 → the most recent window (e.g. last 7 days).
    end_offset=window_days → the prior window (e.g. days [-14, -7]) used for
        biggest-change comparisons.

    Divides by total days in the window (zero-imputation for days where a
    feature was inactive), so sparse features don't get artificially boosted.
    """
    n = len(feature_history)
    end = n - end_offset
    start = max(0, end - window_days)
    rows = feature_history[start:end]
    if not rows:
        return {}
    sums: dict = {}
    for row in rows:
        for idx_str, val in row.get("f", {}).items():
            sums[idx_str] = sums.get(idx_str, 0.0) + float(val[0])
    return {idx_str: total / len(rows) for idx_str, total in sums.items()}


def windowed_n_active(feature_history: list, window_days: int, end_offset: int = 0) -> dict:
    """Sum of n_active across a window. (e.g. number of posts that activated
    each feature over the past 7 days.)
    """
    n = len(feature_history)
    end = n - end_offset
    start = max(0, end - window_days)
    rows = feature_history[start:end]
    counts: dict = {}
    for row in rows:
        for idx_str, val in row.get("f", {}).items():
            counts[idx_str] = counts.get(idx_str, 0) + int(val[1])
    return counts


# Every post activates exactly 4 features in the SAE — used to derive
# n_posts from the sum of per-feature n_active counts.
FEATURES_PER_POST = 4


def build_top_for_window(
    means: dict,
    n_active: dict,
    excluded: set,
    label_map: dict,
    feature_baselines: dict,
    top_k: int,
) -> list:
    entries = []
    for idx_str, m in means.items():
        idx = int(idx_str)
        if idx in excluded:
            continue
        baseline_val = feature_baselines.get(idx_str)
        entries.append({
            "idx": idx,
            "label": label_map.get(idx, f"feature_{idx}"),
            "mean_activation": float(m),
            "n_active": int(n_active.get(idx_str, 0)),
            "baseline_mean": float(baseline_val) if baseline_val is not None else None,
        })
    entries.sort(key=lambda e: (-e["n_active"], -e["mean_activation"], e["idx"]))
    top = entries[:top_k]
    for i, e in enumerate(top):
        e["rank"] = i + 1
    return top


def _symmetric_rel_change(curr: float, prior: float) -> float:
    """Symmetric percent change in [-1, +1].

    Defined as (curr - prior) / max(curr, prior). Doubling reads as +0.5,
    halving as -0.5, going to zero as -1.0, growing from zero as +1.0.
    Avoids the asymmetry of (curr - prior) / prior, where the positive
    direction is unbounded but the negative direction caps at -1.

    Assumes at least one of `curr` or `prior` is > 0; both being zero is
    filtered upstream.
    """
    denom = max(curr, prior)
    return (curr - prior) / denom


def build_biggest_change_for_window(
    feature_history: list,
    window_days: int,
    excluded: set,
    label_map: dict,
    feature_baselines: dict,
    top_k: int,
) -> list:
    """Biggest change vs prior window using a symmetric percent scale.
    Returns [] if history < 2 * window_days (no prior window to compare).

    Each entry carries both mean-based and count-based deltas so the frontend
    can switch metric without re-fetching. Sort key is the *max* of |mean
    rel_change| and |count rel_change| so that big count movers aren't lost.

    Features inactive in *both* windows are skipped (no signal); a feature
    that dropped to zero today is kept (it's exactly the kind of decrease
    we want to surface).
    """
    if len(feature_history) < 2 * window_days:
        return []

    current = windowed_means(feature_history, window_days, end_offset=0)
    prior = windowed_means(feature_history, window_days, end_offset=window_days)
    curr_counts = windowed_n_active(feature_history, window_days, end_offset=0)
    prior_counts = windowed_n_active(feature_history, window_days, end_offset=window_days)

    # Union of features active in either window so big drops to zero are
    # still considered. `current` only carries features active today, so
    # we have to walk prior too.
    all_idxs = set(current.keys()) | set(prior.keys())

    entries = []
    for idx_str in all_idxs:
        idx = int(idx_str)
        if idx in excluded:
            continue
        curr_val = current.get(idx_str, 0.0)
        prior_val = prior.get(idx_str, 0.0)
        if max(curr_val, prior_val) < MIN_NONZERO:
            continue  # both windows effectively zero — no signal
        rel_change = _symmetric_rel_change(curr_val, prior_val)
        curr_n = int(curr_counts.get(idx_str, 0))
        prior_n = int(prior_counts.get(idx_str, 0))
        if max(curr_n, prior_n) > 0:
            n_active_rel_change = _symmetric_rel_change(curr_n, prior_n)
        else:
            n_active_rel_change = None
        baseline_val = feature_baselines.get(idx_str)
        entries.append({
            "idx": idx,
            "label": label_map.get(idx, f"feature_{idx}"),
            "current_mean": float(curr_val),
            "prior_mean": float(prior_val),
            "rel_change": float(rel_change),
            "current_n_active": curr_n,
            "prior_n_active": prior_n,
            "n_active_rel_change": (
                float(n_active_rel_change) if n_active_rel_change is not None else None
            ),
            "baseline_mean": float(baseline_val) if baseline_val is not None else None,
        })

    def _sort_key(e):
        m = abs(e["rel_change"])
        c = abs(e["n_active_rel_change"]) if e["n_active_rel_change"] is not None else 0.0
        return (-max(m, c), e["idx"])  # idx tiebreak → deterministic across runs

    entries.sort(key=_sort_key)
    top = entries[:top_k]
    for i, e in enumerate(top):
        e["rank"] = i + 1
    return top


def build_biggest_baseline_change_for_window(
    means: dict,
    n_active: dict,
    n_posts_in_window: int,
    excluded: set,
    label_map: dict,
    feature_baselines: dict,
    top_k: int,
) -> list:
    """Biggest change vs training baseline: (current_mean - baseline_mean) / baseline_mean.

    Each entry also carries an *implied* baseline n_active for count-mode
    display: baseline_mean (a per-post activation rate) times n_posts in the
    window. This lets the frontend show a count-unit "Δ vs baseline" without
    needing a separately-stored count baseline.

    Returns [] if there are no features with a usable baseline_mean.
    """
    # Walk all features with a usable baseline so drops to zero today are
    # still surfaced (means dict only carries features active in this window).
    candidate_idxs = set(feature_baselines.keys()) | set(means.keys())

    entries = []
    for idx_str in candidate_idxs:
        idx = int(idx_str)
        if idx in excluded:
            continue
        baseline_val = feature_baselines.get(idx_str)
        if baseline_val is None:
            continue
        baseline_val = float(baseline_val)
        if baseline_val < MIN_NONZERO:
            continue
        curr_val = float(means.get(idx_str, 0.0))
        if max(curr_val, baseline_val) < MIN_NONZERO:
            continue
        mean_rel_change = _symmetric_rel_change(curr_val, baseline_val)
        curr_n = int(n_active.get(idx_str, 0))
        baseline_n_implied = baseline_val * n_posts_in_window
        if max(curr_n, baseline_n_implied) > MIN_NONZERO:
            n_active_rel_change = _symmetric_rel_change(curr_n, baseline_n_implied)
        else:
            n_active_rel_change = None
        entries.append({
            "idx": idx,
            "label": label_map.get(idx, f"feature_{idx}"),
            "current_mean": float(curr_val),
            "current_n_active": curr_n,
            "baseline_mean": baseline_val,
            "mean_rel_change": float(mean_rel_change),
            "baseline_n_active_implied": float(baseline_n_implied),
            "n_active_rel_change": (
                float(n_active_rel_change) if n_active_rel_change is not None else None
            ),
        })

    def _sort_key(e):
        m = abs(e["mean_rel_change"])
        c = abs(e["n_active_rel_change"]) if e["n_active_rel_change"] is not None else 0.0
        return (-max(m, c), e["idx"])  # idx tiebreak → deterministic across runs

    entries.sort(key=_sort_key)
    top = entries[:top_k]
    for i, e in enumerate(top):
        e["rank"] = i + 1
    return top


def build_top_features(
    feature_history: list,
    excluded: set,
    label_map: dict,
    feature_baselines: dict,
    top_k: int = TOP_K_DASHBOARD,
) -> dict:
    """Top features + biggest-change for each window in WINDOWS.
    Empty per-window if insufficient history.
    """
    if not feature_history:
        return {"as_of": None, "n_observations": 0, "windows": {}}

    n = len(feature_history)
    last = feature_history[-1]

    windows: dict = {}
    for window_name, window_days in WINDOWS:
        if n < window_days:
            windows[window_name] = {
                "top": [],
                "biggest_change": [],
                "biggest_baseline_change": [],
                "n_posts": 0,
                "total_n_active": 0,
                "total_mean_activation": 0.0,
            }
            continue
        means = windowed_means(feature_history, window_days)
        n_active = windowed_n_active(feature_history, window_days)
        total_n_active = sum(n_active.values())
        total_mean_activation = float(sum(means.values()))
        n_posts_in_window = total_n_active // FEATURES_PER_POST
        top = build_top_for_window(
            means, n_active, excluded, label_map, feature_baselines, top_k
        )
        biggest = build_biggest_change_for_window(
            feature_history, window_days, excluded, label_map, feature_baselines, top_k
        )
        biggest_baseline = build_biggest_baseline_change_for_window(
            means, n_active, n_posts_in_window, excluded, label_map, feature_baselines, top_k
        )
        windows[window_name] = {
            "top": top,
            "biggest_change": biggest,
            "biggest_baseline_change": biggest_baseline,
            "n_posts": int(n_posts_in_window),
            "total_n_active": int(total_n_active),
            "total_mean_activation": total_mean_activation,
        }

    return {
        "as_of": last["date"],
        "n_observations": n,
        "windows": windows,
    }


def build_feature_index(
    feature_history: list,
    label_map: dict,
    feature_baselines: dict,
    model_version,
    trajectory_len: int = TRAJECTORY_LEN,
) -> dict:
    """Full feature list with baseline + current_{1d,7d,30d} + trajectory."""
    last_data = feature_history[-1].get("f", {}) if feature_history else {}
    recent = feature_history[-trajectory_len:] if feature_history else []
    n = len(feature_history)

    means_7d = windowed_means(feature_history, 7) if n >= 1 else {}
    means_30d = windowed_means(feature_history, 30) if n >= 1 else {}
    n_active_7d = windowed_n_active(feature_history, 7) if n >= 1 else {}

    ids = set(label_map.keys()) | {int(k) for k in feature_baselines.keys()}

    features = []
    for idx in sorted(ids):
        idx_str = str(idx)
        trajectory = []
        for row in recent:
            val = row.get("f", {}).get(idx_str)
            trajectory.append(float(val[0]) if val is not None else 0.0)
        baseline_val = feature_baselines.get(idx_str)
        current_1d = float(last_data[idx_str][0]) if idx_str in last_data else None
        current_7d = float(means_7d[idx_str]) if idx_str in means_7d else None
        current_30d = float(means_30d[idx_str]) if idx_str in means_30d else None
        features.append({
            "idx": idx,
            "label": label_map.get(idx, f"feature_{idx}"),
            "baseline_mean": float(baseline_val) if baseline_val is not None else None,
            "current_1d": current_1d,
            "current_7d": current_7d,
            "current_30d": current_30d,
            "n_active_recent_7d": int(n_active_7d.get(idx_str, 0)),
            "trajectory": trajectory,
        })

    return {
        "model_version": model_version,
        "n_observations": n,
        "as_of": feature_history[-1]["date"] if feature_history else None,
        "features": features,
    }


def build_feature_series(
    feature_history: list,
    label_map: dict,
    feature_baselines: dict,
) -> dict:
    """Raw, parameter-free per-feature daily inputs for the client-side
    simulator.

    The browser recomputes the §4 sequential wealth process for any start
    date / alpha / beta / Bonferroni / direction from this file alone, so
    nothing here depends on those parameters. We emit, for every feature,
    its full per-day n_active count (densified — 0 on days the sparse
    feature_history row omitted it), plus the per-day post count.

    n_posts is derived from the exactly-FEATURES_PER_POST invariant already
    relied on by build_top_features, keeping that assumption in one module.
    Aggregates only (counts + labels); no raw post text — consistent with
    the module docstring.
    """
    dates = [row["date"] for row in feature_history]
    n = len(feature_history)

    n_posts = [
        sum(int(v[1]) for v in row.get("f", {}).values()) // FEATURES_PER_POST
        for row in feature_history
    ]

    ids = set(label_map.keys()) | {int(k) for k in feature_baselines.keys()}

    features = []
    for idx in sorted(ids):
        idx_str = str(idx)
        counts = [0] * n
        means = [0.0] * n
        for d, row in enumerate(feature_history):
            val = row.get("f", {}).get(idx_str)
            if val is not None:
                # feature_history stores [mean_activation, n_active] per feature
                means[d] = float(val[0])
                counts[d] = int(val[1])
        features.append({
            "idx": idx,
            "label": label_map.get(idx, f"feature_{idx}"),
            "n_active": counts,
            "mean": means,
        })

    return {
        "n_observations": n,
        "as_of": dates[-1] if dates else None,
        "dates": dates,
        "n_posts": n_posts,
        "features": features,
    }


def run(args: argparse.Namespace) -> None:
    summary_path = Path(args.day_summary)
    if not summary_path.exists():
        raise FileNotFoundError(f"{summary_path} not found — run score_daily first")
    summary = json.loads(summary_path.read_text())

    cache = ReleaseCache.from_dir(args.release_cache)
    if not cache.baseline.exists():
        raise FileNotFoundError(f"{cache.baseline} not found — pull model-current first")
    baseline = json.loads(cache.baseline.read_text())
    training_error = float(baseline["training_error"])
    feature_baselines = baseline.get("feature_means", {})

    history = load_jsonl(cache.history)
    feature_history = load_jsonl(cache.feature_history)
    label_map = load_feature_labels(cache.features)
    excluded = load_excluded_ids(Path(args.excluded_features))

    alert = bool(history[-1]["rejected"]) if history else False

    today = build_today(summary, training_error, alert)
    recon_history = build_recon_history(history, training_error)
    site_summary = build_summary(history, today, training_error, alert)
    alerts = build_alerts(history)
    top_features = build_top_features(feature_history, excluded, label_map, feature_baselines)
    feature_index = build_feature_index(
        feature_history, label_map, feature_baselines, today.get("model_version")
    )
    feature_series = build_feature_series(feature_history, label_map, feature_baselines)

    out_dir = Path(args.live_public_dir)
    if args.dry_run:
        print(f"--dry-run: would write to {out_dir}/")
        for name in (
            "today.json", "recon_history.json", "summary.json", "alerts.json",
            "top_features.json", "feature_index.json", "feature_series.json",
        ):
            print(f"  - {out_dir}/{name}")
        print("\n[today.json preview]")
        print(json.dumps(today, indent=2))
        return

    write_json(out_dir / "today.json", today)
    write_json(out_dir / "recon_history.json", recon_history)
    write_json(out_dir / "summary.json", site_summary)
    write_json(out_dir / "alerts.json", alerts)
    write_json(out_dir / "top_features.json", top_features)
    write_json(out_dir / "feature_index.json", feature_index)
    write_json(out_dir / "feature_series.json", feature_series)
    print(f"[publish] wrote 7 JSONs to {out_dir}/")

    alert_body_path = Path(args.alert_body)
    if alert:
        alert_body_path.parent.mkdir(parents=True, exist_ok=True)
        alert_body_path.write_text(build_alert_body(today, history))
        print(f"[publish] alert active → wrote {alert_body_path}")
    elif alert_body_path.exists():
        alert_body_path.unlink()
        print(f"[publish] alert cleared → removed {alert_body_path}")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Write derived JSONs to public/data/live/ for the frontend"
    )
    p.add_argument("--day-summary", default=DAY_SUMMARY_PATH)
    p.add_argument("--release-cache", default=RELEASE_CACHE_DIR)
    p.add_argument("--live-public-dir", default=LIVE_PUBLIC_DIR)
    p.add_argument("--alert-body", default=DEFAULT_ALERT_BODY)
    p.add_argument("--excluded-features", default=DEFAULT_EXCLUDED_FEATURES)
    p.add_argument("--dry-run", action="store_true")
    run(p.parse_args())


if __name__ == "__main__":
    main()
