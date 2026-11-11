"""The repository's hand-written source files, for the size and width rules (tests/test_file_sizes.py,
tests/test_line_widths.py; docs/phase24/CLEAN-CODE.md, A1).

Every .js, .cjs and .py under the repository, except what nobody writes by hand: installed packages, build output, the
vendored third-party files (web/hk/vendor/: d3-geo.js has one 20,555-character line) and the files a generator writes,
named in GENERATED (their width comes from the generator).
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", ".ci", ".claude", "__pycache__", ".pytest_cache", "build", "dist",
             ".mypy_cache", ".ruff_cache", "frontend_min"}
SKIP_PATHS = ("web/hk/vendor/",)
# written by a tool, not by hand (each with the tool that writes it)
GENERATED = {
    "hosts/ha/custom_components/hk_frontend/tools/sf_symbols/names.py",      # build_glyphs.py, from SF Symbols' own names
}
KINDS = {"js": (".js", ".cjs"), "py": (".py",)}


def files(kind: str) -> list[Path]:
    """Every hand-written file of `kind` ("js": .js and .cjs; "py"), sorted."""
    ends = KINDS[kind]
    out = []
    for d, dirs, names in os.walk(ROOT):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        for name in sorted(names):
            if not name.endswith(ends):
                continue
            p = Path(d) / name
            rel = p.relative_to(ROOT).as_posix()
            if rel.startswith(SKIP_PATHS) or rel in GENERATED:
                continue
            out.append(p)
    return out


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()
