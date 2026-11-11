"""split_js.py's the proofs and the commands that run them: build, verify, the split, and --check on a split tree (moved here by tools/split_py.py from tools/split_js.py:
tools/split_py_manifests/split_js.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from split_js_names import (CALL, GENERATED_CLASS_MODE, LOADER_BEGIN, LOADER_END, Refusal, ROOT, TS_BASELINE,
    TS_FIXTURE, TYPES_D_TS,)
from split_js_analysis import analyze, ask, diagnostics, kit_of, loader_block, lstrip_lines, Plan
from split_js_plan import make_plan
from split_js_writers import apply_edits, git, is_split, part_text, shell_text
from split_js_adopt import adopt_text


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
    lib = set(ask({"cmd": "lib_globals", "names": sorted(set().union(*plan.takes.values(), *plan.ahead.values())),
                   "globals": TYPES_D_TS})["names"])
    problems = []
    for pi, draft in drafts.items():
        d = got[str(draft.resolve())]
        if d["syntax"]:
            problems.append(f"{man['parts'][pi]['name']}: does not parse: {d['syntax'][0]}")
        missing = {u["name"] for u in d["unresolved"]}
        kit_by_tsc = (missing & (declared | params)) - {n for n in missing if n in plan.unresolved_before and n not in declared}
        kit_by_tsc |= (plan.takes[pi] | plan.ahead[pi]) & lib
        stray = missing - declared - params - plan.unresolved_before
        if stray:
            problems.append(f"{man['parts'][pi]['name']}: tsc cannot find {sorted(stray)}, and the original shell cannot either")
        want = plan.takes[pi] | plan.ahead[pi]
        if kit_by_tsc != want:
            problems.append(f"{man['parts'][pi]['name']}: the references say the kit is {sorted(want)}, "
                            f"tsc says {sorted(kit_by_tsc)}: differs by {sorted(kit_by_tsc ^ want)}")
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
    for pi, part in enumerate(man["parts"]):
        later = set().union(*(plan.gives[j] for j in range(pi + 1, len(man["parts"])))) if pi + 1 < len(man["parts"]) else set()
        lost = plan.ahead[pi] - later
        if lost:
            bad.append(f"{part['name']}: binds {sorted(lost)} ahead, which no later part hands back")
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
        if plan.unresolved_before:     # (names the original could not find either, a global lookup there and in the part)
            man["source"]["unresolved"] = sorted(plan.unresolved_before)
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
            lost_names = {u["name"] for u in d["unresolved"]} - set((man.get("source") or {}).get("unresolved", []))
            if lost_names:
                bad.append(f"{n}: tsc cannot find {sorted(lost_names)}: add them to the part's takes "
                           f"(and the shell's kit)")
        if taken_back - gives_all:
            bad.append(f"the shell takes back {sorted(taken_back - gives_all)} that no part hands back")
        # (bind_ahead) a later part's names a part binds once every part has run: a later part hands each back
        given_by = {n: set(re.findall(r"^\s*" + re.escape(kitn) + r"\.([\w$]+) = \1;", (folder / f"{n}.js").read_text(), re.M)) |
                       set(re.findall(r" " + re.escape(kitn) + r"\.([\w$]+) = \1;", (folder / f"{n}.js").read_text()))
                    for n in names if (folder / f"{n}.js").is_file()}
        for i, n in enumerate(names):
            f = folder / f"{n}.js"
            if not f.is_file():
                continue
            m_ah = re.search(re.escape(kitn) + r"\.ahead\.push\(function \(\) \{(.*?)\}\);", f.read_text(), re.S)
            if not m_ah:
                continue
            want = set(re.findall(r"([\w$]+) = " + re.escape(kitn) + r"\.\1;", m_ah.group(1)))
            later = set().union(*(given_by.get(x, set()) for x in names[i + 1:]))
            if want - later:
                bad.append(f"{n}: binds {sorted(want - later)} ahead, which no later part hands back")
            if (kitn + ".ahead.forEach(") not in text:
                bad.append(f"{n} binds names ahead, and the shell's runParts never runs K.ahead")
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
