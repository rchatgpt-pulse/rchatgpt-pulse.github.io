"""Constants for the live monitoring pipeline."""

# Sequential test (§4 of the paper)
BETA = 1.05
ALPHA = 0.10

# Scraping
SUBREDDIT = "ChatGPT"
DAILY_POST_CAP = 500
WINDOW_HOURS = 30  # 24h coverage + 6h overlap

# GitHub repo (single source of truth)
GITHUB_OWNER = "jessica-dai"
GITHUB_REPO = "r-chatgpt"
DEFAULT_REPO = f"{GITHUB_OWNER}/{GITHUB_REPO}"

# Release tags
MODEL_RELEASE_TAG = "model-current"
STATE_RELEASE_TAG = "state-current"

# Local data paths (relative to repo root)
RAW_POSTS_DIR = "data/raw_posts"
SEEN_IDS_PATH = "data/seen_ids.json"
DAY_SCORES_DIR = "data/day_scores"
DAY_SUMMARY_PATH = "data/day_summary.json"
RECON_HISTORY_PATH = "data/recon_history.jsonl"
TEST_STATE_PATH = "data/test_state.json"
RELEASE_CACHE_DIR = "data/release_cache"
EMBED_UNPACK_ROOT = "data/cache_unpack"

# Frontend (Phase 6+)
LIVE_PUBLIC_DIR = "public/data/live"

# Embedding
EMBED_MODEL = "text-embedding-3-small"
EMBED_CACHE_NAME = "live_daily"
TOP_K_FEATURES = 10
