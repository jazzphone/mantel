"""The old module paths phase 25's packages left importable (mantel_server/_moved.py) go away in the release their rows
name (decision 4: one release). This fails once pyproject's version reaches a row's release while the row is still there:
that release deletes them (`tools/move_py.py --expired VERSION` lists them) and imports every module at its new path."""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def version(text: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", text)[:3])


def test_no_alias_outlives_its_release():
    now = version(tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"])
    table = (ROOT / "hosts/server/mantel_server/_moved.py").read_text()
    rows = re.findall(r'^    "(\w+)": \("([\w.]+)", "([\d.]+)"\),$', table, re.M)
    assert rows, "the alias table is empty or unreadable"
    due = sorted(f"{old} -> {new}" for old, new, until in rows if now >= version(until))
    assert not due, (f"version {'.'.join(map(str, now))}: these old paths go away in this release; delete their rows "
                     f"(tools/move_py.py --expired) and import each at its new path: {due[:10]}")


def test_every_row_points_at_a_module_that_is_there():
    table = (ROOT / "hosts/server/mantel_server/_moved.py").read_text()
    for old, new, _until in re.findall(r'^    "(\w+)": \("([\w.]+)", "([\d.]+)"\),$', table, re.M):
        assert (ROOT / "hosts/server/mantel_server" / (new.replace(".", "/") + ".py")).is_file(), (old, new)
