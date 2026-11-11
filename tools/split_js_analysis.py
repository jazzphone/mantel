"""split_js.py's the TypeScript helper's analysis, the text helpers, and the Member and Plan records (moved here by tools/split_py.py from tools/split_js.py:
tools/split_py_manifests/split_js.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from split_js_names import (CALL, HELPER, LOADER, LOADER_BEGIN, LOADER_END, NO_WAIT_README, READY_LINES, READY_README,
    Refusal, ROOT, TYPES_D_TS, WIDTH,)


# ------------------------------------------------------------------------------------------------ node helper
def node() -> str:
    found = os.environ.get("NODE") or shutil.which("node")
    if not found:
        raise SystemExit("no node: set NODE or put node on the PATH")
    return found


def ask(req: dict) -> dict:
    run = subprocess.run([node(), str(HELPER)], input=json.dumps(req), capture_output=True, text=True, cwd=ROOT)
    if run.returncode != 0:
        raise SystemExit(f"split_js.cjs failed:\n{run.stderr[-3000:]}")
    return json.loads(run.stdout)


def analyze(path: Path, mode: str, run_in: str | None, cont: bool = False, man: dict | None = None) -> dict:
    """`man` (the manifest) turns on class-method mode when it names a class, and gives the kit's name."""
    cls = (man or {}).get("class")
    decl = (man or {}).get("run_in_decl")
    if decl and mode == "shell":               # a declared function's body is the scope (hk-base.js's initialize)
        run_in = decl
    return ask({"cmd": "analyze", "file": str(path), "mode": mode, "run_in": run_in, "globals": TYPES_D_TS,
                "run_in_decl": bool(decl), "iife": (man or {}).get("iife", 0),
                "cont_call": CALL if cont else None, "class_name": cls if mode == "shell" else None,
                "class_expr": bool(cls) and mode == "part", "kit_name": kit_of(man)})


def codes(texts: list[str]) -> list[str]:
    """Each class member's text as its code: no comments, no JSDoc cast parentheses (what split_js.cjs codeOf prints)."""
    return ask({"cmd": "code", "texts": texts})["codes"]


def kit_of(man: dict | None) -> str:
    return (man or {}).get("kit_name", "K")


def diagnostics(paths: list[Path]) -> dict[str, dict]:
    got = ask({"cmd": "diagnostics", "files": [str(p) for p in paths], "globals": TYPES_D_TS})
    return {str(Path(k).resolve()): v for k, v in got.items()}


# ------------------------------------------------------------------------------------------------ small text helpers
def pack(pieces: list[str], first: str, cont: str, width: int = WIDTH) -> list[str]:
    """The pieces joined by spaces and wrapped at `width`: the first line starts with `first`, the others with `cont`."""
    lines, cur, started = [], first, False
    for piece in pieces:
        if started and len(cur) + 1 + len(piece) > width:
            lines.append(cur)
            cur = cont + piece
        else:
            cur = cur + (" " if started else "") + piece
        started = True
    lines.append(cur)
    return lines


def commas(items: list[str], last: str = ";") -> list[str]:
    return [it + ("," if k < len(items) - 1 else last) for k, it in enumerate(items)]


def by_name(names) -> list[str]:
    return sorted(set(names), key=lambda s: (s.lower(), s))


def parts_list(parts: list[str], indent: str) -> str:
    """The PARTS array: on one line when it fits, else wrapped under its first element."""
    pieces = commas([f"'{p}.js'" for p in parts], last="]")
    return "\n".join(pack(pieces, indent + "var PARTS = [", indent + " " * 13)).split("var PARTS = ", 1)[1]


def loader_block(man: dict, indent: str = "  ") -> str:
    """The generated loader of a shell: the template, filled in from the manifest."""
    folder = Path(man["folder"]).name
    wait = man.get("wait", True)
    ready = (READY_LINES if wait else "").format(i=indent, label=man["label"])
    readme = (READY_README if wait else NO_WAIT_README).format(i=indent, label=man["label"])
    return LOADER.format(i=indent, begin=LOADER_BEGIN, end=LOADER_END, folder=folder, name=man["name"], glob=man["global"],
                         label=man["label"], parts=parts_list([p["name"] for p in man["parts"]], indent), ready=ready,
                         readme=readme)


def lstrip_lines(text: str) -> str:
    return "\n".join(ln.lstrip(" \t") for ln in text.split("\n"))


def reindent(lines: list[str], protected: set[int], first_no: int, member_indent: int, target: int) -> list[str]:
    """The member's lines at `target` spaces instead of `member_indent`; lines that begin inside a template literal or a
    continued string (`protected`, 1-based numbers) are kept exactly."""
    out = []
    for k, raw in enumerate(lines):
        no = first_no + k
        raw = raw.rstrip("\r")
        if no in protected:
            out.append(raw)
        elif not raw.strip():
            out.append("")
        else:
            lead = len(raw) - len(raw.lstrip(" "))
            if "\t" in raw[:lead + 1] and raw[:lead].strip(" ") == "":
                raise Refusal(f"a tab indents line {no}")
            shift = target - member_indent
            out.append(" " * (lead + shift) + raw[lead:] if lead + shift >= 0 else raw.lstrip(" "))
    return out


# ------------------------------------------------------------------------------------------------ the plan
@dataclass
class Member:
    scope: int
    index: int
    d: dict
    part: int = -1                 # the part it moves to; -1: stays in the shell
    adopted: bool = False          # it came from one of the hand-split files (`adopt`): any statement moves with its file
    late: bool = False             # stays, but waits for the parts (runs in the function handed to loadParts)

    @property
    def key(self) -> tuple[int, int]:
        return (self.scope, self.index)

    @property
    def label(self) -> str:
        return (self.d["names"][0] if self.d["names"] else self.d.get("method") or self.d["head"][:50])


@dataclass
class Plan:
    man: dict
    lines: list[str]
    an: dict
    run_in: str | None
    members: dict[tuple[int, int], Member] = field(default_factory=dict)
    takes: dict[int, set[str]] = field(default_factory=dict)         # part -> names it takes from K
    gives: dict[int, set[str]] = field(default_factory=dict)         # part -> names it hands back on K
    shell_takes: dict[int, set[str]] = field(default_factory=dict)   # scope -> names the shell takes back
    shell_kit: set[str] = field(default_factory=set)                 # names the shell puts on K
    refusals: list[str] = field(default_factory=list)
    unresolved_before: set[str] = field(default_factory=set)
    cs: int | None = None                                            # the scope of the class's members (class-method mode)
    live: dict[int, set] = field(default_factory=dict)               # part -> shell variables it binds late
    ahead: dict[int, set] = field(default_factory=dict)              # part -> later parts' names it binds once all have run
    ahead_users: set = field(default_factory=set)                    # members that use a later part's name (bind_ahead)
