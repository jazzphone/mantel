"""Fail on broken relative links in README.md and docs/**/*.md.

    ~/.venvs/mantel/bin/python tools/check_links.py [--root DIR] [--no-anchors]

Checks, for every Markdown link `[text](target)` and reference definition `[label]: target`:
  * a relative target (no scheme, not `#only`) must exist, resolved from the linking file's folder
    (a leading `/` means the repository root);
  * a `#fragment` on a Markdown target (or on the same file) must match a heading, using GitHub's
    slug rules (lowercase, punctuation dropped, spaces to hyphens, `-1`, `-2` for repeats).
External links (`https:`, `mailto:` ...) are not fetched. Fenced code blocks and `inline code` are
skipped, so command examples never count as links. Stdlib only. Exit status 1 when anything is broken.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]

FENCE = re.compile(r"^\s*(```|~~~)")
INLINE_CODE = re.compile(r"(`+)(?:(?!\1).)+?\1")
# [text](target "title") or [text](<target with spaces>); images start with ! and are checked the same way
INLINE_LINK = re.compile(r"\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)")
REF_DEF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)")
SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
HTML_ID = re.compile(r"""\b(?:id|name)=["']([^"']+)["']""")


@dataclass(frozen=True)
class Problem:
    file: Path
    line: int
    target: str
    reason: str

    def __str__(self) -> str:
        return f"{self.file}:{self.line}: {self.target}: {self.reason}"


def doc_files(root: Path) -> list[Path]:
    files = [p for p in [root / "README.md"] if p.is_file()]
    docs = root / "docs"
    if docs.is_dir():
        files += sorted(docs.rglob("*.md"))
    return files


def _plain_lines(text: str):
    """(line number, line) for text outside fenced code, with inline code removed."""
    fence = None
    for n, line in enumerate(text.splitlines(), 1):
        m = FENCE.match(line)
        if m:
            marker = m.group(1)
            if fence is None:
                fence = marker
            elif marker == fence:
                fence = None
            continue
        if fence is None:
            yield n, INLINE_CODE.sub("", line)


def slug(heading: str) -> str:
    """GitHub's anchor for a heading's text."""
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", heading)      # links and images keep their text
    text = INLINE_CODE.sub(lambda m: m.group(0).strip("`"), text)
    text = re.sub(r"<[^>]+>", "", text).strip().lower()
    text = re.sub(r"[^\w\- ]", "", text, flags=re.UNICODE)
    return text.replace(" ", "-")


def anchors(path: Path, cache: dict[Path, set[str]]) -> set[str]:
    if path not in cache:
        found: set[str] = set()
        seen: dict[str, int] = {}
        text = path.read_text(encoding="utf-8", errors="replace")
        fence = None
        for line in text.splitlines():
            m = FENCE.match(line)
            if m:
                fence = None if fence == m.group(1) else (fence or m.group(1))
                continue
            if fence:
                continue
            h = HEADING.match(line)
            if h:
                base = slug(h.group(2))
                count = seen.get(base, 0)
                seen[base] = count + 1
                found.add(base if count == 0 else f"{base}-{count}")
            found.update(HTML_ID.findall(line))
        cache[path] = found
    return cache[path]


def targets(text: str):
    for n, line in _plain_lines(text):
        for m in INLINE_LINK.finditer(line):
            yield n, m.group(1)
        m = REF_DEF.match(line)
        if m:
            yield n, m.group(1)


def check_file(path: Path, root: Path, cache: dict[Path, set[str]], check_anchors: bool = True) -> list[Problem]:
    problems: list[Problem] = []
    text = path.read_text(encoding="utf-8", errors="replace")
    rel = path.relative_to(root)
    for line, raw in targets(text):
        target = raw[1:-1] if raw.startswith("<") and raw.endswith(">") else raw
        if not target or SCHEME.match(target) or target.startswith("//"):
            continue
        base, _, fragment = target.partition("#")
        base = unquote(base.partition("?")[0])
        if not base:                                   # "#section": this file
            dest = path
        else:
            dest = (root / base.lstrip("/")) if base.startswith("/") else (path.parent / base)
            dest = Path(*[p for p in dest.parts])      # no resolve(): a symlink is the repository's business
            try:
                dest = dest.resolve()
                dest.relative_to(root.resolve())
            except ValueError:
                problems.append(Problem(rel, line, target, "points outside the repository"))
                continue
            if not dest.exists():
                problems.append(Problem(rel, line, target, "no such file or folder"))
                continue
        if check_anchors and fragment and dest.is_file() and dest.suffix.lower() == ".md":
            if unquote(fragment).lower() not in anchors(dest, cache):
                problems.append(Problem(rel, line, target, f"no heading '#{fragment}' in {dest.name}"))
    return problems


def check(root: Path = ROOT, check_anchors: bool = True) -> list[Problem]:
    root = Path(root)
    cache: dict[Path, set[str]] = {}
    problems: list[Problem] = []
    for path in doc_files(root):
        problems += check_file(path, root, cache, check_anchors)
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    ap.add_argument("--no-anchors", action="store_true", help="check files and folders only, not #fragments")
    args = ap.parse_args(argv)
    problems = check(args.root, not args.no_anchors)
    for p in problems:
        print(p)
    files = len(doc_files(args.root))
    print(f"{files} files checked, {len(problems)} broken link(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
