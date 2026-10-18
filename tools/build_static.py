#!/usr/bin/env python3
"""Stage the static web app for the image and stamp it with a content-derived build id (PLAN §8).

    python tools/build_static.py OUT_DIR [--src web]

Writes into OUT_DIR (which must not exist yet):
    web/                    a copy of the web app (no dotfiles, caches or source maps)
    static-manifest.json    {"build": id, "files": {"hk/cards/x.js": {"sha256": ..., "size": n}, ...}}
    BUILD_ID                the id alone; /api/version and the image label read it

The id is the first 16 hex digits of a SHA-256 over every file's path and content, so it changes
exactly when a served byte changes and is identical for identical sources (reproducible).

What this does NOT do yet is rename files to ``name.<hash>.ext``: HK's modules load each other by
absolute ``/hk/...`` paths and by paths assembled at run time, so a blind rename would break them.
docs/phase3/PACKAGING.md describes the safe route. Until then the server sends ``no-cache`` with an
ETag for every asset (a conditional request, answered 304 when nothing changed) and the build id
tells open screens to reload.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", "__pycache__", ".git"}
SKIP_SUFFIXES = {".map", ".pyc"}


def _wanted(path: Path, base: Path) -> bool:
    rel = path.relative_to(base)
    if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts):
        return False
    return path.is_file() and path.suffix not in SKIP_SUFFIXES


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build(src: Path, out: Path) -> str:
    """Copy src to out/web, write the manifest and BUILD_ID, return the build id."""
    if out.exists():
        raise SystemExit(f"{out} already exists; choose a new directory")
    if not src.is_dir():
        raise SystemExit(f"{src} is not a directory")
    files = sorted(p for p in src.rglob("*") if _wanted(p, src))
    manifest: dict[str, dict] = {}
    overall = hashlib.sha256()
    for p in files:
        rel = p.relative_to(src).as_posix()
        digest = file_digest(p)
        manifest[rel] = {"sha256": digest, "size": p.stat().st_size}
        overall.update(rel.encode() + b"\0" + digest.encode() + b"\n")
    build_id = overall.hexdigest()[:16]
    for p in files:
        dest = out / "web" / p.relative_to(src)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest)
    (out / "static-manifest.json").write_text(json.dumps({"build": build_id, "files": manifest}, indent=1, sort_keys=True))
    (out / "BUILD_ID").write_text(build_id + "\n")
    return build_id


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("out", type=Path)
    p.add_argument("--src", type=Path, default=ROOT / "web")
    a = p.parse_args(argv)
    build_id = build(a.src, a.out)
    print(f"build {build_id}: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
