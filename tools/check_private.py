"""Fail when a tracked file, or a commit message, names a home's own words.

    python tools/check_private.py [--root DIR] [--rev REV | --staged] [--messages REV_RANGE]

The words are never in this repository (listing them here would publish them): they come from
HK_PRIVATE (one regular expression, as tools/stage_ha_app.py takes it) and/or the file named by
HK_PRIVATE_FILE (one regular expression per line; blank lines and `#` lines skipped). Matching ignores
case. With neither set there is nothing to check and the exit status is 0.

Every file `git ls-files` lists is read, except binary ones (a NUL byte in the first 8 KB): as it is in the
working tree, or with --rev as that commit has it (what a push sends) or with --staged as the index has it (what a
commit takes), so a local edit that is never committed is not a finding. With --messages, the commit messages, author and committer of REV_RANGE (e.g. `origin/main..HEAD`) are
checked too. Findings name the file and line, never the matching text. Stdlib only. Exit status 1 when
anything matches.

As a pre-commit hook (.git/hooks/pre-commit), with the list kept outside the repository:

    HK_PRIVATE_FILE=~/.config/mantel/private-words python tools/check_private.py --staged
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


def _worktree(root: Path):
    names = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True).stdout
    for name in filter(None, names.decode().split("\0")):
        path = root / name
        if path.is_file():
            yield name, path.read_bytes()


def _blobs(root: Path, rev: str | None):
    """(name, bytes) of each file in commit `rev`, or in the index when rev is None."""
    cmd = ["git", "ls-tree", "-r", "-z", rev] if rev else ["git", "ls-files", "-s", "-z"]
    listing = subprocess.run(cmd, cwd=root, capture_output=True, check=True).stdout.decode()
    entries = []
    for item in filter(None, listing.split("\0")):
        meta, _, name = item.partition("\t")
        fields = meta.split()
        if rev and fields[1] != "blob":           # ls-tree: mode type sha; submodules are commits
            continue
        if fields[0] == "160000":
            continue
        entries.append((name, fields[2] if rev else fields[1]))
    if not entries:
        return
    batch = subprocess.run(["git", "cat-file", "--batch"], cwd=root, check=True, capture_output=True,
                           input="".join(f"{sha}\n" for _, sha in entries).encode()).stdout
    pos = 0
    for name, _ in entries:
        header_end = batch.index(b"\n", pos)
        size = int(batch[pos:header_end].split()[2])
        yield name, batch[header_end + 1:header_end + 1 + size]
        pos = header_end + 1 + size + 1          # the content, then its newline


def scan_files(root: Path, pats: list[re.Pattern], rev: str | None = None, staged: bool = False) -> list[str]:
    hits = []
    for name, data in (_blobs(root, rev) if rev or staged else _worktree(root)):
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
    where = ap.add_mutually_exclusive_group()
    where.add_argument("--rev", help="check the files as this commit has them, not the working tree")
    where.add_argument("--staged", action="store_true", help="check the files as the index has them")
    ap.add_argument("--messages", metavar="REV_RANGE", help="also check these commits' messages and authors")
    a = ap.parse_args(argv)
    pats = patterns()
    if not pats:
        print("private words: none given (HK_PRIVATE, HK_PRIVATE_FILE), nothing to check")
        return 0
    hits = scan_files(a.root, pats, a.rev, a.staged) + (scan_messages(a.root, a.messages, pats) if a.messages else [])
    for h in hits:
        print(f"{h}: a home's own word")
    print(f"private words: {len(hits)} finding(s)" if hits else "private words: clean")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
