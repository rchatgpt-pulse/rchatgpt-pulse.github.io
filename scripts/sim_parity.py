"""Generate the cross-language parity fixture for the per-feature simulator.

Runs the authoritative `live/_vendor/sequential_test.py::SequentialMeanTest`
on synthetic daily-rate series and dumps the expected log-wealth trajectory
(both directions) to scripts/sim_parity_fixture.json. The TypeScript port is
checked against this fixture by scripts/sim_parity_check.ts.

Direction mapping (must match src/lib/sequentialTest.ts):
  increase : SequentialMeanTest(baseline=μ₀, factor=β)        fed obs
  decrease : SequentialMeanTest(baseline=-μ₀/β, factor=1.0)   fed -obs
             (the increase test on the sign-flipped stream → g = μ₀/β - obs)

Per-test α = α / bonferroni, so the Python threshold log(1/(α/B)) equals the
TS threshold log(B/α).

Run: python scripts/sim_parity.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from live._vendor.sequential_test import SequentialMeanTest  # noqa: E402

DATES = [f"2026-02-{d:02d}" for d in range(1, 41)]  # 40 chronological days
START_DATE = DATES[15]  # 15 pre-start days (μ₀), 25 monitored days
ALPHA = 0.1
BETA = 1.05
BONFERRONI = 7

# A sustained upward shift (increase should reject) and a sustained downward
# shift (decrease should reject). Running both directions on each scenario
# exercises both the threshold-crossing and the no-reject paths.
SCENARIOS = {
    "up": [0.03] * 15 + [0.10, 0.25, 0.45, 0.60] + [0.68] * 21,
    "down": [0.68] * 15 + [0.60, 0.45, 0.25, 0.10] + [0.03] * 21,
}


def _jsonable(x: float):
    return x if math.isfinite(x) else None


def run(rate: list[float], direction: str):
    pre = [r for d, r in zip(DATES, rate) if d < START_DATE]
    post = [r for d, r in zip(DATES, rate) if d >= START_DATE]
    mu0 = sum(pre) / len(pre)
    per_test_alpha = ALPHA / BONFERRONI

    if direction == "increase":
        t = SequentialMeanTest(baseline=mu0, factor=BETA, alpha=per_test_alpha)
        stream = post
    else:
        t = SequentialMeanTest(baseline=-mu0 / BETA, factor=1.0, alpha=per_test_alpha)
        stream = [-o for o in post]

    log_wealth: list = []
    rejection_index = None
    for i, o in enumerate(stream):
        was = t.rejected
        t.update(o)
        log_wealth.append(_jsonable(float(t.log_wealth)))
        if rejection_index is None and not was and t.rejected:
            rejection_index = i

    return {"logWealth": log_wealth, "rejectionIndex": rejection_index}


def main() -> None:
    fixture = {
        "dates": DATES,
        "startDate": START_DATE,
        "params": {"alpha": ALPHA, "beta": BETA, "bonferroni": BONFERRONI},
        "threshold": math.log(BONFERRONI / ALPHA),
        "scenarios": SCENARIOS,
        "expected": {
            name: {
                "increase": run(rate, "increase"),
                "decrease": run(rate, "decrease"),
            }
            for name, rate in SCENARIOS.items()
        },
    }
    out = Path(__file__).parent / "sim_parity_fixture.json"
    out.write_text(json.dumps(fixture, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
