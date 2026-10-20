"""Fail when a tracked file, or a commit message, names a home's own words.

    python tools/check_private.py [--root DIR] [--messages REV_RANGE]

The words are never in this repository (listing them here would publish them): they come from
HK_PRIVATE (one regular expression, as tools/stage_ha_app.py takes it) and/or the file named by
HK_PRIVATE_FILE (one regular expression per line; blank lines and `#` lines skipped). Matching ignores
case. With neither set there is nothing to check and the exit status is 0.

Every file `git ls-files` lists is read, except binary ones (a NUL byte in the first 8 KB). With
--messages, the commit messages, author and committer of REV_RANGE (e.g. `origin/main..HEAD`) are
checked too. Findings name the file and line, never the matching text. Stdlib only. Exit status 1 when
anything matches.

As a pre-commit hook (.git/hooks/pre-commit), with the list kept outside the repository:

    HK_PRIVATE_FILE=~/.config/mantel/private-words python tools/check_private.py
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patterns(env: dict[str, str] | None = None) -> list[re.Pattern]:
    env = os.environ if env is None else env
    out = []
    if env.get("HK_PRIVATE"):
        out.append(env["HK_PRIVATE"])
    if env.get("HK_PRIVATE_FILE"):
        for line in Path(env["HK_PRIVATE_FILE"]).expanduser().read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                out.append(line.strip())
    return [re.compile(p, re.I) for p in out]


def scan_files(root: Path, pats: list[re.Pattern]) -> list[str]:
    names = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True).stdout
    hits = []
    for name in filter(None, names.decode().split("\0")):
        path = root / name
        if not path.is_file():
            continue
        data = path.read_bytes()
        if b"\0" in data[:8192]:
            continue
        for n, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
            if any(p.search(line) for p in pats):
                hits.append(f"{name}:{n}")
    return hits


def scan_messages(root: Path, revs: str, pats: list[re.Pattern]) -> list[str]:
    log = subprocess.run(["git", "log", "--format=%H%x00%an <%ae>%n%cn <%ce>%n%B%x01", revs],
                         cwd=root, capture_output=True, check=True, text=True).stdout
    hits = []
    for entry in filter(str.strip, log.split("\x01")):
        sha, _, rest = entry.strip().partition("\0")
        if any(p.search(rest) for p in pats):
            hits.append(f"commit {sha[:10]}")
    return hits


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--messages", metavar="REV_RANGE", help="also check these commits' messages and authors")
    a = ap.parse_args(argv)
    pats = patterns()
    if not pats:
        print("private words: none given (HK_PRIVATE, HK_PRIVATE_FILE), nothing to check")
        return 0
    hits = scan_files(a.root, pats) + (scan_messages(a.root, a.messages, pats) if a.messages else [])
    for h in hits:
        print(f"{h}: a home's own word")
    print(f"private words: {len(hits)} finding(s)" if hits else "private words: clean")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
