# public/data/live

JSONs the frontend reads for the live drift monitor.

## Root files (live 128-feature §3 model, `model_version: "v2"`)

Written by the daily pipeline (`live/publish.py`) and updated daily:
`today.json`, `recon_history.json`, `summary.json`, `alerts.json`,
`top_features.json`, `feature_index.json`, `feature_series.json`, plus the
hand-edited `excluded_features.json`. The `/monitor` simulator reads the merged
historical + live `feature_series.json` (see `src/data/useLiveData.tsx`).

## `c0/ c1/ c2/ c3/` — §4 PuLSE archive representations (M=64 SAEs)

Frozen archives, one per checkpoint (paper §4). **No daily updates, no
inference on new posts.** Each directory ships exactly one file:

    c{0,1,2,3}/feature_series.json

selectable on `/monitor` via `?model=c{0,1,2,3}` (see the representation picker
in `src/pages/LiveSimulatorPage.tsx` and `useVersionedFeatureSeries` in
`src/data/useLiveData.tsx`). The file is **not** merged with the §3 historical
series — it already spans the full range (Dec 2022 → ~2025-11-30).

Training-through dates (display only): c0 = 2023-03-23, c1 = 2023-09-09,
c2 = 2024-04-04, c3 = 2025-04-18.

### Schema (same as the live `feature_series.json`)

```json
{
  "n_observations": <n_days>,
  "as_of": "YYYY-MM-DD",
  "dates":   ["YYYY-MM-DD", ...],
  "n_posts": [<int>, ...],
  "features": [
    { "idx": <int>, "label": "<interpretation>",
      "n_active": [<int>, ...], "mean": [<float>, ...] }
  ]
}
```

`label` is the c-feature's auto-labeled **interpretation** sentence (these
featurizations have no short names). 64 features per archive.

### Generation (run where `/data/reddit` + checkpoints + torch live)

Reuse `reddit_online/export_web_data.py::export_feature_series_full(saelearner,
posts_path, output_path, label_map)` — it already emits this exact shape. Run
once per checkpoint dir under
`/data/reddit/cache_features/text-embedding-3-small__title_text/sae_M64_K4/`
(`221201_230323`, `221201_230914`, `221201_240405`, `221201_250419`), with
`label_map = {idx: interpretation}` from that checkpoint's feature file, writing
to `public/data/live/c{n}/feature_series.json`.
