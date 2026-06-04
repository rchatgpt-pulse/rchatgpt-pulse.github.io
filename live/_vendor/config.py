"""Minimal config stub for vendored modules.

The original reddit_online/config.py contained experiment-wide constants
(dataset paths, cache directories, model defaults). For the live pipeline
we only need a small subset, all overridable via environment variables.
"""
import os

EMBEDDING_CACHE_DIR = os.environ.get("EMBEDDING_CACHE_DIR", "data/cache/embeddings")
ANNOTATION_CACHE_DIR = os.environ.get("ANNOTATION_CACHE_DIR", "data/cache/annotations")
PROMPTS_DIR = os.environ.get("PROMPTS_DIR", "live/_vendor/prompts")
FEATURES_CACHE_DIR = os.environ.get("FEATURES_CACHE_DIR", "data/cache/features")
DEFAULT_N_WORKERS = int(os.environ.get("DEFAULT_N_WORKERS", "5"))
