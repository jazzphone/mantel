"""split_js.py's the plan: which member goes to which part, what the kit takes and hands back, and what is refused (moved here by tools/split_py.py from tools/split_js.py:
tools/split_py_manifests/split_js.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import re
from pathlib import Path
from split_js_names import GENERATED_CLASS_MODE, MUTATORS
from split_js_analysis import analyze, diagnostics, Member, Plan


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
        if m.d["kind"] == "class" and man.get("class"):    # (class mode: the class the parts add methods to is there at once)
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
        plan.takes[pi], plan.gives[pi], plan.live[pi], plan.ahead[pi] = set(), set(), set(), set()
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
                if tpart > m.part and man.get("bind_ahead") and not mutable:
                    # (2026-11-11, bind_ahead) a later part's name, used when a function is called: the part has a var of
                    # its own, bound once every part has run (runParts: K.ahead). Nothing that runs while the parts run may
                    # reach it: refused below
                    plan.ahead[m.part].add(name)
                    plan.ahead_users.add(m.key)
                    plan.gives[tpart].add(name)
                    continue
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
    # (2026-11-11, bind_ahead) WHILE THE PARTS RUN, a part's statement that runs at once (not a declaration) must not reach,
    # through what it calls (its callbacks' and IIFEs' too), a member that uses a later part's name (bound only once every
    # part has run), a member of the shell that uses a moved one (taken back then too), or a statement that waits
    if man.get("bind_ahead"):
        for m in sorted(plan.members.values(), key=lambda x: (x.scope, x.index)):
            if m.part < 0 or m.scope == plan.cs or m.d["kind"] in ("function", "directive"):
                continue
            seen, stack = set(), [(m.key, [m.label])]
            if m.d["kind"] == "class":
                # (the review) a class runs what it is defined with -- `extends X`, a static field or block, a computed key:
                # its references that run now, not its methods'
                seen.add(m.key)
                stack = [((r["scope"], r["index"]), [m.label, r.get("name")]) for r in m.d["refs"] if "index" in r and r.get("now")]
                for r in m.d["refs"]:
                    t = by_key.get((r["scope"], r["index"])) if "index" in r else None
                    if r.get("now") and t is not None and t.part > m.part:
                        plan.refusals.append(f"{man['parts'][m.part]['name']}: `{m.label}` (line {m.d['first']}) uses `{r.get('name')}` "
                                             f"of the later part {man['parts'][t.part]['name']} as it is defined, while the parts run")
            while stack:
                key, via = stack.pop()
                tgt = by_key.get(key)
                if tgt is None or tgt.key in seen:
                    continue
                seen.add(tgt.key)
                why = None
                if tgt.key in plan.ahead_users:
                    why = "uses a later part's name, bound only once every part has run"
                elif tgt.late and tgt.d["kind"] != "function":
                    why = "waits for the parts"
                elif tgt.part < 0 and tgt is not m and any(
                        (t := by_key.get((r["scope"], r["index"]))) is not None and t.part >= 0 for r in tgt.d["refs"] if "index" in r):
                    why = "is the shell's and uses a moved member, taken back only once every part has run"
                if why:
                    plan.refusals.append(f"{man['parts'][m.part]['name']}: `{m.label}` (line {m.d['first']}) runs while the parts run "
                                         f"and reaches `{tgt.label}`, which {why} (through {' -> '.join(via)})")
                    continue
                if tgt is m or tgt.d["kind"] == "function":
                    stack += [((r["scope"], r["index"]), via + [r.get("name")]) for r in tgt.d["refs"] if "index" in r]
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
