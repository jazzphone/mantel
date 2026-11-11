#!/usr/bin/env python3
"""Move flat modules of Mantel Server into a package, and prove nothing but the place changed (phase 25, Part C:
docs/phase25/PLAN.md). The server's twin of tools/split_py.py, and built on the same habits: Python's own syntax tree, a
refusal that names the statement, a `--check` that proves everything and writes nothing.

    tools/move_py.py identity                 # move what tools/move_py_manifests/identity.json lists, then prove it
    tools/move_py.py identity --check         # the whole plan and the whole proof, nothing written
    tools/move_py.py --expired 0.1.166        # the alias rows that go away in that release or earlier

THE MANIFEST (tools/move_py_manifests/<package>.json):
    {"package": "identity", "modules": ["accounts", "auth", ...], "why": "who may do what: ...",
     "checked": {"db": "its migrations folder is found by name; fixed in <commit>"}, "alias_until": "0.1.166"}
`"init": "<package>"` (optional) names the module of the package's own name (`linked.py` for `linked/`): it becomes
`<package>/__init__.py`, keeps its dotted name (no alias row: `mantel_server.linked` is the same module, now a package) and
its relative imports are redone against the package itself; the proof allows it the package's own submodules as new names.
`checked` names a module that looks things up beside its own file (the tool lists every such use and refuses the module until
the manifest says someone looked); `alias_until` is the release the old paths stop importing in (else two releases past
pyproject's version; `--until` overrides).

WHAT IT DOES, as one operation for a whole package:
  * `git mv` each module into hosts/server/mantel_server/<package>/ (an existing package keeps its __init__.py; a new one gets
    a docstring that says what it holds and no imports, so it cannot start a cycle);
  * rewrites every import of a moved module in every Python file of the repo (git ls-files, plus anything untracked), by the
    syntax tree and by the statement's own text span, so comments and formatting elsewhere stay byte for byte:
      from . import a, b          from .a import X          from mantel_server import a          from mantel_server.a import X
      import mantel_server.a      import mantel_server.a as M      and the code's own `mantel_server.a.X` after a bare
      `import mantel_server.a`;
    a statement that names several modules of which only some moved is split in two. A moved module's OWN relative imports
    are redone for the new depth, siblings that did not move included (`from . import store` becomes `from .. import store`);
  * rewrites a string that is exactly a dotted module path (`monkeypatch.setattr("mantel_server.a.X", ...)`, `mock.patch(...)`,
    a route row naming its module); lists every other string that mentions a moved module, and every non-Python file that does
    (the Dockerfile's `python -m`, docs). It rewrites the module paths in tools/split_py_manifests and tests/fixtures (JSON data
    that is keyed by file path) and reports the rest;
  * keeps the old paths importable for ONE release: hosts/server/mantel_server/_moved.py holds the table (old name, new path,
    the release it goes away in) and a lazy finder; mantel_server/__init__.py installs it. LAZY: nothing is imported at start;
    `import mantel_server.a` (or `from mantel_server import a`) imports the new module and hands back that same object, and
    the old name is then in sys.modules. The next release's `--expired` lists the rows to delete.

WHAT IT REFUSES (and says so, naming the file and line):
  * a module that is not a flat module of the server, is not tracked, or whose new place is taken; a package name that is a
    module; a file with uncommitted changes among those it would touch (a move conflicts with any open change: run it at a
    quiet moment; `--allow-dirty` to override);
  * a module that finds files beside itself (`__file__`, `__path__`, importlib.resources, pkgutil: the migrations, models and
    static folders) unless the manifest's `checked` says it was looked at; the tool does not change what a module does;
  * a module with sibling parts (tools/split_py_manifests, mode "siblings") unless all of them move together;
  * an import statement it would have to rewrite that has a comment inside it, or that shares its line with other code and
    would need splitting.

THE PROOF (before anything is written, on a copy of the tree; again on the real tree after):
  * every file's syntax tree is identical to the original's except its import statements, which are compared as resolved
    bindings (module, name, alias, in order; a relative import resolved from where the file sat and where it sits), and the
    two code forms above (an attribute chain, an exact dotted string), compared after the old tree is mapped;
  * every moved module imports at its new path and through its alias in both orders (new first, alias first) and gives the same
    object (`is`), `from mantel_server import a` included; the set of top-level names is what the old module had, each the same
    object both ways; and every module of the server imports as it did (a module that failed before may fail after);
  * a second plan over the finished texts finds nothing left to rewrite (no file imports an old path, the alias table aside);
  * `python -m compileall` is clean on every touched file.

NOT DONE FOR YOU (it prints the reminders): `tools/route_table.py --write` (the route lock and docs/development/Routes.md are keyed
by module path), `tools/code_map.py` (docs/development/Code-map.md lists files), and the non-Python mentions it found.
"""
from __future__ import annotations

import argparse
import ast
import copy
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
PY = sys.executable
TOP = "mantel_server"
SERVER = "hosts/server/mantel_server"
MANIFESTS = "tools/move_py_manifests"
SPLITS = "tools/split_py_manifests"
WIDTH = 118
SELF = {"tools/move_py.py", "tests/test_move_py.py"}      # they name modules as examples
BEGIN, END = "    # --- the table: written by tools/move_py.py ---", "    # --- end of the table ---"
ROW = re.compile(r'^    "(\w+)": \("([\w.]+)", "([\d.]+)"\),$')
FILE_NAMES = {"__file__", "__path__"}
FILE_MODULES = {"importlib.resources", "pkgutil", "importlib.metadata"}
MODULE_ATTRS = {"__name__", "__doc__", "__package__", "__loader__", "__spec__", "__file__", "__cached__", "__builtins__", "__path__"}


class Refusal(Exception):
    pass


# ------------------------------------------------------------------------------------------------ the alias module
MOVED_TEMPLATE = '''"""The old paths of modules that moved into packages, importable for one release (tools/move_py.py, phase 25).

`import mantel_server.accounts` and `from mantel_server import accounts` still work and give the very module that now lives
at `mantel_server.identity.accounts`: the same object, so a monkeypatch on either path reaches both. Nothing is imported until
an old path is: a finder answers only for the names in the table, and loads the new module when asked. The table is written
by the tool, one row per moved module, with the release the old path goes away in; the next release deletes its rows
(`tools/move_py.py --expired VERSION` lists them) and then the finder has nothing left to answer.
"""
from __future__ import annotations

import importlib
import importlib.abc
import importlib.machinery
import sys

# old name -> (new path under mantel_server, the release the old name goes away in)
MOVED: dict[str, tuple[str, str]] = {
%(begin)s
%(end)s
}


class _Alias(importlib.abc.Loader):
    """Loads an old name by importing the new module and handing back that same object."""

    def __init__(self, target: str) -> None:
        self.target = target
        self.real = None

    def create_module(self, spec):
        self.real = importlib.import_module(self.target)
        self.spec = self.real.__spec__
        return self.real

    def exec_module(self, module) -> None:
        # the import system has just put the alias's spec on the module; the module keeps its own
        module.__spec__ = self.spec


class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        head, _, name = fullname.rpartition(".")
        if head != "mantel_server" or name not in MOVED:
            return None
        return importlib.machinery.ModuleSpec(fullname, _Alias("mantel_server." + MOVED[name][0]))


def install() -> None:
    if not any(isinstance(f, _Finder) for f in sys.meta_path):
        sys.meta_path.insert(0, _Finder())
'''
INIT_TEXT = '"""Mantel Server."""\nfrom __future__ import annotations\n\nfrom . import _moved\n\n_moved.install()\n'


def moved_rows(text: str) -> dict[str, tuple[str, str]]:
    rows = {}
    for line in text.splitlines():
        m = ROW.match(line)
        if m:
            rows[m.group(1)] = (m.group(2), m.group(3))
    return rows


def moved_text(text: str | None, rows: dict[str, tuple[str, str]]) -> str:
    text = text if text is not None else MOVED_TEMPLATE % {"begin": BEGIN, "end": END}
    if BEGIN not in text or END not in text:
        raise Refusal(f"{SERVER}/_moved.py has lost the table's marker lines")
    head, rest = text.split(BEGIN + "\n", 1)
    _, tail = rest.split(END, 1)
    body = "".join(f'    "{n}": ("{p}", "{v}"),\n' for n, (p, v) in sorted(rows.items()))
    return head + BEGIN + "\n" + body + END + tail


def expired(version: str, root: Path = ROOT) -> list[str]:
    p = root / SERVER / "_moved.py"
    rows = moved_rows(p.read_text()) if p.is_file() else {}
    key = lambda v: tuple(int(x) for x in v.split("."))
    return [f"{n}: mantel_server.{new} (goes away in {v})" for n, (new, v) in sorted(rows.items()) if key(v) <= key(version)]


# ------------------------------------------------------------------------------------------------ files and spans
def git(root: Path, *args: str, check: bool = True) -> str:
    run = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if check and run.returncode:
        raise Refusal(f"git {' '.join(args)}: {run.stderr.strip()}")
    return run.stdout


def listed(root: Path, *paths: str, others: bool = True) -> list[str]:
    flags = ["-co", "--exclude-standard"] if others else []
    return [p for p in git(root, "ls-files", *flags, "--", *paths).splitlines() if (root / p).is_file()]


def line_starts(b: bytes) -> list[int]:
    out, i = [0], b.find(b"\n")
    while i != -1:
        out.append(i + 1)
        i = b.find(b"\n", i + 1)
    return out


def span(starts: list[int], node: ast.AST) -> tuple[int, int]:
    return (starts[node.lineno - 1] + node.col_offset, starts[node.end_lineno - 1] + node.end_col_offset)


def package_of(rel: str) -> str | None:
    """The dotted package a server file sits in (a relative import is resolved against it), None outside the server."""
    if not rel.startswith(SERVER + "/"):
        return None
    parts = rel[len(SERVER) + 1:].split("/")
    return ".".join([TOP, *parts[:-1]])


def dotted_module(rel: str) -> str:
    parts = rel[len(SERVER) + 1:].removesuffix(".py").split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join([TOP, *parts])


def resolve_from(node: ast.ImportFrom, pkg: str | None) -> str | None:
    """The absolute module a `from` names, None when it is not a mantel_server one."""
    if node.level == 0:
        mod = node.module or ""
    else:
        if pkg is None:
            return None
        parts = pkg.split(".")
        keep = len(parts) - (node.level - 1)
        if keep < 1:
            return None
        mod = ".".join(parts[:keep]) + ("." + node.module if node.module else "")
    return mod if mod == TOP or mod.startswith(TOP + ".") else None


def relative(pkg: str, target: str) -> tuple[int, str]:
    p, t = pkg.split("."), target.split(".")
    n = 0
    while n < len(p) and n < len(t) and p[n] == t[n]:
        n += 1
    return len(p) - n + 1, ".".join(t[n:])


def docstring_ids(tree: ast.AST) -> set[int]:
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.body:
            b = n.body[0]
            if isinstance(b, ast.Expr) and isinstance(b.value, ast.Constant) and isinstance(b.value.value, str):
                out.add(id(b.value))
    return out


def fstring_ids(tree: ast.AST) -> set[int]:
    return {id(c) for n in ast.walk(tree) if isinstance(n, ast.JoinedStr) for c in ast.walk(n)}


# ------------------------------------------------------------------------------------------------ the mapping
class Moves:
    def __init__(self, names: dict[str, str]):
        self.names = names                  # old module name -> its package
        alt = "|".join(sorted(map(re.escape, names), key=len, reverse=True)) or "(?!)"
        self.exact = re.compile(rf"^{TOP}\.({alt})((?:\.[A-Za-z_]\w*)*)$")
        self.mention = re.compile(rf"{TOP}[./]({alt})\b")

    def new_dotted(self, d: str) -> str:
        parts = d.split(".")
        if len(parts) >= 2 and parts[0] == TOP and parts[1] in self.names:
            return ".".join([TOP, self.names[parts[1]], *parts[1:]])
        return d

    def map_from(self, mod: str, name: str) -> str:
        """The module a `from mod import name` reads after the move (`from mantel_server import a` names a module)."""
        if mod == TOP and name in self.names:
            return f"{TOP}.{self.names[name]}"
        return self.new_dotted(mod)


# ------------------------------------------------------------------------------------------------ one file
@dataclass
class FileEdit:
    text: str                       # the new text
    imports: int = 0                # import statements rewritten
    attrs: int = 0
    strings: int = 0


def fmt_from(level: int, module: str, names: list[str], indent: str) -> list[str]:
    head = f"from {'.' * level}{module} import "
    line = indent + head + ", ".join(names)
    if len(line) <= WIDTH:
        return [line]
    out, cur = [indent + head + "("], ""
    for n in names:
        piece = n + ","
        if cur and len(indent) + 4 + len(cur) + 1 + len(piece) > WIDTH:
            out.append(indent + "    " + cur)
            cur = piece
        else:
            cur = (cur + " " + piece) if cur else piece
    out.append(indent + "    " + cur)
    out.append(indent + ")")
    return out


def alias_text(a: ast.alias) -> str:
    return a.name + (f" as {a.asname}" if a.asname else "")


def bindings(tree: ast.AST, pkg: str | None) -> list[tuple]:
    """Every name an import statement binds, resolved to where it points, in order of appearance."""
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            mod = resolve_from(n, pkg)
            for a in n.names:
                out.append(("from", mod if mod is not None else (n.level, n.module), a.name, a.asname))
        elif isinstance(n, ast.Import):
            for a in n.names:
                out.append(("import", a.name, None, a.asname))
    return out


def binds_top(tree: ast.AST) -> bool:
    return any(isinstance(n, ast.Import) and any(a.asname is None and (a.name == TOP or a.name.startswith(TOP + ".")) for a in n.names)
               for n in ast.walk(tree))


def rewrite_file(rel: str, new_rel: str, text: str, mv: Moves, notes: list[str]) -> FileEdit | None:
    """The file's new text (None: nothing to change), edits made only inside the spans they replace."""
    try:
        tree = ast.parse(text, rel)
    except SyntaxError as err:
        raise Refusal(f"{rel}: does not parse ({err})")
    old_pkg, new_pkg = package_of(rel), package_of(new_rel)
    b = text.encode()
    starts = line_starts(b)
    edits: list[tuple[int, int, str]] = []
    count = FileEdit(text)
    top = binds_top(tree)
    skip = docstring_ids(tree) | fstring_ids(tree)
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            old_mod = resolve_from(n, old_pkg)
            if old_mod is None:
                continue
            groups: dict[tuple[int, str], list[str]] = {}
            changed = n.level > 0 and new_pkg != old_pkg      # a moved file's relative imports change depth
            for a in n.names:
                new_mod = mv.map_from(old_mod, a.name) if a.name != "*" else mv.new_dotted(old_mod)
                changed = changed or new_mod != old_mod
                level, modname = (0, new_mod) if n.level == 0 else relative(new_pkg or old_pkg, new_mod)
                groups.setdefault((level, modname), []).append(alias_text(a))
            if not changed or list(groups) == [(n.level, n.module or "")]:
                continue                                     # nothing moved, or it still reads the same
            s, e = span(starts, n)
            seg = b[s:e].decode()
            if "#" in seg:
                raise Refusal(f"{rel}:{n.lineno}: an import it must rewrite has a comment inside it; move the comment first")
            indent = b[starts[n.lineno - 1]:s].decode()
            if len(groups) > 1 and indent.strip():
                raise Refusal(f"{rel}:{n.lineno}: an import that shares its line with other code and would have to split")
            lead = "" if indent.strip() else indent          # continuation lines line up with the statement
            lines: list[str] = []
            for (level, modname), names in groups.items():
                lines += fmt_from(level, modname, names, lead)
            lines[0] = lines[0][len(lead):]                  # the first starts where the statement did
            new = "\n".join(lines)
            if new != seg:
                edits.append((s, e, new))
                count.imports += 1
        elif isinstance(n, ast.Import):
            parts, changed = [], False
            for a in n.names:
                nd = mv.new_dotted(a.name)
                changed = changed or nd != a.name
                parts.append(nd + (f" as {a.asname}" if a.asname else ""))
            if changed:
                s, e = span(starts, n)
                edits.append((s, e, "import " + ", ".join(parts)))
                count.imports += 1
        elif top and isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == TOP and n.attr in mv.names:
            s, e = span(starts, n)
            if b[s:e].decode() != f"{TOP}.{n.attr}":
                raise Refusal(f"{rel}:{n.lineno}: `{TOP}.{n.attr}` is spread over lines or has a comment inside it")
            edits.append((s, e, f"{TOP}.{mv.names[n.attr]}.{n.attr}"))
            count.attrs += 1
        elif isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in skip:
            m = mv.exact.match(n.value)
            s, e = span(starts, n)
            seg = b[s:e].decode()
            if m:
                old = f"{TOP}.{m.group(1)}"
                if seg.count(old) == 1 and ast.literal_eval(seg) == n.value:
                    edits.append((s, e, seg.replace(old, mv.new_dotted(old))))
                    count.strings += 1
                    continue
            if mv.mention.search(n.value):
                notes.append(f"{rel}:{n.lineno}: a string mentions a moved module and was not rewritten: {n.value[:90]!r}")
    if not edits:
        return None
    edits.sort(reverse=True)
    for (s1, e1, _), (s2, e2, _) in zip(edits, edits[1:]):
        if s1 < e2:
            raise Refusal(f"{rel}: two rewrites overlap")
    for s, e, new in edits:
        b = b[:s] + new.encode() + b[e:]
    count.text = b.decode()
    return count


# ------------------------------------------------------------------------------------------------ the plan
@dataclass
class Plan:
    root: Path
    man: dict
    package: str
    moves: dict[str, str]
    until: str
    renames: dict[str, str] = field(default_factory=dict)            # old rel -> new rel
    old: dict[str, str] = field(default_factory=dict)                # old rel -> original text, every file that changes
    new: dict[str, str] = field(default_factory=dict)                # final rel -> new text (changed files and created ones)
    json_paths: dict[str, str] = field(default_factory=dict)         # final rel -> text, JSON data keyed by file path
    created: set[str] = field(default_factory=set)
    counts: dict[str, int] = field(default_factory=lambda: {"files": 0, "imports": 0, "attrs": 0, "strings": 0})
    areas: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)                   # things to look at
    mentions: list[str] = field(default_factory=list)                # non-Python files that name a moved module
    regenerate: list[str] = field(default_factory=list)
    refusals: list[str] = field(default_factory=list)
    init: str | None = None                                          # the module that becomes the package's __init__


def area(rel: str) -> str:
    return "hosts/server" if rel.startswith("hosts/server") else rel.split("/")[0]


def next_release(root: Path, ahead: int = 2) -> str:
    m = re.search(r'^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"', (root / "pyproject.toml").read_text(), re.M) if (root / "pyproject.toml").is_file() else None
    if not m:
        raise Refusal("no `alias_until` in the manifest, no --until, and no version in pyproject.toml to count from")
    return f"{m.group(1)}.{m.group(2)}.{int(m.group(3)) + ahead}"


def file_uses(text: str, rel: str) -> list[str]:
    out = []
    tree = ast.parse(text)
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and n.id in FILE_NAMES:
            out.append(f"{rel}:{n.lineno}: {n.id}")
        elif isinstance(n, ast.Import):
            out += [f"{rel}:{n.lineno}: imports {a.name}" for a in n.names if a.name in FILE_MODULES]
        elif isinstance(n, ast.ImportFrom) and n.level == 0 and (n.module in FILE_MODULES or f"{n.module}.{n.names[0].name}" in FILE_MODULES):
            out.append(f"{rel}:{n.lineno}: imports from {n.module}")
    return out


def name_uses(text: str, rel: str) -> list[str]:
    """`__name__` read for something other than the `__main__` test: a logger, a registry key. It will say the new path."""
    out = []
    tree = ast.parse(text)
    main_tests = {id(c) for n in ast.walk(tree) if isinstance(n, ast.Compare) for c in ast.walk(n)
                  if isinstance(c, ast.Name) and c.id == "__name__"}
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and n.id == "__name__" and id(n) not in main_tests:
            out.append(f"{rel}:{n.lineno}: __name__ (a logger or key named for the module will carry the new path)")
    return out


def make_plan(root: Path, man: dict, until: str | None = None, check_dirty: bool = False) -> Plan:
    for k in ("package", "modules", "why"):
        if not man.get(k):
            raise Refusal(f"the manifest needs \"{k}\"")
    package, modules = man["package"], list(man["modules"])
    if not package.isidentifier() or package.startswith("_"):
        raise Refusal(f"`{package}` is not a package name")
    if len(set(modules)) != len(modules):
        raise Refusal("a module is listed twice")
    # "init": the module of the package's own name becomes its __init__.py: its dotted name does not change (no alias),
    # only its relative imports, which now resolve against the package itself
    init = man.get("init")
    if init is not None and (init != package or init in modules):
        raise Refusal(f"\"init\" names the module that becomes {package}/__init__.py: `{package}`, and not among \"modules\"")
    plan = Plan(root, man, package, {m: package for m in modules}, until or man.get("alias_until") or next_release(root))
    plan.init = init
    ref = plan.refusals
    base = root / SERVER
    tracked = set(listed(root, SERVER, others=False))
    if (base / f"{package}.py").exists() and init is None:
        ref.append(f"`{package}` is already a module ({SERVER}/{package}.py): name it the manifest's \"init\"")
    if init is not None:
        old = f"{SERVER}/{init}.py"
        if old not in tracked:
            ref.append(f"`{init}`: {old} is not a tracked flat module of the server")
        elif (base / package).exists():
            ref.append(f"`{init}`: {SERVER}/{package}/ already exists")
        else:
            plan.renames[old] = f"{SERVER}/{package}/__init__.py"
    if (base / package).exists() and not (base / package / "__init__.py").is_file():
        ref.append(f"{SERVER}/{package}/ exists and is not a package")
    for m in modules:
        old = f"{SERVER}/{m}.py"
        new = f"{SERVER}/{package}/{m}.py"
        if m in ("__init__", "__main__") or not (root / old).is_file():
            ref.append(f"`{m}`: not a flat module of the server ({old})")
        elif old not in tracked:
            ref.append(f"`{m}`: {old} is not tracked by git")
        elif (root / new).exists():
            ref.append(f"`{m}`: {new} already exists")
        else:
            plan.renames[old] = new
    # sibling parts (phase 24's "siblings" manifests): a module and its parts move together
    checked = man.get("checked", {})
    for p in sorted((root / SPLITS).glob("*.json")) if (root / SPLITS).is_dir() else []:
        sm = json.loads(p.read_text())
        if sm.get("mode") != "siblings" or not sm["module"].startswith(SERVER + "/"):
            continue
        stem = Path(sm["module"]).stem
        parts = {f"{stem}_{part['name']}" for part in sm["parts"]}
        group = {stem} | parts
        inside, outside = sorted(group & (set(modules) | {init})), sorted(group - (set(modules) | {init}))
        if inside and outside:
            ref.append(f"`{', '.join(inside)}` moves, and {', '.join(outside)} (the parts of {p.name}) does not: a module and its "
                       f"sibling parts move together")
    if ref:
        return plan
    old_texts = {rel: (root / rel).read_text() for rel in plan.renames}
    for rel, text in old_texts.items():
        name = Path(rel).stem
        uses = file_uses(text, rel)
        if uses and name not in checked:
            ref.append(f"`{name}` finds files beside itself, and the manifest's `checked` does not say it was looked at:\n      "
                       + "\n      ".join(uses))
        elif uses:
            plan.notes.append(f"`{name}` finds files beside itself (the manifest says it was checked: {checked[name]}): " + "; ".join(uses))
        plan.notes += name_uses(text, rel)
    if ref:
        return plan
    mv = Moves(plan.moves)
    candidates = [p for p in listed(root, "*.py") if p not in plan.renames and p not in SELF and (p.startswith(SERVER + "/") or TOP in (root / p).read_text(errors="replace"))]
    try:
        for rel in list(plan.renames) + candidates:
            text = old_texts.get(rel) or (root / rel).read_text()
            new_rel = plan.renames.get(rel, rel)
            edit = rewrite_file(rel, new_rel, text, mv, plan.notes)
            if edit is None and rel not in plan.renames:
                continue
            plan.old[rel] = text
            if edit is not None:
                plan.new[new_rel] = edit.text
                for k in ("imports", "attrs", "strings"):
                    plan.counts[k] += getattr(edit, k)
            plan.counts["files"] += 1
            plan.areas[area(rel)] = plan.areas.get(area(rel), 0) + 1
    except Refusal as err:
        ref.append(str(err))
        return plan
    json_and_mentions(plan, mv)
    # the new package's __init__, the alias table, and the hook that installs it
    init_rel = f"{SERVER}/{package}/__init__.py"
    if not (root / init_rel).is_file() and plan.init is None:
        body = f"{man['why'].rstrip('.')}.\n\nModules: {', '.join(sorted(modules))}.\n"
        plan.new[init_rel] = f'"""{body}"""\n'
        plan.created.add(init_rel)
    table = f"{SERVER}/_moved.py"
    cur = (root / table).read_text() if (root / table).is_file() else None
    rows = moved_rows(cur) if cur else {}
    for m in modules:
        if m in rows:
            ref.append(f"`{m}` is already in the alias table ({table})")
        rows[m] = (f"{package}.{m}", plan.until)
    if ref:
        return plan
    plan.new[table] = moved_text(cur, rows)
    if cur is None:
        plan.created.add(table)
    top_init = f"{SERVER}/__init__.py"
    cur_init = (root / top_init).read_text()
    if "_moved" not in cur_init:
        plan.old[top_init] = cur_init
        plan.new[top_init] = INIT_TEXT if not cur_init.strip() else cur_init.rstrip("\n") + "\n\nfrom . import _moved\n\n_moved.install()\n"
    plan.areas["hosts/server"] = plan.areas.get("hosts/server", 0)
    if check_dirty:
        touched = list(plan.old) + list(plan.renames.values())
        dirty = [ln for ln in git(root, "status", "--porcelain", "--", *touched).splitlines()]
        if dirty:
            ref.append("uncommitted changes among the files it would touch (run at a quiet moment, or --allow-dirty):\n      "
                       + "\n      ".join(dirty[:20]))
    return plan


DATA_JSON = ("tools", "tests")


def json_and_mentions(plan: Plan, mv: Moves) -> None:
    """JSON data keyed by file path is rewritten; every other text that names a moved module is reported."""
    root = plan.root
    path_re = re.compile(rf"(?<![\w/]){re.escape(SERVER)}/(" + "|".join(sorted(map(re.escape, plan.moves), key=len, reverse=True)) + r")\.py(?![\w])")
    lock = "tests/fixtures/route_table.lock.json"
    regenerated = {lock, "docs/development/Routes.md", "docs/development/Code-map.md"}
    for rel in listed(root, "*", others=True):
        if rel.endswith(".py") or rel.startswith(f"{SERVER}/static/") or "node_modules" in rel or rel in plan.new:
            continue
        p = root / rel
        if p.stat().st_size > 3_000_000:
            continue
        try:
            text = p.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        if rel in regenerated:
            if mv.mention.search(text):
                plan.regenerate.append(rel)
            continue
        # (an "init" move: the module that becomes its package's __init__ is named by its new file too)
        init_re = re.compile(rf"(?<![\w/]){re.escape(SERVER)}/{plan.init}\.py(?![\w])") if plan.init else None
        if rel.endswith(".json") and rel.split("/")[0] in DATA_JSON and (path_re.search(text) or init_re and init_re.search(text)):
            new_text = path_re.sub(lambda m: f"{SERVER}/{plan.package}/{m.group(1)}.py", text)
            if init_re:
                new_text = init_re.sub(f"{SERVER}/{plan.package}/__init__.py", new_text)
            plan.json_paths[rel] = new_text
            plan.old[rel] = text
            plan.new[rel] = plan.json_paths[rel]
            continue
        hits = [(i, ln.strip()) for i, ln in enumerate(text.splitlines(), 1) if mv.mention.search(ln) or path_re.search(ln)]
        if hits:
            if rel.startswith("docs/"):
                plan.mentions.append(f"{rel}: {len(hits)} mention(s) (docs are not rewritten)")
            else:
                plan.mentions += [f"{rel}:{i}: {ln[:110]}" for i, ln in hits[:6]]


# ------------------------------------------------------------------------------------------------ writing
def apply_plan(plan: Plan, root: Path, use_git: bool) -> None:
    for old, new in plan.renames.items():
        (root / new).parent.mkdir(parents=True, exist_ok=True)
        if use_git:
            git(root, "mv", old, new)
        elif (root / old).exists():
            os.rename(root / old, root / new)
    for rel, text in plan.new.items():
        if (root / rel).parent.is_dir() or rel in plan.created:
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text)
    if use_git:
        git(root, "add", "--", *plan.new, *plan.renames.values())


def copy_tree(root: Path, dest: Path) -> None:
    for rel in listed(root, "hosts", "hk_core"):
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / rel, dest / rel)


# ------------------------------------------------------------------------------------------------ the proof
class Strip(ast.NodeTransformer):
    """The tree with its import statements taken out, an old tree's moved attribute chains and exact strings mapped."""

    def __init__(self, mv: Moves | None, top: bool, skip: set[int]):
        self.mv, self.top, self.skip = mv, top, skip

    def visit_Import(self, node):
        return None

    visit_ImportFrom = visit_Import

    def visit_Attribute(self, node):
        if self.mv and self.top and isinstance(node.value, ast.Name) and node.value.id == TOP and node.attr in self.mv.names:
            return ast.Attribute(value=ast.Attribute(value=node.value, attr=self.mv.names[node.attr], ctx=ast.Load()), attr=node.attr, ctx=node.ctx)
        return self.generic_visit(node)

    def visit_Constant(self, node):
        if self.mv and isinstance(node.value, str) and id(node) not in self.skip and self.mv.exact.match(node.value):
            return ast.Constant(value=self.mv.new_dotted(node.value))
        return node


def dump(tree: ast.AST, mv: Moves | None) -> str:
    top, skip = binds_top(tree), docstring_ids(tree) | fstring_ids(tree)
    return ast.dump(Strip(mv, top, skip).visit(copy.deepcopy(tree)))   # a copy: the transformer takes the imports out


def prove_syntax(plan: Plan, mv: Moves) -> list[str]:
    bad = []
    new_rel_of = {**{v: k for k, v in plan.renames.items()}}
    for new_rel, text in plan.new.items():
        if not new_rel.endswith(".py") or new_rel in plan.created or new_rel == f"{SERVER}/__init__.py":
            continue                                     # what the tool writes itself is not compared
        old_rel = new_rel_of.get(new_rel, new_rel)
        if old_rel not in plan.old:
            continue
        a, b = ast.parse(plan.old[old_rel]), ast.parse(text)
        if dump(a, mv) != dump(b, None):
            bad.append(f"{new_rel}: its syntax tree changed beyond its imports")
        want = [(k, mv.map_from(m, n) if k == "from" and isinstance(m, str) and n != "*" else
                 (mv.new_dotted(m) if isinstance(m, str) else m), n, asn)
                for (k, m, n, asn) in bindings(a, package_of(old_rel))]
        got = bindings(b, package_of(new_rel))
        if sorted(map(repr, want)) != sorted(map(repr, got)):      # a split statement reorders, so compared as sets
            bad.append(f"{new_rel}: its imports bind something else after the rewrite:\n      {sorted(set(map(repr, want)) ^ set(map(repr, got)))[:6]}")
    return bad


PROVE_SCRIPT = r"""
import importlib, json, sys
spec = json.loads(sys.argv[2])
SKIP = set(spec["skip"])
def names(m):
    return sorted(n for n in vars(m) if n not in SKIP)
out = {"bad": [], "names": {}, "errors": {}}
mode = sys.argv[1]
for old, new in spec["pairs"]:
    if mode != "before" and old not in spec["names"]:
        continue                                  # it did not import before either: the errors say so
    try:
        if mode == "before":
            out["names"][old] = names(importlib.import_module(old))
            continue
        first, second = (new, old) if mode == "new" else (old, new)
        a = importlib.import_module(first)
        b = importlib.import_module(second)
        n, o = (a, b) if mode == "new" else (b, a)
        if n is not o:
            out["bad"].append(f"{old} and {new} are two different module objects")
            continue
        mine = set(spec.get("submodules", {}).get(old, []))
        if [x for x in names(n) if x not in mine or x in spec["names"][old]] != spec["names"][old]:
            gone = sorted(set(spec["names"][old]) - set(names(n))); extra = sorted(set(names(n)) - set(spec["names"][old]) - mine)
            out["bad"].append(f"{new}: top-level names differ (lost {gone[:8]}, new {extra[:8]})")
        for k in spec["names"][old]:
            if getattr(n, k, None) is not getattr(o, k, None):
                out["bad"].append(f"{new}.{k} is not the same object through the alias")
        leaf = old.rsplit(".", 1)[1]
        ns = {}
        exec(f"from mantel_server import {leaf} as X", ns)
        if ns["X"] is not n:
            out["bad"].append(f"`from mantel_server import {leaf}` is not {new}")
        ns = {}
        exec(f"import {old} as X; import {old}", ns)
        if ns["X"] is not n or ns["mantel_server"].__dict__.get(leaf) is not n:
            out["bad"].append(f"`import {old}` is not {new}")
    except BaseException as err:
        out["errors"][old] = f"{type(err).__name__}: {str(err)[:200]}"
if mode != "alias":
    for m in spec["all"]:
        try:
            importlib.import_module(m)
        except BaseException as err:
            out["errors"][m] = f"{type(err).__name__}: {str(err)[:200]}"
print(json.dumps(out))
"""


def run_imports(tree: Path, mode: str, spec: dict) -> dict:
    env = dict(os.environ, PYTHONPATH=f"{tree}:{tree}/hosts/server", PYTHONHASHSEED="0")
    run = subprocess.run([PY, "-c", PROVE_SCRIPT, mode, json.dumps(spec)], capture_output=True, text=True, env=env, cwd=tree, timeout=600)
    if run.returncode or not run.stdout.strip():
        raise Refusal(f"importing in {tree} failed:\n{run.stderr[-1500:]}")
    return json.loads(run.stdout.strip().splitlines()[-1])


def server_modules(tree: Path) -> list[str]:
    rels = (p.relative_to(tree).as_posix() for p in (tree / SERVER).rglob("*.py"))
    return sorted(dotted_module(r) for r in rels if not r.endswith("__main__.py") and "/static/" not in r and "__pycache__" not in r)


def before_names(plan: Plan) -> tuple[dict, dict]:
    pairs = [[f"{TOP}.{m}", f"{TOP}.{plan.package}.{m}"] for m in plan.moves]
    # (the init keeps its name: the same names before and after, but for its own submodules, which a package's
    # namespace gains as they are imported)
    extra = {}
    if plan.init:
        pairs.append([f"{TOP}.{plan.init}", f"{TOP}.{plan.init}"])
        extra[f"{TOP}.{plan.init}"] = sorted(plan.moves)
    spec = {"pairs": pairs, "skip": sorted(MODULE_ATTRS), "all": server_modules(plan.root), "submodules": extra}
    return spec, run_imports(plan.root, "before", spec)


def prove_imports(plan: Plan, tree: Path, before_spec: dict, before: dict) -> list[str]:
    mv = Moves(plan.moves)
    spec = dict(before_spec, names=before["names"], all=server_modules(tree))
    bad = []
    got_new = run_imports(tree, "new", spec)
    got_alias = run_imports(tree, "alias", spec)
    bad += got_new["bad"] + [f"(alias first) {b}" for b in got_alias["bad"]]
    was = {mv.new_dotted(k): v for k, v in before["errors"].items()}
    for mod, err in sorted(got_new["errors"].items()):
        if mod not in was:
            bad.append(f"{mod} no longer imports: {err}")
    for mod, err in sorted(got_alias["errors"].items()):
        bad.append(f"(alias first) {mod}: {err}")
    return bad


def prove_static(plan: Plan, tree: Path, mv: Moves, whole: bool) -> list[str]:
    """No file imports an old path: a second plan over the finished texts finds nothing to rewrite. (On the copy, only the
    files the plan changed are there to read; every other file needed no rewrite, which is what the plan found.)"""
    bad = []
    rels = listed(tree, "*.py") if whole else [r for r in plan.new if r.endswith(".py")]
    for rel in rels:
        if rel.endswith("/_moved.py"):
            continue
        text = plan.new[rel] if rel in plan.new and not whole else (tree / rel).read_text(errors="replace")
        if not (rel.startswith(SERVER + "/") or TOP in text):
            continue
        try:
            edit = rewrite_file(rel, rel, text, mv, [])
        except Refusal as err:
            bad.append(str(err))
            continue
        if edit is not None:
            bad.append(f"{rel}: still names an old path")
    return bad


def prove_compile(plan: Plan, tree: Path) -> list[str]:
    bad = []
    files = [r for r in plan.new if r.endswith(".py")]
    for rel in files:
        try:
            compile(plan.new[rel], rel, "exec")
        except SyntaxError as err:
            bad.append(f"{rel}: {err}")
    here = [str(tree / r) for r in files if (tree / r).is_file()]
    if here:
        run = subprocess.run([PY, "-m", "compileall", "-q", *here], capture_output=True, text=True)
        if run.returncode:
            bad.append("compileall: " + (run.stdout + run.stderr)[-800:])
    return bad


def prove(plan: Plan, tree: Path, mv: Moves, before_spec: dict, before: dict, whole: bool) -> list[str]:
    return prove_syntax(plan, mv) + prove_static(plan, tree, mv, whole) + prove_compile(plan, tree) + prove_imports(plan, tree, before_spec, before)


# ------------------------------------------------------------------------------------------------ main
def load_manifest(name: str, root: Path = ROOT) -> dict:
    p = Path(name) if name.endswith(".json") else root / MANIFESTS / f"{name}.json"
    if not p.is_file():
        raise Refusal(f"no manifest {p}")
    return json.loads(p.read_text())


def report(plan: Plan, tail: str) -> None:
    c = plan.counts
    print(f"{plan.package}: {len(plan.renames)} modules into {SERVER}/{plan.package}/; {c['files']} files change "
          f"({', '.join(f'{a}: {n}' for a, n in sorted(plan.areas.items()))}); {c['imports']} import statements, {c['attrs']} "
          f"attribute uses, {c['strings']} dotted strings rewritten; {len(plan.json_paths)} JSON data files by path")
    for label, items in (("look at", plan.notes), ("non-Python files that name a moved module (not rewritten)", plan.mentions)):
        if items:
            print(f"  {label}:")
            print("\n".join("    " + i for i in items[:60]) + (f"\n    ... and {len(items) - 60} more" if len(items) > 60 else ""))
    print(f"  aliases: {len(plan.moves)} rows in {SERVER}/_moved.py, each goes away in {plan.until}")
    reminders = ["tools/route_table.py --write (the lock and docs/development/Routes.md are keyed by module path"
                 + (f"; {', '.join(plan.regenerate)} name moved modules)" if plan.regenerate else ")"),
                 "tools/code_map.py (docs/development/Code-map.md)"]
    print("  then run: " + "; ".join(reminders))
    print(tail)


def run_move(root: Path, man: dict, check_only: bool, until: str | None = None, allow_dirty: bool = False) -> int:
    try:
        plan = make_plan(root, man, until, check_dirty=not check_only and not allow_dirty)
    except Refusal as err:
        print(f"{man.get('package', '?')}: refused:\n  - {err}")
        return 1
    if plan.refusals:
        print(f"{man.get('package', '?')}: refused:\n" + "\n".join("  - " + r for r in plan.refusals))
        return 1
    mv = Moves(plan.moves)
    before_spec, before = before_names(plan)
    with tempfile.TemporaryDirectory(prefix="move_py-") as td:
        tree = Path(td)
        copy_tree(root, tree)
        apply_plan(plan, tree, use_git=False)
        bad = prove(plan, tree, mv, before_spec, before, False)
    if bad:
        print(f"{plan.package}: the proof failed:\n" + "\n".join("  - " + b for b in bad))
        return 1
    proven = (f"  proven on a copy: every file's syntax tree the same but its imports, {len(plan.moves)} modules the same object "
              f"at the new path and through the alias (both orders), the same names, every server module imports, no old path left, "
              f"compileall clean")
    if check_only:
        report(plan, proven + "\n  --check: nothing written")
        return 0
    apply_plan(plan, root, use_git=True)
    bad = prove(plan, root, mv, before_spec, before, True)
    if bad:
        print(f"{plan.package}: written, and the proof on the tree failed:\n" + "\n".join("  - " + b for b in bad))
        return 1
    report(plan, proven + "\n  written and proven again on the tree (staged, not committed)")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest", nargs="?")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--until", metavar="VERSION")
    ap.add_argument("--allow-dirty", action="store_true")
    ap.add_argument("--expired", metavar="VERSION")
    a = ap.parse_args(argv)
    if a.expired:
        rows = expired(a.expired)
        print("\n".join(rows) if rows else f"no alias goes away in {a.expired} or before")
        return 0
    if not a.manifest:
        ap.error("name a manifest")
    try:
        return run_move(ROOT, load_manifest(a.manifest), a.check, a.until, a.allow_dirty)
    except Refusal as err:
        print(f"refused: {err}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
