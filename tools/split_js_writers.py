"""split_js.py's the writers: the parts' text, the shell's text, and the manifest and git helpers (moved here by tools/split_py.py from tools/split_js.py:
tools/split_py_manifests/split_js.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from split_js_names import CALL, LOADER_BEGIN, MANIFESTS, PART_HEADER, Refusal, ROOT
from split_js_analysis import by_name, commas, kit_of, loader_block, Member, pack, Plan, reindent
from split_js_plan import code_scopes, is_tail_return


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
    draft = takes is not None              # (build's draft, without its takes: tsc names what the kit must hold)
    takes = plan.takes[pi] if takes is None else takes
    if takes:
        out += take_lines(by_name(takes), kit)
        out.append("")
    ahead = by_name(plan.ahead.get(pi, ()))
    if ahead and not draft:
        out += pack(commas(ahead), "    var ", "        ")
        out += ["    // (of later parts, used when called: bound once every part has run, runParts)",
                f"    {kit}.ahead.push(function () {{"] + pack([f"{n} = {kit}.{n};" for n in ahead], "      ", "      ") + ["    });", ""]
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
    if any(plan.ahead.values()):
        entries += ["ahead: []"]
    kit += pack(commas(entries, last=""), ind2 + "  ", ind2 + "  ")
    kit += [f"{ind2}}};", f"{ind}}}"]
    back_all = by_name(set().union(*takes.values()) if takes else set())
    run = [f"{ind}function runParts() {{", f"{ind2}var {kitn} = kit();",
           f"{ind2}PARTS.forEach(function (file) {{ window.{man['global']}[partKey(file)]({kitn}); }});"]
    if any(plan.ahead.values()):
        run.append(f"{ind2}{kitn}.ahead.forEach(function (bind) {{ bind(); }});   // (the later parts' names each part uses)")
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
