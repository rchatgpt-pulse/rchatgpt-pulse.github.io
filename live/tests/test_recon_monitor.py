"""Tests for live.recon_monitor."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

from live import recon_monitor
from live._vendor.sequential_test import SequentialMeanTest


def _write_summary(path: Path, date: str, day_error: float):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "date": date,
        "day_error": day_error,
    }))


def _write_baseline(path: Path, training_error: float):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "training_error": training_error,
        "model_version": "test",
    }))


def _args(tmp_path: Path, force: bool = False) -> argparse.Namespace:
    return argparse.Namespace(
        day_summary=str(tmp_path / "day_summary.json"),
        release_cache=str(tmp_path / "release"),
        force=force,
    )


def test_first_update_appends_one_row(tmp_path: Path):
    _write_baseline(tmp_path / "release" / "baseline.json", 1.0)
    _write_summary(tmp_path / "day_summary.json", "2026-01-01", 1.1)

    alert = recon_monitor.run(_args(tmp_path))
    assert isinstance(alert, bool)

    history = recon_monitor.load_history(tmp_path / "release" / "recon_history.jsonl")
    assert len(history) == 1
    row = history[0]
    assert row["date"] == "2026-01-01"
    assert row["day_error"] == pytest.approx(1.1)
    assert row["n_observations"] == 1

    state = json.loads((tmp_path / "release" / "test_state.json").read_text())
    assert state["effective_baseline"] == pytest.approx(1.0 * recon_monitor.BETA)
    assert state["training_error"] == pytest.approx(1.0)


def test_replay_then_update(tmp_path: Path):
    """Pre-existing history is replayed; new observation appended at the end."""
    _write_baseline(tmp_path / "release" / "baseline.json", 1.0)
    history = [
        {"date": "2026-01-01", "day_error": 1.04},
        {"date": "2026-01-02", "day_error": 1.06},
    ]
    recon_monitor.write_history(tmp_path / "release" / "recon_history.jsonl", history)

    _write_summary(tmp_path / "day_summary.json", "2026-01-03", 1.05)
    recon_monitor.run(_args(tmp_path))

    rows = recon_monitor.load_history(tmp_path / "release" / "recon_history.jsonl")
    assert [r["date"] for r in rows] == ["2026-01-01", "2026-01-02", "2026-01-03"]
    assert rows[-1]["n_observations"] == 3


def test_same_date_is_idempotent_skip(tmp_path: Path):
    """Re-running with the same date is a no-op without --force."""
    _write_baseline(tmp_path / "release" / "baseline.json", 1.0)
    _write_summary(tmp_path / "day_summary.json", "2026-01-01", 1.1)

    recon_monitor.run(_args(tmp_path))
    history_a = recon_monitor.load_history(tmp_path / "release" / "recon_history.jsonl")

    recon_monitor.run(_args(tmp_path))
    history_b = recon_monitor.load_history(tmp_path / "release" / "recon_history.jsonl")

    assert history_a == history_b


def test_force_overwrites_existing_date(tmp_path: Path):
    """--force drops the existing row for today and recomputes from scratch."""
    _write_baseline(tmp_path / "release" / "baseline.json", 1.0)

    _write_summary(tmp_path / "day_summary.json", "2026-01-01", 1.05)
    recon_monitor.run(_args(tmp_path))

    _write_summary(tmp_path / "day_summary.json", "2026-01-01", 1.20)
    recon_monitor.run(_args(tmp_path, force=True))

    history = recon_monitor.load_history(tmp_path / "release" / "recon_history.jsonl")
    assert len(history) == 1
    assert history[0]["day_error"] == pytest.approx(1.20)


def test_nan_day_error_skips(tmp_path: Path):
    """NaN/None day_error is skipped without writing to history."""
    _write_baseline(tmp_path / "release" / "baseline.json", 1.0)
    (tmp_path / "day_summary.json").write_text(json.dumps({
        "date": "2026-01-01",
        "day_error": None,
    }))
    alert = recon_monitor.run(_args(tmp_path))
    assert alert is False
    history_path = tmp_path / "release" / "recon_history.jsonl"
    assert not history_path.exists() or recon_monitor.load_history(history_path) == []


@pytest.mark.parametrize("bad", [float("inf"), float("-inf"), float("nan")])
def test_nonfinite_day_error_skips(tmp_path: Path, bad):
    """Inf (degenerate single-post days) and NaN are skipped, not fed to the
    wealth process. Python's json round-trips the Infinity/NaN tokens that
    score_daily writes to the (Python-only) day_summary.json."""
    _write_baseline(tmp_path / "release" / "baseline.json", 1.0)
    (tmp_path / "day_summary.json").write_text(
        json.dumps({"date": "2026-01-01", "day_error": bad})
    )
    alert = recon_monitor.run(_args(tmp_path))
    assert alert is False
    history_path = tmp_path / "release" / "recon_history.jsonl"
    assert not history_path.exists() or recon_monitor.load_history(history_path) == []


def test_synthetic_drift_rejects_deterministically():
    """Direct test of SequentialMeanTest with a clear-signal stream."""
    test = SequentialMeanTest(baseline=1.0, factor=1.0, alpha=0.05)
    for _ in range(50):
        if test.update(1.5):
            break
    assert test.rejected
    # Strong signal (1.5 vs effective baseline 1.0): rejection should be fast.
    assert test.n_observations < 20
