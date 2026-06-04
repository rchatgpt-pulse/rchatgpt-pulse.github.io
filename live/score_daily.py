"""Score one day's r/ChatGPT posts using the current SAE."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import tarfile
from pathlib import Path

import numpy as np
import pandas as pd

from live.live_config import (
    DAY_SCORES_DIR,
    DAY_SUMMARY_PATH,
    EMBED_CACHE_NAME,
    EMBED_MODEL,
    EMBED_UNPACK_ROOT,
    RAW_POSTS_DIR,
    RELEASE_CACHE_DIR,
    TOP_K_FEATURES,
)
from live.release_io import ReleaseCache


def post_text(post: dict) -> str:
    """Concatenate title + selftext for embedding. Must match training format."""
    title = (post.get("title") or "").strip()
    body = (post.get("selftext") or "").strip()
    if title and body:
        return f"{title}\n\n{body}"
    return title or body


def load_features(path: Path) -> dict:
    """Load features.json as {feature_idx: label}."""
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError(f"expected dict in {path}, got {type(raw).__name__}")
    return {int(k): str(v) for k, v in raw.items()}


def setup_embedding_cache(cache_tar: Path, unpack_root: Path) -> Path:
    unpack_root.mkdir(parents=True, exist_ok=True)
    if cache_tar.exists():
        with tarfile.open(cache_tar, "r:gz") as tf:
            tf.extractall(unpack_root)
    cache_dir = unpack_root / "embedding_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def repack_embedding_cache(unpack_root: Path, cache_tar: Path) -> None:
    cache_dir = unpack_root / "embedding_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_tar.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(cache_tar, "w:gz") as tf:
        tf.add(cache_dir, arcname="embedding_cache")


def append_feature_history(
    path: Path,
    date: str,
    feature_means: np.ndarray,
    feature_n_active: np.ndarray,
) -> int:
    """Append today's per-feature means + n_active to feature_history.jsonl.
    Idempotent: drops any prior row for the same date. Returns total row count.

    Format per line (compact wide):
        {"date":"YYYY-MM-DD","f":{"<idx>":[<mean>,<n_active>], ...}}
    Only non-zero features are stored.
    """
    rows: list = []
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    rows = [r for r in rows if r.get("date") != date]

    non_zero = {
        str(int(idx)): [float(feature_means[idx]), int(feature_n_active[idx])]
        for idx in range(len(feature_means))
        if feature_means[idx] > 0
    }
    rows.append({"date": date, "f": non_zero})
    rows.sort(key=lambda r: r["date"])

    path.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "\n"
    path.write_text(body)
    return len(rows)


def score_day(args: argparse.Namespace) -> None:
    date = args.date or dt.date.today().isoformat()
    raw_posts_path = Path(args.raw_posts_dir) / f"{date}.jsonl"
    if not raw_posts_path.exists():
        raise FileNotFoundError(f"raw posts not found: {raw_posts_path}")

    cache = ReleaseCache.from_dir(args.release_cache)
    print(f"[score_daily] date={date}  raw={raw_posts_path}")

    posts = []
    with open(raw_posts_path) as f:
        for line in f:
            line = line.strip()
            if line:
                posts.append(json.loads(line))
    print(f"[score_daily] loaded {len(posts)} posts")

    # EMBEDDING_CACHE_DIR must be set before utils_embedding's first import,
    # because vendored config.py reads the env var at module load time.
    unpack_root = Path(args.unpack_root)
    embed_cache_dir = setup_embedding_cache(cache.embed_tar, unpack_root)
    os.environ["EMBEDDING_CACHE_DIR"] = str(embed_cache_dir)

    from live._vendor.sae import load_model
    from live._vendor.utils_embedding import get_openai_embeddings

    sae = load_model(str(cache.ckpt))
    feature_labels = load_features(cache.features)
    baseline = json.loads(cache.baseline.read_text())
    training_error = float(baseline["training_error"])
    model_version = baseline.get("model_version")
    trained_through = baseline.get("trained_through")

    texts = [post_text(p) for p in posts]
    print(f"[score_daily] embedding {len(texts)} texts (cache_name={args.cache_name})")
    text2emb = get_openai_embeddings(
        texts=[t for t in texts if t],
        model=args.embed_model,
        cache_name=args.cache_name,
        show_progress=False,
    )

    valid_posts = []
    embed_rows = []
    for p, txt in zip(posts, texts):
        if not txt:
            continue
        emb = text2emb.get(txt)
        if emb is None:
            print(f"[score_daily] WARN: no embedding for post {p['id']}")
            continue
        valid_posts.append(p)
        embed_rows.append(np.asarray(emb, dtype=np.float32))

    if not valid_posts:
        embed_matrix = np.empty((0, sae.input_dim), dtype=np.float32)
    else:
        embed_matrix = np.stack(embed_rows)
    n = embed_matrix.shape[0]
    print(f"[score_daily] embed matrix shape: {embed_matrix.shape}")

    if n == 0:
        day_error = float("nan")
        activations = np.empty((0, sae.m_total_neurons), dtype=np.float32)
    else:
        sample_weights = np.ones(n, dtype=np.float32)
        day_error = float(sae.compute_reconstruction_error(embed_matrix, sample_weights))
        if not np.isfinite(day_error):
            # A single-post (or otherwise degenerate) day yields a non-finite
            # normalized error (zero-variance denominator). Record it as NaN so
            # the sequential monitor skips it and published JSON stays finite.
            print(f"[score_daily] WARN: non-finite day_error for n={n}; recording as NaN")
            day_error = float("nan")
        activations = sae.get_activations(embed_matrix, show_progress=False)

    print(f"[score_daily] day_error = {day_error:.6f}  (training_error = {training_error:.6f})")

    if n > 0:
        feature_means = activations.mean(axis=0)
        feature_n_active = (activations > 0).sum(axis=0)
    else:
        feature_means = np.zeros(sae.m_total_neurons, dtype=np.float32)
        feature_n_active = np.zeros(sae.m_total_neurons, dtype=np.int64)

    top_idx = np.argsort(-feature_means)[: args.top_k]
    top_features = [
        {
            "idx": int(idx),
            "label": feature_labels.get(int(idx), f"feature_{idx}"),
            "mean_activation": float(feature_means[idx]),
            "n_active": int(feature_n_active[idx]),
        }
        for idx in top_idx
        if feature_means[idx] > 0
    ]

    rows = []
    for i, p in enumerate(valid_posts):
        act = activations[i]
        for idx in np.nonzero(act)[0]:
            rows.append({
                "post_id": p["id"],
                "feature_idx": int(idx),
                "activation": float(act[idx]),
            })
    df = pd.DataFrame(rows, columns=["post_id", "feature_idx", "activation"])
    out_parquet = Path(args.day_scores_dir) / f"{date}.parquet"
    out_parquet.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_parquet, index=False)
    print(f"[score_daily] wrote {len(df)} rows to {out_parquet}")

    summary = {
        "date": date,
        "n_posts_raw": len(posts),
        "n_posts_scored": n,
        "day_error": day_error,
        "training_error": training_error,
        "model_version": model_version,
        "trained_through": trained_through,
        "top_features": top_features,
    }
    summary_path = Path(args.day_summary_path)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"[score_daily] wrote {summary_path}")

    repack_embedding_cache(unpack_root, cache.embed_tar)
    print(f"[score_daily] repacked embedding cache to {cache.embed_tar}")

    n_history_rows = append_feature_history(
        cache.feature_history, date, feature_means, feature_n_active
    )
    print(f"[score_daily] feature_history.jsonl now has {n_history_rows} rows")


def main() -> None:
    p = argparse.ArgumentParser(description="Score one day's r/ChatGPT posts with the current SAE")
    p.add_argument("--date", default=None, help="YYYY-MM-DD (default: today UTC)")
    p.add_argument("--raw-posts-dir", default=RAW_POSTS_DIR)
    p.add_argument("--release-cache", default=RELEASE_CACHE_DIR)
    p.add_argument("--day-scores-dir", default=DAY_SCORES_DIR)
    p.add_argument("--day-summary-path", default=DAY_SUMMARY_PATH)
    p.add_argument("--unpack-root", default=EMBED_UNPACK_ROOT)
    p.add_argument("--cache-name", default=EMBED_CACHE_NAME)
    p.add_argument("--embed-model", default=EMBED_MODEL)
    p.add_argument("--top-k", type=int, default=TOP_K_FEATURES)
    score_day(p.parse_args())


if __name__ == "__main__":
    main()
