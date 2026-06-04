"""Wrappers around `gh release` for the live pipeline."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from live.live_config import DEFAULT_REPO


def _gh(*args: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(["gh", *args], check=check, capture_output=capture, text=True)


def release_exists(tag: str, repo: str = DEFAULT_REPO) -> bool:
    p = _gh("release", "view", tag, "--repo", repo, check=False, capture=True)
    return p.returncode == 0


def pull(tag: str, dest: str | Path, repo: str = DEFAULT_REPO, pattern: str = "*") -> Path:
    """Download assets matching `pattern` from release `tag` into `dest`."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    _gh(
        "release", "download", tag,
        "--repo", repo,
        "--dir", str(dest),
        "--pattern", pattern,
        "--clobber",
    )
    return dest


def push(
    tag: str,
    files: Iterable[str | Path],
    repo: str = DEFAULT_REPO,
    notes: Optional[str] = None,
    title: Optional[str] = None,
    create_if_missing: bool = True,
) -> None:
    """Upload `files` to release `tag`. Creates if missing, otherwise --clobber."""
    file_strs = [str(f) for f in files]
    if release_exists(tag, repo):
        _gh("release", "upload", tag, *file_strs, "--repo", repo, "--clobber")
        return
    if not create_if_missing:
        raise RuntimeError(f"Release {tag} does not exist on {repo}")
    cmd = ["release", "create", tag, *file_strs, "--repo", repo]
    if title is not None:
        cmd += ["--title", title]
    if notes is not None:
        cmd += ["--notes", notes]
    _gh(*cmd)


@dataclass(frozen=True)
class ReleaseCache:
    """Filesystem layout of pulled model-current + state-current assets."""
    root: Path

    @classmethod
    def from_dir(cls, dir_path: str | Path) -> "ReleaseCache":
        return cls(root=Path(dir_path))

    @property
    def baseline(self) -> Path:
        return self.root / "baseline.json"

    @property
    def features(self) -> Path:
        return self.root / "features.json"

    @property
    def history(self) -> Path:
        return self.root / "recon_history.jsonl"

    @property
    def test_state(self) -> Path:
        return self.root / "test_state.json"

    @property
    def embed_tar(self) -> Path:
        return self.root / "embedding_cache.tar.gz"

    @property
    def feature_history(self) -> Path:
        return self.root / "feature_history.jsonl"

    @property
    def ckpt(self) -> Path:
        ckpts = sorted(self.root.glob("SAE_*.pt"))
        if not ckpts:
            raise FileNotFoundError(
                f"no SAE_*.pt in {self.root} — run `python -m live.release_io pull --tag model-current` first"
            )
        return ckpts[0]


def main() -> None:
    import argparse
    p = argparse.ArgumentParser(description="gh release wrappers for the live pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    pull_p = sub.add_parser("pull")
    pull_p.add_argument("--tag", required=True)
    pull_p.add_argument("--dest", default="data/release_cache")
    pull_p.add_argument("--repo", default=DEFAULT_REPO)
    pull_p.add_argument("--pattern", default="*")

    push_p = sub.add_parser("push")
    push_p.add_argument("--tag", required=True)
    push_p.add_argument("--repo", default=DEFAULT_REPO)
    push_p.add_argument("--notes", default=None)
    push_p.add_argument("--title", default=None)
    push_p.add_argument("files", nargs="+")

    args = p.parse_args()
    if args.cmd == "pull":
        pull(args.tag, args.dest, args.repo, args.pattern)
    else:
        push(args.tag, args.files, args.repo, args.notes, args.title)


if __name__ == "__main__":
    main()
