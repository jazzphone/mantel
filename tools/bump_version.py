#!/usr/bin/env python3
"""Set Mantel's one version number in every file that carries it. docs/development/Releasing.md.

    python tools/bump_version.py 0.1.37              # the three files (tools/check_version.py FILES)
    python tools/bump_version.py 0.1.37 --changelog  # ... and rename CHANGELOG.md's "## Unreleased" to it

Only each file's own top-level version line changes (a `version:` line in the Apps' config.yaml, the
[project] table's `version =` in pyproject.toml); comments and everything else stay as they are. Then it
runs tools/check_version.py's checks, so a file it could not update is reported, not silently left behind.
It never tags, commits or pushes: Releasing.md has those steps.
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _check_version():
    spec = importlib.util.spec_from_file_location("mantel_check_version", ROOT / "tools/check_version.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cv = _check_version()


def set_version(version: str, root: Path = ROOT) -> list[str]:
    """Rewrite the version line in each file; returns the files that changed."""
    changed = []
    for name in cv.FILES:
        path = root / name
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".toml":
            # the first `version = "..."` after [project], before the next table
            new = re.sub(r'(?ms)(^\[project\]\s*$.*?^version\s*=\s*)"[^"]*"', rf'\g<1>"{version}"', text, count=1)
        else:
            new = re.sub(r'(?m)^version:\s*"?[^"\s#]+"?', f'version: "{version}"', text, count=1)
        if new != text:
            path.write_text(new, encoding="utf-8")
            changed.append(name)
    return changed


def name_unreleased(version: str, root: Path = ROOT, today: datetime.date | None = None) -> bool:
    """CHANGELOG.md's "## Unreleased" becomes "## <version> - <date>". False when there is no such heading, or when
    it is not the newest section (one left below released versions was renamed 0.1.71 out of order once)."""
    path = root / "CHANGELOG.md"
    text = path.read_text(encoding="utf-8")
    day = (today or datetime.date.today()).isoformat()
    first = re.search(r"(?m)^## .*$", text)
    if first is None or not re.fullmatch(r"(?i)## Unreleased[ \t]*", first.group(0)):
        return False
    new = re.sub(r"(?mi)^## Unreleased[ \t]*$", f"## {version} - {day}", text, count=1)
    if new == text:
        return False
    path.write_text(new, encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("version", help="the new version, X.Y.Z")
    p.add_argument("--changelog", action="store_true", help='also rename CHANGELOG.md\'s "## Unreleased" section')
    p.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    if not cv.SEMVER.match(a.version):
        print(f"{a.version!r} is not X.Y.Z", file=sys.stderr)
        return 2
    for name in set_version(a.version, a.root):
        print(f"{name}: {a.version}")
    if a.changelog:
        if name_unreleased(a.version, a.root):
            print(f"CHANGELOG.md: Unreleased is now {a.version}")
        elif cv.changelog_section(a.version, a.root) is None:
            print('CHANGELOG.md has no "## Unreleased" section to rename; add the release notes by hand',
                  file=sys.stderr)
            return 1
    found = cv.problems(root=a.root)
    for line in found:
        print(line, file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
