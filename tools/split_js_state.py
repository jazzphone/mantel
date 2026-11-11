"""split_js.py's --report, the state rewrite, --write-loaders and --find (moved here by tools/split_py.py from tools/split_js.py:
tools/split_py_manifests/split_js.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from split_js_names import CALL, GENERATED_NAMES, LOADER_BEGIN, LOADER_END, MANIFESTS, Refusal, ROOT, TYPES_D_TS
from split_js_analysis import analyze, ask, diagnostics, loader_block
from split_js_writers import is_split


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
