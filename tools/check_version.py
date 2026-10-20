#!/usr/bin/env python3
"""Check that Mantel has ONE version number. docs/development/Releasing.md.

    python tools/check_version.py                    # the three files agree (prints the version)
    python tools/check_version.py --tag v0.1.36      # ... and the tag is v<that version>, with release notes
    python tools/check_version.py --print            # print the version only (for the release workflow)

The Home Assistant App's config.yaml (packaging/ha-app/config.yaml) is the source of truth: it is the number
Home Assistant compares to offer **Update**. The Python package (pyproject.toml) and the Mantel Connect App
(packaging/connect-app/config.yaml) carry the same value, and so do the published images
(ghcr.io/jazzphone/mantel-*:<version>), which the release workflow tags from it. A mismatch is a release
mistake: the App would say one version and pull an image tagged another.

With --tag (the release workflow passes the pushed tag) the tag must be exactly v<version>, and CHANGELOG.md
must have that version's section (``## 0.1.36`` or ``## [0.1.36]``, a date after it is fine): the App's
CHANGELOG.md in the add-on repository is that section (tools/publish_ha_apps.py), so a release without one
has nothing to show in Home Assistant's update dialog.

Stdlib only, like the other tools.
"""
from __future__ import annotations

import argparse
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "packaging/ha-app/config.yaml"
# every file that carries the version, and how to find it there (a top-level `version:` / `version =` line)
FILES = (SOURCE, "packaging/connect-app/config.yaml", "pyproject.toml")
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_YAML_VERSION = re.compile(r'^version:\s*"?([^"\s#]+)"?\s*(#.*)?$', re.M)


def read_version(path: Path) -> str | None:
    """The version a file declares, or None when it has none."""
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".toml":
        return (tomllib.loads(text).get("project") or {}).get("version")
    m = _YAML_VERSION.search(text)
    return m.group(1) if m else None


def versions(root: Path = ROOT) -> dict[str, str | None]:
    return {name: read_version(root / name) for name in FILES}


def changelog_section(version: str, root: Path = ROOT) -> str | None:
    """The body of CHANGELOG.md's section for `version` (without its heading), or None when there is none.

    A section starts at a level-2 heading naming the version (``## 0.1.36``, ``## [0.1.36] - 2026-10-20``,
    ``## v0.1.36``) and runs to the next level-2 heading. "Unreleased" is the name for the one still being
    written; publish_ha_apps.py may take it for a build-only dry run, never for a release."""
    path = root / "CHANGELOG.md"
    if not path.is_file():
        return None
    name = re.escape(version) if version == "Unreleased" else r"\[?v?" + re.escape(version) + r"\]?"
    head = re.compile(r"^## " + name + r"(\s|$)", re.I)
    out, inside = [], False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            if inside:
                break
            inside = bool(head.match(line))
            continue
        if inside:
            out.append(line)
    return "\n".join(out).strip() + "\n" if inside else None


def problems(tag: str | None = None, root: Path = ROOT) -> list[str]:
    found = versions(root)
    source = found[SOURCE]
    out = []
    if source is None:
        return [f"{SOURCE}: no version: line"]
    if not SEMVER.match(source):
        out.append(f"{SOURCE}: version {source!r} is not X.Y.Z (the tag, the images and Home Assistant use it)")
    for name, value in found.items():
        if value != source:
            out.append(f"{name}: version {value!r}, but {SOURCE} says {source!r} (python tools/bump_version.py {source})")
    if tag is not None:
        if tag != f"v{source}":
            out.append(f"tag {tag!r} does not match the version: expected v{source}")
        if changelog_section(source, root) is None:
            out.append(f"CHANGELOG.md: no section for {source} (a '## {source}' heading); rename 'Unreleased' to it")
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--tag", help="the release tag (vX.Y.Z) that must match, with its CHANGELOG section")
    p.add_argument("--print", action="store_true", help="print the version only, after the checks pass")
    p.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    found = problems(a.tag, a.root)
    for line in found:
        print(line, file=sys.stderr)
    if found:
        print(f"check_version: {len(found)} problem(s)", file=sys.stderr)
        return 1
    version = versions(a.root)[SOURCE]
    print(version if a.print else f"check_version: {version} everywhere" + (f", tag {a.tag}" if a.tag else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
