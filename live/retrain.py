"""Live pipeline retrain entry points.

  bootstrap_release : package SAE checkpoint + features into model-{vN,current}
                      releases, compute training_error baseline, seed empty
                      state-current release.
  retrain           : (Phase 9, not implemented)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import tarfile
import tempfile
from pathlib import Path

import numpy as np

from live import release_io
from live._vendor.sae import load_model
from live.live_config import DEFAULT_REPO


def load_training_embeddings(emb_path: str) -> np.ndarray:
    """Return (n, d) float32 ndarray of training-set embeddings.

    Accepts a directory of chunk_*.npy files (utils_embedding's chunked-cache
    format) or a single .npy file containing the (n, d) matrix.
    """
    p = Path(emb_path)
    if p.is_file():
        arr = np.load(p)
        if arr.ndim != 2:
            raise ValueError(f"expected 2-D array in {p}, got shape {arr.shape}")
        return arr.astype(np.float32, copy=False)

    if not p.is_dir():
        raise FileNotFoundError(f"--train-embeddings path does not exist: {p}")

    chunk_files = sorted(p.glob("chunk_*.npy"))
    if not chunk_files:
        raise FileNotFoundError(f"no chunk_*.npy files in {p}")

    chunks = [
        np.array([emb for _, emb in np.load(cf, allow_pickle=True)], dtype=np.float32)
        for cf in chunk_files
    ]
    if not any(len(c) for c in chunks):
        raise ValueError(f"chunk_*.npy in {p} contained no embeddings")
    return np.vstack(chunks)


def bootstrap_release(args: argparse.Namespace) -> None:
    ckpt = Path(args.checkpoint)
    feats = Path(args.features)
    emb = args.train_embeddings
    trained_through = args.trained_through or dt.date.today().isoformat()

    if not ckpt.exists():
        raise FileNotFoundError(f"checkpoint not found: {ckpt}")
    if not feats.exists():
        raise FileNotFoundError(f"features not found: {feats}")

    print(f"[bootstrap] loading SAE from {ckpt}")
    sae = load_model(str(ckpt))

    print(f"[bootstrap] loading training embeddings from {emb}")
    embeddings = load_training_embeddings(emb)
    n = embeddings.shape[0]
    print(f"[bootstrap] loaded {n} embeddings, dim={embeddings.shape[1]}")

    print("[bootstrap] computing training_error on training set")
    sample_weights = np.ones(n, dtype=np.float32)
    training_error = float(sae.compute_reconstruction_error(embeddings, sample_weights))
    print(f"[bootstrap] training_error = {training_error:.6f}")

    print("[bootstrap] computing per-feature training baselines")
    activations = sae.get_activations(embeddings, show_progress=False)
    feature_means_arr = activations.mean(axis=0)
    feature_means = {
        str(i): float(feature_means_arr[i])
        for i in range(sae.m_total_neurons)
        if feature_means_arr[i] > 0
    }
    print(f"[bootstrap] computed {len(feature_means)} non-zero feature baselines")

    with tempfile.TemporaryDirectory() as staging_str:
        staging = Path(staging_str)
        ckpt_dest = staging / ckpt.name
        feats_dest = staging / "features.json"
        baseline_dest = staging / "baseline.json"

        shutil.copy(ckpt, ckpt_dest)
        shutil.copy(feats, feats_dest)
        baseline = {
            "training_error": training_error,
            "model_version": args.version,
            "trained_through": trained_through,
            "n_train_embeddings": n,
            "embedding_dim": int(embeddings.shape[1]),
            "feature_means": feature_means,
        }
        baseline_dest.write_text(json.dumps(baseline, indent=2))

        assets = [ckpt_dest, feats_dest, baseline_dest]
        notes = (
            f"Bootstrap release {args.version}.\n"
            f"- training_error: {training_error:.6f}\n"
            f"- n_train_embeddings: {n}\n"
            f"- trained_through: {trained_through}\n"
            f"- non-zero feature baselines: {len(feature_means)}\n"
        )

        version_tag = f"model-{args.version}"
        print(f"[bootstrap] pushing {version_tag} on {args.repo}")
        release_io.push(
            version_tag, assets, repo=args.repo, notes=notes,
            title=f"Model {args.version}",
        )

        print(f"[bootstrap] pushing model-current on {args.repo}")
        release_io.push(
            "model-current", assets, repo=args.repo,
            notes=f"Rolling alias. Currently points to {args.version}.\n\n{notes}",
            title="Model (current)",
        )

    # Seed state-current. GH Releases reject 0-byte assets.
    with tempfile.TemporaryDirectory() as staging_str:
        staging = Path(staging_str)
        (staging / "seen_ids.json").write_text("{}")
        (staging / "test_state.json").write_text("{}")
        (staging / "recon_history.jsonl").write_text("\n")
        (staging / "feature_history.jsonl").write_text("\n")

        cache_tar = staging / "embedding_cache.tar.gz"
        empty_dir = staging / "embedding_cache"
        empty_dir.mkdir()
        with tarfile.open(cache_tar, "w:gz") as tf:
            tf.add(empty_dir, arcname="embedding_cache")

        state_assets = [
            staging / "seen_ids.json",
            staging / "test_state.json",
            staging / "recon_history.jsonl",
            staging / "feature_history.jsonl",
            cache_tar,
        ]
        print(f"[bootstrap] pushing state-current on {args.repo}")
        release_io.push(
            "state-current", state_assets, repo=args.repo,
            notes="Rolling state. Updated daily by daily.yml.",
            title="State (current)",
        )

    print("[bootstrap] done")


def main() -> None:
    p = argparse.ArgumentParser(description="Live pipeline retrain entry points")
    sub = p.add_subparsers(dest="cmd", required=True)

    boot = sub.add_parser(
        "bootstrap_release",
        help="Package existing SAE into model-current release",
    )
    boot.add_argument("--checkpoint", required=True)
    boot.add_argument("--features", required=True)
    boot.add_argument(
        "--train-embeddings", required=True,
        help="Dir of chunk_*.npy OR single .npy file",
    )
    boot.add_argument("--version", default="v1")
    boot.add_argument("--repo", default=DEFAULT_REPO)
    boot.add_argument("--trained-through", default=None)

    args = p.parse_args()
    if args.cmd == "bootstrap_release":
        bootstrap_release(args)


if __name__ == "__main__":
    main()
