#!/usr/bin/env python3
"""Cut a big web JavaScript file into parts, by name, and prove nothing but the place changed (phase 18, Part B;
docs/phase18/CODE-HEALTH.md "Part B: split the four files").

    tools/split_js.py grid-cards              # split web/hk/cards/hk-grid-cards.js as tools/split_manifests/grid-cards.json says
    tools/split_js.py grid-cards --check      # unsplit: the whole proof, nothing written; split: the files still agree with it
    tools/split_js.py --find roomParts        # which part (or shell) holds a member, for a session porting an edit
    tools/split_js.py --all --check           # every manifest, and every ready one (below)
    tools/split_js.py settings --regroup --write  # a class-method part cut into the parts its manifest now lists

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
EXPORTS OBJECTS (phase 25, the screensaver, which no longer binds ahead): the shell's kit makes an empty object per
part that an earlier part calls (`Run: {}`), the part fills it as it runs (`Run.start = start`), and an earlier part
calls `Run.start()` when it is called, never as it runs. The check takes `Name: {}` as a kit entry.
BIND AHEAD (`"bind_ahead": true`, any shell; the screensaver, 2026-11-11): a part's member may use a LATER part's member
when it is called (parts whose features call each other both ways). The part declares the name (`var late;`) and pushes
a binder on K.ahead (`late = K.late;`); runParts runs every binder once all the parts have run, before the shell takes
its names back. Refused: a part's statement that runs while the parts run (not a declaration) and reaches, through what it
calls, a member that uses such a name, a statement that waits, or a shell member that uses a moved one. The proof checks
that tsc's missing names in each draft part are its takes and its ahead names, and that a later part hands each back.
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

READY MANIFESTS (phase 25, Part E): a file near the size limit (tests/test_file_sizes.py "Near the size limit") gets its manifest
BEFORE it needs it, in tools/split_manifests/ready/<name>.json, proven by `split_js.py <name> --check` on the unsplit file
(`--all --check` proves them too, and `--all` alone never splits one). Nothing else that reads tools/split_manifests/*.json
sees them: they name an unsplit shell. Re-run `--check` when the file has changed a lot; a refusal says what moved. When the
file crosses the limit, `split_js.py <name>` splits it and moves the manifest up to tools/split_manifests/.

Node: $NODE, else node on the PATH.
"""
from __future__ import annotations

import argparse
import json
import os  # noqa: F401 -- its parts use it (tools/split_py.py)
import re  # noqa: F401 -- its parts use it (tools/split_py.py)
import shutil  # noqa: F401 -- its parts use it (tools/split_py.py)
import subprocess  # noqa: F401 -- its parts use it (tools/split_py.py)
import sys
import tempfile  # noqa: F401 -- its parts use it (tools/split_py.py)
from dataclasses import dataclass, field  # noqa: F401 -- its parts use it (tools/split_py.py)
from pathlib import Path

if str(Path(__file__).resolve().parent) not in sys.path:   # (tools/split_py.py, flat siblings)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
from split_js_names import (ADOPT_LOADER, CALL, GENERATED_CLASS_MODE, GENERATED_NAMES, HELPER, LOADER, LOADER_BEGIN,  # noqa: F401 -- tools/split_py.py
    LOADER_END, MANIFESTS, MUTATORS, NO_WAIT_README, PART_HEADER, READY, READY_LINES, READY_README, Refusal, ROOT,  # noqa: F401 -- tools/split_py.py
    TS_BASELINE, TS_FIXTURE, TYPES_D_TS, WIDTH,)  # noqa: F401 -- tools/split_py.py
from split_js_analysis import (analyze, ask, by_name, codes, commas, diagnostics, kit_of, loader_block, lstrip_lines,  # noqa: F401 -- tools/split_py.py
    Member, node, pack, parts_list, Plan, reindent,)  # noqa: F401 -- tools/split_py.py
from split_js_plan import (class_scope, code_scopes, is_tail_return, make_plan, mutated, mutated_anywhere, now_text,  # noqa: F401 -- tools/split_py.py
    reaches, state_object, target_key,)  # noqa: F401 -- tools/split_py.py
from split_js_writers import (apply_edits, git, hand_back_lines, is_split, load_manifest, part_text, shell_text,  # noqa: F401 -- tools/split_py.py
    splice, take_lines,)  # noqa: F401 -- tools/split_py.py
from split_js_adopt import adopt_text  # noqa: F401 -- tools/split_py.py
from split_js_proofs import (build, check_split, do_split, edited_since, insert_near, sum_takes, ts_counts,  # noqa: F401 -- tools/split_py.py
    update_fixtures, verify,)  # noqa: F401 -- tools/split_py.py
from split_js_state import do_state, find, print_report, report, state_rewrite, write_loaders  # noqa: F401 -- tools/split_py.py


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
    ap.add_argument("--write", action="store_true", help="--state, --regroup: write (else only the proof)")
    ap.add_argument("--regroup", action="store_true",
                    help="a class-method split: move methods to the parts the manifest now lists them in (split_js_regroup.py)")
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
    if args.regroup:
        from split_js_regroup import regroup
        man, p = load_manifest(args.manifest[0])
        folder = ROOT / man["folder"]
        kept = {f: f.read_text() for f in folder.glob("*.js")} | {ROOT / man["shell"]: (ROOT / man["shell"]).read_text()}
        bad = regroup(man, args.write)
        for b in bad:
            print("  - " + b)
        if bad or not args.write:
            return 1 if bad else 0
        write_loaders()
        if do_split(man, p, True):          # the structural check fails: every file back as it was
            for f in set(folder.glob("*.js")) - set(kept):
                f.unlink()
            for f, t in kept.items():
                f.write_text(t)
            print(f"{man['name']}: the regrouped split did not check; every file is as it was")
            return 1
        return 0
    if args.adopt_out:
        man, _ = load_manifest(args.manifest[0])
        text, bad, _ = adopt_text(man)
        print("\n".join("  - " + b for b in bad) or "proven")
        Path(args.adopt_out).write_text(text)
        return 1 if bad else 0
    names = [p.stem for p in sorted(MANIFESTS.glob("*.json"))] if args.all else args.manifest
    ready = [p.stem for p in sorted(READY.glob("*.json"))] if args.all else []
    if not names:
        ap.error("name a manifest, or --all")
    rc = 0
    for n in names:
        man, p = load_manifest(n)
        rc |= do_split(man, p, args.check)
    for n in ready:                      # (--all never splits a file that is only ready: it is proven, nothing written)
        man, p = load_manifest(n)
        rc |= do_split(man, p, True)
    return rc


if __name__ == "__main__":
    sys.exit(main())
