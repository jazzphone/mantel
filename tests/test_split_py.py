"""tools/split_py.py (phase 24, A3: docs/phase24/CLEAN-CODE.md): a big Python module cut into parts by name, and proved.

On a synthetic module in a temporary package: the package mode's proof (each statement's syntax tree, the same names, the
same objects), a relative import one level deeper, the refusals (a later part, a name bound in two parts, an import-time
read before a later binder, a monkeypatched name apart from its reader) and a planted mistake the proof catches.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _tool():
    spec = importlib.util.spec_from_file_location("split_py", ROOT / "tools/split_py.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["split_py"] = mod
    spec.loader.exec_module(mod)
    return mod


SOURCE = '''"""A module to cut."""
from __future__ import annotations

import json
from . import helper as H

LIMIT = 3
# the names, two of them
NAMES = ("a",
         "b")
NAMES += ("c",)


def twice(n: int) -> int:
    return n * LIMIT


def show() -> str:
    from .helper import word
    return json.dumps([twice(2), word(), H.WORD])


class Box:
    size = LIMIT

    def total(self) -> int:
        return twice(self.size)
'''

MAN = {"module": "pkg/mod.py", "mode": "package", "name": "mod",
       "parts": [{"name": "base", "title": "the limits", "members": ["LIMIT", "NAMES"]},
                 {"name": "maths", "title": "the maths", "members": ["twice"]},
                 {"name": "rest", "title": "the rest", "rest": True, "members": []}]}


@pytest.fixture()
def tree(tmp_path, monkeypatch):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg/__init__.py").write_text("")
    (tmp_path / "pkg/helper.py").write_text("WORD = 'w'\n\ndef word():\n    return WORD\n")
    (tmp_path / "pkg/mod.py").write_text(SOURCE)
    (tmp_path / "tests").mkdir()
    tool = _tool()
    monkeypatch.setattr(tool, "ROOT", tmp_path)
    return tool, tmp_path


def test_a_module_becomes_a_package_and_the_proof_holds(tree):
    tool, root = tree
    assert tool.do_split(json.loads(json.dumps(MAN)), check_only=False) == 0
    assert "# the names, two of them\nNAMES = (" in (root / "pkg/mod/base.py").read_text()   # its comment with it, nothing more
    pkg = root / "pkg/mod"
    assert sorted(p.name for p in pkg.glob("*.py")) == ["__init__.py", "base.py", "maths.py", "rest.py"]
    rest = (pkg / "rest.py").read_text()
    assert "    from ..helper import word" in rest                     # one level deeper
    assert "from .maths import twice" in rest and "from .base import LIMIT" in rest
    init = (pkg / "__init__.py").read_text()
    assert "from .base import LIMIT, NAMES" in init and "'twice'," in init
    out = subprocess.run([sys.executable, "-c", "import pkg.mod as m; print(m.show(), m.NAMES, m.Box().total())"],
                         cwd=root, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.split() == ['[6,', '"w",', '"w"]', "('a',", "'b',", "'c')", "9"]


def test_it_refuses_what_a_move_would_change(tree, tmp_path):
    tool, root = tree

    def refused(edit, why, source=SOURCE):
        man = json.loads(json.dumps(MAN))
        edit(man)
        plan = tool.make_plan(man, source)
        assert any(why in r for r in plan.refusals), plan.refusals

    # a part that uses a later part
    refused(lambda m: m["parts"][0]["members"].append("show"), "of the later part")
    # NAMES += ... is a binder: it goes with NAMES (the tool puts an unnamed statement with the one before it, so name the
    # binder's neighbor elsewhere to force the split)
    src = SOURCE.replace('NAMES += ("c",)', 'EXTRA = 1\nNAMES += ("c",)')
    refused(lambda m: m["parts"][1]["members"].append("EXTRA"), "binds `NAMES`", src)
    # an import-time read before a later binder
    src2 = SOURCE.replace('NAMES += ("c",)', 'FIRST = NAMES[0]\nNAMES += ("c",)')
    refused(lambda m: m["parts"][1]["members"].append("FIRST"), "at import time", src2)


def test_a_monkeypatched_name_stays_with_its_readers(tree):
    tool, root = tree
    (root / "tests/test_x.py").write_text("import pkg.mod as M\n\ndef test(monkeypatch):\n    monkeypatch.setattr(M, 'LIMIT', 9)\n")
    plan = tool.make_plan(json.loads(json.dumps(MAN)), SOURCE)
    assert any("monkeypatched" in r and "`LIMIT`" in r for r in plan.refusals)


def test_the_proof_catches_a_planted_change(tree):
    tool, root = tree
    plan = tool.make_plan(json.loads(json.dumps(MAN)), SOURCE)
    files = tool.build(plan)
    files["pkg/mod/maths.py"] = files["pkg/mod/maths.py"].replace("return n * LIMIT", "return n * LIMIT + 1")
    assert any("twice" in b for b in tool.prove(plan, files))
    ast.parse(files["pkg/mod/rest.py"])


# ------------------------------------------------------------------------------------------------ lazy mode
LAZY_SOURCE = '''"""A module whose parts call each other."""
from __future__ import annotations

TABLE = {"a": 1}
FACTOR = 2


def early(x):
    """Doc."""
    return helper(x) + TABLE["a"] * FACTOR


# a mutation of TABLE, far from it
TABLE["b"] = 2
LATER = TABLE["b"] + 1


def helper(x):
    return x + LATER


class Box:
    def total(self):
        return early(1)

    def twice(self):
        from .helper import word
        return word() * 2
'''

LAZY_MAN = {"module": "pkg/mod.py", "mode": "package", "name": "mod", "lazy": True,
            "parts": [{"name": "base", "title": "the table and the first caller", "members": ["TABLE", "FACTOR", "early"]},
                      {"name": "tail", "title": "the rest", "rest": True, "members": []}]}


def _lazy(tree, source=LAZY_SOURCE, edit=None):
    tool, root = tree
    (root / "pkg/mod.py").write_text(source)
    man = json.loads(json.dumps(LAZY_MAN))
    if edit:
        edit(man)
    return tool, root, man


def test_lazy_a_call_to_a_later_part_imports_it_inside_the_function(tree):
    tool, root, man = _lazy(tree)
    assert tool.do_split(man, check_only=False) == 0
    base = (root / "pkg/mod/base.py").read_text()
    assert '    """Doc."""\n    from .tail import helper\n    return helper(x)' in base       # after the docstring, nothing else changed
    assert base.index('TABLE["b"] = 2') > base.index("TABLE = {")            # the mutation went with its table
    tail = (root / "pkg/mod/tail.py").read_text()
    assert "from .base import early, TABLE\n" in tail and "from .tail" not in tail   # the earlier part at the top: what the tail reads itself
    #                                                               (not FACTOR, which only `early` reads)
    assert "        from ..helper import word" in tail                         # (a relative import in a moved function: one dot more)
    out = subprocess.run([sys.executable, "-c", "import pkg.mod as m; print(m.early(1), m.TABLE, m.LATER)"],
                         cwd=root, capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "6 {'a': 1, 'b': 2} 3"


def test_lazy_refuses_what_a_late_import_cannot_do(tree):
    tool, root, man = _lazy(tree)
    src = "def helper():\n    return 1\n\n\ndef early():\n    return helper()\n\n\nVALUE = early()\n"
    # an import-time call reaches a later part through a function: its late import would find the part not loaded
    man["parts"][0]["members"] = ["early", "VALUE"]
    assert any("through `early`" in r and "later part" in r for r in tool.make_plan(man, src).refusals)
    # a lambda made at import time has no place for a late import
    src = "def helper(v):\n    return v\n\n\nHANDLERS = {\"a\": lambda v: helper(v)}\n"
    man["parts"][0]["members"] = ["HANDLERS"]
    assert any("`helper` of the later part" in r for r in tool.make_plan(man, src).refusals)
    # a name apart from the place it is bound
    man["parts"][0]["members"] = ["TABLE"]
    plan = tool.make_plan(man, LAZY_SOURCE)
    assert plan.refusals == []                                               # (the mutation goes with TABLE by itself)
    assert plan.owner["TABLE"] == 0 and next(s for s in plan.stmts if s.kind == "assign" and not s.names).part == 0
    # a package is not a module that stays
    man["mode"] = "siblings"
    assert any("lazy" in r for r in tool.make_plan(man, LAZY_SOURCE).refusals)


def test_lazy_proof_catches_a_planted_change(tree):
    tool, root, man = _lazy(tree)
    plan = tool.make_plan(man, LAZY_SOURCE)
    files = tool.build(plan)
    assert tool.prove(plan, files) == []
    base = "pkg/mod/base.py"
    # a late import taken out: the function reads a name nothing gives it, and the plan's import is missing
    gone = dict(files, **{base: files[base].replace("    from .tail import helper\n", "")})
    bad = tool.prove(plan, gone)
    assert any("late imports" in b for b in bad) and any("`helper`, which nothing in it defines" in b for b in bad)
    # a late import that brings in more than the plan says
    more = dict(files, **{base: files[base].replace("import helper", "import helper, LATER")})
    assert any("late imports" in b for b in tool.prove(plan, more))
    # the body changed as well
    changed = dict(files, **{base: files[base].replace('TABLE["a"]', 'TABLE["b"]')})
    assert any("early" in b for b in tool.prove(plan, changed))


def test_a_name_the_tests_patch_on_a_package_is_refused(tree):
    tool, root = tree
    (root / "tests/test_x.py").write_text("import pkg.mod as M\n\ndef test(monkeypatch):\n    monkeypatch.setattr(M, 'LATER', 9)\n")
    (root / "pkg/mod.py").write_text(LAZY_SOURCE)
    man = json.loads(json.dumps(LAZY_MAN))
    man["parts"][0]["members"] += ["LATER"]                                # in the part with its reader: still the package's attribute
    man["parts"][0]["members"].append("helper")
    assert any("monkeypatched" in r and "`LATER`" in r and "__init__" in r for r in tool.make_plan(man, LAZY_SOURCE).refusals)
