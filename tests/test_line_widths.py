"""A width ratchet (phase 24, A1: docs/phase24/CLEAN-CODE.md): no line over 200 characters.

A file can't be "shortened" under the size limit (tests/test_file_sizes.py) by cramming its lines together, so lines have
a limit too: 200 characters, in every hand-written .js, .cjs and .py (tests/hand_written.py says which files those are).

tests/fixtures/line_widths.json records each file's count of lines over 200 characters today. A count may only fall, and a
file that is not listed may not have any. Run ``python tests/test_line_widths.py --update`` to write the fixture from the
tree (only to lower or remove an entry). tools/rewrap.py breaks long lines without changing what the code does.

THE EXCEPTIONS: a line that overflows inside a template literal, a regular expression or a Python multi-line string can't be
broken without changing the value. tests/fixtures/line_width_exceptions.json lists those, each with its file, a hash of its
text and why; a listed line is not counted. That list can only shrink, too: a listed line that is gone or shorter fails the
test until it is taken off.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hand_written  # noqa: E402

ROOT = hand_written.ROOT
FIXTURE = ROOT / "tests/fixtures/line_widths.json"
EXCEPTIONS = ROOT / "tests/fixtures/line_width_exceptions.json"
WIDTH = 200


def line_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def exceptions() -> list[dict]:
    return json.loads(EXCEPTIONS.read_text()) if EXCEPTIONS.is_file() else []


def long_lines(path: Path) -> list[str]:
    return [ln for ln in path.read_text(errors="replace").split("\n") if len(ln) > WIDTH]


def measure() -> dict[str, int]:
    """{path: lines over WIDTH} for every hand-written file that has any, the listed exceptions not counted."""
    allowed: dict[str, set[str]] = {}
    for e in exceptions():
        allowed.setdefault(e["file"], set()).add(e["hash"])
    out = {}
    for kind in ("js", "py"):
        for path in hand_written.files(kind):
            rel = hand_written.rel(path)
            n = sum(1 for ln in long_lines(path) if line_hash(ln) not in allowed.get(rel, ()))
            if n:
                out[rel] = n
    return dict(sorted(out.items()))


def test_no_file_gets_more_long_lines():
    fixture = json.loads(FIXTURE.read_text())
    now = measure()
    worse, fewer = [], []
    for path, n in now.items():
        if n > fixture.get(path, 0):
            worse.append(f"{path}: {n} lines over {WIDTH} characters, {fixture.get(path, 0)} allowed")
        elif n < fixture[path]:
            fewer.append(f"{path}: {fixture[path]} -> {n}")
    for path, n in fixture.items():
        if path not in now:
            fewer.append(f"{path}: {n} -> 0 (take it off the list)")
    assert not worse, (f"lines over {WIDTH} characters (break them: tools/rewrap.py, or by hand):\n" + "\n".join(worse))
    assert not fewer, ("these files have fewer long lines: lower them in tests/fixtures/line_widths.json "
                       "(python tests/test_line_widths.py --update) so they cannot come back:\n" + "\n".join(fewer))


# THE ONLY FILES THE LIST MAY HOLD (phase 24): the ones held at their size (tests/test_file_sizes.py HELD), where a rewrap
# would add lines, and hk-media-now.js, a phase 18 part of exactly 2,000 lines that a rewrap would take over its limit.
# Every other long line is broken (tools/rewrap.py) or is a listed exception.
HELD = {"web/hk/cards/hk-detail.js", "web/hk/media/hk-media-now.js"}


def test_only_the_held_files_have_long_lines():
    listed = set(json.loads(FIXTURE.read_text()))
    assert listed <= HELD, f"not held, so no line over {WIDTH} characters allowed: {sorted(listed - HELD)}"


def test_every_exception_is_still_a_long_line_that_is_there():
    """The list of lines that can't be broken only shrinks: a line that was broken or changed comes off it."""
    stale = []
    for e in exceptions():
        p = ROOT / e["file"]
        have = {line_hash(ln) for ln in long_lines(p)} if p.is_file() else set()
        if e["hash"] not in have:
            stale.append(f"{e['file']}: {e['hash']} ({e.get('why', '')[:60]})")
        assert e.get("why"), f"{e['file']}: an exception needs its reason"
    assert not stale, ("these exceptions are no longer long lines in their file: take them off "
                       "tests/fixtures/line_width_exceptions.json:\n" + "\n".join(stale))


if __name__ == "__main__":
    if "--update" in sys.argv:
        FIXTURE.write_text(json.dumps(measure(), indent=1) + "\n")
        print(f"wrote {FIXTURE.relative_to(ROOT)}")
    else:
        print(json.dumps(measure(), indent=1))
