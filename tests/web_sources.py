"""A web file that was cut into parts is still ONE source to the tests (phase 18, Part B).

web/hk/cards/hk-detail.js (its panels are in web/hk/sheets/) and the files tools/split_js.py cut up (hk-grid-cards.js and
web/hk/grid-cards/, the rest as each is split) are a shell plus the files its list names. The tests were written when each
was one file, and what each pins (a string, an allow list, a snapshot) is the code as a whole, so ``read(path)`` answers a
shell's text followed by every part's, and any other file's text. The same idea as the jsc suites' tests/split_files.js,
which reads the same list the same way: ``var PARTS = [...]`` (or the detail sheets' ``var SHEETS = [...]``) in the shell,
and the folder from the loader's address (``'/hk/<folder>/' + file``).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
LIST = re.compile(r"var (?:PARTS|SHEETS) = \[([^\]]*)\]")
FOLDER = re.compile(r"'/hk/([\w-]+)/' \+ file")


def _path(rel: str | Path) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else ROOT / p


DETAIL = "web/hk/cards/hk-detail.js"            # cut by hand (5573f9db): its list is SHEETS, and it has no manifest


def known_shells() -> set[str]:
    """The paths (from the repository root) that must be shells: every manifest's shell, and hk-detail.js. A file here with
    no parts list is an error, never "a file that is not cut into parts": a damaged list would otherwise hide the parts from
    every test that reads the file."""
    global _known
    if _known is None:
        _known = {DETAIL}
        for manifest in sorted((ROOT / "tools" / "split_manifests").glob("*.json")):
            _known.add(json.loads(manifest.read_text(encoding="utf-8"))["shell"])
    return _known


_known: set[str] | None = None


def parts(rel: str | Path) -> list[Path]:
    """The part files of a shell, in the order they run ([] for a file that is not cut into parts)."""
    shell = _path(rel)
    text = shell.read_text(encoding="utf-8")
    listed, folder = LIST.search(text), FOLDER.search(text)
    if not (listed and folder):
        try:
            here = shell.resolve().relative_to(ROOT.resolve()).as_posix()
        except ValueError:
            return []
        if here in known_shells():
            raise ValueError(f"{here} is a shell (a manifest names it, or it is hk-detail.js) but has no parts list: "
                             f"`var PARTS = [...]` (or SHEETS) and the loader's '/hk/<folder>/' + file")
        return []
    return [WEB / "hk" / folder.group(1) / name for name in re.findall(r"'([^']+)'", listed.group(1))]


def read(rel: str | Path) -> str:
    """The file's text; a shell's, followed by every part's."""
    shell = _path(rel)
    text = shell.read_text(encoding="utf-8")
    files = parts(shell)
    return text + "".join("\n" + f.read_text(encoding="utf-8") for f in files)


def shells() -> list[Path]:
    """Every web file that is a shell (it has a parts list and a loader)."""
    return [p for p in sorted(WEB.rglob("*.js")) if "node_modules" not in p.parts and parts(p)]


def owner(rel: str) -> str:
    """For a part file, the shell it belongs to (as a path from the repository root, like ``rel``); any other path as it is.
    The allow lists that are keyed by a file's name (strings a file may hold) keep their meaning through this."""
    if rel.startswith("web/hk/"):
        for shell in _owners():
            if rel in shell[1]:
                return shell[0]
    return rel


_cache: list[tuple[str, set[str]]] | None = None


def _owners() -> list[tuple[str, set[str]]]:
    global _cache
    if _cache is None:
        _cache = [(s.relative_to(ROOT).as_posix(), {f.relative_to(ROOT).as_posix() for f in parts(s)}) for s in shells()]
    return _cache
