#!/usr/bin/env python3
"""Cut a big Python module into parts, by name, and prove nothing but the place changed (phase 24, A3:
docs/phase24/CLEAN-CODE.md). The Python twin of tools/split_js.py.

    tools/split_py.py model             # split as tools/split_py_manifests/model.json says
    tools/split_py.py model --check     # the whole proof, nothing written
    tools/split_py.py --find NAME       # which file holds a top-level name, for a session porting an edit

TWO SHAPES (the manifest's "mode"):
  * "package": hk_core/settings/model.py becomes hk_core/settings/model/ -- an __init__.py that imports every name of the
    old module back, explicitly (no `*`; all of them in __all__, so ruff's F401 stays where it was), and one submodule per
    part. Every top-level statement goes to a part (a part with "rest": true takes what no part names). The parts run in
    the manifest's order and each imports from earlier ones only, by name.
  * "siblings": hosts/server/mantel_server/music.py stays a module; the parts become sibling modules (music_<name>.py)
    it imports back. A name a test monkeypatches stays where its readers are (below), so a part may use only its own
    imports and earlier parts, never the module it came from.

  * "siblings" with "flat": true (tools/split_js.py; tools/ is no package, its scripts run as `python tools/x.py` and tests load them
    by file path): the parts are imported by their plain names (`from split_js_names import ...`), and the module that stays puts
    its own folder on sys.path first, so the import works however the module was loaded. The proof imports it by its plain name.

LAZY PACKAGES (the manifest's "lazy": true, package mode only; hk_core/settings/model.py): parts that call each other in
every direction. The parts are ordered by what must be there WHILE THE MODULE LOADS (the tables, what mutates them, a
constant built from another), and a call a function makes to a later part is resolved when it is called: the tool writes
`from .<part> import <names>` as the first statement of each such function (after its docstring), nothing else changes.
  * the names a part claims: "members" (by name) and "lines": [[first, last], ...] (the named statements that begin there);
  * a statement that only changes a name (`X[k] = ...`, `X += ...`, `X.update(...)`) goes with the part that defines X;
  * import time reaches further than the statement: a def or class it reads may be called as the module loads, so what that
    reads counts too; so does a lambda made then (there is no place in it for a late import). Any such read of a later part,
    and an import-time read with a binder of the name later in the file, is refused;
  * proof, beyond the below: each function's syntax tree, with the inserted leading imports taken out, is the original's, and
    those imports are exactly the ones the plan lists, each from a part that defines the name; no file reads a name nothing in
    it defines or imports (a late import left out); and every value the module builds as it loads (not functions or classes)
    has the same repr in the package as in the module (PYTHONHASHSEED=0, so a set or dict built the same way reads the same).

WHAT IT REFUSES (and says so, naming the statement):
  * a part that uses a name of a later part, or (siblings) of the module that stays;
  * a name bound in two parts (an `X += ...`, a second `X = ...`, `X[k] = ...` or `X.append(...)` at the top level is a
    binder of X: every binder of a name is in the part that defines it);
  * a statement that reads a name AT IMPORT TIME (outside a function body) from another part while a binder of that name
    comes later in the file: it would see the final value where it saw an earlier one;
  * a name a test monkeypatches separated from the code that reads it (read from the tests: `monkeypatch.setattr(M,
    "NAME", ...)`; a patch through a variable, as `for name, value in ...: setattr(M, name, value)`, counts as patching
    every upper-case name of the module, the cautious reading). A PACKAGE refuses any patched name something reads: a patch
    on `import pkg.mod as M` sets the package's attribute, and the parts read their own;
  * a statement that is not a def, class, import, assignment or docstring and has no named statement before it (an
    unnamed statement -- a call, an `if` -- goes with the named one before it).

THE PROOF:
  * every moved statement's `ast.dump` is identical in its new place (a relative import inside it is compared with its
    level taken from where it now sits: the package's parts are one level deeper);
  * importing the package (or the module) gives the same set of names as the old module, and every name `is` the same
    object read through the package as through the submodule that holds it;
  * the parts import only earlier parts (static), and the package imports without a cycle;
  * mypy is the gate's (tools/typecheck/py_check.py: the same total, no file above what it carried; the slice moves the
    old module's error counts to the files that now have them).
Names are found with Python's own symbol tables (symtable), so a local variable never passes for a module name.
"""
from __future__ import annotations

import argparse
import ast
import builtins
import copy
import json
import os
import re
import shutil
import subprocess
import symtable
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = ROOT / "tools/split_py_manifests"
PY = sys.executable


class Refusal(Exception):
    pass


# ------------------------------------------------------------------------------------------------ the analysis
@dataclass
class Stmt:
    index: int
    node: ast.stmt
    first: int                      # 1-based, comments above it included
    last: int
    names: list[str]                # what it defines (def, class, assignment target, import alias)
    binds: set[str]                 # what it binds or mutates at the top level (names + X += / X[k] = / X.f(...))
    now: set[str] = field(default_factory=set)        # module names read at import time
    later: set[str] = field(default_factory=set)      # module names read inside a function body
    lam: set[str] = field(default_factory=set)        # module names read in a lambda that is made at import time
    sites: list = field(default_factory=list)         # (function node, module names it reads): where a late import can go
    kind: str = ""
    part: int = -1


def target_names(t: ast.expr, out: list[str]) -> None:
    if isinstance(t, ast.Name):
        out.append(t.id)
    elif isinstance(t, (ast.Tuple, ast.List)):
        for e in t.elts:
            target_names(e, out)
    elif isinstance(t, ast.Starred):
        target_names(t.value, out)


def base_name(e: ast.expr) -> str | None:
    while isinstance(e, (ast.Attribute, ast.Subscript)):
        e = e.value
    return e.id if isinstance(e, ast.Name) else None


def defined(node: ast.stmt) -> tuple[list[str], set[str], str]:
    """(names it defines, names it binds or mutates, its kind)."""
    names: list[str] = []
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name], {node.name}, "def"
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        for a in node.names:
            if a.name == "*":
                raise Refusal(f"line {node.lineno}: `import *` hides which names it brings")
            names.append(a.asname or a.name.split(".")[0])
        return names, set(names), "import"
    if isinstance(node, ast.Assign):
        binds: set[str] = set()
        for t in node.targets:
            target_names(t, names)
            b = base_name(t) if not isinstance(t, (ast.Name, ast.Tuple, ast.List)) else None
            if b:
                binds.add(b)
        return names, set(names) | binds, "assign"
    if isinstance(node, ast.AnnAssign):
        target_names(node.target, names)
        b = base_name(node.target) if not isinstance(node.target, ast.Name) else None
        return names, set(names) | ({b} if b else set()), "assign"
    if isinstance(node, ast.AugAssign):
        b = base_name(node.target)
        return [], {b} if b else set(), "augassign"
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
        return [], set(), "docstring"
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute):
        b = base_name(node.value.func.value)
        return [], {b} if b else set(), "call"
    return [], set(), "other"


def free_globals(table: symtable.SymbolTable) -> set[str]:
    """The names a function (and everything inside it) reads from the module."""
    out = {s.get_name() for s in table.get_symbols() if s.is_global() and s.is_referenced()}
    for c in table.get_children():
        out |= free_globals(c)
    return out


def import_time_lambda_reads(node: ast.AST) -> set[str]:
    """The names read in the body of a lambda that is made while the module loads (not inside a function body): the
    lambda runs later, but there is no place in it for a late import, so these count as import-time reads."""
    out: set[str] = set()

    def visit(n: ast.AST) -> None:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for x in n.decorator_list + n.args.defaults + [d for d in n.args.kw_defaults if d is not None]:
                visit(x)
            return                                   # its body runs when it is called: a late import can go there
        if isinstance(n, ast.Lambda):
            own = {a.arg for a in n.args.args + n.args.posonlyargs + n.args.kwonlyargs}
            own |= {a.arg for a in (n.args.vararg, n.args.kwarg) if a}
            out.update(x.id for x in ast.walk(n.body) if isinstance(x, ast.Name) and isinstance(x.ctx, ast.Load)
                       and x.id not in own)
            for x in n.args.defaults + [d for d in n.args.kw_defaults if d is not None]:
                visit(x)
            return
        for c in ast.iter_child_nodes(n):
            visit(c)
    visit(node)
    return out


def find_table(tables: list, name: str, lineno: int):
    return next((c for c in tables if c.get_name() == name and c.get_lineno() == lineno), None)


def collect_sites(node: ast.stmt, table: symtable.SymbolTable, module_names: set[str], out: list) -> None:
    """The functions of a def or class a late import can go in -- the def itself, or each method of a class (a function inside
    a function is covered by the outer one) -- each with the module names it (and what is inside it) reads, from the symbol
    table, so a local of the same name never counts."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        out.append((node, free_globals(table) & module_names))
        return
    kids = table.get_children()
    for b in node.body:
        if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            t = find_table(kids, b.name, b.lineno)
            if t is None:
                raise Refusal(f"line {b.lineno}: no symbol table for `{b.name}`")
            collect_sites(b, t, module_names, out)


def analyze(text: str, filename: str) -> list[Stmt]:
    tree = ast.parse(text, filename)
    lines = text.split("\n")
    module_names: set[str] = set()
    stmts: list[Stmt] = []
    prev_end = 0
    for i, node in enumerate(tree.body):
        first = getattr(node, "decorator_list", None) and min(d.lineno for d in node.decorator_list) or node.lineno
        # the comment lines right above it go with it (not past a blank line or the previous statement)
        k = first                                  # (1-based: lines[k - 1] is the statement's first line)
        while k - 1 > prev_end and lines[k - 2].lstrip().startswith("#"):
            k -= 1
        names, binds, kind = defined(node)
        stmts.append(Stmt(i, node, k, node.end_lineno, names, binds, kind=kind))
        module_names.update(names)
        prev_end = node.end_lineno
    top = symtable.symtable(text, filename, "exec")
    children = top.get_children()
    for st in stmts:
        n = st.node
        # import time: the names read in the statement outside function bodies (a class body runs at once)
        deferred_spans = []
        for sub in ast.walk(n):
            if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)) and sub is not n:
                deferred_spans.append(sub)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            deferred_spans.append(n)
        in_def = set()
        for d in deferred_spans:
            body = d.body if isinstance(d.body, list) else [d.body]
            for b in body:
                for x in ast.walk(b):
                    in_def.add(id(x))
            # (a function's defaults and decorators run at once; its arguments' annotations too, for mypy)
        for sub in ast.walk(n):
            if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load) and sub.id in module_names and id(sub) not in in_def:
                st.now.add(sub.id)
            if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load) and sub.id in module_names and id(sub) in in_def:
                st.later.add(sub.id)
        st.lam = {x for x in import_time_lambda_reads(n) if x in module_names}
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            table = find_table(children, n.name, n.lineno)
            if table is None:
                raise Refusal(f"line {n.lineno}: no symbol table for `{n.name}`")
            collect_sites(n, table, module_names, st.sites)
        # a function's body: what its symbol table says it reads from the module (never one of its own locals)
        if st.later:
            got: set[str] = set()
            for c in children:
                if st.first <= c.get_lineno() <= st.last:
                    got |= free_globals(c)
            st.later &= got | set()
        # (string annotations are not read: `from __future__ import annotations` makes every annotation a string)
    return stmts


# ------------------------------------------------------------------------------------------------ the plan
@dataclass
class Plan:
    man: dict
    text: str
    stmts: list[Stmt]
    owner: dict[str, int]           # name -> the part that defines it (-1: stays, siblings mode)
    uses: dict[int, set[str]]       # part -> names it takes from other parts (or, in package mode, imports it keeps)
    refusals: list[str]
    lazy: dict[int, list] = field(default_factory=dict)   # lazy mode: statement index -> [(function node, {part: names})]


def patched_names(module_dotted: str, stmts: list[Stmt]) -> set[str]:
    """Names the tests monkeypatch on this module (a patch through a variable: every upper-case name)."""
    out: set[str] = set()
    short = module_dotted.rsplit(".", 1)[-1]
    upper = {n for st in stmts for n in st.names if n.isupper()}
    for f in list((ROOT / "tests").rglob("test_*.py")) + list((ROOT / "hosts").rglob("test_*.py")):
        if "node_modules" in f.parts:
            continue
        t = f.read_text(errors="replace")
        if module_dotted not in t and f"import {short}" not in t and f"{short} as" not in t:
            continue
        aliases = set(re.findall(r"(?:from [\w.]+ )?import [\w.]*?\b" + re.escape(short) + r"\b(?: as (\w+))?", t))
        aliases = {a or short for a in aliases} | {short}
        for a in aliases:
            for m in re.finditer(r"setattr\(\s*" + re.escape(a) + r"\s*,\s*([^,\)]+)", t):
                arg = m.group(1).strip()
                if re.fullmatch(r"[\"'](\w+)[\"']", arg):
                    out.add(arg[1:-1])
                else:
                    # a patch through a loop variable whose loop names its values literally (test_music.py: `for name,
                    # value in (("START_TIMEOUT", 1.0), ...)`): exactly those names; any other variable: every upper-case name
                    lit = loop_literals(t, arg, m.start())
                    out |= lit if lit is not None else upper
    return out


def loop_literals(text: str, var: str, at: int) -> set[str] | None:
    """The string names a `for <var>[, ...] in <literal tuple or list>:` just before position `at` gives `var`, else None."""
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None
    line = text.count("\n", 0, at) + 1
    best = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.For, ast.AsyncFor)) and node.lineno <= line <= (node.end_lineno or node.lineno):
            tgt = node.target
            names = [tgt] if isinstance(tgt, ast.Name) else list(tgt.elts) if isinstance(tgt, ast.Tuple) else []
            pos = [i for i, n in enumerate(names) if isinstance(n, ast.Name) and n.id == var]
            if not pos or not isinstance(node.iter, (ast.Tuple, ast.List)):
                continue
            got = set()
            for el in node.iter.elts:
                v = el.elts[pos[0]] if isinstance(el, (ast.Tuple, ast.List)) and isinstance(tgt, ast.Tuple) else el
                if not (isinstance(v, ast.Constant) and isinstance(v.value, str)):
                    got = None
                    break
                got.add(v.value)
            if got is not None:
                best = got
    return best


def make_plan(man: dict, text: str) -> Plan:
    stmts = analyze(text, man["module"])
    mode = man.get("mode", "package")
    lazy = bool(man.get("lazy"))
    refusals: list[str] = []
    if lazy and mode != "package":
        refusals.append("\"lazy\" is for a package (its parts import each other, which a module that stays cannot)")
    by_name: dict[str, list[Stmt]] = {}
    for st in stmts:
        for n in st.names:
            by_name.setdefault(n, []).append(st)
    rest = [i for i, p in enumerate(man["parts"]) if p.get("rest")]
    if mode == "package" and len(rest) != 1:
        refusals.append("a package needs exactly one part with \"rest\": true (it takes what no part names)")
    if mode == "siblings" and rest:
        refusals.append("siblings: what no part names stays in the module; no part is \"rest\"")
    for part in man["parts"]:                      # a submodule's name would replace the package's attribute of that name
        if part["name"] in by_name and mode == "package":
            refusals.append(f"the part `{part['name']}` has the name of a top-level name of {man['module']}: importing it would hide that name")
    # who goes where: the named ones
    for pi, part in enumerate(man["parts"]):
        for name in part.get("members", []):
            hits = by_name.get(name, [])
            if not hits:
                refusals.append(f"{part['name']}: `{name}` is not a top-level name of {man['module']}")
            for st in hits:
                if st.part not in (-1, pi):
                    refusals.append(f"`{name}` (line {st.node.lineno}) is named by {man['parts'][st.part]['name']} and {part['name']}")
                st.part = pi
    # a part may also claim the named statements that begin on given lines ("lines": [[first, last], ...]); a name in
    # "members" is claimed first
    claimed: dict[int, int] = {}
    for pi, part in enumerate(man["parts"]):
        for lo, hi in part.get("lines", []):
            for st in stmts:
                if st.kind in ("import", "docstring") or not st.names or not lo <= st.first <= hi:
                    continue
                if st.part >= 0 and claimed.get(st.index) is None:
                    continue                                   # named in "members"
                if claimed.get(st.index, pi) != pi:
                    refusals.append(f"`{st.names[0]}` (line {st.node.lineno}) is in the lines of {man['parts'][claimed[st.index]]['name']} "
                                    f"and {part['name']}")
                claimed[st.index] = st.part = pi
    # in lazy mode a statement that only changes a name (`X[k] = ...`, `X += ...`, `X.update(...)`) goes with the part that
    # defines X: its mutations then run there, in the file's order, as one would see them
    named_part = {n: (st.part if st.part >= 0 else (rest[0] if rest else -1))
                  for st in stmts if st.kind not in ("import", "docstring") and st.names for n in st.names}
    # an import goes everywhere it is used, so it has no part; the unnamed ones follow the statement before them
    last = -1
    for st in stmts:
        if st.kind in ("import", "docstring") and st.part < 0:
            continue
        if st.part >= 0:
            last = st.part
            continue
        if lazy and not st.names and st.kind in ("augassign", "call", "assign") and any(b in named_part for b in st.binds):
            homes = {named_part[b] for b in st.binds if b in named_part}
            if len(homes) > 1:
                refusals.append(f"line {st.node.lineno} changes names of {len(homes)} different parts")
            st.part = min(homes)
            continue                                           # (it does not become "the statement before" the next one)
        if st.kind in ("augassign", "call", "other") or (st.kind == "assign" and not st.names):
            st.part = last if last >= 0 else (rest[0] if rest else -1)
        elif mode == "package":
            st.part = rest[0] if rest else -1
        last = st.part
    owner: dict[str, int] = {}
    for st in stmts:
        if st.kind in ("import", "docstring"):
            continue
        for n in st.names:
            owner[n] = st.part
    imports = {n for st in stmts if st.kind == "import" for n in st.names}
    # binders: every statement that binds or mutates a name is in the part that defines it
    for st in stmts:
        if st.kind in ("import", "docstring"):
            continue
        for b in st.binds:
            if b in owner and owner[b] != st.part:
                refusals.append(f"line {st.node.lineno} binds `{b}` in {pname(man, st.part)}, but {pname(man, owner[b])} defines it")
    # uses: across parts, in order; import-time reads after every binder
    binders_at: dict[str, list[int]] = {}
    for st in stmts:
        for b in st.binds:
            binders_at.setdefault(b, []).append(st.node.lineno)
    uses: dict[int, set[str]] = {i: set() for i in range(-1, len(man["parts"]))}
    by_owner_stmt: dict[str, list[Stmt]] = {}
    for st in stmts:
        if st.kind not in ("import", "docstring"):
            for n in st.names:
                by_owner_stmt.setdefault(n, []).append(st)
    lazy_plan: dict[int, list] = {}
    for st in stmts:
        if st.kind in ("import", "docstring"):
            continue
        if not lazy:
            reads = {n: None for n in (st.now | st.later) - imports}
        else:
            # what must be there while the module loads: the names read outside function bodies (a lambda made then counts), and
            # whatever a def or class read there reaches, since it may be called then (its late imports would find the later
            # part not yet loaded)
            reads, work = {}, [(n, None) for n in sorted(st.now | st.lam)]
            while work:
                n, via = work.pop()
                if n in reads or n in imports:
                    continue
                reads[n] = via
                for o_st in by_owner_stmt.get(n, []):
                    if o_st.kind == "def" and o_st is not st:
                        work += [(m, via or n) for m in sorted(o_st.later | o_st.now | o_st.lam)]
        for n, via in reads.items():
            o = owner.get(n)
            if o is None or o == st.part:
                continue
            through = f" (through `{via}`, which it calls or may call)" if via else ""
            if mode == "siblings" and st.part >= 0 and o < 0:
                refusals.append(f"{pname(man, st.part)}: line {st.node.lineno} uses `{n}`, which stays in {man['module']} "
                                f"(a sibling may use only earlier siblings)")
                continue
            if st.part >= 0 and o >= 0 and o > st.part:
                refusals.append(f"{pname(man, st.part)}: line {st.node.lineno} uses `{n}` of the later part {pname(man, o)}"
                                + (f" while it loads{through}" if lazy else ""))
                continue
            if via:
                continue                                       # (reached through a function: ordered, but not a name this part imports)
            if (n in st.now or (lazy and n in st.lam)) and any(line > st.node.lineno for line in binders_at.get(n, [])):
                refusals.append(f"line {st.node.lineno} reads `{n}` at import time, and `{n}` is bound again later "
                                f"(line {max(binders_at[n])}): in {pname(man, st.part)} it would see the final value")
            uses[st.part].add(n)
        if lazy:
            # the names a function reads when it is called: from an earlier part, a plain import at the top of the part; from a
            # later part, an import as the first statement of the function (after its docstring), made when it runs
            for node, got in st.sites:
                need: dict[int, set[str]] = {}
                for n in got - imports:
                    o = owner.get(n)
                    if o is not None and o >= 0 and o != st.part:
                        if o > st.part:
                            need.setdefault(o, set()).add(n)
                        else:
                            uses[st.part].add(n)
                if need:
                    lazy_plan.setdefault(st.index, []).append((node, {o: sorted(v, key=str.lower) for o, v in need.items()}))
            if st.kind != "def":
                for n in (st.later - st.now - st.lam) - imports:
                    o = owner.get(n)
                    if o is not None and st.part >= 0 and o > st.part:
                        refusals.append(f"{pname(man, st.part)}: line {st.node.lineno} reads `{n}` of the later part {pname(man, o)} "
                                        f"in a lambda (no place in it for a late import)")
    # monkeypatched names stay with every reader
    dotted = man["module"].removesuffix(".py").replace("/", ".")
    if mode == "siblings":
        dotted = dotted.split("hosts.server.", 1)[-1]
    for n in sorted(patched_names(dotted, stmts) & set(owner)):
        readers = {st.part for st in stmts if n in (st.now | st.later)}
        if mode == "package":
            # a patch on the package sets the package's attribute; the code in a part reads the part's own
            if readers:
                refusals.append(f"`{n}` is monkeypatched by the tests on the package and read in "
                                f"{sorted(pname(man, r) for r in readers)}: the patch would land on the package's __init__, "
                                f"which the parts do not read")
        elif readers - {owner[n]}:
            refusals.append(f"`{n}` is monkeypatched by the tests and read in {sorted(pname(man, r) for r in readers - {owner[n]})}, "
                            f"apart from {pname(man, owner[n])}, where the patch lands")
    return Plan(man, text, stmts, owner, uses, list(dict.fromkeys(refusals)), lazy_plan)


def pname(man: dict, pi: int) -> str:
    return man["parts"][pi]["name"] if pi >= 0 else Path(man["module"]).name


# ------------------------------------------------------------------------------------------------ writing
def deeper(src: str, node: ast.stmt, base_line: int) -> str:
    """`src` (the statement's text, its first line being base_line) with every relative import inside it one level deeper."""
    lines = src.split("\n")
    for sub in ast.walk(node):
        if isinstance(sub, ast.ImportFrom) and sub.level > 0:
            k = sub.lineno - base_line
            lines[k] = re.sub(r"\bfrom (\.+)", lambda m: "from ." + m.group(1), lines[k], count=1)
    return "\n".join(lines)


def import_text(st: Stmt, keep: set[str], level_up: int) -> str | None:
    """An import statement cut down to the aliases `keep` names, with its relative level raised by level_up."""
    n = st.node
    aliases = [a for a in n.names if (a.asname or a.name.split(".")[0]) in keep]
    if not aliases:
        return None
    parts = ", ".join(a.name + (f" as {a.asname}" if a.asname else "") for a in aliases)
    if isinstance(n, ast.Import):
        return f"import {parts}"
    level = n.level + (level_up if n.level else 0)
    return f"from {'.' * level}{n.module or ''} import {parts}"


def wrap(line: str, width: int = 118) -> list[str]:
    if len(line) <= width or " import " not in line:
        return [line]
    head, names = line.split(" import ", 1)
    out, cur = [], head + " import ("
    for k, piece in enumerate(names.split(", ")):
        add = piece + ","
        if len(cur) + 1 + len(add) > width:
            out.append(cur)
            cur = "    " + add
        else:
            cur = cur + ("" if cur.endswith("(") else " ") + add
    out.append(cur + ")")
    return out


def late_imports(plan: Plan, st: Stmt, text: str, files: dict[int, str]) -> str:
    """`text` (a def or class, from line st.first) with, as the first statement of each function that reads a name of a
    later part -- after its docstring -- one `from .<part> import <names>` for each such part."""
    lines = text.split("\n")
    adds: list[tuple[int, list[str]]] = []
    for node, need in plan.lazy[st.index]:
        first = node.body[0]
        if lines[first.lineno - st.first][:first.col_offset].strip():
            raise Refusal(f"line {node.lineno}: `{node.name}` has its body on the line of its def; a late import has no place in it")
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
            at = first.end_lineno - st.first + 1                    # after the docstring
        else:
            at = first.lineno - st.first
            while at > 0 and lines[at - 1].lstrip().startswith("#"):    # (the comments above the first statement stay with it)
                at -= 1
        new = []
        for o in sorted(need):
            for ln in wrap(f"from .{Path(files[o]).stem} import {', '.join(need[o])}"):
                new.append(" " * first.col_offset + ln)
        adds.append((at, new))
    for at, new in sorted(adds, key=lambda a: -a[0]):
        lines[at:at] = new
    return "\n".join(lines)


def stmt_text(plan: Plan, st: Stmt) -> str:
    return "\n".join(plan.text.split("\n")[st.first - 1:st.last])


def build(plan: Plan) -> dict[str, str]:
    """{relative path: text} of every file the split writes."""
    man, mode = plan.man, plan.man.get("mode", "package")
    mod = Path(man["module"])
    imports = [st for st in plan.stmts if st.kind == "import"]
    level_up = 1 if mode == "package" else 0
    dot = "" if man.get("flat") else "."       # flat siblings (tools/split_js.py): plain `from split_js_x import`, tools/ is no package
    folder = mod.with_suffix("") if mode == "package" else mod.parent
    dotted_pkg = ".".join(mod.with_suffix("").parts)
    out: dict[str, str] = {}
    files: dict[int, str] = {}
    for pi, part in enumerate(man["parts"]):
        files[pi] = (folder / f"{part['name']}.py").as_posix() if mode == "package" else \
            (mod.parent / f"{mod.stem}_{part['name']}.py").as_posix()
    for pi, part in enumerate(man["parts"]):
        mine = [st for st in plan.stmts if st.part == pi and st.kind not in ("import", "docstring")]
        used = set().union(*[(st.now | st.later) for st in mine]) if mine else set()
        used |= {n for st in mine for n in names_in_annotations(st.node)}
        head = [f'"""{mod.stem}.py\'s {part["title"]} (moved here by tools/split_py.py from {man["module"]}:',
                f'tools/split_py_manifests/{man["name"]}.json; `tools/split_py.py --find NAME` says which file holds a name)."""',
                "from __future__ import annotations", ""]
        for st in imports:
            if isinstance(st.node, ast.ImportFrom) and st.node.module == "__future__":
                continue
            line = import_text(st, used, level_up)
            if line:
                head += wrap(line)
        takes: dict[int, list[str]] = {}
        for n in sorted(plan.uses[pi] | (used & set(plan.owner))):
            o = plan.owner.get(n)
            if o is not None and o != pi and o >= 0 and not (plan.man.get("lazy") and o > pi):    # (a later part: a late import)
                takes.setdefault(o, []).append(n)
        for o in sorted(takes):
            head += wrap(f"from {dot}{Path(files[o]).stem} import {', '.join(sorted(takes[o], key=str.lower))}")
        body = []
        for k, st in enumerate(mine):
            text = stmt_text(plan, st)
            if mode == "package":
                text = deeper(text, st.node, st.first)
            if plan.lazy.get(st.index):
                text = late_imports(plan, st, text, files)
            if k:
                body.append("")
                if isinstance(st.node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) or \
                        isinstance(mine[k - 1].node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    body.append("")
            body.append(text)
        out[files[pi]] = "\n".join(head + ["", ""] + body) + "\n"
    names = [n for st in plan.stmts if st.kind not in ("docstring",) for n in st.names]
    if mode == "package":
        doc = next((st for st in plan.stmts if st.kind == "docstring"), None)
        init = [stmt_text(plan, doc) if doc else f'"""{dotted_pkg}."""', "",
                f"# THIS PACKAGE WAS ONE MODULE ({man['module']}), cut into the files beside this one by tools/split_py.py from",
                f"# tools/split_py_manifests/{man['name']}.json; `tools/split_py.py --find NAME` says which file holds a name. Every name",
                "# of the old module is imported back here, so `from ... import X` reads as it did.",
                "from __future__ import annotations", ""]
        for st in imports:
            if isinstance(st.node, ast.ImportFrom) and st.node.module == "__future__":
                continue
            line = import_text(st, set(st.names), level_up)
            if line:
                init += wrap(line)
        for pi in range(len(man["parts"])):
            mine = sorted({n for st in plan.stmts if st.part == pi and st.kind not in ("import", "docstring") for n in st.names},
                          key=str.lower)
            if mine:
                init += wrap(f"from .{Path(files[pi]).stem} import {', '.join(mine)}")
        allnames = sorted(set(names), key=str.lower)
        init += ["", "__all__ = ["] + [f"    {n!r}," for n in allnames] + ["]"]
        out[(folder / "__init__.py").as_posix()] = "\n".join(init) + "\n"
    else:
        # the module that stays: the moved statements out, their names imported back where the first one was
        keep_lines = plan.text.split("\n")
        moved = [st for st in plan.stmts if st.part >= 0]
        gone = set()
        for st in moved:
            gone.update(range(st.first, st.last + 1))
        back = []
        for pi in range(len(man["parts"])):
            mine = sorted({n for st in moved if st.part == pi for n in st.names}, key=str.lower)
            if mine:
                got = wrap(f"from {dot}{Path(files[pi]).stem} import {', '.join(mine)}")
                got = [g + "  # noqa: F401 -- tools/split_py.py" for g in got]
                back += got
        if man.get("flat"):       # the parts sit beside this file and are imported by their plain names, however it was loaded
            back = ["if str(Path(__file__).resolve().parent) not in sys.path:   # (tools/split_py.py, flat siblings)",
                    "    sys.path.insert(0, str(Path(__file__).resolve().parent))"] + back
        first = min(st.first for st in moved)
        # an import of the module only its moved code used stays (the module keeps every name it had), marked for ruff
        stays = [st for st in plan.stmts if st.part < 0 and st.kind not in ("import", "docstring")]
        used_here = set().union(*[(st.now | st.later | names_in_annotations(st.node)) for st in stays]) if stays else set()
        for st in plan.stmts:
            if st.kind == "import" and (set(st.names) - used_here) and not (isinstance(st.node, ast.ImportFrom)
                                                                               and st.node.module == "__future__"):
                for no in range(st.node.lineno, st.node.end_lineno + 1):
                    if "noqa" not in keep_lines[no - 1]:
                        keep_lines[no - 1] += "  # noqa: F401 -- its parts use it (tools/split_py.py)"
        new = []
        for no, line in enumerate(keep_lines, 1):
            if no == first:
                new += back + [""]
            if no in gone:
                continue
            new.append(line)
        text = re.sub(r"\n{4,}", "\n\n\n", "\n".join(new))
        out[mod.as_posix()] = text
    return out


def names_in_annotations(node: ast.stmt) -> set[str]:
    out = set()
    for sub in ast.walk(node):
        ann = getattr(sub, "annotation", None) or getattr(sub, "returns", None)
        for a in [ann] if ann is not None else []:
            for x in ast.walk(a):
                if isinstance(x, ast.Name):
                    out.add(x.id)
    return out


# ------------------------------------------------------------------------------------------------ the proof
def strip_late(node: ast.stmt, part_names: set[str]) -> tuple[ast.stmt, list[list[tuple[str, list[str]]]]]:
    """A copy of a def or class with the late imports taken out -- the `from .<part> import ...` statements that open a function
    (after its docstring) -- and, in source order, the ones taken from each function."""
    node = copy.deepcopy(node)
    found: list[list[tuple[str, list[str]]]] = []

    def go(n: ast.AST) -> None:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            i = 1 if n.body and isinstance(n.body[0], ast.Expr) and isinstance(n.body[0].value, ast.Constant) \
                and isinstance(n.body[0].value.value, str) else 0
            j = i
            while j < len(n.body) and isinstance(n.body[j], ast.ImportFrom) and n.body[j].level == 1 \
                    and n.body[j].module in part_names and all(a.asname is None for a in n.body[j].names):
                j += 1
            if j > i:
                found.append([(x.module or "", [a.name for a in x.names]) for x in n.body[i:j] if isinstance(x, ast.ImportFrom)])
                del n.body[i:j]
        elif isinstance(n, ast.ClassDef):
            for b in n.body:
                go(b)
    go(node)
    return node, found


def unbound_names(text: str, filename: str) -> list[str]:
    """Names a file reads that nothing in it defines, imports, or builtins gives (a lazy import left out)."""
    top = symtable.symtable(text, filename, "exec")
    have = {s.get_name() for s in top.get_symbols() if s.is_assigned() or s.is_imported() or s.is_namespace()}
    ok = have | set(dir(builtins)) | {"__file__", "__name__", "__doc__", "__package__", "__spec__"}
    bad: set[str] = set()

    def go(t: symtable.SymbolTable, is_top: bool) -> None:
        for sym in t.get_symbols():
            if sym.is_referenced() and (is_top or sym.is_global()) and sym.get_name() not in ok:
                bad.add(sym.get_name())
        for c in t.get_children():
            go(c, False)
    go(top, True)
    return sorted(bad)


def prove(plan: Plan, files: dict[str, str]) -> list[str]:
    bad = []
    mode = plan.man.get("mode", "package")
    lazy = bool(plan.man.get("lazy"))
    part_names = {p["name"] for p in plan.man["parts"]}
    up = 1 if mode == "package" else 0
    have: dict[str, list[tuple[str, list]]] = {}
    defines: dict[str, set[str]] = {}
    for path, text in files.items():
        try:
            tree = ast.parse(text, path)
        except SyntaxError as err:
            bad.append(f"{path}: does not parse: {err}")
            continue
        for node in tree.body:
            if lazy and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                node, found = strip_late(node, part_names)          # (what is left must be the original function)
            else:
                found = []
            have.setdefault(path, []).append((ast.dump(node), found))
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                defines.setdefault(path, set()).update(defined(node)[0])
        if lazy and Path(path).name != "__init__.py":
            bad += [f"{path}: reads `{n}`, which nothing in it defines or imports" for n in unbound_names(text, path)]
    stem_path = {Path(p).stem: p for p in files}
    for st in plan.stmts:
        if st.kind in ("import", "docstring"):
            continue
        node = ast.parse(stmt_text(plan, st)).body[0]
        if up and st.part >= 0:
            for sub in ast.walk(node):
                if isinstance(sub, ast.ImportFrom) and sub.level:
                    sub.level += up
        want = ast.dump(node)
        hits = [(p, f) for p, ds in have.items() for d, f in ds if d == want]
        if len(hits) != 1:
            bad.append(f"line {st.node.lineno} ({(st.names or [st.kind])[0]}): found {len(hits)} times after the split, not once")
        elif lazy:
            # the late imports are exactly the ones the plan says, each from the part that defines the name
            expect = [[(plan.man["parts"][o]["name"], list(need[o])) for o in sorted(need)] for _n, need in plan.lazy.get(st.index, [])]
            if hits[0][1] != expect:
                bad.append(f"line {st.node.lineno} ({(st.names or [st.kind])[0]}): its late imports are {hits[0][1]}, the plan says {expect}")
            for group in hits[0][1]:
                for mod_name, names in group:
                    for n in names:
                        if n not in defines.get(stem_path.get(mod_name, ""), set()):
                            bad.append(f"line {st.node.lineno}: a late import of `{n}` from {mod_name}, which does not define it")
    # the parts import only earlier parts (at the top: a late import is inside a function and is not one of these)
    order = [p["name"] for p in plan.man["parts"]]
    for path, text in files.items():
        me = Path(path).stem
        for m in re.finditer(r"^from \.?(\w+) import", text, re.M):
            other = m.group(1)
            if plan.man.get("flat") and not other.startswith(Path(plan.man["module"]).stem + "_"):
                continue
            other_part = other.removeprefix(Path(plan.man["module"]).stem + "_") if mode == "siblings" else other
            if other_part in order and me in order + [Path(plan.man["module"]).stem + "_" + o for o in order]:
                me_part = me.removeprefix(Path(plan.man["module"]).stem + "_") if mode == "siblings" else me
                if me_part in order and order.index(other_part) >= order.index(me_part):
                    bad.append(f"{path} imports {other}, which is not earlier in the manifest")
    return bad


IMPORT_PROOF = r"""
import importlib, json, sys
name, subs = sys.argv[1], json.loads(sys.argv[2])
m = importlib.import_module(name)
names = sorted(n for n in vars(m) if not (n.startswith('__') and n.endswith('__')))
same = []
for sub in subs:
    s = importlib.import_module(sub)
    for n, v in vars(s).items():
        if n.startswith('__') or n not in vars(m):
            continue
        if vars(m)[n] is not v and not isinstance(v, type(sys)):
            same.append(f'{sub}.{n} is not {name}.{n}')
print(json.dumps({'names': names, 'notsame': same}))
"""


def import_names(root: Path, dotted: str, subs: list[str], extra: str = "") -> dict:
    env = dict(os.environ, PYTHONPATH=f"{extra}{root}:{root}/hosts/server")
    run = subprocess.run([PY, "-c", IMPORT_PROOF, dotted, json.dumps(subs)], capture_output=True, text=True, env=env, cwd=root)
    if run.returncode:
        raise Refusal(f"importing {dotted} failed:\n{run.stderr[-2000:]}")
    return json.loads(run.stdout.strip().splitlines()[-1])


VALUES_PROOF = r"""
import importlib, json, re, sys
m = importlib.import_module(sys.argv[1])
out = {}
for n, v in vars(m).items():
    if n.startswith('__') and n.endswith('__') or callable(v) or isinstance(v, type(sys)):
        continue
    out[n] = re.sub(r'0x[0-9a-f]{6,}', '0x', repr(v))
print(json.dumps(out))
"""


def import_values(root: Path, dotted: str, extra: str = "") -> dict[str, str]:
    """{name: repr} of every value the module builds as it loads (not its functions, classes or modules). Run with a fixed hash
    seed, so a set or a dict made the same way is written the same way: the split must build every table as it was built."""
    env = dict(os.environ, PYTHONPATH=f"{extra}{root}:{root}/hosts/server", PYTHONHASHSEED="0")
    run = subprocess.run([PY, "-c", VALUES_PROOF, dotted], capture_output=True, text=True, env=env, cwd=root)
    if run.returncode:
        raise Refusal(f"importing {dotted} failed:\n{run.stderr[-2000:]}")
    return json.loads(run.stdout.strip().splitlines()[-1])


def dotted_of(man: dict) -> str:
    mod = Path(man["module"]).with_suffix("")
    if man.get("flat"):
        return mod.name
    parts = mod.parts[2:] if mod.parts[:2] == ("hosts", "server") else mod.parts
    return ".".join(parts)


# ------------------------------------------------------------------------------------------------ main
def load_manifest(name: str) -> dict:
    p = Path(name) if name.endswith(".json") else MANIFESTS / f"{name}.json"
    man = json.loads(p.read_text())
    man["name"] = p.stem
    return man


def do_split(man: dict, check_only: bool) -> int:
    mod = ROOT / man["module"]
    if not mod.is_file():
        print(f"{man['module']}: not a module (already split?)")
        return 1
    text = mod.read_text()
    plan = make_plan(man, text)
    if plan.refusals:
        print(f"{man['name']}: refused:\n" + "\n".join("  - " + r for r in plan.refusals))
        return 1
    files = build(plan)
    bad = prove(plan, files)
    if bad:
        print(f"{man['name']}: the proof failed:\n" + "\n".join("  - " + b for b in bad))
        return 1
    dotted = dotted_of(man)
    flat = bool(man.get("flat"))             # a module of tools/, which is no package: imported by its plain name from its folder
    here = f"{(ROOT / man['module']).parent}:" if flat else ""
    before = import_names(ROOT, dotted, [], here)
    values_before = import_values(ROOT, dotted, here) if man.get("lazy") else {}
    mode = man.get("mode", "package")
    with tempfile.TemporaryDirectory(prefix="split_py-") as td:
        # the split tree: a copy of what the import reaches, with the new files in place of the module
        tmp = Path(td)
        top = Path(man["module"]).parts[0] if mode == "package" or not man["module"].startswith("hosts/server/") else "hosts"
        if flat:
            (tmp / Path(man["module"]).parent).mkdir(parents=True)
            for f in (ROOT / man["module"]).parent.glob("*.py"):
                shutil.copy(f, tmp / Path(man["module"]).parent / f.name)
        else:
            subprocess.run(["cp", "-R", str(ROOT / top), str(tmp / top)], check=True)
        if not flat and top != "hk_core" and (ROOT / "hk_core").is_dir():
            subprocess.run(["cp", "-R", str(ROOT / "hk_core"), str(tmp / "hk_core")], check=True)
        (tmp / man["module"]).unlink()
        for path, t in files.items():
            (tmp / path).parent.mkdir(parents=True, exist_ok=True)
            (tmp / path).write_text(t)
        subs = [dotted + "." + Path(p).stem if mode == "package" else Path(p).stem if flat else
                dotted.rsplit(".", 1)[0] + "." + Path(p).stem
                for p in files if Path(p).name != "__init__.py" and Path(p).as_posix() != man["module"]]
        there = f"{tmp / Path(man['module']).parent}:" if flat else ""
        after = import_names(tmp, dotted, subs, there)
        values_after = import_values(tmp, dotted, there) if man.get("lazy") else {}
    if after["notsame"]:
        bad += after["notsame"]
    if man.get("lazy"):
        bad += [f"`{n}` is built differently as the package loads" for n in sorted(values_before)
                if values_after.get(n) != values_before[n]]
        bad += [f"`{n}` is built by the package and was not by the module" for n in sorted(set(values_after) - set(values_before))
                if n not in {Path(p).stem for p in files}]
    gone = sorted(set(before["names"]) - set(after["names"]))
    extra = sorted(set(after["names"]) - set(before["names"]) - {Path(p).stem for p in files} - {"annotations"})
    if gone:
        bad.append(f"names the old module had and the split lacks: {gone[:20]}")
    if extra and mode == "package":
        bad.append(f"names the split has and the old module lacked: {extra[:20]}")
    if bad:
        print(f"{man['name']}: the proof failed:\n" + "\n".join("  - " + b for b in bad))
        return 1
    print(f"{man['name']}: {sum(1 for s in plan.stmts if s.part >= 0)} statements into {len(man['parts'])} parts; proven (each "
          f"statement's syntax tree the same in its new place, the parts import only earlier ones, the same {len(after['names'])} "
          f"names, each the same object through the package as through its file)")
    for path, t in sorted(files.items()):
        print(f"  {path:60s} {t.count(chr(10)):5d} lines")
    if check_only:
        print("  --check: nothing written")
        return 0
    if mode == "package":
        mod.unlink()
    for path, t in files.items():
        (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
        (ROOT / path).write_text(t)
    return 0


def find(name: str) -> int:
    hits = 0
    for p in sorted(MANIFESTS.glob("*.json")):
        man = json.loads(p.read_text())
        mod = ROOT / man["module"]
        folder = mod.with_suffix("") if man.get("mode", "package") == "package" else mod.parent
        cands = sorted(folder.glob("*.py")) if folder.is_dir() and man.get("mode", "package") == "package" else \
            [mod] + sorted(mod.parent.glob(mod.stem + "_*.py"))
        for f in cands:
            if not f.is_file():
                continue
            for node in ast.parse(f.read_text()).body:
                names, _, kind = defined(node)
                if name in names and kind != "import":
                    print(f"{f.relative_to(ROOT)}:{node.lineno}  {name}")
                    hits += 1
    if not hits:
        print(f"{name}: not a top-level name of any split module")
    return 0 if hits else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest", nargs="?")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--find", metavar="NAME")
    a = ap.parse_args(argv)
    if a.find:
        return find(a.find)
    if not a.manifest:
        ap.error("name a manifest")
    try:
        return do_split(load_manifest(a.manifest), a.check)
    except Refusal as err:
        print(f"refused: {err}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
