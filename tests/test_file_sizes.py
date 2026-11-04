"""A size ratchet (phase 18, Part B0; docs/phase18/CODE-HEALTH.md): the biggest files only get smaller.

tests/fixtures/file_sizes.json records every web/**/*.js over 2,500 lines and every Python file over 2,200 lines with its
line count today. None may grow, and none that is not listed may cross the line. A file that shrinks is fine, and the test says
to lower its number in the fixture so it cannot grow back; a file that drops under the line is taken off the list. Run
``python tests/test_file_sizes.py --update`` to write the fixture from the tree (only to lower or remove an entry, or, in the
commit that splits a file, to follow it).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/file_sizes.json"
LIMITS = {"js": 2500, "py": 2200}
SKIP = {"node_modules", ".git", ".venv", "venv", ".ci", ".claude", "__pycache__", ".pytest_cache", "build", "dist", ".mypy_cache"}


def lines(path: Path) -> int:
    with path.open("rb") as f:
        return sum(1 for _ in f)


def measure() -> dict[str, dict[str, int]]:
    """{"js": {path: lines}, "py": {path: lines}} for the files over their line, from the tree."""
    out: dict[str, dict[str, int]] = {"js": {}, "py": {}}
    for kind, base in (("js", ROOT / "web"), ("py", ROOT)):
        for d, dirs, files in os.walk(base):
            dirs[:] = sorted(x for x in dirs if x not in SKIP)
            for name in sorted(files):
                if not name.endswith("." + kind):
                    continue
                path = Path(d) / name
                n = lines(path)
                if n > LIMITS[kind]:
                    out[kind][path.relative_to(ROOT).as_posix()] = n
    return out


def test_no_big_file_grows_and_no_file_crosses_the_line():
    fixture = json.loads(FIXTURE.read_text())
    now = measure()
    grown, crossed, shrunk = [], [], []
    for kind, limit in LIMITS.items():
        recorded = fixture[kind]
        for path, n in now[kind].items():
            if path not in recorded:
                crossed.append(f"{path}: {n} lines, over the {limit}-line limit and not on the list")
            elif n > recorded[path]:
                grown.append(f"{path}: {n} lines, it was {recorded[path]}")
            elif n < recorded[path]:
                shrunk.append(f"{path}: {recorded[path]} -> {n}")
        for path, n in recorded.items():
            if path not in now[kind]:
                p = ROOT / path
                shrunk.append(f"{path}: {n} -> {lines(p) if p.exists() else 'gone'} (under the line: take it off the list)")
    assert not grown, "these files grew; split them (tools/split_js.py) or cut something:\n" + "\n".join(grown)
    assert not crossed, "these files crossed the line:\n" + "\n".join(crossed)
    assert not shrunk, ("these files shrank: lower them in tests/fixtures/file_sizes.json (python tests/test_file_sizes.py "
                        "--update) so they cannot grow back:\n" + "\n".join(shrunk))


if __name__ == "__main__":
    if "--update" in sys.argv:
        FIXTURE.write_text(json.dumps(measure(), indent=1) + "\n")
        print(f"wrote {FIXTURE.relative_to(ROOT)}")
    else:
        print(json.dumps(measure(), indent=1))
