# Live monitor

Daily drift monitor for r/ChatGPT applying §4 of [the paper](https://arxiv.org/abs/2502.08166).
The Devvit app scrapes posts each morning, GitHub Actions scores them with a fixed SAE,
a sequential test detects when the day's reconstruction error consistently exceeds the
training baseline, and derived JSONs land at `public/data/live/` for the frontend.

## Architecture

```
Devvit (Reddit cloud)              r-chatgpt repo (private)              Pages
───────────────────              ──────────────────────                ─────
scheduler 07:00 UTC ─PUT─►  data/raw_posts/<date>.jsonl
                                     │
                                     │ push (paths filter)
                                     ▼
                            .github/workflows/daily.yml
                              ├─ pull model-current  (SAE.pt, features.json,
                              │                        baseline.json)
                              ├─ pull state-current  (recon_history.jsonl,
                              │                        test_state.json,
                              │                        embedding_cache.tar.gz)
                              ├─ score_daily         → day_summary.json
                              ├─ recon_monitor       → updated recon_history
                              ├─ publish             → public/data/live/*.json
                              ├─ push state-current  (release_io)
                              └─ commit + push public/data/live/
                                     │
                                     │ workflow_run trigger
                                     ▼
                            .github/workflows/deploy.yml ──────────► Pages
```

State lives in two places:
- **Redis on Devvit's side**: `seen_ids` hash for cross-day post-id dedup.
- **`state-current` GH release on r-chatgpt**: `recon_history.jsonl` (one observation/day),
  `test_state.json` (snapshot of `SequentialMeanTest`), and `embedding_cache.tar.gz`
  (OpenAI embedding cache, text → vector).

The model lives in `model-current` (rolling alias of latest `model-vN`): SAE checkpoint,
feature labels JSON, and `baseline.json` with the training-set recon error.

## §4 monitor

`live/recon_monitor.py` instantiates:

```python
SequentialMeanTest(baseline=training_error, factor=BETA, alpha=ALPHA)
```

where `BETA=1.05` and `ALPHA=0.10` (see `live/live_config.py`). The test runs the wealth
process from [Waudby-Smith & Ramdas](https://arxiv.org/abs/2502.08166) §4.2: each day's
`day_error` is compared to the effective baseline `training_error × 1.05`. The wealth
accumulates evidence against H0 ("mean day_error ≤ effective baseline") and the test
rejects when wealth > 1/α = 10 (equivalently, log_wealth > log(1/α) ≈ 2.30).

The test has no built-in serializer, so each day's run replays the full
`recon_history.jsonl` from scratch (one float per day; cheap forever) before applying the
new observation.

**What an alert means.** The day-over-day reconstruction error has consistently exceeded
the baseline. The SAE's features no longer span the data — drift relative to training.
Response: trigger the retrain workflow (currently a stub) to warm-start a new SAE on
accumulated history. Until retrained, the alert issue stays open and the daily monitor
keeps appending comments.

## Per-feature simulator

The §4 monitor above runs **one** test on the global reconstruction error. The
simulator (`/live/simulator` on the site) lets a user *counterfactually* run the
**same wealth-process test on a single SAE feature**: pick a feature, a start date,
α, a change factor β, a Bonferroni factor, and a direction, and see the wealth
trajectory ωₜ, the rejection threshold, and whether/when it rejects.

**Runs in the browser, not Python.** The site is static (GitHub Pages, no backend),
so the test is re-derived client-side on every control change. This is sound because
ωₜ depends only on `(series, start date, β, direction)` — α and the Bonferroni
factor only set the *horizontal* threshold `log(B/α)`, not the curve — so one
parameter-free data file supports every control.

**Observable.** Per the reference (`reddit_online` `meta.py:run_feature_test`), the
per-feature observable is the **daily activation rate**: the fraction of that day's
posts that activate the feature, `n_active / n_posts`. The baseline μ₀ is the mean
rate over all days *strictly before* the chosen start date (the pre-deployment
split); the test runs over the days on/after it. μ₀ is recomputed client-side
whenever the start date changes.

**Hypotheses / direction.**
- `increase`: H0 `mean ≤ μ₀·β` — effective baseline `μ₀·β`, `g = obs − μ₀·β`.
- `decrease`: H0 `mean ≥ μ₀/β` — the increase test on the sign-flipped stream,
  equivalently `g = μ₀/β − obs`. The ONS λ-update is the gradient of `log(1+λg)`
  either way, so a single branch on `g` covers both tails (no separate code path).

**Bonferroni.** Per-test level is `α / B`, so the rejection threshold is
`log(1/(α/B)) = log(B/α)`. With one shared `feature_series.json` the client can move
B freely; it only shifts the threshold line.

**Data.** `publish.py:build_feature_series()` emits
`public/data/live/feature_series.json` — raw and parameter-free:

```jsonc
{
  "n_observations": 152, "as_of": "2026-05-18",
  "dates":  ["2026-01-...", ...],            // chronological
  "n_posts": [137, 152, ...],                // per day; sum(n_active)//4
  "features": [ { "idx": 5, "label": "...",
                  "n_active": [3, 0, 7, ...] } ]   // densified, 0 on absent days
}
```

`n_posts` is derived from the exactly-`FEATURES_PER_POST` (=4) SAE-sparsity
invariant already used by `build_top_features` — kept in that one module. The
sparse `feature_history.jsonl` rows are densified here (0 on days a feature was
absent) so the client doesn't have to. Aggregates only — no raw post text.

**Numerical parity is mandatory.** `src/lib/sequentialTest.ts` is a hand port of
the core recursion in `_vendor/sequential_test.py::SequentialMeanTest` (no
confidence-bound machinery). `scripts/sim_parity.py` runs the authoritative Python
class on synthetic series and dumps the expected log-wealth trajectory;
`scripts/sim_parity_check.ts` asserts the TS port reproduces it to 1e-9 (it matches
exactly) for both directions, including the rejection step. Re-run after any change
to either side:

```bash
python scripts/sim_parity.py && node scripts/sim_parity_check.ts
```

**File map.**
- `live/publish.py` — `build_feature_series()` + `feature_series.json` write.
- `src/lib/sequentialTest.ts` — TS port + `simulate(series, startDate, opts)`.
- `src/data/useLiveData.tsx`, `src/types.ts` — fetch + `LiveFeatureSeries` type.
- `src/pages/LiveSimulatorPage.tsx` — controls + Recharts chart + result card.
- `scripts/sim_parity*` — Python↔TS parity gate.

**Not yet handled (future, when retraining is real).** Only one SAE exists today
(`retrain.py` is a stub), so the feature set is identical at every start date and
the picker is just the full list. Once Ĉ changes per `model_version`, a feature is
only meaningful *within* a model (same idx ≠ same concept across SAEs) and the
test's start date + μ₀ must come from *that model's* pre-deployment window. The
true dependency is therefore **model → feature → start date**, not the current
feature → date order.

Decided design (build later, keep the shape now):

- Adopt the model → feature → question hierarchy. Selecting a model scopes both
  the feature list and the valid start-date range; μ₀ then falls out of that
  model's training baseline for free.
- Single-model case (today) renders the model as a non-interactive caption
  ("Model v1 · <window>"), *not* a tab strip, so the existing 1·feature /
  2·question narrative is unchanged. With ≥2 models that caption becomes a
  step-1 model tab strip (default to latest) and the steps renumber. Retrains
  are drift-triggered and infrequent, so a handful of tabs at most.
- Keep a single date concept: the model fixes the window, the slider picks the
  pre/post split within it. Do **not** introduce a separate model-scoping date
  (the rejected "date-first" option, which created two conflicting dates).
- Forward-compat hook so this stays an additive prefix step rather than a
  rewrite: the feature list and slider range are currently derived from the
  whole `feature_series.json` in one place (`LiveSimulatorPage`); keep that
  derivation centralized so it can later be parameterized by selected model.
  `simulate()` and `feature_series.json` are already model-agnostic.

## Code map

Python (`live/`):
- `_vendor/` — frozen copy of Python method code.
- `live_config.py` — single source of truth for constants (`BETA`, `ALPHA`, `DAILY_POST_CAP`, paths, repo names).
- `release_io.py` — `gh release` wrappers (pull/push, idempotent) + `ReleaseCache` dataclass that maps a directory to canonical filenames (`.baseline`, `.history`, `.test_state`, `.embed_tar`, `.ckpt`).
- `score_daily.py` — load posts → embed via OpenAI (uses cache) → SAE inference → emit `day_summary.json` + sparse-activation parquet under `data/day_scores/`.
- `recon_monitor.py` — load history, replay into `SequentialMeanTest`, append today, write `test_state.json`. `--force` re-runs the same date.
- `publish.py` — combine `day_summary.json` + history into the public JSONs at `public/data/live/` (recon, summary, alerts, top-features, feature-index, and `feature_series.json` for the per-feature simulator). Also emits `live/alert_body.md` when alerting.
- `retrain.py` — `bootstrap_release` subcommand (one-shot at project start). The full `retrain` subcommand is not yet implemented.
- `tests/test_recon_monitor.py` — unit tests for the monitor's idempotency, replay, and `--force` paths.

TypeScript (`devvit/`):
- `src/server/scrape.ts` — `runScrape()` reads `new` + `top` over a 30h window, dedups against Redis, caps at 500, PUTs JSONL to GitHub Contents API.
- `src/server/server.ts` — HTTP routes + `onAppInstall` (registers `scheduler.runJob`).
- `devvit.json` — declares `permissions.http.domains` (api.github.com), `settings.global.github_pat`, mod menu items.

Workflows (`.github/workflows/`):
- `daily.yml` — orchestrates the daily pipeline. Triggers on push to `data/raw_posts/**`. Pulls releases → score → monitor → publish → commit → push state-current. Conditional final step opens/comments on a `retrain-alert`-labeled issue if the test rejected.
- `deploy.yml` — Pages deploy. Triggered by `push: main` AND by `workflow_run: daily-monitor` (so daily.yml's GITHUB_TOKEN push, which doesn't naturally trigger workflows, still fires the redeploy).

## Daily flow (automatic)

1. **07:00 UTC**: Devvit scheduler invokes `/internal/scrape`.
2. `runScrape()` queries `r.subreddit('ChatGPT').new()` + `top('day')` over the 30h window, dedups against `redis.hKeys('seen_ids')`, caps at 500.
3. JSONL is base64'd and PUT to `api.github.com/repos/jessica-dai/r-chatgpt/contents/data/raw_posts/<date>.jsonl` using the `github_pat` Devvit setting.
4. The push to `main` matches `daily-monitor`'s `paths: data/raw_posts/**` filter; the workflow runs.
5. daily.yml pulls model-current + state-current, runs score → recon_monitor → publish, commits `public/data/live/*.json`, pushes the updated `state-current` release.
6. `daily-monitor` completes. `workflow_run` trigger on `deploy.yml` fires; Pages redeploys.
7. If the test rejected, daily.yml opens (or comments on) the `retrain-alert` GH Issue.

## Manual operations

```bash
# Trigger a manual scrape (mod menu in r/publicfeedbackai_dev):
#   "Run scrape now (debug)" → toast shows kept count + commit path

# Trigger a manual pipeline run for a specific date:
gh workflow run daily-monitor --repo jessica-dai/r-chatgpt -f date=2026-05-03

# Inspect what's currently published:
gh api repos/jessica-dai/r-chatgpt/contents/public/data/live/today.json \
  --jq .content | base64 -d | jq

# Inspect full recon history:
gh release download state-current --repo jessica-dai/r-chatgpt \
  --pattern recon_history.jsonl --dir /tmp/state
jq -s '.' /tmp/state/recon_history.jsonl

# Reset Devvit's seen_ids for testing (mod menu in r/publicfeedbackai_dev):
#   "Clear seen_ids (debug)"

# Re-run a past date locally (after pulling releases):
python -m live.release_io pull --tag model-current --dest data/release_cache
python -m live.release_io pull --tag state-current --dest data/release_cache
mkdir -p data/raw_posts
gh api repos/jessica-dai/r-chatgpt/contents/data/raw_posts/2026-05-04.jsonl \
  --jq .content | base64 -d > data/raw_posts/2026-05-04.jsonl
python -m live.score_daily --date 2026-05-04
python -m live.recon_monitor --force   # --force overwrites today's row
python -m live.publish
```

## Local development (Python pipeline)

Setup once:

```bash
pip install -r live/requirements.txt
gh auth status   # if not logged in: gh auth login
export OPENAI_KEY=sk-...
```

Run individual phases:

```bash
# Pull current state
python -m live.release_io pull --tag model-current --dest data/release_cache
python -m live.release_io pull --tag state-current --dest data/release_cache

# Score (requires data/raw_posts/<date>.jsonl)
python -m live.score_daily --date YYYY-MM-DD

# Monitor (idempotent on same date; --force to overwrite)
python -m live.recon_monitor

# Publish (--dry-run prints without writing)
python -m live.publish
```

Force-alert smoke test:

```bash
# Save the real baseline
cp data/release_cache/baseline.json /tmp/baseline.bak
# Lower training_error to force rejection
python -c "
import json; p='data/release_cache/baseline.json'
b=json.load(open(p)); b['training_error']=0.001
json.dump(b, open(p,'w'))
"
python -m live.recon_monitor --force
python -m live.publish
cat live/alert_body.md   # should exist with markdown for the issue body
# Restore
cp /tmp/baseline.bak data/release_cache/baseline.json
python -m live.recon_monitor --force
python -m live.publish   # alert_body.md is auto-removed when alert clears
```

Tests:

```bash
pytest live/tests/

# Per-feature simulator: assert the browser TS port matches the Python
# authority (regenerates the fixture, then checks to 1e-9):
python scripts/sim_parity.py && node scripts/sim_parity_check.ts
```

## Devvit app

The scraper runs as a `@devvit/web` 0.12.x app, scaffolded under `devvit/`. It's installed
on `r/publicfeedbackai_dev` (a personal sub the dev moderates) so the scheduler has somewhere
to live; the app reads from `r/ChatGPT` directly (public-sub access doesn't require
installation).

### Setup (one-time)

```bash
cd devvit
npm install
npx devvit login   # opens browser to authenticate
```

### Local playtest

`npm run dev` runs `devvit playtest`, which uploads a watch-and-redeploy build to Reddit's
infra and installs it on the configured `dev.subreddit` (set in `devvit.json` to
`publicfeedbackai_dev`). File changes in `src/` re-bundle and re-deploy automatically.

```bash
cd devvit
npm run dev
# Wait for "Playtest is ready" then go to:
#   https://sh.reddit.com/r/publicfeedbackai_dev
# Mod menu (... icon) → "Run scrape now (debug)" or "Clear seen_ids (debug)"
```

Exit with `Ctrl-C`. Changes to `devvit.json` (e.g. adding a permission, setting, or menu
item) require restarting `npm run dev` — the file watcher only redeploys on `src/` changes.

### Production deploy

```bash
cd devvit
npm run deploy   # = npm run build && devvit upload  (new app version, no review)
# OR for first-time publish to the marketplace:
npm run launch   # = npm run build && npm run deploy && devvit publish  (review-gated)
```

### Inspecting logs

```bash
cd devvit
npx devvit logs                  # tail recent logs from the live app
npx devvit logs --json           # machine-readable
```

The scheduler's `runScrape` writes `[scrape <date>] kept=N skipped_seen=X ...` to stdout.
Inspect after a 07:00 UTC run to verify or diagnose.

### Settings

```bash
npx devvit settings list            # show currently-set values (secrets are masked)
npx devvit settings set github_pat  # interactive prompt for the value
npx devvit settings delete github_pat
```

Settings must be **declared in `devvit.json`** (under `settings.global`) before they can be
set. The CLI rejects writes to undeclared settings.

### HTTP-route map

`@devvit/web` dispatches Reddit-side events to HTTP endpoints on the in-app server. All
routes are declared in `devvit.json` (`triggers`, `menu.items`) and wired to handlers in
`src/server/server.ts`'s switch statement.

- `/internal/on-app-install` — fires on app install; registers `daily-scrape` with the scheduler.
- `/internal/scrape` — fires on the scheduled cron; calls `runScrape()`.
- `/internal/menu/scrape-now` — fires when a moderator clicks the debug menu.
- `/internal/menu/clear-seen` — clears `seen_ids` from Redis.

## Configuration & secrets

Constants live in `live/live_config.py`:
- `BETA=1.05`, `ALPHA=0.10` — §4 monitor parameters
- `DAILY_POST_CAP=500`, `WINDOW_HOURS=30`, `SUBREDDIT="ChatGPT"`
- `GITHUB_OWNER`, `GITHUB_REPO`, `DEFAULT_REPO`
- All file paths (`RAW_POSTS_DIR`, `RELEASE_CACHE_DIR`, etc.)

Secrets:
- **r-chatgpt repo secret**: `OPENAI_KEY` — for the embedding step in daily.yml. (No GitHub PAT needed; `GITHUB_TOKEN` handles releases / commits / issues for the same repo.)
- **Devvit app setting**: `github_pat` — fine-grained PAT with `Contents: Read & Write` on `r-chatgpt`. Set via `npx devvit settings set github_pat` (see Devvit § above).

Devvit outbound HTTP allowlist (declared in `devvit/devvit.json`):
- `api.github.com`

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `TypeError: fetch failed` from Devvit | `api.github.com` not in `permissions.http.domains` | Add to `devvit.json`, restart playtest |
| `HTTP 400: Bad Content-Length` on release upload | Asset is 0 bytes; GH Releases reject empty files | Always write at least `"\n"` |
| `Unable to lookup the setting key` from Devvit CLI | Setting not declared in `devvit.json` | Add under `settings.global`, restart playtest |
| `no SAE_*.pt in data/release_cache` | Forgot to pull the release | `python -m live.release_io pull --tag model-current --dest data/release_cache` |
| `day_error` wildly different from `training_error` | Text-format mismatch with training | Check `post_text()` in `score_daily.py` matches what the SAE was trained on |
| daily.yml runs but commits nothing | Today's date already in history | recon_monitor skips by default; pass `--force` to re-run |
| Scheduler doesn't fire | Playtest not running OR app not published | `npx devvit logs` from `devvit/` to verify; for production install, `npm run launch` |
| Pages doesn't redeploy after daily-monitor | `workflow_run` trigger missing on deploy.yml | Verify `on.workflow_run.workflows: [daily-monitor]` in `.github/workflows/deploy.yml` |

## Operational invariants

- The SAE is **fixed between retrains** (§4 spec). Don't re-train inside the daily flow.
- `recon_history.jsonl` is **append-only** and replayed each run. The full history is the source of truth; `test_state.json` is observability only.
- `state-current` is the **single source of truth** for daily-evolving state. daily.yml always pulls before computing and pushes after.
- Devvit's `seen_ids` Redis hash deduplicates across days. **Don't reset it** unless scraper logic changes (otherwise you'll re-scrape and double-commit the same posts).
- The text used for embedding is `title + "\n\n" + selftext` (see `post_text()` in `score_daily.py`). This must match training — if a future SAE uses a different format, update `post_text()` in lockstep.
