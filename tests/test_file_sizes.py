"""A size ratchet (phase 18, Part B0; phase 24, A1: docs/phase24/CLEAN-CODE.md): the biggest files only get smaller.

THE RULE: no JavaScript file over 2,500 lines, no Python file over 2,200. tests/fixtures/file_sizes.json records the files
over the line today, each with its line count. None may grow, and none that is not listed may cross the line. A file that
shrinks is fine, and the test says to lower its number in the fixture so it cannot grow back; a file that drops under the
line is taken off the list. Run ``python tests/test_file_sizes.py --update`` to write the fixture from the tree (only to
lower or remove an entry, or, in the commit that splits a file, to follow it).

A WARNING BEFORE THE WALL: a file over 2,300 lines (JavaScript) or 2,000 (Python) is named by ``tools/ci.py quick`` under
its table ("Near the size limit", from ``near()``; ``python tests/test_file_sizes.py --warn`` prints the same), so a split
is planned before a feature is blocked by the wall. It never fails a run.

Which files: every hand-written .js, .cjs and .py in the repository (tests/hand_written.py), not only web/.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hand_written  # noqa: E402

ROOT = hand_written.ROOT
FIXTURE = ROOT / "tests/fixtures/file_sizes.json"
LIMITS = {"js": 2500, "py": 2200}
WARN = {"js": 2300, "py": 2000}


def lines(path: Path) -> int:
    with path.open("rb") as f:
        return sum(1 for _ in f)


def measure(limits: dict[str, int] = LIMITS) -> dict[str, dict[str, int]]:
    """{"js": {path: lines}, "py": {path: lines}} for the files over their line, from the tree."""
    out: dict[str, dict[str, int]] = {"js": {}, "py": {}}
    for kind in out:
        for path in hand_written.files(kind):
            n = lines(path)
            if n > limits[kind]:
                out[kind][hand_written.rel(path)] = n
    return out


def near() -> list[str]:
    """The files in the warning band (over WARN, at or under LIMITS): one line each, for ci.py's table."""
    over = measure(WARN)
    how = {"js": "tools/split_js.py --report", "py": "tools/split_py.py"}
    return [f"{path}: {n} lines (the limit is {LIMITS[kind]}; plan a split: {how[kind]})"
            for kind in ("js", "py") for path, n in sorted(over[kind].items()) if n <= LIMITS[kind]]


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


# THE ONLY FILES THE LIST MAY HOLD (phase 24): the ones whose split was left for later, each with why. A file not named here
# may never be over the limit, so `--update` cannot quietly put a new one on the list. A file comes off as it is split.
# (Empty since 2026-11-11: the last three, hk-saver.js, hk-detail.js and settings/model.py, were cut by the tools.)
HELD: dict[str, str] = {}


def test_only_the_held_files_are_over_the_limit():
    fixture = json.loads(FIXTURE.read_text())
    listed = set(fixture["js"]) | set(fixture["py"])
    assert listed <= set(HELD), f"not held, so not allowed over the limit: {sorted(listed - set(HELD))}"


def test_the_warning_band_sits_below_the_wall():
    for kind in LIMITS:
        assert WARN[kind] < LIMITS[kind]
    assert all(": " in line for line in near())


if __name__ == "__main__":
    if "--update" in sys.argv:
        FIXTURE.write_text(json.dumps(measure(), indent=1) + "\n")
        print(f"wrote {FIXTURE.relative_to(ROOT)}")
    elif "--warn" in sys.argv:
        print("\n".join(near()) or "no file is near the size limit")
    else:
        print(json.dumps(measure(), indent=1))
