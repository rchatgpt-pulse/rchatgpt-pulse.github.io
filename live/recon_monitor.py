"""Sequential drift monitor: feed today's recon error into SequentialMeanTest."""
from __future__ import annotations

import argparse
import dataclasses
import json
import math
import sys
from pathlib import Path

from live._vendor.sequential_test import SequentialMeanTest
from live.live_config import ALPHA, BETA, DAY_SUMMARY_PATH, RELEASE_CACHE_DIR
from live.release_io import ReleaseCache


def load_history(path: Path) -> list:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_history(path: Path, rows: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # GH Releases reject 0-byte assets, so always write at least a newline.
    body = ("\n".join(json.dumps(r) for r in rows) + "\n") if rows else "\n"
    path.write_text(body)


def run(args: argparse.Namespace) -> bool:
    summary_path = Path(args.day_summary)
    if not summary_path.exists():
        raise FileNotFoundError(f"{summary_path} not found — run score_daily first")
    summary = json.loads(summary_path.read_text())
    today_date = summary["date"]
    today_error = summary["day_error"]

    if today_error is None or (
        isinstance(today_error, (int, float)) and not math.isfinite(today_error)
    ):
        # Skip NaN (zero-post days) and Inf (degenerate single-post days):
        # feeding either into the wealth process would corrupt it.
        print(
            f"[recon_monitor] day_error is non-finite/None ({today_error}); "
            f"skipping update for {today_date}"
        )
        return False

    cache = ReleaseCache.from_dir(args.release_cache)
    if not cache.baseline.exists():
        raise FileNotFoundError(f"{cache.baseline} not found — pull model-current first")
    baseline = json.loads(cache.baseline.read_text())
    training_error = float(baseline["training_error"])

    history = load_history(cache.history)

    existing_idx = next(
        (i for i, r in enumerate(history) if r.get("date") == today_date), None
    )
    if existing_idx is not None and not args.force:
        print(
            f"[recon_monitor] {today_date} already in recon_history; "
            f"skipping (use --force to overwrite)"
        )
        return bool(history[existing_idx].get("rejected", False))
    if existing_idx is not None and args.force:
        print(f"[recon_monitor] --force: dropping existing row for {today_date} and recomputing")
        history = history[:existing_idx]

    test = SequentialMeanTest(baseline=training_error, factor=BETA, alpha=ALPHA)
    for r in history:
        test.update(float(r["day_error"]))

    test.update(float(today_error))
    state = test.get_state()

    print(
        f"[recon_monitor] {today_date}: day_error={today_error:.6f} "
        f"vs effective_baseline={test.effective_baseline:.6f} "
        f"(training_error={training_error:.6f} * factor={BETA})"
    )
    print(
        f"[recon_monitor] n={state.n_observations} log_wealth={state.log_wealth:.4f} "
        f"wealth={state.wealth:.4f} threshold_log={math.log(1 / ALPHA):.4f}"
    )
    print(f"[recon_monitor] rejected={state.rejected}  alert={'true' if state.rejected else 'false'}")

    history.append({
        "date": today_date,
        "day_error": float(today_error),
        "log_wealth": float(state.log_wealth),
        "wealth": float(state.wealth),
        "n_observations": int(state.n_observations),
        "rejected": bool(state.rejected),
    })
    write_history(cache.history, history)
    print(f"[recon_monitor] appended row to {cache.history}; total {len(history)} observations")

    state_out = dataclasses.asdict(state)
    state_out.update({
        "training_error": training_error,
        "factor": BETA,
        "alpha": ALPHA,
        "effective_baseline": test.effective_baseline,
    })
    cache.test_state.parent.mkdir(parents=True, exist_ok=True)
    cache.test_state.write_text(json.dumps(state_out, indent=2, default=str))
    print(f"[recon_monitor] wrote {cache.test_state}")

    return bool(state.rejected)


def main() -> int:
    p = argparse.ArgumentParser(description="Update sequential drift monitor with today's day_error")
    p.add_argument("--day-summary", default=DAY_SUMMARY_PATH)
    p.add_argument("--release-cache", default=RELEASE_CACHE_DIR)
    p.add_argument(
        "--force", action="store_true",
        help="Overwrite an existing row for today (replays from scratch)",
    )
    run(p.parse_args())
    return 0


if __name__ == "__main__":
    sys.exit(main())
