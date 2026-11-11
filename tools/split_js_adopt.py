"""split_js.py's adopt: a shell with a hand-written loader and its files, merged into one file for the ordinary split (moved here by tools/split_py.py from tools/split_js.py:
tools/split_py_manifests/split_js.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from split_js_names import ADOPT_LOADER, ROOT
from split_js_analysis import analyze, kit_of, reindent


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
