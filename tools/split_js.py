#!/usr/bin/env python3
"""Cut a big web JavaScript file into parts, by name, and prove nothing but the place changed (phase 18, Part B;
docs/phase18/CODE-HEALTH.md "Part B: split the four files").

    tools/split_js.py grid-cards              # split web/hk/cards/hk-grid-cards.js as tools/split_manifests/grid-cards.json says
    tools/split_js.py grid-cards --check      # unsplit: the whole proof, nothing written; split: the files still agree with it
    tools/split_js.py --find roomParts        # which part (or shell) holds a member, for a session porting an edit
    tools/split_js.py --all --check           # every manifest

THE METHOD IS THE ONE hk-detail.js'S SPLIT USED (commit 5573f9db): real files in a folder beside the shell, each registering
one function; the shell fetches them in parallel, runs them in order with a kit K of what they use of it, takes back what it
uses of them, and only then does the rest of what it did. What is new is that a tool does the moving. Other sessions edit
these files all the time, so a split made by hand would be out of date before it landed; made by a tool from a list of
NAMES, a collision with another session is a re-run on the new tree.

THE MANIFEST (tools/split_manifests/<name>.json) names the shell, the parts folder and, per part, the members it takes:
top-level functions, variables and whole classes of the shell's IIFE (or of the function it runs, `run_in`). Whole
classes, so `super` and `static` stay inside them. Everything the manifest does not name stays in the shell.

HOW THE KIT IS WORKED OUT. The TypeScript compiler API (tools/split_js.cjs, the copy pinned in tools/typecheck) parses the
shell and resolves every identifier to its declaration, so a string, a regular expression or a template never fools it.
A reference from a member in one part to a member in the shell, in the shell's function parameter (the card base `C`) or
in an earlier part is a kit name: the part takes it from K at the top (`var a = K.a`); a reference the other way is
handed back (`K.x = x` at the bottom) and the shell takes it from K once every part has run. That is the plan. It is
then CHECKED the way the plan says: each part is written first without its takes and `tsc` is asked which names it cannot
find (TS2304); that list must equal the takes exactly. After writing, no part and not the shell may have a name `tsc`
cannot find that the original did not.

WHAT IT REFUSES TO MOVE (and says so, naming the member):
  * a member that assigns a variable of the shell, or of another part (a copy through K would go stale);
  * a variable that is assigned anywhere and read from outside the part it would move to;
  * a part that uses a later part (the manifest's order is the order they run), or a shell variable that is declared
    after the parts run;
  * a statement that shares a line with other code, a name declared twice, a name that is not a top-level member.

THE PROOF. Every moved member's text, with only its indentation normalized (lines inside a template literal or a string
continued over a line are kept exactly), is compared before and after, in the part it moved to. Every statement that
stayed is found in the new shell, text for text, in the place the plan put it (the statements that waited for the parts
run in the function handed to loadParts, in their order). Nothing else is in the new shell but the generated block.
`--check` on a split tree re-runs the structural half (the members are where the manifest says, the loader is the
template, the kit's takes and hand-backs agree, `tsc` finds no missing name) and, while the original blob recorded in the
manifest is still in the repository, says which moved members have been edited since (their code: comments and the parentheses
of a JSDoc cast do not count, so a part may be annotated for the type checker).

The loader every split shell has is generated from ONE template (loader_block below); tests/test_web_sources.py pins that.
`--write-loaders` rewrites every split shell's loader from it after the template changes. READINESS (phase 24): the loader
keeps window.__hkSplitReady[label], a promise that resolves once the parts have run and rejects when the loader gives up;
everything that imports a module and uses it at once (web/home.js imp, hk-loader, the Settings panel's boot, Home
Assistant's panel) waits for every started shell's promise. tools/headless/split_race_check.py holds the parts back and
looks.
CLASS-METHOD MODE (a panel like hk-settings.js: one class of 399 members, no `super` outside the constructor, no `static`,
no #private). The manifest names the class (`"class": "HkSettingsPanel"`) and a part lists `"methods": [...]` beside its
`"members"`. A part writes its methods in a class expression (`var Methods = class extends /** @type {any} */ (Object) { ...the
methods, text for text... }`: the `extends` only lets the type checker give `this` the shell class's properties) and hands it to the shell's `install`, which adds each to the class's prototype with Object.defineProperty, NOT enumerable (as a
class body defines them: writable, configurable; a getter or setter keeps its accessor). So `Object.getOwnPropertyNames` and
for-in over the prototype see the same set of names as before (their order is the order the parts ran in), and
tests/test_settings_prototype.py proves it. The things this needs of the manifest:
  * "kit_name": the parts' parameter (`K` is the default; the settings panel has a module of that name already);
  * "early_methods": methods that run before the parts are in (the constructor, connectedCallback, ...): they may not use a
    moved top-level member, nor `this.<a moved method>`;
  * "early": top-level statements that stay where they are and run at once (customElements.define, entry(...));
  * "live": shell variables that are set once, later (the panel's M, K, h, F, set when it boots). A part that uses one has
    its own `var` and a binder; the shell calls `bindLate()` after assigning (the manifest's shell_edits put the call in);
  * the shell waits: `partsReady` is a promise the shell's own code (boot) awaits, put in by a shell_edit.
Moved methods may not use `super`, and may not assign a shell variable (as for any member).
ADOPT (hk-detail.js, whose hand-written SHEETS loader predates the tool; commit 5573f9db). A manifest with `"adopt": "SHEETS"`
names a shell that has `var SHEETS = ['a.js', ...]`, a `kit()`, a `runSheets()` and a `loadSheets()` of its own, and the
files (the manifest's folder) each register one function the shell runs with that kit. The tool first makes the one file
that is (adopt_text): the shell without that loader, and where its call was, the files' members in the list's order (their
takes from the kit and hand-backs left out), then the call runSheets() ended with (`wire()`). It PROVES that merge (every
statement of the shell but the loader's, in order, text for text; every member of every file, text for text; nothing else
but the kit's functions; no name declared twice; no name that now means another member than it did) and refuses what it
cannot (two files that declare one name, or a file that reads the kit's object itself, are renamed or rewritten by hand
first, in a commit of their own). Then the ordinary split cuts that file: every statement that came from a file goes back
to that file's part, named or not (so `def('x', XPanel);` and `XPanel.prototype.y = ...` are not listed in the manifest);
the manifest's other parts take shell members by name. A part's member `"@GLYPHS.script ="` is a statement that declares
nothing, named by how it begins. `--adopt-out FILE` writes the one file for reading. The recorded `source` is the one
file's blob and the commit it can be made from again (`adopt_from`), which `--check` uses to say what was edited since.

Node: $NODE, else node on the PATH.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "tools/split_js.cjs"
MANIFESTS = ROOT / "tools/split_manifests"
# every declaration file the type checker reads (globals.d.ts, the host contract, the hand-written ones): a JSDoc type in a
# part resolves in them as it does in tools/typecheck/check.py
TYPES_D_TS = sorted(str(p) for p in (ROOT / "tools/typecheck/types").glob("*.d.ts"))
TS_FIXTURE = ROOT / "tests/fixtures/ts_check.json"
TS_BASELINE = ROOT / "tools/typecheck/baseline.json"
WIDTH = 118

LOADER_BEGIN = "// ------------------------------------------------------------ the parts (generated by tools/split_js.py)"
LOADER_END = "// ------------------------------------------------------------ end of the parts loader"
CALL = "loadParts"           # the loader's entry; the statements that wait for the parts are the function it is given

# THE LOADER: the same in every split shell (tests/test_web_sources.py pins it). {parts} is the PARTS list, formatted by
# parts_list(); label, glob and url are the shell's own.
LOADER = """\
{i}{begin}
{i}// THIS FILE IS THE SHELL. Its members are cut into the files of web/hk/{folder}/ (the PARTS below, in the order they
{i}// run) by tools/split_js.py from tools/split_manifests/{name}.json; `split_js.py --find <name>` says which file holds
{i}// one. Each file registers one function in window.{glob}; they run here, in this order (a later one may use
{i}// an earlier one), each given the kit K: what the parts use of the shell, in one object. What the shell uses of them,
{i}// they hand back on K, and it is taken from there. The files are fetched in parallel; a host that has already loaded
{i}// them (the suites) starts at once, in the same turn.
{i}// READY: window.__hkSplitReady['{label}'] is a promise that resolves once the parts have run (and rejects if they
{i}// never come), so a page that imports this file and uses it at once awaits it first (web/home.js imp, hk-loader).
{i}var PARTS = {parts};
{i}var PARTS_TRIES = 6;
{i}function partKey(file) {{ return file.replace(/\\.js$/, ''); }}
{i}function partsSettle(err) {{
{i}  var settle = (window.__hkSplitSettle || {{}})['{label}'];
{i}  if (settle) settle(err);
{i}}}
{i}// ONE FILE THAT DIDN'T COME (a tablet's Wi-Fi waking, the server restarting) used to leave the cards dead until a reload
{i}// (the third audit pass, WEB-11): the ones still missing are asked for again, a little later each time, at an address
{i}// of their own -- a browser keeps a failed module's answer for its address
{i}function loadParts(then, n) {{
{i}  // (the first call has no n; the retries and the finish pass it) a shell evaluated twice before its parts arrive
{i}  // must not run them twice: the flag is set at once, not when the parts have run
{i}  if (n === undefined) {{
{i}    var started = window.__hkSplitStarted = window.__hkSplitStarted || {{}};
{i}    if (started['{label}']) return;
{i}    started['{label}'] = true;
{i}    var ready = new Promise(function (resolve, reject) {{
{i}      (window.__hkSplitSettle = window.__hkSplitSettle || {{}})['{label}'] = function (err) {{ if (err) reject(err); else resolve(); }};
{i}    }});
{i}    ready.catch(function () {{ /* the console says so; an importer that awaits it reports it */ }});
{i}    (window.__hkSplitReady = window.__hkSplitReady || {{}})['{label}'] = ready;
{i}  }}
{i}  n = n || 0;
{i}  var have = window.{glob} || {{}};
{i}  var missing = PARTS.filter(function (file) {{ return !have[partKey(file)]; }});
{i}  if (!missing.length) {{
{i}    var failed = null;
{i}    try {{ then(); }} catch (err) {{ failed = err; console.error('[{label}] the parts did not start', err); }}
{i}    // (the checks that drive a page wait for every shell that started to say it is done)
{i}    (window.__hkSplitDone = window.__hkSplitDone || {{}})['{label}'] = true;
{i}    partsSettle(failed);
{i}    return;
{i}  }}
{i}  // (window.hkV: the build's ?v= on an address put together here, web/shim/base.js)
{i}  Promise.all(missing.map(function (file) {{
{i}    var u = '/hk/{folder}/' + file, href = window.hkV ? window.hkV(u) : u;
{i}    var got = n ? import(href + (href.indexOf('?') < 0 ? '?' : '&') + 'retry=' + n) : import(href);
{i}    return got.catch(function (err) {{ return err; }});
{i}  }})).then(function (got) {{
{i}    var err = got.filter(function (r) {{ return r instanceof Error; }})[0];
{i}    var left = PARTS.filter(function (file) {{ return !(window.{glob} || {{}})[partKey(file)]; }});
{i}    if (!left.length) {{ loadParts(then, n); return; }}
{i}    err = err || new Error(left[0] + ' ran without registering');
{i}    if (n + 1 >= PARTS_TRIES) {{ console.error('[{label}] the parts did not start', err); partsSettle(err); return; }}
{i}    console.warn('[{label}] a part did not load (' + err.message + '); again shortly');
{i}    setTimeout(function () {{ loadParts(then, n + 1); }}, Math.min(1000 * Math.pow(2, n), 15000));
{i}  }});
{i}}}
{i}{end}
"""

PART_HEADER = """\
// {file} - {title}.
//
// PART OF {what} ({shell}). Not a card and not run on its own: it registers one
// function, which {shell} calls with the shared kit {kit} once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from {kit} at the top; what the shell or a later file uses of it, it hands back at the bottom.
{check}"""


class Refusal(Exception):
    pass


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
    return LOADER.format(i=indent, begin=LOADER_BEGIN, end=LOADER_END, folder=folder, name=man["name"], glob=man["global"],
                         label=man["label"], parts=parts_list([p["name"] for p in man["parts"]], indent))


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


def make_plan(man: dict, text: str, work: Path) -> Plan:
    """The analysis of the unsplit shell and every decision the split rests on (nothing is written)."""
    work.mkdir(parents=True, exist_ok=True)
    src = work / "original.js"
    src.write_text(text)
    run_in = man.get("run_in") or man.get("run_in_decl")
    an = analyze(src, "shell", run_in, man=man)
    plan = Plan(man=man, lines=text.split("\n"), an=an, run_in=run_in)
    plan.unresolved_before = {u["name"] for u in diagnostics([src])[str(src.resolve())]["unresolved"]}
    plan.cs = class_scope(an)
    if man.get("class") and plan.cs is None:
        plan.refusals.append(f"the manifest names the class `{man['class']}`, which the shell does not declare at its top level")
    for sc in an["scopes"]:
        for st in sc["stmts"]:
            plan.members[(st["scope"], st["index"])] = Member(st["scope"], st["index"], st)
    for dup in an["duplicates"]:
        plan.refusals.append(f"`{dup['name']}` is declared in two scopes: the inner one hides the outer for the code inside it")

    # who moves where
    by, bym = {}, {}
    for m in plan.members.values():
        for n in m.d["names"]:
            by.setdefault(n, []).append(m)
        if m.scope == plan.cs and m.d.get("method"):
            bym.setdefault(m.d["method"], []).append(m)
    for pi, part in enumerate(man["parts"]):
        for name in part["members"]:
            if name.startswith("@"):        # a statement that declares nothing, named by how it begins (`@GLYPHS.script =`)
                hits = [m for m in plan.members.values() if not m.d["names"] and m.d["head"].startswith(name[1:])]
                if not hits:
                    plan.refusals.append(f"{part['name']}: no statement of the shell begins `{name[1:]}`")
                    continue
                if len(hits) > 1:
                    plan.refusals.append(f"{part['name']}: {len(hits)} statements of the shell begin `{name[1:]}`")
                    continue
                m = hits[0]
                if m.part not in (-1, pi):
                    plan.refusals.append(f"`{name[1:]}` is named by {man['parts'][m.part]['name']} and {part['name']}")
                m.part, m.adopted = pi, True
                continue
            hits = by.get(name, [])
            if not hits:
                plan.refusals.append(f"{part['name']}: `{name}` is not a top-level function, class or variable of the shell")
                continue
            if len(hits) > 1:
                plan.refusals.append(f"{part['name']}: `{name}` is declared more than once")
                continue
            m = hits[0]
            if m.part not in (-1, pi):
                plan.refusals.append(f"`{name}` is named by {man['parts'][m.part]['name']} and {part['name']}")
            if name == man.get("class"):
                plan.refusals.append(f"{part['name']}: `{name}` is the class itself: its methods move, not the class")
            m.part = pi
        for name in part.get("methods", []):
            hits = bym.get(name, [])
            if not hits:
                plan.refusals.append(f"{part['name']}: `{name}` is not a method of {man.get('class', 'a class')} (the manifest has no \"class\" or the name is wrong)")
                continue
            if len(hits) > 1 and sorted(h.d["msub"] for h in hits) != ["get", "set"]:
                plan.refusals.append(f"{part['name']}: `{name}` is declared more than once")
                continue
            for m in hits:
                if m.part not in (-1, pi):
                    plan.refusals.append(f"method `{name}` is named by {man['parts'][m.part]['name']} and {part['name']}")
                m.part = pi
    # ADOPT: every statement that came from one of the hand-split files moves back to the part of that file, named or not
    # (`def('x', XPanel);` and `XPanel.prototype.y = ...` have no name to list)
    ranges = man.get("_adopted") or []
    if ranges:
        run_scope = next(i for i, sc in enumerate(an["scopes"]) if sc["name"] == "run")
        index_of = {p["name"]: i for i, p in enumerate(man["parts"])}
        for m in plan.members.values():
            if m.scope != run_scope:
                continue
            for fname, a, b in ranges:
                if a <= m.d["first"] and m.d["last"] <= b:
                    pi = index_of.get(fname)
                    if pi is None:
                        plan.refusals.append(f"`{m.label}` (line {m.d['first']}) came from {fname}, which the manifest has no part for")
                    elif m.part not in (-1, pi):
                        plan.refusals.append(f"`{m.label}` came from {fname} but the manifest gives it to {man['parts'][m.part]['name']}")
                    else:
                        m.part, m.adopted = pi, True
    for m in plan.members.values():
        if m.part >= 0 and m.d["shared"]:
            plan.refusals.append(f"`{m.label}` (line {m.d['first']}) has {m.d['shared']}: cannot be cut by lines")
        if m.part >= 0 and m.scope == plan.cs:
            for what, bad in (("is the constructor", m.d["msub"] == "constructor"), ("is static", m.d["isStatic"]),
                              ("has a #private or computed name", m.d["priv"] or m.d["computed"]),
                              ("uses `super`, which would mean another prototype in a class expression", m.d["usesSuper"]),
                              ("is not a method or accessor", m.d["msub"] == "other")):
                if bad:
                    plan.refusals.append(f"method `{m.label}` (line {m.d['first']}) {what}: it cannot be moved")
        elif m.part >= 0 and m.d["kind"] not in ("function", "class", "var") and not m.adopted:
            plan.refusals.append(f"`{m.label}` is a {m.d['kind']}, not a member")
    if man.get("class"):
        clash = {n for m in plan.members.values() for n in m.d["names"]} & GENERATED_CLASS_MODE
        if clash:
            plan.refusals.append(f"the shell already declares {sorted(clash)}, which class-method mode generates")
    # the ones that stay but wait: after the first move in their scope, and not a function declaration (hoisted anyway)
    cut = {}
    for m in plan.members.values():
        if m.part >= 0:
            cut[m.scope] = min(cut.get(m.scope, 10 ** 9), m.index)
    host_lines = {(sc["host"]["first"], sc["host"]["last"]) for sc in an["scopes"] if sc["host"]}
    early = man.get("early", [])
    live = set(man.get("live", []))
    is_early = lambda m: bool(set(m.d["names"]) & set(early)) or m.d["head"].startswith(tuple(early))  # noqa: E731
    wait_all = bool(man.get("wait_all"))
    for m in sorted(plan.members.values(), key=lambda x: (x.scope, x.index)):
        # ("wait_all", hk-base.js: every statement of the scope that is not a declaration waits for the parts, in its order,
        # those before the first moved member too, except the ones the manifest names "early" -- so nothing it makes, as
        # window.hkCards, can be seen before the parts have filled it)
        if m.part >= 0 or m.scope == plan.cs or (not wait_all and (m.scope not in cut or m.index < cut[m.scope])):
            continue
        if wait_all and m.scope != len(code_scopes(an)) - 1:
            continue
        if early and is_early(m):                          # named in the manifest: stays where it is and runs at once
            continue
        if m.d["kind"] in ("function", "directive"):
            continue
        if is_tail_return(plan, m):                        # a declared scope's last `return x;` stays last (tail_return)
            continue
        if (m.d["first"], m.d["last"]) in host_lines:      # the call that holds the next scope stays where it is
            continue
        # (the state rewrite's object: `ST.x = value` was `var x = value`; it stays where it was, at once, when its value
        # reaches nothing that moved or waits -- the parts may read ST.x as they run, so it must be set before they do)
        st_obj = state_object(plan)
        if st_obj and m.d["kind"] == "expr" and re.match(re.escape(st_obj) + r"\.[\w$]+ = ", m.d["head"]) and not reaches(plan, m):
            continue
        # (phase 24) a statement that sets a property of one of the scope's own variables that stays (`M.glass = ...`), and
        # reaches nothing that moved or waits, stays where it was too: a part reading that object as it runs sees it set
        mut = mutated(m)
        if mut and mut != st_obj and m.d["kind"] == "expr" and any(
                mut in o.d["names"] and o.part < 0 and o.scope == m.scope for o in plan.members.values()) and not reaches(plan, m):
            continue
        if wait_all and m.d["kind"] == "var" and not any(not w.get("hoisted") for w in m.d["writes"]) and not reaches(plan, m):
            continue            # ("wait_all") a variable whose value reaches nothing that moved or waits still runs at once
        if not wait_all and m.d["kind"] == "var" and not any(not w.get("hoisted") for w in m.d["writes"]) and not any(
                (t := plan.members.get((r["scope"], r["index"]))) is not None and r.get("now") and (t.part >= 0 or t.late)
                for r in m.d["refs"] if "index" in r):
            continue            # a variable whose initializer touches nothing that moved or waits stays where it is, early
        m.late = True
    # statements that share a line wait together: a line is cut whole, so it cannot be half early and half waiting
    changed = True
    while changed:
        changed = False
        for m in plan.members.values():
            if m.late or m.part >= 0 or m.d["kind"] in ("function", "directive") or m.scope == plan.cs:
                continue
            if any(o.late and o.scope == m.scope and o.d["first"] <= m.d["last"] and m.d["first"] <= o.d["last"]
                   for o in plan.members.values() if o is not m):
                m.late = changed = True

    # references
    writers: dict[tuple, list[Member]] = {}
    for m in plan.members.values():
        for w in m.d["writes"]:
            writers.setdefault(target_key(w), []).append(m)
    for pi in range(len(man["parts"])):
        plan.takes[pi], plan.gives[pi], plan.live[pi] = set(), set(), set()
    for sc in range(len(an["scopes"])):
        plan.shell_takes[sc] = set()
    early_methods = set(man.get("early_methods", []))
    moved_methods = {m.d["method"] for m in plan.members.values() if m.scope == plan.cs and m.part >= 0}
    for m in plan.members.values():
        if m.scope == plan.cs and m.part < 0 and m.d.get("method") in early_methods:
            hit = sorted(set(m.d["thisProps"]) & moved_methods)
            if hit:
                plan.refusals.append(f"`{m.label}` runs before the parts are in, and uses `this.{hit[0]}`, which moves"
                                     f"{' (and ' + str(len(hit) - 1) + ' more)' if len(hit) > 1 else ''}")
        for r in m.d["refs"]:
            tk = target_key(r)
            tgt = plan.members.get((r["scope"], r["index"])) if "index" in r else None
            tpart = tgt.part if tgt else -1                      # a parameter of a scope's function is the shell's
            name = r.get("name") or r.get("param")
            if r.get("hoisted"):
                plan.refusals.append(f"`{name}` (used by `{m.label}`) is declared inside another statement and hoisted: not movable")
                continue
            if m.part >= 0 and tpart < 0 and name in live and tgt is not None:
                plan.live[m.part].add(name)                      # a shell variable set once, later: bound by bindLate()
                continue
            if tpart >= 0 and m.part < 0 and ((m.scope == plan.cs and m.d.get("method") in early_methods) or
                                              (m.scope != plan.cs and early and is_early(m) and r.get("now"))):
                plan.refusals.append(f"`{m.label}` runs before the parts are in, and uses `{name}`, which moves to "
                                     f"{man['parts'][tpart]['name']}")
                continue
            if m.part < 0 and not m.late and tgt is not None and tgt.late and tgt.d["kind"] != "function":
                plan.refusals.append(f"the shell's `{m.label}` (line {m.d['first']}) uses `{name}`, which waits for the parts "
                                     f"(line {tgt.d['first']}) and is declared where `{m.label}` cannot see it: move `{name}`'s "
                                     f"cause into a part, or keep it in the shell")
                continue
            if m.part == tpart:
                continue
            mutable = bool(writers.get(tk))
            if m.part >= 0 and tpart < 0:
                if tgt is not None and tgt.late:
                    plan.refusals.append(f"{man['parts'][m.part]['name']}: `{m.label}` uses `{name}`, which stays in the shell but is "
                                         f"defined after the parts run (line {tgt.d['first']}): move it into a part or earlier")
                if mutable:
                    plan.refusals.append(f"`{m.label}` uses `{name}`, which the shell assigns to again "
                                         f"({', '.join(sorted({w.label for w in writers[tk]}))}); a copy through K would go stale")
                plan.takes[m.part].add(name)
                plan.shell_kit.add(name)
            elif m.part >= 0 and tpart >= 0:
                if tpart > m.part:
                    plan.refusals.append(f"{man['parts'][m.part]['name']} (`{m.label}`) uses `{name}` of the later part "
                                         f"{man['parts'][tpart]['name']}: reorder the parts, or move one of them")
                    continue
                if mutable:
                    plan.refusals.append(f"`{m.label}` uses `{name}` of {man['parts'][tpart]['name']}, which is assigned to again "
                                         f"({', '.join(sorted({w.label for w in writers[tk]}))}); a copy through K would go stale")
                plan.takes[m.part].add(name)
                plan.gives[tpart].add(name)
            elif m.part < 0 and tpart >= 0:
                if mutable:
                    plan.refusals.append(f"the shell's `{m.label}` uses `{name}` of {man['parts'][tpart]['name']}, which is assigned to "
                                         f"again; a copy through K would go stale")
                if m.index < cut.get(m.scope, 10 ** 9) and m.d["kind"] != "function" and r.get("now") and not m.late:
                    plan.refusals.append(f"the shell's `{m.label}` (line {m.d['first']}) uses `{name}` of {man['parts'][tpart]['name']} "
                                         f"while it is evaluated, before the parts have run")
                plan.shell_takes[tgt.scope].add(name)
                plan.gives[tpart].add(name)
    # a moved member that assigns a name of the shell or another part
    for tk, ws in writers.items():
        for w in ws:
            t = plan.members.get((tk[1], tk[2])) if tk[0] == "m" else None
            tpart = t.part if t else -1
            if w.part >= 0 and w.part != tpart:
                plan.refusals.append(f"`{w.label}` assigns `{tk[3] if tk[0] == 'm' else tk[1]}`, which is "
                                     f"{'the shell' if tpart < 0 else man['parts'][tpart]['name']}'s: it cannot move")
            if w.part < 0 and tpart >= 0:
                plan.refusals.append(f"the shell's `{w.label}` assigns `{tk[3]}`, which moved to {man['parts'][tpart]['name']}")
    # (phase 24) RUN AT LOAD, REACHED THROUGH A CALL: a statement of the shell that runs at once (it stays, does not wait,
    # and is not a declaration) and calls a function of the shell that uses a moved member, or a variable that waits for
    # the parts, would meet it undefined before the parts have run. The direct use is refused above; this follows calls.
    by_key = plan.members
    for m in sorted(plan.members.values(), key=lambda x: (x.scope, x.index)):
        if m.part >= 0 or m.late or m.scope == plan.cs or m.d["kind"] in ("function", "directive", "class"):
            continue
        if man.get("class") and m.d["kind"] == "other":
            continue
        # (every ref of the statement, its callbacks' and IIFEs' too: `items.forEach(function () {...})` runs them at once)
        start = [r for r in m.d["refs"] if "index" in r]
        seen, stack = set(), [(r, [r.get("name")]) for r in start]
        while stack:
            r, via = stack.pop()
            tgt = by_key.get((r["scope"], r["index"]))
            if tgt is None or tgt.key in seen:
                continue
            seen.add(tgt.key)
            if tgt.part >= 0 or (tgt.late and tgt.d["kind"] != "function"):
                # (a direct use inside a callback or an IIFE of the statement too: it may run at once)
                if len(via) > 1 or not any(r2.get("now") for r2 in m.d["refs"] if r2.get("name") == via[0]):
                    plan.refusals.append(f"the shell's `{m.label}` (line {m.d['first']}) runs at load and reaches `{via[-1]}`, which "
                                         f"{'moves to ' + man['parts'][tgt.part]['name'] if tgt.part >= 0 else 'waits for the parts'}, "
                                         f"through {' -> '.join(via[:-1])}: it would meet it undefined")
                continue
            if tgt.d["kind"] == "function":
                stack += [(r2, via + [r2.get("name")]) for r2 in tgt.d["refs"] if "index" in r2]
    # (phase 24) A STATEMENT THAT WAITS AND CHANGES AN OBJECT a part reads as it runs (`M.glass = ...`, `X.push(...)`,
    # `Object.assign(X, ...)`): the part would read the object before the change. The object must stay in the shell (where
    # the change, reaching nothing that moved, runs at once) or the change must not wait.
    changed_late = {}
    for m in plan.members.values():
        if m.part < 0 and m.late and m.d["kind"] in ("expr", "other", "var"):
            for w in mutated_anywhere(m):
                changed_late.setdefault(w, m)
    for m in plan.members.values():
        if m.part < 0 or m.d["kind"] in ("function", "class"):
            continue
        for r in m.d["refs"]:
            if r.get("now") and r.get("name") in changed_late:
                s = changed_late[r["name"]]
                plan.refusals.append(f"{man['parts'][m.part]['name']}: `{m.label}` reads `{r['name']}` as it runs, and the shell's "
                                     f"`{s.label}` (line {s.d['first']}) changes it after the parts have run: keep `{r['name']}` in "
                                     f"the shell")
    # (phase 24, the review) ORDER THROUGH A SHARED OBJECT: a moved member is evaluated after every statement of the shell that
    # runs at once, and a statement that waits after all of them. If one of them, earlier or later in the file, changes an
    # object the other reads (or both change it), moving changes what is read: `var snap = cfg.a` moved, an early
    # `cfg.a = 2` after it; `var r = (list.push('a'), 1)` moved, an early `var n = list.length` after it; a waiting
    # `list.push(x)` before an early `var n = list.length`.
    def runs_now(x: Member) -> bool:
        return x.part < 0 and not x.late and x.d["kind"] not in ("function", "class", "directive") and x.scope != plan.cs

    st_name = state_object(plan)

    def split_state(names: set, text: str, mut: bool) -> set:
        """The state object counted per property (ST.SHEET and ST.registered are not one thing)."""
        if not st_name or st_name not in names:
            return names
        pat = (r"\b" + re.escape(st_name) + r"\.([\w$]+)(?:\s*(?:[-+*/|&]?=)(?!=)|(?:\.[\w$]+)*\." + MUTATORS + r"\()") if mut \
            else (r"\b" + re.escape(st_name) + r"\.([\w$]+)")
        return (names - {st_name}) | {st_name + "." + p for p in re.findall(pat, text)}

    def reads(x: Member) -> set:
        text = now_text(x) if x.d["kind"] not in ("function", "class") else ""
        names = {r.get("name") for r in x.d["refs"] if r.get("name") and r.get("now")}
        return split_state(names, text, False)

    def changes(x: Member) -> set:
        text = now_text(x)
        names = mutated_anywhere(Member(x.scope, x.index, dict(x.d, text=text)))
        return split_state(names, text, True)
    timeline = sorted(plan.members.values(), key=lambda x: (x.scope, x.index))
    for a in timeline:
        moved_or_late = (a.part >= 0 and a.d["kind"] not in ("function", "class")) or (a.part < 0 and a.late)
        if not moved_or_late:
            continue
        a_mut, a_read = changes(a), reads(a)
        for b in timeline:
            if b.scope != a.scope or not runs_now(b):
                continue
            if b.index < a.index:                        # (an at-once statement before it runs before it either way)
                continue
            b_mut = changes(b)
            clash = sorted((a_mut & (reads(b) | b_mut)) | (b_mut & a_read))
            clash = [c for c in clash if c not in ("window", "document", "globalThis")]
            if clash:
                plan.refusals.append(f"`{a.label}` ({'moves to ' + man['parts'][a.part]['name'] if a.part >= 0 else 'waits'}) and the "
                                     f"shell's `{b.label}` (line {b.d['first']}, at once) both touch `{clash[0]}`, one changing it: "
                                     f"their order would change")
    # (the state rewrite) a part that reads ST.x as it runs (outside a function) while ST.x is set by a statement that waits for
    # the parts would read it unset; and a statement that runs at once reading an ST.x that is set later, likewise
    st_obj = state_object(plan)
    if st_obj:
        late_props, early_props = set(), set()
        for m in plan.members.values():
            hit = re.match(re.escape(st_obj) + r"\.([\w$]+) = ", m.d["head"])
            if hit and m.part < 0:
                (late_props if m.late else early_props).add(hit.group(1))
        for m in plan.members.values():
            if m.part < 0 and m.late:
                continue
            if not any(r.get("name") == st_obj and r.get("now") for r in m.d["refs"]):
                continue
            read = set(re.findall(re.escape(st_obj) + r"\.([\w$]+)", now_text(m)))
            bad = sorted(read & late_props)
            if bad:
                where = man["parts"][m.part]["name"] if m.part >= 0 else "the shell, at once"
                plan.refusals.append(f"`{m.label}` ({where}) reads {', '.join(st_obj + '.' + b for b in bad)} as it runs, "
                                     f"before the statement that sets it (it waits for the parts)")
    plan.refusals = list(dict.fromkeys(plan.refusals))
    return plan


def mutated(m: Member) -> str | None:
    """The variable a statement changes the inside of (`X.y = ...`, `X[k] = ...`, `X.push(...)`, `Object.assign(X, ...)`),
    by its text; None for anything else."""
    head = m.d["head"]
    hit = re.match(r"([A-Za-z_$][\w$]*)\s*(?:\.[\w$]+|\[[^\]]*\])+\s*=[^=]", head) \
        or re.match(r"([A-Za-z_$][\w$]*)(?:\.[\w$]+)*\." + MUTATORS + r"\(", head) \
        or re.match(r"Object\.assign\(\s*([A-Za-z_$][\w$]*)\s*,", head)
    if not hit or hit.group(1) in ("window", "document", "globalThis", "customElements", "console", "self"):
        return None
    return hit.group(1)


MUTATORS = r"(?:push|unshift|splice|pop|shift|sort|reverse|set|add|delete|clear|fill|copyWithin)"


def mutated_anywhere(m: Member) -> set[str]:
    """Every name whose inside a statement may change, anywhere in its text, callbacks included (`X.y = `, `X[k] = `,
    `X.push(`, `Object.assign(X, `): an over-reach on purpose -- a refusal it makes is a manifest to change, never a bug."""
    text = re.sub(r"//[^\n]*", "", m.d["text"])
    out = set(re.findall(r"\b([A-Za-z_$][\w$]*)(?:\.[\w$]+|\[[^\]\n]*\])+\s*(?:[-+*/|&]?=)(?!=)", text))
    out |= set(re.findall(r"\b([A-Za-z_$][\w$]*)(?:\.[\w$]+)*\." + MUTATORS + r"\(", text))
    out |= set(re.findall(r"Object\.assign\(\s*([A-Za-z_$][\w$]*)", text))
    return out - {"window", "document", "globalThis", "customElements", "console", "self", "this", "e", "el", "s", "o"}


def state_object(plan: Plan) -> str | None:
    """The state rewrite's object in this shell (`var ST = /** @type {Record<string, any>} */ ({});`), if it has one."""
    for m in plan.members.values():
        if m.d["kind"] == "var" and len(m.d["names"]) == 1 and "/** @type {Record<string, any>} */ ({})" in m.d["text"] \
                and "THE SHARED STATE (tools/split_js.py state)" in m.d["text"]:
            return m.d["names"][0]
    return None


def now_text(m: Member) -> str:
    """A member's text without its function bodies: what runs as it is evaluated (a function's body runs when it is called)."""
    text = m.d["text"]
    if m.d["kind"] in ("function", "class"):
        return ""
    out, depth, i = [], 0, 0
    for hit in re.finditer(r"\bfunction\b[^{]*\{|=>\s*\{", text):
        pass
    # (a cheap cut: drop every `function ... { ... }` and `=> { ... }` body by brace matching outside strings)
    i, n = 0, len(text)
    while i < n:
        mf = re.compile(r"\bfunction\b[^{(]*\([^)]*\)\s*\{|=>\s*\{").search(text, i)
        if not mf:
            out.append(text[i:])
            break
        out.append(text[i:mf.start()])
        j, depth = mf.end(), 1
        while j < n and depth:
            c = text[j]
            if c in "'\"`":
                q = c
                j += 1
                while j < n and text[j] != q:
                    j += 2 if text[j] == "\\" else 1
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            j += 1
        i = j
    return "".join(out)


def reaches(plan: Plan, m: Member) -> bool:
    """Does running `m` now reach a member that moved, or a statement that waits for the parts (through the functions of
    the shell it calls or reads)?"""
    seen, stack = set(), [r for r in m.d["refs"] if "index" in r]     # (callbacks and IIFEs inside it may run at once)
    while stack:
        r = stack.pop()
        tgt = plan.members.get((r["scope"], r["index"]))
        if tgt is None or tgt.key in seen:
            continue
        seen.add(tgt.key)
        if tgt.part >= 0 or (tgt.late and tgt.d["kind"] != "function"):
            return True
        if tgt.d["kind"] == "function":
            stack += [r2 for r2 in tgt.d["refs"] if "index" in r2]
    return False


# names the class-method shell generates (the loader's own are PARTS, PARTS_TRIES, partKey, partsSettle, loadParts, kit, runParts)
GENERATED_CLASS_MODE = {"install", "bindLate", "lates", "partsReady"}


def class_scope(an: dict) -> int | None:
    for i, sc in enumerate(an["scopes"]):
        if sc["name"] == "class":
            return i
    return None


def code_scopes(an: dict) -> list[dict]:
    """The scopes that hold statements the parts run in (the class's members are not one)."""
    return [sc for sc in an["scopes"] if sc["name"] != "class"]


def target_key(r: dict) -> tuple:
    if "index" in r:
        return ("m", r["scope"], r["index"], r["name"])
    return ("p", r["scope"], r["param"])


# ------------------------------------------------------------------------------------------------ writing the parts
def hand_back_lines(names: list[str], kit: str = "K") -> list[str]:
    """`K.a = a; K.b = b;` wrapped, statement by statement."""
    return pack([f"{kit}.{n} = {n};" for n in names], "    ", "    ")


def take_lines(names: list[str], kit: str = "K") -> list[str]:
    """`var a = K.a, b = K.b;` wrapped."""
    return pack(commas([f"{n} = {kit}.{n}" for n in names]), "    var ", "        ")


def part_text(plan: Plan, pi: int, takes: set[str] | None = None, check: bool = False) -> tuple[str, list[Member]]:
    man = plan.man
    part = man["parts"][pi]
    mine = sorted((m for m in plan.members.values() if m.part == pi), key=lambda m: m.d["first"])
    out = PART_HEADER.format(file=part["name"] + ".js", title=part["title"], what=man["what"],
                             shell=Path(man["shell"]).name, kit=kit_of(man), check="// @ts-check\n" if check else "").rstrip("\n").split("\n")
    kit = kit_of(man)
    out += ["(function () {", "  'use strict';",
            f"  (window.{man['global']} = window.{man['global']} || {{}})['{part['name']}'] = function ({kit}) {{"]
    takes = plan.takes[pi] if takes is None else takes
    if takes:
        out += take_lines(by_name(takes), kit)
        out.append("")
    late = by_name(plan.live.get(pi, ()))
    if late:
        out += pack(commas(late), "    var ", "        ")
        out += ["    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)",
                f"    {kit}.late.push(function (s) {{"] + pack([f"{n} = s.{n};" for n in late], "      ", "      ") + ["    });", ""]
    tops = [m for m in mine if m.scope != plan.cs]
    meths = [m for m in mine if m.scope == plan.cs]
    for k, m in enumerate(tops):
        d = m.d
        body = reindent(plan.lines[d["first"] - 1:d["last"]], set(d["protected"]), d["first"], d["indent"], 4)
        if k and plan.lines[d["first"] - 2].strip() == "":
            out.append("")
        out += body
    if meths:
        if tops:
            out.append("")
        out += [f"    // THE METHODS this part adds to {man['class']}.prototype ({kit}.install: not enumerable, as a class body",
                "    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type",
                "    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)",
                "    var Methods = class extends /** @type {any} */ (Object) {"]
        for k, m in enumerate(meths):
            d = m.d
            body = reindent(plan.lines[d["first"] - 1:d["last"]], set(d["protected"]), d["first"], d["indent"], 6)
            if k and plan.lines[d["first"] - 2].strip() == "":
                out.append("")
            out += body
        out += ["    };", f"    {kit}.install(Methods);"]
    if plan.gives[pi]:
        out.append("")
        out.append("    // what the shell and the later parts use of this one")
        out += hand_back_lines(by_name(plan.gives[pi]), kit)
    out += ["  };", "})();", ""]
    return "\n".join(out), mine


# ------------------------------------------------------------------------------------------------ writing the shell
def shell_text(plan: Plan, extra_takes: dict[int, set[str]] | None = None) -> str:
    """The shell: the moved members and the waiting statements cut out, the loader put where the first member was, and the
    kit, the run and the call that holds the waiting statements put in the scope the parts run in."""
    man, an, L = plan.man, plan.an, plan.lines
    scopes = code_scopes(an)
    top, home = scopes[0], scopes[-1]       # home: the scope the parts run in (the function run_in names, else the IIFE)
    hs = len(scopes) - 1
    kitn = kit_of(man)
    cls_mode = bool(man.get("class"))
    live_mode = bool(man.get("live"))          # shell variables set once, later: bound by bindLate() (any shell)
    takes = {sc: set(v) for sc, v in plan.shell_takes.items()}
    for sc, extra in (extra_takes or {}).items():
        takes.setdefault(sc, set()).update(extra)
    moved = [m for m in plan.members.values() if m.part >= 0]
    late = sorted((m for m in plan.members.values() if m.late), key=lambda m: (m.scope, m.index))
    remove = [(m.d["first"], m.d["last"]) for m in moved + late]
    insert: dict[int, list[str]] = {}

    # the loader (IIFE level), where the IIFE's first moved member was; else before the call that holds the scope
    top_ind = " " * (top["stmts"][0]["indent"] if top["stmts"] else 2)
    block = loader_block(man, top_ind).rstrip("\n").split("\n")
    if takes.get(0):
        block += pack(commas(by_name(takes[0])), top_ind + "var ", top_ind + "    ")
    first_top = min((m.d["first"] for m in moved if m.scope == 0), default=None)
    if first_top is not None:
        insert.setdefault(first_top, []).extend(block + [""])
    elif home["host"]:
        insert.setdefault(home["host"]["first"], []).extend(block + [""])
    else:
        insert.setdefault(home["close"], []).extend([""] + block)

    # the kit, the run and the call, in the scope the parts run in
    ind = " " * (home["stmts"][0]["indent"] if home["stmts"] else 4)
    ind2 = ind + "  "
    kit = [f"{ind}function kit() {{", f"{ind2}return {{"]
    entries = [f"{n}: {n}" for n in by_name(plan.shell_kit)]
    if cls_mode:
        entries += ["install: install"]
    if live_mode:
        entries += ["late: lates"]
    kit += pack(commas(entries, last=""), ind2 + "  ", ind2 + "  ")
    kit += [f"{ind2}}};", f"{ind}}}"]
    back_all = by_name(set().union(*takes.values()) if takes else set())
    run = [f"{ind}function runParts() {{", f"{ind2}var {kitn} = kit();",
           f"{ind2}PARTS.forEach(function (file) {{ window.{man['global']}[partKey(file)]({kitn}); }});"]
    run += pack([f"{n} = {kitn}.{n};" for n in back_all], ind2, ind2) if back_all else []
    if live_mode:
        run.append(f"{ind2}bindLate();")
    run.append(f"{ind}}}")
    decl = pack(commas(by_name(takes[hs])), ind + "var ", ind + "    ") if hs != 0 and takes.get(hs) else []
    cls_defs = []
    names = by_name(man.get("live", []))
    if cls_mode:
        cls = man["class"]
        cls_defs = [
            f"{ind}// THE CLASS'S METHODS that parts add: as a class body defines them (writable, configurable, NOT enumerable; a",
            f"{ind}// getter or setter stays an accessor), so for-in and Object.getOwnPropertyNames over the prototype see the same names",
            f"{ind}function install(from) {{",
            f"{ind2}Object.getOwnPropertyNames(from.prototype).forEach(function (name) {{",
            f"{ind2}  if (name === 'constructor') return;",
            f"{ind2}  if (Object.prototype.hasOwnProperty.call({cls}.prototype, name)) throw new Error('[{man['label']}] ' + name + ' is defined twice');",
            f"{ind2}  var d = Object.getOwnPropertyDescriptor(from.prototype, name);",
            f"{ind2}  Object.defineProperty({cls}.prototype, name, d.get || d.set",
            f"{ind2}    ? {{ get: d.get, set: d.set, enumerable: false, configurable: true }}",
            f"{ind2}    : {{ value: d.value, writable: true, enumerable: false, configurable: true }});",
            f"{ind2}}});",
            f"{ind}}}"]
    if live_mode:
        cls_defs += [
            f"{ind}// THE SHELL'S VARIABLES SET ONCE, LATER ({', '.join(names)}): each part that uses one has its own copy, handed over here",
            f"{ind}// whenever the shell has assigned them (the parts run, and the page's start)",
            f"{ind}var lates = [];",
            f"{ind}function bindLate() {{",
            f"{ind2}var s = {{ " + ", ".join(f"{n}: {n}" for n in names) + " };",
            f"{ind2}lates.forEach(function (bind) {{ bind(s); }});",
            f"{ind}}}",
        ]
    prelude = decl + cls_defs + kit + run
    first_run = min((m.d["first"] for m in moved if m.scope == hs), default=None)
    if first_run is not None and hs != 0:
        insert.setdefault(first_run, []).extend(prelude + [""])
    else:
        insert.setdefault(home["close"], []).extend([""] + prelude)
    # the call, with the statements that wait for the parts (in their order, as they were)
    cont = ind + "  "
    if cls_mode:
        # the element is defined at once (the host makes one the moment the module is in); the page waits for its methods:
        # boot() awaits partsReady (a shell_edit). Nothing waits in the shell itself.
        if late:
            raise Refusal("class-method mode: " + ", ".join(m.label for m in late) + " would wait for the parts; name them under "
                          "\"early\" in the manifest (they run at once) or move them")
        call = [f"{ind}var partsReady = new Promise(function (resolve, reject) {{",
                f"{cont}var ran = false;",
                f"{cont}{CALL}(function () {{",
                f"{cont}  runParts();",
                f"{cont}  ran = true;",
                f"{cont}  resolve();",
                f"{cont}}});",
                f"{cont}// (the loader gives up after its last try with a note in the console; the page says so too)",
                f"{cont}if (!ran) setTimeout(function () {{ reject(new Error('its files did not load')); }}, 75000);",
                f"{ind}}});",
                f"{ind}partsReady.catch(function () {{ /* boot() reports it */ }});"]
    else:
        call = [f"{ind}{CALL}(function () {{", f"{cont}runParts();"]
        spans = set()
        for m in late:
            # (statements that share a line wait together: the line is written once)
            if (m.d["first"], m.d["last"]) in spans:
                continue
            spans.add((m.d["first"], m.d["last"]))
            body = reindent(L[m.d["first"] - 1:m.d["last"]], set(m.d["protected"]), m.d["first"], m.d["indent"], len(cont))
            call += ([""] if m is late[0] or L[m.d["first"] - 2].strip() == "" else []) + body
        call.append(f"{ind}}});")
    tail = next((m for m in plan.members.values() if is_tail_return(plan, m)), None)
    if tail is not None:          # before a declared scope's last `return x;`: the call must be reached
        insert.setdefault(tail.d["first"], []).extend(call + [""])
    else:
        insert.setdefault(home["close"], []).extend([""] + call)
    return splice(L, remove, insert)


def is_tail_return(plan: Plan, m: Member) -> bool:
    """The last statement of a declared function's body that is a `return` (hk-weather.js's boot() ends `return true;`, and
    its caller tries again on an event when it returns false): it stays the last statement, after the loader's call."""
    if not plan.man.get("run_in_decl"):
        return False
    scopes = code_scopes(plan.an)
    hs = len(scopes) - 1
    if m.scope != hs or not scopes[hs]["stmts"]:
        return False
    last = scopes[hs]["stmts"][-1]
    return m.index == last["index"] and m.d["head"].startswith("return")


def splice(L: list[str], remove: list[tuple[int, int]], insert: dict[int, list[str]]) -> str:
    gone = set()
    for a, b in remove:
        gone.update(range(a, b + 1))
    out: list[str] = []
    gap = False                     # just after a removed statement
    for no, line in enumerate(L, 1):
        if no in insert:
            if out and out[-1].strip() == "" and insert[no] and insert[no][0] == "":
                insert[no] = insert[no][1:]
            out += insert[no]
            gap = False
        if no in gone:
            gap = True
            continue
        if gap and line.strip() == "":
            if out and out[-1].strip() == "":
                continue
        else:
            gap = False
        out.append(line)
    return "\n".join(out)


def apply_edits(text: str, edits: list[dict]) -> str:
    for e in edits:
        if text.count(e["find"]) != 1:
            raise Refusal(f"shell_edits: `{e['find'][:60]}` is found {text.count(e['find'])} times, not once")
        text = text.replace(e["find"], e["replace"])
    return text


# ------------------------------------------------------------------------------------------------ the whole thing
def load_manifest(arg: str) -> tuple[dict, Path]:
    p = Path(arg)
    if not p.suffix:
        p = MANIFESTS / f"{arg}.json"
    if not p.is_file():
        raise SystemExit(f"no manifest {p}")
    man = json.loads(p.read_text())
    man["name"] = p.stem
    return man, p


def is_split(text: str) -> bool:
    return LOADER_BEGIN in text


def git(*args: str, input: str | None = None) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT, input=input).stdout.strip()


# ------------------------------------------------------------------------------------------------ adopt (phase 24, B5)
# The names of a hand-written loader like hk-detail.js's (commit 5573f9db) that `adopt` replaces: the list (the manifest's
# "adopt"), and the functions around it. The list also names the files: the folder the manifest names, `<name>.js` each.
ADOPT_LOADER = ("kit", "sheetKey", "runSheets", "SHEET_TRIES", "loadSheets")


def adopt_text(man: dict, read=None) -> tuple[str, list[str], list[tuple[str, int, int]]]:
    """ADOPT: the one file that a shell with a hand-written loader and its hand-split files is, in the order it runs.

    `"adopt": "SHEETS"` in a manifest says the shell has `var SHEETS = ['a.js', ...]`, a `kit()`, a `runSheets()` and a
    `loadSheets()` of its own, and that the files (the manifest's folder) each register one function the shell runs with
    that kit. The text this returns is the shell without that loader, and where its call was: the files' members, in the
    list's order, with their takes from the kit and their hand-backs left out, and then the one call `runSheets()` ended
    with (`wire()`). A kit entry that is a function (`sheetState: function () { return D; }`) becomes a declared function
    before the members. It is the text the ordinary split then cuts, so the proof of the split (and of the move, member by
    member) is the tool's own. THIS function proves the merge: every statement of the shell but the loader's, in order, text
    for text; every member of every file, text for text; nothing else but the kit's functions and the final call; no name
    declared twice; and no name that meant something else before (a global, a take) now meaning another member. Returns
    (text, problems); `read(path)` answers a file's text (default: the working tree)."""
    read = read or (lambda rel: (ROOT / rel).read_text())
    work = Path(tempfile.mkdtemp(prefix="split_js-adopt-"))
    problems: list[str] = []
    try:
        listname = man["adopt"]
        kitn = kit_of(man)
        shell_src = read(man["shell"])
        L = shell_src.split("\n")
        sf = work / "shell.js"
        sf.write_text(shell_src)
        an = analyze(sf, "shell", man.get("run_in"), man=man)
        run = [sc for sc in an["scopes"] if sc["name"] == "run"]
        if not run:
            return "", [f"adopt: the shell has no function `{man.get('run_in')}` handed on (run_in)"], []
        run = run[0]
        listing = re.search(r"var " + re.escape(listname) + r" = \[([^\]]*)\]", shell_src)
        if not listing:
            return "", [f"adopt: the shell has no `var {listname} = [...]`"], []
        files = re.findall(r"'([^']+)\.js'", listing.group(1))
        folder = Path(man["folder"])
        run_sheets = next((st for st in run["stmts"] if "runSheets" in st["names"]), None)
        kit_st = next((st for st in run["stmts"] if "kit" in st["names"]), None)
        call = next((st for st in run["stmts"] if st["head"].startswith("loadSheets(")), None)
        if not (run_sheets and kit_st and call):
            return "", ["adopt: the shell's hand-written loader (kit, runSheets, loadSheets and its call) is not as expected"], []
        # what runSheets takes back (`a = K.a;`) and the call it ends with (`wire();`)
        back = set(re.findall(r"([\w$]+) = " + re.escape(kitn) + r"\.\1;", run_sheets["text"]))
        final = re.findall(r"\n\s*([\w$]+)\(\);\n\s*\}\s*$", run_sheets["text"])
        if len(final) != 1:
            return "", ["adopt: runSheets does not end with one call (`wire();`)"], []
        # the kit's functions: `name: function () { body }`; the rest of it must be `name: name`
        entries = re.findall(r"([\w$]+): function \(\) \{ ([^{}]*) \}", kit_st["text"])
        plain = set(re.findall(r"([\w$]+): \1\b", kit_st["text"]))
        left = re.sub(r"([\w$]+): function \(\) \{ [^{}]*\}", "", kit_st["text"])
        left = re.sub(r"([\w$]+): \1\b", "", left)
        if re.search(r"[\w$]+:", left):
            problems.append("adopt: the kit has an entry that is neither `name: name` nor `name: function () { ... }`")
        loader = [st for st in run["stmts"] if set(st["names"]) & ({listname} | set(ADOPT_LOADER))
                  or (st["kind"] == "var" and st["names"] and not st["init"] and set(st["names"]) <= back) or st is call]
        gone = set()
        for st in loader:
            gone.update(range(st["first"], st["last"] + 1))
        # each file's members: its function's statements but the takes and the hand-backs
        bodies: dict[str, list[str]] = {}
        member_stmts: list[tuple[str, dict]] = []
        for name in files:
            f = work / (name + ".js")
            f.write_text(read(str(folder / (name + ".js"))))
            pan = analyze(f, "part", None, man=man)
            ft = f.read_text().split("\n")
            body: list[str] = []
            bodies[name] = body
            for st in pan["scopes"][0]["stmts"]:
                if st.get("takes") or re.match(re.escape(kitn) + r"\.[\w$]+ = [\w$]+;", st["head"]):
                    continue
                body.append("")
                body += reindent(ft[st["first"] - 1:st["last"]], set(st["protected"]), st["first"], st["indent"], 4)
                member_stmts.append((name, st))
        before: list[str] = []
        after: list[str] = []
        for no, line in enumerate(L, 1):
            if no in gone:
                continue
            (before if no < call["first"] else after).append(line)
        block = [f"    function {fname}() {{ {fbody} }}" for fname, fbody in entries]
        ranges: list[tuple[str, int, int]] = []        # (file, first line, last line) of each file's members in the one file
        for name in files:
            mine = bodies[name]
            first = len(block) + 1
            block += mine
            ranges.append((name, first, len(block)))
        block += ["", f"    {final[0]}();"]
        # (the blank lines the loader's statements left are closed up; the block has none doubled)
        head = re.sub(r"\n{3,}", "\n\n", "\n".join(before)).rstrip("\n").split("\n")
        tail = re.sub(r"\n{3,}", "\n\n", "\n".join(after)).lstrip("\n").split("\n")
        text = "\n".join(head + [""] + block + tail)
        base = len(head) + 1
        ranges = [(n, a + base, b + base) for n, a, b in ranges]
        # THE PROOF
        one = work / "one.js"
        one.write_text(text)
        oan = analyze(one, "shell", man.get("run_in"), man=man)
        orun = [sc for sc in oan["scopes"] if sc["name"] == "run"][0]
        one_texts = [st["text"] for st in orun["stmts"]]
        want_shell = [st["text"] for st in run["stmts"] if st not in loader]
        pos = 0
        for t in want_shell:
            try:
                pos = one_texts.index(t, pos) + 1
            except ValueError:
                problems.append("adopt: a statement of the shell is not in the one file, in its place: " + t.split("\n")[0][:90])
        pool = list(one_texts)
        for t in want_shell:
            if t in pool:
                pool.remove(t)
        for fname, st in member_stmts:
            if st["text"] in pool:
                pool.remove(st["text"])
            else:
                problems.append(f"adopt: {fname}: member `{st['head'][:60]}` is not in the one file, text for text")
        extra = [t for t in pool]
        if len(extra) != len(entries) + 1:
            problems.append(f"adopt: the one file holds {len(extra)} statements that are neither the shell's nor the files', "
                            f"expected {len(entries) + 1} (the kit's functions and {final[0]}())")
        # no name declared twice in the one scope (two files that both declare it would share it)
        seen: dict[str, str] = {}
        owner = {id(st): fn for fn, st in member_stmts}
        for st in orun["stmts"]:
            for n in st["names"]:
                if n in seen and st["kind"] in ("function", "var", "class"):
                    problems.append(f"adopt: `{n}` is declared twice in the one file (line {st['first']}); rename one: "
                                    f"two files' scopes cannot be merged otherwise")
                seen.setdefault(n, st["head"])
        for dup in oan["duplicates"]:
            problems.append(f"adopt: `{dup['name']}` is declared in two scopes of the one file")
        # no name now means another member than it did: a file's member keeps the names it used (a global stays a global,
        # a take stays the shell's name), compared member by member
        by_text = {}
        for st in orun["stmts"]:
            by_text.setdefault(st["text"], st)
        for fname, st in member_stmts:
            now = by_text.get(st["text"])
            if now is None:
                continue
            before = {r.get("name") or r.get("param") for r in st["refs"] if "index" in r or "param" in r}
            after = {r.get("name") or r.get("param") for r in now["refs"] if "index" in r or "param" in r}
            if before != after:
                problems.append(f"adopt: {fname}: `{st['head'][:50]}` refers to different top-level names in the one file: "
                                f"{sorted(before ^ after)}")
        return text, problems, ranges
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build(man: dict, text: str, work: Path) -> tuple[Plan, dict[str, str], str]:
    """Plan the split of `text` and make every file's text (nothing is written): (plan, {part file: text}, shell)."""
    plan = make_plan(man, text, work)
    if plan.refusals:
        raise Refusal("\n".join("  - " + r for r in plan.refusals))
    parts, drafts = {}, {}
    # the kit, checked the way the plan says: each part without its takes; tsc names what it cannot find
    for pi, part in enumerate(man["parts"]):
        draft = work / "draft" / (part["name"] + ".js")
        draft.parent.mkdir(exist_ok=True)
        t, _ = part_text(plan, pi, takes=set())
        draft.write_text(t)
        drafts[pi] = draft
    got = diagnostics(list(drafts.values()))
    declared = {n for m in plan.members.values() for n in m.d["names"]} | {r["param"] for m in plan.members.values()
                                                                             for r in m.d["refs"] if "param" in r}
    params = {p for sc in plan.an["scopes"] for p in sc["params"]}
    # a taken name that is also a browser global (CSS, Image, ...): tsc finds the global, so it never reports it missing
    lib = set(ask({"cmd": "lib_globals", "names": sorted(set().union(*plan.takes.values())), "globals": TYPES_D_TS})["names"])
    problems = []
    for pi, draft in drafts.items():
        d = got[str(draft.resolve())]
        if d["syntax"]:
            problems.append(f"{man['parts'][pi]['name']}: does not parse: {d['syntax'][0]}")
        missing = {u["name"] for u in d["unresolved"]}
        kit_by_tsc = (missing & (declared | params)) - {n for n in missing if n in plan.unresolved_before and n not in declared}
        kit_by_tsc |= plan.takes[pi] & lib
        stray = missing - declared - params - plan.unresolved_before
        if stray:
            problems.append(f"{man['parts'][pi]['name']}: tsc cannot find {sorted(stray)}, and the original shell cannot either")
        if kit_by_tsc != plan.takes[pi]:
            problems.append(f"{man['parts'][pi]['name']}: the references say the kit is {sorted(plan.takes[pi])}, "
                            f"tsc says {sorted(kit_by_tsc)}: differs by {sorted(kit_by_tsc ^ plan.takes[pi])}")
    if problems:
        raise Refusal("\n".join("  - " + p for p in problems))
    extra: dict[int, set[str]] = {}
    shell = None
    for attempt in range(3):
        shell = apply_edits(shell_text(plan, extra), man.get("shell_edits", []))
        probe = work / "shell-probe.js"
        probe.write_text(shell)
        miss = {u["name"] for u in diagnostics([probe])[str(probe.resolve())]["unresolved"]} - plan.unresolved_before
        moved_names = {n: m for m in plan.members.values() if m.part >= 0 for n in m.d["names"]}
        add = {n for n in miss if n in moved_names}
        if not add:
            if miss:
                raise Refusal(f"the new shell uses names tsc cannot find, and the original did not: {sorted(miss)}")
            break
        for n in add:
            m = moved_names[n]
            extra.setdefault(m.scope, set()).add(n)
            plan.gives[m.part].add(n)
    for pi, part in enumerate(man["parts"]):
        parts[part["name"] + ".js"], _ = part_text(plan, pi)
    return plan, parts, shell


def verify(plan: Plan, parts: dict[str, str], shell: str, work: Path) -> list[str]:
    """The proof: returns what disagrees (empty: proven)."""
    man = plan.man
    bad: list[str] = []
    out = work / "out"
    out.mkdir(exist_ok=True)
    # 1. moved members, text for text, in the part they went to
    for pi, part in enumerate(man["parts"]):
        f = out / (part["name"] + ".js")
        f.write_text(parts[part["name"] + ".js"])
        an = analyze(f, "part", None, man=man)
        have = {}
        for sc in an["scopes"]:
            for st in sc["stmts"]:
                if sc["name"] == "class":
                    have.setdefault("#" + str(st.get("method")), []).append(st["text"])
                    continue
                for n in st["names"] or [st["head"]]:
                    have.setdefault(n, []).append(st["text"])
        for m in (m for m in plan.members.values() if m.part == pi):
            for n in (["#" + str(m.d.get("method"))] if m.scope == plan.cs else (m.d["names"] or [m.d["head"]])):
                got = have.get(n, [])
                if got.count(m.d["text"]) != 1:
                    bad.append(f"{part['name']}: `{n.lstrip('#')}` is not the same text after the move")
    # 2. the statements that stayed, in the new shell (including the function handed to loadParts)
    f = out / "shell.js"
    f.write_text(shell)
    an = analyze(f, "shell", plan.run_in, cont=True, man=man)
    fresh = [st for sc in an["scopes"] for st in sc["stmts"]]
    fresh_all = list(fresh)
    hosts = {(sc["host"]["first"], sc["host"]["last"]) for sc in plan.an["scopes"] if sc["host"]}
    if plan.cs is not None:        # the class: its members came out, so it is compared by its first line, member by member
        hosts |= {(m.d["first"], m.d["last"]) for m in plan.members.values()
                  if m.scope != plan.cs and m.d["kind"] == "class" and m.d["names"] == [man["class"]]}
    edits = plan.man.get("shell_edits", [])
    for m in plan.members.values():
        if m.part >= 0:
            continue
        cands = {m.d["text"]}
        every = m.d["text"]
        for e in edits:
            ef, er = lstrip_lines(e["find"]), lstrip_lines(e["replace"])
            if ef in m.d["text"]:
                cands.add(m.d["text"].replace(ef, er))
            if ef in every:
                every = every.replace(ef, er)
        cands.add(every)
        if (m.d["first"], m.d["last"]) in hosts:      # a scope's host: its inside changed, its first line did not
            hit = next((st for st in fresh if st["head"] == m.d["head"] and st["kind"] == m.d["kind"]), None)
        else:
            hit = next((st for st in fresh if st["text"] in cands), None)
        if hit is None:
            bad.append(f"the shell: `{m.label}` (line {m.d['first']}) is not found after the split")
        else:
            fresh.remove(hit)
    # 3. nothing else is in the new shell but the generated statements
    generated = {"PARTS", "PARTS_TRIES", "partKey", "partsSettle", "loadParts", "kit", "runParts"} | (GENERATED_CLASS_MODE if man.get("class") else set()) \
        | ({"lates", "bindLate"} if man.get("live") else set())
    for st in fresh:
        names = set(st["names"])
        if not (names & generated or st["head"].startswith((CALL + "(", "runParts(", "partsReady.")) or
                (st["kind"] == "var" and names and names <= sum_takes(plan))):
            bad.append(f"the shell has a statement the plan did not put there: {st['head'][:70]}")
    # the shell's variables that parts bind late must call bindLate() wherever the shell assigns them
    if man.get("live"):
        live = set(man.get("live", []))
        writers = [m for m in plan.members.values() if any(w.get("name") in live for w in m.d["writes"])]
        for m in writers:
            texts = ([st["text"] for st in fresh_all if st["kind"] == "method" and st.get("method") == m.d.get("method")]
                     if m.scope == plan.cs else [st["text"] for st in fresh_all if st["names"] and st["names"] == m.d["names"]])
            if not texts or not all("bindLate()" in t for t in texts):
                bad.append(f"`{m.label}` assigns {sorted(live & {w.get('name') for w in m.d['writes']})}, so it must call bindLate() "
                           f"(a shell_edit in the manifest puts it in)")
    # 4. tsc: nothing missing that the original had
    diag = diagnostics([out / (p["name"] + ".js") for p in man["parts"]] + [f])
    for p in man["parts"]:
        d = diag[str((out / (p["name"] + ".js")).resolve())]
        if d["syntax"]:
            bad.append(f"{p['name']}: syntax: {d['syntax'][0]}")
        # (a name the original shell could not find either stays a global lookup in the part: the same, not a missing take)
        lost = {u["name"] for u in d["unresolved"]} - plan.unresolved_before
        if lost:
            bad.append(f"{p['name']}: tsc cannot find {sorted(lost)}")
    d = diag[str(f.resolve())]
    if d["syntax"]:
        bad.append(f"the shell: syntax: {d['syntax'][0]}")
    new = {u["name"] for u in d["unresolved"]} - plan.unresolved_before
    if new:
        bad.append(f"the shell: tsc cannot find {sorted(new)}")
    # 5. every part's takes are provided, in order
    have: set[str] = set(plan.shell_kit)
    for pi, part in enumerate(man["parts"]):
        lost = plan.takes[pi] - have
        if lost:
            bad.append(f"{part['name']}: takes {sorted(lost)} that nothing provides yet")
        have |= plan.gives[pi]
    for sc, names in plan.shell_takes.items():
        lost = names - have
        if lost:
            bad.append(f"the shell takes back {sorted(lost)} that no part hands back")
    return bad


def sum_takes(plan: Plan) -> set[str]:
    return set().union(*plan.shell_takes.values()) if plan.shell_takes else set()


def ts_counts(parts: dict[str, str], shell: str, work: Path) -> dict:
    """Which parts have no tsc error at all (they opt in with // @ts-check), and the fixtures to bring along."""
    out = work / "ts"
    out.mkdir(exist_ok=True)
    files = []
    for name, t in parts.items():
        f = out / name
        f.write_text(t)
        files.append(f)
    sf = out / "shell.js"
    sf.write_text(shell)
    diag = diagnostics(files + [sf])
    counts = {name: diag[str((out / name).resolve())]["total"] for name in parts}
    counts["__shell__"] = diag[str(sf.resolve())]["total"]
    return counts


def insert_near(items: list[str], new: str) -> list[str]:
    """`new` among the paths of its own tree, where Path order puts it (the others stay where they are)."""
    items = [x for x in items if x != new]
    key = lambda p: Path(p).parts  # noqa: E731
    same = [i for i, e in enumerate(items) if e.split("/")[0] == new.split("/")[0]]
    pos = next((i for i in same if key(items[i]) > key(new)), (same[-1] + 1) if same else len(items))
    return items[:pos] + [new] + items[pos:]


def update_fixtures(man: dict, counts: dict[str, int], opted: set[str]) -> None:
    """tests/fixtures/ts_check.json and tools/typecheck/baseline.json follow the new files (nothing else in them moves)."""
    folder = man["folder"].rstrip("/")
    new = {f"{folder}/{n}": c for n, c in counts.items() if n != "__shell__"}
    fx = json.loads(TS_FIXTURE.read_text())
    for p in new:
        fx["checked"] = [x for x in fx["checked"] if x != p]
        fx["unchecked_allowed"] = [x for x in fx["unchecked_allowed"] if x != p]
        which = "checked" if p.rsplit("/", 1)[1] in opted else "unchecked_allowed"
        fx[which] = insert_near(fx[which], p)
    TS_FIXTURE.write_text(json.dumps(fx, indent=1) + "\n")
    base = json.loads(TS_BASELINE.read_text())
    files = base["files"]
    files[man["shell"]] = counts["__shell__"]
    for p, c in new.items():
        if p in files:
            files[p] = c
        else:
            order = insert_near(list(files), p)
            files[p] = c
            files = {k: files[k] for k in order}
    base["files"] = files
    base["total"] = sum(files.values())
    TS_BASELINE.write_text(json.dumps(base, indent=1) + "\n")


def do_split(man: dict, p: Path, check_only: bool) -> int:
    shell_path = ROOT / man["shell"]
    text = shell_path.read_text()
    if is_split(text):
        return check_split(man, check_only=True)
    was = text
    if man.get("adopt"):         # the hand-split shell and its files, as the one file the split then cuts (adopt_text)
        text, bad, ranges = adopt_text(man)
        man["_adopted"] = ranges
        if bad:
            print(f"{man['name']}: the adopted file does not prove:")
            print("\n".join("  - " + b for b in bad))
            return 1
        print(f"{man['name']}: adopted {len(re.findall(r'hk-[a-z-]+[.]js', re.search(r'var ' + man['adopt'] + r' = [[][^]]*[]]', was).group(0)))} "
              f"hand-split files into the shell: {text.count(chr(10)) + 1} lines in one scope, every statement and member proven in place")
    work = Path(tempfile.mkdtemp(prefix="split_js-"))
    try:
        plan, parts, shell = build(man, text, work)
        bad = verify(plan, parts, shell, work)
        if bad:
            print(f"{man['name']}: the proof failed:")
            print("\n".join("  - " + b for b in bad))
            return 1
        moved = sum(1 for m in plan.members.values() if m.part >= 0)
        late = sum(1 for m in plan.members.values() if m.late)
        counts = ts_counts(parts, shell, work)
        opted = {n for n, c in counts.items() if n != "__shell__" and c == 0}
        for n in opted:
            pi = [k for k, q in enumerate(man["parts"]) if q["name"] + ".js" == n][0]
            parts[n], _ = part_text(plan, pi, check=True)
        sizes = {n: t.count("\n") for n, t in parts.items()}
        print(f"{man['name']}: {moved} members moved into {len(parts)} parts, {late} statements wait for them in the shell; "
              f"proven (each moved member's text is the same, nothing else is new, tsc finds no missing name)")
        for n, c in sizes.items():
            print(f"  {man['folder']}/{n:32s} {c:5d} lines   tsc errors {counts[n]}{'  (// @ts-check)' if n in opted else ''}")
        print(f"  {man['shell']:46s} {shell.count(chr(10)) + 1:5d} lines   (was {was.count(chr(10))})   tsc errors {counts['__shell__']}")
        if check_only:
            print("  --check: nothing written")
            return 0
        folder = ROOT / man["folder"]
        folder.mkdir(parents=True, exist_ok=True)
        for n, t in parts.items():
            (folder / n).write_text(t)
        shell_path.write_text(shell)
        blob = git("hash-object", "-w", "--stdin", input=text)
        man["source"] = {"blob": blob, "lines": text.count("\n")}
        if man.get("adopt"):        # (the one file was never a file of the repository: this is the commit it can be made from)
            man["source"]["adopt_from"] = git("rev-parse", "HEAD")
        saved = {k: v for k, v in man.items() if k not in ("name", "_adopted")}
        p.write_text(json.dumps(saved, indent=2, ensure_ascii=False) + "\n")
        update_fixtures(man, counts, opted)
        return 0
    except Refusal as err:
        print(f"{man['name']}: refused:\n{err}")
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


def check_split(man: dict, check_only: bool = True) -> int:
    """A split tree: the files still agree with the manifest."""
    shell_path = ROOT / man["shell"]
    text = shell_path.read_text()
    folder = ROOT / man["folder"]
    bad: list[str] = []
    listed = re.search(r"var PARTS = \[([^\]]*)\]", text)
    names = re.findall(r"'([^']+)\.js'", listed.group(1)) if listed else []
    if names != [p["name"] for p in man["parts"]]:
        bad.append(f"PARTS is {names}, the manifest says {[p['name'] for p in man['parts']]}")
    on_disk = sorted(f.stem for f in folder.glob("*.js"))
    if on_disk != sorted(names):
        bad.append(f"{man['folder']} holds {on_disk}, PARTS lists {sorted(names)}")
    block = text[text.find("  " + LOADER_BEGIN):text.find(LOADER_END) + len(LOADER_END) + 1] if LOADER_BEGIN in text else ""
    if not block.strip():
        bad.append("the shell has no loader block")
    else:
        want = loader_block(man, re.match(r" *", block).group(0))
        if block != want:
            bad.append("the shell's loader is not the template (tools/split_js.py loader_block)")
    work = Path(tempfile.mkdtemp(prefix="split_js-"))
    try:
        files = [folder / f"{n}.js" for n in names if (folder / f"{n}.js").is_file()]
        diag = diagnostics(files + [shell_path])
        # the kit: what each part takes must be put on K by the shell or an earlier part
        an = analyze(shell_path, "shell", man.get("run_in"), cont=True, man=man)
        kitn = kit_of(man)
        kit_keys = set(re.findall(r"^\s+(?:[\w$]+: [\w$]+,? ?)+$", text, re.M) and re.findall(r"([\w$]+): \1\b", text[text.find("function kit()"):text.find("function runParts")]))
        have = set(kit_keys)
        taken_back = set(re.findall(r"([\w$]+) = " + re.escape(kitn) + r"\.\1;", text[text.find("function runParts"):text.find(CALL + "(function")]))
        gives_all: set[str] = set()
        for n in names:
            f = folder / f"{n}.js"
            if not f.is_file():
                bad.append(f"{n}.js is missing")
                continue
            t = f.read_text()
            if not t.startswith("// " + n + ".js - "):
                bad.append(f"{n}.js does not begin with the part header")
            kq = re.escape(kitn)
            takes = set(re.findall(r"([\w$]+) = " + kq + r"\.\1\b", "".join(re.findall(r"^    var [^;]*;", t, re.M))))
            gives = set(re.findall(r"^\s*" + kq + r"\.([\w$]+) = \1;", t, re.M)) | set(re.findall(r" " + kq + r"\.([\w$]+) = \1;", t))
            lost = takes - have
            if lost:
                bad.append(f"{n}: takes {sorted(lost)} that neither the shell's kit nor an earlier part puts on K")
            have |= gives
            gives_all |= gives
            d = diag[str(f.resolve())]
            if d["syntax"]:
                bad.append(f"{n}: syntax: {d['syntax'][0]}")
            if d["unresolved"]:
                bad.append(f"{n}: tsc cannot find {sorted({u['name'] for u in d['unresolved']})}: add them to the part's takes "
                           f"(and the shell's kit)")
        if taken_back - gives_all:
            bad.append(f"the shell takes back {sorted(taken_back - gives_all)} that no part hands back")
        if (text.count("\n") and diag[str(shell_path.resolve())]["syntax"]):
            bad.append(f"the shell: syntax: {diag[str(shell_path.resolve())]['syntax'][0]}")
        # members are where the manifest says
        for part in man["parts"]:
            f = folder / (part["name"] + ".js")
            if not f.is_file():
                continue
            pan = analyze(f, "part", None, man=man)["scopes"]
            have_names = {n for st in pan[0]["stmts"] for n in st["names"]}
            have_heads = [st["head"] for st in pan[0]["stmts"] if not st["names"]]
            lost = [m for m in part["members"] if m not in have_names and not (m.startswith("@") and any(h.startswith(m[1:]) for h in have_heads))]
            if lost:
                bad.append(f"{part['name']}: the manifest lists {lost}, which the file does not declare at its top level")
            have_methods = {st["method"] for sc in pan[1:] if sc["name"] == "class" for st in sc["stmts"]}
            lost = [m for m in part.get("methods", []) if m not in have_methods]
            if lost:
                bad.append(f"{part['name']}: the manifest lists the methods {lost}, which the file's class does not have")
        shell_names = {n for sc in an["scopes"] for st in sc["stmts"] for n in st["names"]
                       if st["kind"] in ("function", "class") or (st["kind"] == "var" and st["init"])}
        back = [m for part in man["parts"] for m in part["members"] if m in shell_names and m not in ("kit",)]
        if back:
            bad.append(f"members the manifest moved are in the shell again: {back}")
        shell_methods = {st["method"] for sc in an["scopes"] if sc["name"] == "class" for st in sc["stmts"]}
        back = [m for part in man["parts"] for m in part.get("methods", []) if m in shell_methods]
        if back:
            bad.append(f"methods the manifest moved are in the shell's class again: {back}")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    note = ""
    if not bad:
        edited = edited_since(man)
        if edited is not None:
            note = (f"; {len(edited)} moved members were edited since the split ({', '.join(edited[:6])}{', ...' if len(edited) > 6 else ''})"
                    if edited else "; every moved member is still the text it was")
    if bad:
        print(f"{man['name']}: out of step with its manifest:")
        print("\n".join("  - " + b for b in bad))
        return 1
    print(f"{man['name']}: split into {len(names)} parts; the manifest, PARTS, the folder, the loader template and the kit agree; "
          f"tsc finds no missing name{note}")
    return 0


def edited_since(man: dict) -> list[str] | None:
    """The moved members whose code is no longer the original's (None: the original blob recorded in the manifest is gone).
    Comments, and the parentheses of a JSDoc cast, are not code: a part may be annotated for the type checker (phase 18, C1)
    and stay "the text it was"."""
    src = man.get("source") or {}
    blob = src.get("blob")
    had = bool(blob) and git("cat-file", "-t", blob) == "blob"
    from_commit = src.get("adopt_from")
    if not had and not (from_commit and git("cat-file", "-t", from_commit) == "commit"):
        return None
    work = Path(tempfile.mkdtemp(prefix="split_js-"))
    try:
        orig = work / "original.js"
        if had:
            orig.write_text(subprocess.run(["git", "cat-file", "blob", blob], capture_output=True, text=True, cwd=ROOT).stdout)
        else:        # an adopted file: made again from the commit it was made from (adopt_text, reading that commit's files)
            text, bad, _ = adopt_text(man, read=lambda rel: git("show", f"{from_commit}:{rel}"))
            if bad:
                return None
            orig.write_text(text)
        def named(an):
            out = {}
            for sc in an["scopes"]:
                for st in sc["stmts"]:
                    for n in (["#" + str(st.get("method"))] if sc["name"] == "class" else st["names"]):
                        out.setdefault(n, []).append(st["code"])
            return out
        was = named(analyze(orig, "shell", man.get("run_in"), man=man))
        edited = []
        for part in man["parts"]:
            f = ROOT / man["folder"] / (part["name"] + ".js")
            now = named(analyze(f, "part", None, man=man))
            edited += [n for n in part["members"] + ["#" + x for x in part.get("methods", [])]
                       if n in was and n in now and was[n] != now[n]]
        edited = [n.lstrip("#") for n in edited]
        return edited
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------------------------------------------ --report
GENERATED_NAMES = {"PARTS", "PARTS_TRIES", "partKey", "partsSettle", "loadParts", "kit", "runParts"} | GENERATED_CLASS_MODE


def report(path: Path, man: dict) -> dict:
    """What a manifest for `path` must respect, from the checker's view (phase 24, A2): the top-level members grouped by
    the variables they reassign. A member that assigns a variable, and every member that reads a variable someone
    assigns, are in that variable's group: a group moves whole or not at all (a copy through K would go stale). Not
    counted as reassignment: a split shell's take-backs from the kit (runParts, the bare `var a, b;` it fills) and a
    `var` local to a function (the analyzer's `hoisted` targets)."""
    an = analyze(path, "shell", man.get("run_in") or man.get("run_in_decl"), cont=is_split(path.read_text()), man=man)
    members = {}
    for sc in an["scopes"]:
        if sc["name"] == "cont":
            continue
        for st in sc["stmts"]:
            members[(st["scope"], st["index"])] = st
    gen = {k for k, st in members.items() if set(st["names"]) & GENERATED_NAMES or st.get("bare")
           or st["head"].startswith(CALL + "(")}
    parent = {k: k for k in members}

    def root(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def join(a, b):
        ra, rb = root(a), root(b)
        if ra != rb:
            parent[rb] = ra
    reassigned: dict[tuple, set[str]] = {}
    for k, st in members.items():
        if k in gen:
            continue
        for w in st["writes"]:
            if w.get("hoisted") or "index" not in w:
                continue
            tk = (w["scope"], w["index"])
            if tk == k or tk in gen or tk not in members:
                continue
            reassigned.setdefault(tk, set()).add(w["name"])
            join(tk, k)
    for k, st in members.items():
        if k in gen:
            continue
        for r in st["refs"]:
            tk = (r.get("scope"), r.get("index"))
            if tk in reassigned and r.get("name") in reassigned[tk] and not r.get("hoisted"):
                join(tk, k)
    groups: dict[tuple, list] = {}
    for k, st in members.items():
        if k not in gen:
            groups.setdefault(root(k), []).append(st)
    out = []
    for g, sts in groups.items():
        names = sorted({n for k2, ns in reassigned.items() if root(k2) == g for n in ns})
        sts.sort(key=lambda s: s["first"])
        out.append({"lines": sum(s["last"] - s["first"] + 1 for s in sts), "reassigned": names,
                    "members": [s["names"][0] if s["names"] else s["head"][:40] for s in sts],
                    "first": sts[0]["first"], "last": sts[-1]["last"]})
    out.sort(key=lambda g: -g["lines"])
    rows = [{"name": (s["names"][0] if s["names"] else s["head"][:60]), "kind": s["kind"], "first": s["first"],
             "lines": s["last"] - s["first"] + 1, "group": next(i for i, g in enumerate(out) if (s["names"][0] if s["names"] else s["head"][:40]) in g["members"]),
             "scope": an["scopes"][s["scope"]]["name"]}
            for k, s in sorted(members.items(), key=lambda kv: kv[1]["first"]) if k not in gen]
    return {"file": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path), "groups": out, "members": rows}


def print_report(rep: dict) -> None:
    gs = rep["groups"]
    single = [g for g in gs if not g["reassigned"]]
    print(f"{rep['file']}: {len(rep['members'])} top-level members in {len(gs)} groups "
          f"({len(single)} members touch no reassigned name: each moves on its own)")
    for i, g in enumerate(gs):
        if not g["reassigned"]:
            continue
        mem = ", ".join(g["members"][:12]) + (f", ... ({len(g['members'])} in all)" if len(g["members"]) > 12 else "")
        print(f"  group {i}: {g['lines']} lines, lines {g['first']}-{g['last']}, reassigns {', '.join(g['reassigned'][:20])}"
              f"{' ...' if len(g['reassigned']) > 20 else ''}\n    members: {mem}")


# ------------------------------------------------------------------------------------------------ the state rewrite
def state_rewrite(path: Path, man: dict, names: list[str], avoid: list[str] = ()) -> tuple[str, str]:
    """(rewritten text, the object's name): the listed top-level vars of the shell's scope as properties of one object,
    proved by running the rewrite backwards (split_js.cjs state / state_back). Raises Refusal."""
    text = path.read_text()
    req = {"file": str(path), "vars": names, "run_in": man.get("run_in") or man.get("run_in_decl"),
           "run_in_decl": bool(man.get("run_in_decl")), "iife": man.get("iife", 0), "avoid": list(avoid), "globals": TYPES_D_TS}
    got = ask({"cmd": "state", **req})
    if got["refusals"]:
        raise Refusal("\n".join("  - " + r for r in got["refusals"]))
    back = ask({"cmd": "state_back", **req, "original": text, "rewritten": got["text"], "obj": got["obj"],
                "markers": got["markers"], "count": got["count"]})
    if not back["equal"]:
        raise Refusal(f"the rewrite run backwards is not the original:\n--- original ...\n{back['a']}\n--- backwards ...\n{back['b']}")
    with tempfile.TemporaryDirectory(prefix="split_js-state-") as td:
        a, b = Path(td) / "a.js", Path(td) / "b.js"
        a.write_text(text)
        b.write_text(got["text"])
        d = diagnostics([a, b])
        before = {u["name"] for u in d[str(a.resolve())]["unresolved"]}
        after = {u["name"] for u in d[str(b.resolve())]["unresolved"]}
        if d[str(b.resolve())]["syntax"]:
            raise Refusal(f"the rewritten file does not parse: {d[str(b.resolve())]['syntax'][0]}")
        if after - before:
            raise Refusal(f"after the rewrite tsc cannot find {sorted(after - before)}")
    return got["text"], got["obj"]


def do_state(arg: str, names: list[str], write: bool) -> int:
    path = Path(arg).resolve()
    man: dict = {}
    for p in MANIFESTS.glob("*.json"):
        m = json.loads(p.read_text())
        if (ROOT / m["shell"]).resolve() == path:
            man = m
    try:
        text, obj = state_rewrite(path, man, names)
    except Refusal as err:
        print(f"{path.name}: the state rewrite is refused:\n{err}")
        return 1
    print(f"{path.name}: {len(names)} variables on `{obj}`; proven (the rewrite run backwards prints the original's syntax tree, "
          f"tsc finds no new missing name)")
    if write:
        path.write_text(text)
    else:
        print("  (nothing written: --write writes it)")
    return 0


def write_loaders() -> int:
    """Every split shell's loader block rewritten from the template (the template changed: phase 24's readiness promise).
    Only the text between the loader's two banner lines changes; the proof is test_web_sources.py's byte-for-byte pin and
    `--all --check`."""
    changed = 0
    for p in sorted(MANIFESTS.glob("*.json")):
        man = json.loads(p.read_text())
        man["name"] = p.stem
        shell = ROOT / man["shell"]
        text = shell.read_text()
        if not is_split(text):
            continue
        a = text.index(LOADER_BEGIN)
        a = text.rindex("\n", 0, a) + 1
        b = text.index(LOADER_END) + len(LOADER_END) + 1
        indent = re.match(r" *", text[a:]).group(0)
        new = text[:a] + loader_block(man, indent) + text[b:]
        if new != text:
            shell.write_text(new)
            changed += 1
            print(f"{man['shell']}: the loader rewritten from the template")
    print(f"{changed} loader(s) rewritten")
    return 0


def find(name: str) -> int:
    hits = 0
    for p in sorted(MANIFESTS.glob("*.json")):
        man = json.loads(p.read_text())
        man["name"] = p.stem
        shell = ROOT / man["shell"]
        if not is_split(shell.read_text()):
            files = [(shell, "shell", man.get("run_in"))]
        else:
            files = [(ROOT / man["folder"] / (q["name"] + ".js"), "part", None) for q in man["parts"]]
            files.append((shell, "shell", man.get("run_in")))
        for f, mode, run_in in files:
            an = analyze(f, mode, run_in, cont=(mode == "shell" and is_split(shell.read_text())), man=man)
            for sc in an["scopes"]:
                for st in sc["stmts"]:
                    if (name in st["names"] and not (st.get("takes") or st.get("bare"))) or (sc["name"] == "class" and st.get("method") == name):
                        what = "method" if sc["name"] == "class" else st["kind"]
                        print(f"{f.relative_to(ROOT)}:{st['first']}  {what} {name}   ({man['name']})")
                        hits += 1
    if not hits:
        print(f"{name}: not a top-level member or a method of any manifest's shell or parts")
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest", nargs="*", help="a manifest's name (tools/split_manifests/<name>.json) or path")
    ap.add_argument("--all", action="store_true", help="every manifest")
    ap.add_argument("--check", action="store_true", help="prove without writing; on a split tree, check the files still agree")
    ap.add_argument("--find", metavar="NAME", help="which part (or the shell) holds a top-level member")
    ap.add_argument("--report", metavar="FILE", help="the groups a manifest for FILE must keep whole (reassigned names)")
    ap.add_argument("--run-in", help="--report: the scope is the body of the function this file hands to NAME(...)")
    ap.add_argument("--run-in-decl", help="--report: the scope is the body of the function NAME declared in the IIFE")
    ap.add_argument("--iife", type=int, default=0, help="--report: which IIFE of the file (0-based)")
    ap.add_argument("--json", type=Path, help="--report: also write the groups and the members, one row each, as JSON here")
    ap.add_argument("--adopt-out", metavar="FILE", help="a manifest with \"adopt\": write the one file its hand-split shell and files are "
                                                       "(proven), for reading; needs the hand-split tree (or run it in an older commit)")
    ap.add_argument("--write-loaders", action="store_true", help="rewrite every split shell's loader from the template")
    ap.add_argument("--state", metavar="FILE", help="the state rewrite: --vars' top-level vars of FILE as one object's properties")
    ap.add_argument("--vars", help="--state: the variables, comma-separated (or @file with one per line)")
    ap.add_argument("--write", action="store_true", help="--state: write the rewritten file (else only the proof)")
    args = ap.parse_args(argv)
    if args.state:
        vs = Path(args.vars[1:]).read_text().split() if args.vars and args.vars.startswith("@") else (args.vars or "").split(",")
        return do_state(args.state, [v.strip() for v in vs if v.strip()], args.write)
    if args.write_loaders:
        return write_loaders()
    if args.find:
        return find(args.find)
    if args.report:
        man = {"run_in": args.run_in, "run_in_decl": args.run_in_decl, "iife": args.iife}
        for p in MANIFESTS.glob("*.json"):             # a split shell is read with its own manifest
            m = json.loads(p.read_text())
            if (ROOT / m["shell"]).resolve() == Path(args.report).resolve():
                man = m
        rep = report(Path(args.report).resolve(), man)
        print_report(rep)
        if args.json:
            args.json.write_text(json.dumps(rep, indent=1) + "\n")
        return 0
    if args.adopt_out:
        man, _ = load_manifest(args.manifest[0])
        text, bad, _ = adopt_text(man)
        print("\n".join("  - " + b for b in bad) or "proven")
        Path(args.adopt_out).write_text(text)
        return 1 if bad else 0
    names = [p.stem for p in sorted(MANIFESTS.glob("*.json"))] if args.all else args.manifest
    if not names:
        ap.error("name a manifest, or --all")
    rc = 0
    for n in names:
        man, p = load_manifest(n)
        rc |= do_split(man, p, args.check)
    return rc


if __name__ == "__main__":
    sys.exit(main())
