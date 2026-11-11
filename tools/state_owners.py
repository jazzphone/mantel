#!/usr/bin/env python3
"""Who reads and who writes each name of the screensaver's shared state object `ST` (phase 25, Part A: docs/phase25/PLAN.md).

    tools/state_owners.py            # write docs/phase25/SAVER-STATE.md
    tools/state_owners.py --check    # is it fresh, and is every name written only by its owner? (tests/test_state_owners.py)
    tools/state_owners.py --json     # the uses, one per line: file, name, kind, line, function

Phase 24 cut hk-saver.js into a shell and ten parts (tools/split_js.py) and turned the variables they share into the
properties of one object, `ST`. The cut moved the tangle into more files; it did not undo it. Part A gives each piece of
that state ONE OWNER, the file that writes it; the others ask the owner through a few functions it exports. This tool
is the map: for each `ST` name, the files that read it, the files that write it and where. A use is found by the
TypeScript parser (tools/state_owners.cjs), so a comment or a string never counts. "Write" is an assignment to `ST.x`
itself (`=`, `+=`, `++`, `delete`, a destructuring target); a write into what it holds (`ST.x.y = v`) is a "mutate",
listed but not a second writer: the object is the owner's, its contents are its callers' business.

OWNERS is the decision (PLAN.md Part A, step 2), written once here; the page says for each name who owns it and whether
anyone else still writes it. `--check` fails on a name written by a file that is not its owner only when the name is in
DONE: the owners already moved, which must stay that way.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "tools/state_owners.cjs"
OUT = ROOT / "docs/phase25/SAVER-STATE.md"
SHELL = "web/hk/modules/hk-saver.js"
MANIFEST = ROOT / "tools/split_manifests/saver.json"
OBJECT = "ST"

# THE OWNERS (decided 2026-11-11 from the map; PLAN.md Part A step 2, decision 1). Each name's owner is the file that
# writes it; where several did, the feature it belongs to, and the earlier part where that saves a part binding a later
# one (the photos own the count since the last slide: every slide writes it, and the photos run first). The shell owns
# the page itself (host, root), touch and idle, and the preview API. Each owner moves in a commit of its own (DONE).
OWNERS: dict[str, tuple[str, str]] = {}     # name -> (owner part, why); filled from FEATURES
FEATURES: list[tuple[str, str, tuple[str, ...]]] = [
    ("hk-saver-start", "the run: started and stopped, the photo pace, the dashboard covered", (
        "builtFor", "busy", "coveredPage", "coveredView", "coverT", "drawnAs", "entrance", "fadeDone", "failed",
        "listAt", "listing", "listKey", "litWait", "moTap", "noteRun", "on", "pageVisibility", "photoRun",
        "queued", "shownAt", "slideBefore", "slideHeld", "slideT", "startedBy")),
    ("hk-saver-photos", "the photos on screen: the deck, the layers, the count since a slide", (
        "deck", "displayLayer", "lastPh", "lastPhoto", "lastSlide", "layer", "lyPhoto", "lyPhotoLum", "moRand",
        "moState", "shown", "sinceFc", "tbT")),
    ("hk-saver-draw", "the modes: the clock, the corner, Big, the forecast, night", (
        "bigCtl", "bigFor", "bigRun", "ckArgs", "ckCtl", "ckLoad", "ckRun", "cornerAsked", "cornerAt", "fband",
        "fcShowing", "fscene", "fSig", "fSky", "fTick", "mode", "nightT", "scn")),
    ("hk-saver-layout", "the layouts and Home Energy", (
        "enCtl", "enRun", "enShowing", "enT", "landIm", "ly", "lyClientAt", "lyLoad", "lyRun", "TW")),
    ("hk-saver-screens", "the extras rotation, the music slide and the panel", (
        "exBefore", "exKind", "exLast", "exOutT", "exT", "muShowing", "pnl", "saverSent")),
    ("hk-saver-pane", "the Side Pane, the dashboard view and the curtain", (
        "curtain", "curtainRun", "dashAt", "dashOut", "dashT", "downOpts", "PageCard", "paneCard", "paneSide",
        "paneT", "paneUp", "paneW", "sidePane", "sideT", "wasBlack")),
    ("hk-saver-black", "the config, the house's black and the backlight, the heartbeat", (
        "cfg", "hkAcked", "hkAckTry", "hkDown", "hkFirst", "hkOn", "hkRun", "hkWokeAt", "hubOff", "lastBeat",
        "lastRaw", "lightRun", "litAt", "resumedAt")),
    ("hk-saver", "the shell: the page it draws on, touch and idle, the preview API", (
        "asked", "autoAsked", "cards", "DARK_UNDER_BLACK", "dashV", "designController", "force", "host",
        "idleT", "ksOff", "ksSaver", "lastInput", "mx", "my", "nightPreview", "paneEl", "paneResetT", "paneSc",
        "pendingSwitch", "press", "pressStop", "previewEnergy", "previewHouse", "previewOn", "previewOver",
        "previewPane", "previewPaneNote", "previewSelected", "previewShape", "previewWeather", "root",
        "shellConf", "touchSent", "unsubCards")),
]
for _part, _why, _names in FEATURES:
    for _n in _names:
        OWNERS[_n] = (_part, _why)
# the owners already moved (PLAN.md's Build log): each of their names must stay written by its owner alone
DONE: set[str] = set()


def files(root: Path = ROOT) -> list[str]:
    """The shell and its parts, in the order they run."""
    man = json.loads((root / MANIFEST.relative_to(ROOT)).read_text())
    return [SHELL] + [f"{man['folder']}/{p['name']}.js" for p in man["parts"]]


def node() -> str:
    found = os.environ.get("NODE") or shutil.which("node")
    if not found:
        raise SystemExit("state_owners.py needs Node.js ($NODE or node on the PATH)")
    return found


def uses(root: Path = ROOT) -> list[dict]:
    """Every use of an ST name in the shell and its parts (tools/state_owners.cjs)."""
    names = files(root)
    r = subprocess.run([node(), str(HELPER)], input=json.dumps({"files": [str(root / f) for f in names], "object": OBJECT}),
                       capture_output=True, text=True, cwd=root)
    if r.returncode:
        raise SystemExit(f"tools/state_owners.cjs failed:\n{r.stderr[-2000:]}")
    out = json.loads(r.stdout)
    for u in out:
        u["file"] = str(Path(u["file"]).resolve().relative_to(root.resolve()))
    return out


def short(path: str) -> str:
    return Path(path).stem


def table(found: list[dict]) -> dict[str, dict]:
    """Each name: its readers, writers, mutators (by file) and write sites, and its owner."""
    out: dict[str, dict] = {}
    for u in found:
        n = out.setdefault(u["name"], {"read": set(), "write": set(), "mutate": set(), "sites": []})
        n[u["kind"]].add(u["file"])
        if u["kind"] == "write":
            n["sites"].append(u)
    for name, n in out.items():
        n["owner"] = OWNERS.get(name, ("hk-saver", ""))[0]
    return out


def owner_file(owner: str, root: Path = ROOT) -> str:
    return next(f for f in files(root) if short(f) == owner)


def strays(tab: dict[str, dict], root: Path = ROOT) -> dict[str, list[str]]:
    """The names written by a file that is not their owner: name -> those files."""
    out = {}
    for name, n in tab.items():
        own = owner_file(n["owner"], root)
        others = sorted(f for f in n["write"] if f != own)
        if others:
            out[name] = others
    return out


def render(found: list[dict] | None = None, root: Path = ROOT) -> str:
    found = uses(root) if found is None else found
    tab = table(found)
    names = sorted(tab, key=str.lower)
    order = [short(f) for f in files(root)]
    multi = [n for n in names if len(tab[n]["write"]) > 1]
    three = [n for n in names if len(tab[n]["write"]) >= 3]
    stray = strays(tab, root)
    touched: dict[str, int] = defaultdict(int)
    for n in names:
        for f in tab[n]["read"] | tab[n]["write"] | tab[n]["mutate"]:
            touched[short(f)] += 1
    lines = [
        "# The screensaver's shared state (`ST`), by owner",
        "",
        "Generated by `tools/state_owners.py` from the shell (`web/hk/modules/hk-saver.js`) and its parts (`web/hk/saver/`);",
        "`tests/test_state_owners.py` fails until it is written again. Phase 25, Part A ([PLAN.md](PLAN.md)): each name gets",
        "one owner, the file that writes it; the others ask it through functions it exports. A **write** sets `ST.x` itself;",
        "a **mutate** writes into what it holds (`ST.x.y = v`), which does not make a second writer.",
        "",
        "## Now",
        "",
        f"- **{len(names)} names**; **{len(multi)} written by more than one file**, {len(three)} by three or more.",
        f"- **{len(stray)} written by a file that is not their owner** (the work left); owners moved: "
        f"{', '.join(f'`{d}`' for d in sorted(DONE)) if DONE else 'none yet'}.",
        "- Names each file touches: " + ", ".join(f"`{p}` {touched.get(p, 0)}" for p in order) + ".",
        "",
        "## The owners",
        "",
        "| Owner | What it holds | Names |",
        "|---|---|---|",
    ]
    for part, why, owned in FEATURES:
        lines.append(f"| `{part}` | {why} | {', '.join(f'`{n}`' for n in owned)} |")
    lines += ["", "## Every name", "",
              "Files by their part name (`hk-saver` is the shell). Writers not the owner are in **bold**.", "",
              "| Name | Owner | Written by | Read by | Mutated by |", "|---|---|---|---|---|"]
    for name in names:
        n = tab[name]
        own = owner_file(n["owner"], root)
        wr = ", ".join(f"**{short(f)}**" if f != own else short(f) for f in sorted(n["write"], key=lambda f: order.index(short(f))))
        rd = ", ".join(short(f) for f in sorted(n["read"], key=lambda f: order.index(short(f))))
        mu = ", ".join(short(f) for f in sorted(n["mutate"], key=lambda f: order.index(short(f))))
        lines.append(f"| `{name}` | {n['owner']} | {wr or '-'} | {rd or '-'} | {mu or '-'} |")
    lines += ["", "## Where each is written", "",
              "Each write as `file:line (function)`; `(top)` runs as the file runs.", ""]
    for name in names:
        sites = sorted(tab[name]["sites"], key=lambda u: (order.index(short(u["file"])), u["line"]))
        if not sites:
            continue
        where = "; ".join(f"{short(u['file'])}:{u['line']} ({u['fn'] or 'top'})" for u in sites)
        lines.append(f"- `{name}`: {where}")
    return "\n".join(lines) + "\n"


def check(root: Path = ROOT) -> list[str]:
    found = uses(root)
    problems = []
    if (root / OUT.relative_to(ROOT)).read_text() != render(found, root):
        problems.append(f"{OUT.relative_to(ROOT)} is out of date: run tools/state_owners.py")
    tab = table(found)
    stray = strays(tab, root)
    for name in sorted(tab):
        if name not in OWNERS:
            problems.append(f"ST.{name} has no owner: give it one in tools/state_owners.py FEATURES")
        elif OWNERS[name][0] in DONE and name in stray:
            problems.append(f"ST.{name} is owned by {OWNERS[name][0]} but written by {', '.join(stray[name])}")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="the page is fresh and the moved owners stay sole writers")
    ap.add_argument("--json", action="store_true", help="print every use, one per line")
    args = ap.parse_args(argv)
    if args.json:
        for u in uses():
            print(json.dumps(u))
        return 0
    if args.check:
        problems = check()
        for p in problems:
            print(p, file=sys.stderr)
        return 1 if problems else 0
    OUT.write_text(render())
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
