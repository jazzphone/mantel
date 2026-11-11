"""tools/move_py.py (phase 25, Part C): flat server modules moved into a package, every import rewritten by the syntax tree, the old
paths kept as lazy aliases for one release, and all of it proved.

On a throwaway `mantel_server` in a temporary git repo (a root module, a subpackage with relative imports, tests and tools that
import in every form, a monkeypatch string): the move and the rewritten text, `--check` writing nothing, the aliases (lazy, and the
same object), a second package added to the same table, the refusals (a file lookup, sibling parts, a missing module, a dirty
tree, a comment inside an import), and planted mistakes the proof catches.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = "hosts/server/mantel_server"


def _tool():
    spec = importlib.util.spec_from_file_location("move_py", ROOT / "tools/move_py.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["move_py"] = mod
    spec.loader.exec_module(mod)
    return mod


mp = _tool()

FILES = {
    f"{SERVER}/__init__.py": "\n",
    f"{SERVER}/store.py": '''"""The store."""
from __future__ import annotations

LIMIT = 3


def accounts_seen() -> list:
    from . import accounts
    return accounts.ACCOUNTS
''',
    f"{SERVER}/auth.py": '''"""Auth."""
from __future__ import annotations

from .store import LIMIT


def check(n: int) -> bool:
    return n < LIMIT
''',
    f"{SERVER}/accounts.py": '''"""Accounts."""
from __future__ import annotations

import json
from . import store, auth  # the two it reads
from .store import LIMIT

ACCOUNTS = ["a", "b"]
_private = json.dumps(ACCOUNTS)


def count() -> int:
    return LIMIT + len(ACCOUNTS) + int(auth.check(1)) + store.LIMIT
''',
    f"{SERVER}/other.py": '''"""Stays where it is."""
from __future__ import annotations

import mantel_server.accounts
from mantel_server import auth, store


def n() -> int:
    return len(mantel_server.accounts.ACCOUNTS) + store.LIMIT + int(auth.check(2))
''',
    f"{SERVER}/sub/__init__.py": "",
    f"{SERVER}/sub/api.py": '''"""A subpackage."""
from __future__ import annotations

from .. import accounts, store
from ..auth import check
from . import local


def go() -> int:
    return accounts.count() + store.LIMIT + int(check(0)) + local.ONE
''',
    f"{SERVER}/sub/local.py": '''"""Local."""
from __future__ import annotations

from .. import auth

ONE = int(auth.check(0))
''',
    "tests/test_x.py": '''import pytest
import mantel_server.auth as A
from mantel_server import accounts
from mantel_server.accounts import ACCOUNTS


def test_it(monkeypatch):
    monkeypatch.setattr("mantel_server.accounts.ACCOUNTS", ["z"])
    assert accounts.ACCOUNTS == ["z"] and A.check(1)
    note = "mantel_server.accounts is mentioned here, in a longer string"
    assert note
''',
    "tools/t.py": '''from mantel_server.accounts import count
print(count())
''',
    "tests/fixtures/line_widths.json": json.dumps({f"{SERVER}/accounts.py": 0, f"{SERVER}/store.py": 1}),
    "pyproject.toml": 'version = "0.1.5"\n',
    "Dockerfile": "CMD python -m mantel_server.accounts\n",
}
MAN = {"package": "identity", "modules": ["accounts", "auth"], "why": "Who may do what", "alias_until": "0.1.7"}


def _git(root, *a):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@e.test", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@e.test")
    return subprocess.run(["git", *a], cwd=root, check=True, capture_output=True, text=True, env=env).stdout


def make(tmp_path: Path, extra: dict | None = None) -> Path:
    for rel, text in {**FILES, **(extra or {})}.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "start")
    return tmp_path


def py(root: Path, code: str) -> subprocess.CompletedProcess:
    env = dict(os.environ, PYTHONPATH=f"{root}:{root}/hosts/server")
    return subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, env=env)


def read(root: Path, rel: str) -> str:
    return (root / rel).read_text()


# ------------------------------------------------------------------------------------------------ the move
def test_move_rewrites_every_form_and_proves(tmp_path, capsys):
    root = make(tmp_path)
    assert mp.run_move(root, dict(MAN), check_only=False) == 0, capsys.readouterr().out
    assert not (root / SERVER / "accounts.py").exists()
    assert (root / SERVER / "identity/accounts.py").is_file() and (root / SERVER / "identity/auth.py").is_file()
    assert 'Who may do what.\n\nModules: accounts, auth.' in read(root, f"{SERVER}/identity/__init__.py")
    # a moved module: its own relative imports redone for the new depth, siblings that moved and that did not; comments stay
    acc = read(root, f"{SERVER}/identity/accounts.py")
    assert "import json\nfrom .. import store\nfrom . import auth  # the two it reads\nfrom ..store import LIMIT\n" in acc   # one statement split in two
    assert "    from .identity import accounts\n" in read(root, f"{SERVER}/store.py")                          # a function-level import
    assert read(root, f"{SERVER}/identity/auth.py").count("from ..store import LIMIT") == 1
    # every importer: relative from a subpackage, absolute, `import a.b` (and the code's own use of it), `as`, a split `from`
    api = read(root, f"{SERVER}/sub/api.py")
    assert "from ..identity import accounts\nfrom .. import store\nfrom ..identity.auth import check\nfrom . import local\n" in api
    assert "from ..identity import auth" in read(root, f"{SERVER}/sub/local.py")
    other = read(root, f"{SERVER}/other.py")
    assert "import mantel_server.identity.accounts" in other and "mantel_server.identity.accounts.ACCOUNTS" in other
    assert "from mantel_server.identity import auth\nfrom mantel_server import store\n" in other
    test = read(root, "tests/test_x.py")
    assert "import mantel_server.identity.auth as A" in test and "from mantel_server.identity import accounts" in test
    assert "from mantel_server.identity.accounts import ACCOUNTS" in test
    assert 'monkeypatch.setattr("mantel_server.identity.accounts.ACCOUNTS"' in test         # an exact dotted string
    assert '"mantel_server.accounts is mentioned here, in a longer string"' in test         # a longer one is only reported
    assert "from mantel_server.identity.accounts import count" in read(root, "tools/t.py")
    assert f"{SERVER}/identity/accounts.py" in read(root, "tests/fixtures/line_widths.json")  # data keyed by file path
    assert read(root, "Dockerfile") == FILES["Dockerfile"]                                            # reported, never rewritten
    # the aliases, the table, the hook
    table = read(root, f"{SERVER}/_moved.py")
    assert '"accounts": ("identity.accounts", "0.1.7"),' in table and '"auth": ("identity.auth", "0.1.7"),' in table
    assert "_moved.install()" in read(root, f"{SERVER}/__init__.py")
    # moved with git mv: the old path is gone from the index and the new one is in it, staged
    tracked = _git(root, "ls-files").split()
    assert f"{SERVER}/identity/accounts.py" in tracked and f"{SERVER}/accounts.py" not in tracked
    # the moved tree runs: the importer with the code's own use, the tools, and the tests (monkeypatch string included)
    assert py(root, "import mantel_server.other as o; print(o.n())").stdout.strip() == "6"
    assert py(root, "import runpy; runpy.run_path('tools/t.py')").returncode == 0
    run = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_x.py"], cwd=root, capture_output=True,
                         text=True, env=dict(os.environ, PYTHONPATH=f"{root}:{root}/hosts/server"))
    assert run.returncode == 0, run.stdout + run.stderr


def test_check_writes_nothing(tmp_path, capsys):
    root = make(tmp_path)
    assert mp.run_move(root, dict(MAN), check_only=True) == 0
    out = capsys.readouterr().out
    assert "proven on a copy" in out and "--check: nothing written" in out and "tools/route_table.py --write" in out
    assert "Dockerfile:1" in out                                    # a non-Python mention is reported, not rewritten
    assert "tests/test_x.py:" in out and "a string mentions a moved module" in out
    assert _git(root, "status", "--porcelain") == ""
    assert (root / SERVER / "accounts.py").is_file() and not (root / SERVER / "identity").exists()


def test_aliases_are_lazy_and_the_same_object(tmp_path):
    root = make(tmp_path)
    assert mp.run_move(root, dict(MAN), check_only=False) == 0
    code = """
import sys
import mantel_server
assert not any(k.startswith('mantel_server.') and k != 'mantel_server._moved' for k in sys.modules), sorted(sys.modules)   # lazy
from mantel_server import accounts
import mantel_server.accounts as b
import mantel_server.identity.accounts as c
assert accounts is b is c and sys.modules['mantel_server.accounts'] is c
assert c.__spec__.name == 'mantel_server.identity.accounts' and c.__name__ == 'mantel_server.identity.accounts'
import mantel_server.auth
assert mantel_server.auth is mantel_server.identity.auth and mantel_server.accounts is c
assert 'mantel_server.sub' not in sys.modules
print('ok')
"""
    run = py(root, code)
    assert run.stdout.strip() == "ok", run.stderr
    # a patch through either path reaches both
    run = py(root, "import mantel_server.accounts as a, mantel_server.identity.accounts as b\na.ACCOUNTS = [1]\nassert b.ACCOUNTS == [1]\nprint('ok')")
    assert run.stdout.strip() == "ok", run.stderr


def test_second_package_adds_rows_and_old_rows_expire(tmp_path):
    root = make(tmp_path)
    assert mp.run_move(root, dict(MAN), check_only=False) == 0
    _git(root, "commit", "-qam", "identity")
    assert mp.run_move(root, {"package": "data", "modules": ["store"], "why": "Where it is kept", "alias_until": "0.1.8"}, check_only=False) == 0
    table = read(root, f"{SERVER}/_moved.py")
    assert len(mp.moved_rows(table)) == 3 and '"store": ("data.store", "0.1.8")' in table and '"accounts": ("identity.accounts"' in table
    # the second move found the first's code at its new places, and rewrote what pointed at the old store
    assert "from ..data import store" in read(root, f"{SERVER}/sub/api.py") or "from ..data import store" in read(root, f"{SERVER}/identity/accounts.py")
    assert py(root, "import mantel_server.store as s, mantel_server.data.store as d; assert s is d; print('ok')").stdout.strip() == "ok"
    assert mp.expired("0.1.7", root) == ["accounts: mantel_server.identity.accounts (goes away in 0.1.7)",
                                         "auth: mantel_server.identity.auth (goes away in 0.1.7)"]


# ------------------------------------------------------------------------------------------------ the refusals
def refused(root, man, capsys, **kw):
    assert mp.run_move(root, man, check_only=True, **kw) == 1
    return capsys.readouterr().out


def test_refuses_a_file_lookup_unless_checked(tmp_path, capsys):
    root = make(tmp_path, {f"{SERVER}/finder.py": 'from pathlib import Path\nDATA = Path(__file__).with_name("data")\n'})
    out = refused(root, {**MAN, "modules": ["finder"]}, capsys)
    assert "finds files beside itself" in out and "finder.py:2: __file__" in out
    assert mp.run_move(root, {**MAN, "modules": ["finder"], "checked": {"finder": "data moved with it"}}, check_only=True) == 0


def test_refuses_sibling_parts_apart(tmp_path, capsys):
    root = make(tmp_path, {f"{SERVER}/music.py": "X = 1\n", f"{SERVER}/music_names.py": "Y = 2\n",
                           "tools/split_py_manifests/music.json": json.dumps({"module": f"{SERVER}/music.py", "mode": "siblings",
                                                                               "parts": [{"name": "names", "members": ["Y"]}]})})
    out = refused(root, {**MAN, "modules": ["music"]}, capsys)
    assert "sibling parts move together" in out and "music_names" in out
    assert mp.run_move(root, {**MAN, "modules": ["music", "music_names"]}, check_only=True) == 0


def test_siblings_manifest_module_path_follows_the_move(tmp_path):
    root = make(tmp_path, {f"{SERVER}/music.py": "X = 1\n", f"{SERVER}/music_names.py": "Y = 2\n",
                           "tools/split_py_manifests/music.json": json.dumps({"module": f"{SERVER}/music.py", "mode": "siblings",
                                                                               "parts": [{"name": "names", "members": ["Y"]}]})})
    assert mp.run_move(root, {**MAN, "modules": ["music", "music_names"]}, check_only=False) == 0
    assert json.loads(read(root, "tools/split_py_manifests/music.json"))["module"] == f"{SERVER}/identity/music.py"


def test_refuses_missing_untracked_and_taken(tmp_path, capsys):
    root = make(tmp_path)
    (root / SERVER / "loose.py").write_text("X = 1\n")
    (root / SERVER / "identity").mkdir()
    (root / SERVER / "identity/__init__.py").write_text("")
    (root / SERVER / "identity/auth.py").write_text("")
    out = refused(root, {**MAN, "modules": ["nope", "loose", "auth"]}, capsys)
    assert "`nope`: not a flat module" in out and "`loose`" in out and "is not tracked" in out and "identity/auth.py already exists" in out
    out = refused(root, {**MAN, "package": "store", "modules": ["auth"]}, capsys)
    assert "`store` is already a module" in out
    out = refused(root, {"package": "x", "modules": []}, capsys)
    assert "needs" in out or "refused" in out


def test_refuses_a_dirty_tree_and_a_comment_inside_an_import(tmp_path, capsys):
    root = make(tmp_path)
    (root / "tools/t.py").write_text("from mantel_server.accounts import count  # dirty\n")
    assert mp.run_move(root, dict(MAN), check_only=False) == 1
    assert "uncommitted changes" in capsys.readouterr().out
    assert (root / SERVER / "accounts.py").is_file()
    _git(root, "checkout", "tools/t.py")
    (root / "tools/u.py").write_text("from mantel_server import (\n    accounts,  # first\n    store,\n)\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-qm", "u")
    out = refused(root, dict(MAN), capsys)
    assert "has a comment inside it" in out and "tools/u.py:1" in out


def test_a_split_import_in_an_if_on_one_line_is_refused(tmp_path, capsys):
    root = make(tmp_path, {"tools/v.py": "if True: from mantel_server import accounts, store\n"})
    assert "would have to split" in refused(root, dict(MAN), capsys)


# ------------------------------------------------------------------------------------------------ the proof catches mistakes
def _plan(root):
    return mp.make_plan(root, dict(MAN))


def test_proof_catches_a_changed_body(tmp_path):
    root = make(tmp_path)
    plan = _plan(root)
    mv = mp.Moves(plan.moves)
    assert mp.prove_syntax(plan, mv) == []
    rel = f"{SERVER}/identity/accounts.py"
    plan.new[rel] = plan.new[rel].replace('ACCOUNTS = ["a", "b"]', 'ACCOUNTS = ["a", "c"]')
    assert any("beyond its imports" in b for b in mp.prove_syntax(plan, mv))


def test_proof_catches_a_wrong_relative_level(tmp_path):
    root = make(tmp_path)
    plan = _plan(root)
    mv = mp.Moves(plan.moves)
    rel = f"{SERVER}/identity/auth.py"
    assert "from ..store import LIMIT" in plan.new[rel]
    plan.new[rel] = plan.new[rel].replace("from ..store import LIMIT", "from .store import LIMIT")          # the level a move forgot
    bad = mp.prove_syntax(plan, mv)
    assert any("bind something else" in b for b in bad), bad


def test_proof_catches_an_old_path_left_behind(tmp_path):
    root = make(tmp_path)
    plan = _plan(root)
    mv = mp.Moves(plan.moves)
    mp.apply_plan(plan, root, use_git=False)
    (root / "tools/t.py").write_text("from mantel_server.accounts import count\n")
    assert any("tools/t.py: still names an old path" in b for b in mp.prove_static(plan, root, mv, whole=True))


def test_proof_catches_a_module_that_changed_its_names(tmp_path, capsys):
    root = make(tmp_path)
    plan = _plan(root)
    spec, before = mp.before_names(plan)
    work = tmp_path.parent / (tmp_path.name + "-copy")
    work.mkdir()
    mp.copy_tree(root, work)
    mp.apply_plan(plan, work, use_git=False)
    assert mp.prove_imports(plan, work, spec, before) == []
    (work / SERVER / "identity/accounts.py").write_text(read(work, f"{SERVER}/identity/accounts.py") + "\nEXTRA = 1\n")
    assert any("top-level names differ" in b for b in mp.prove_imports(plan, work, spec, before))


def test_rewrite_keeps_text_outside_the_statement_byte_for_byte(tmp_path):
    mv = mp.Moves({"accounts": "identity"})
    src = "# a comment\nimport os  # keep\nfrom mantel_server import accounts  # noqa: F401\n\n\ndef f():\n    from . import accounts as A\n    return A\n"
    edit = mp.rewrite_file(f"{SERVER}/x.py", f"{SERVER}/x.py", src, mv, [])
    assert edit.text == src.replace("from mantel_server import accounts", "from mantel_server.identity import accounts").replace(
        "from . import accounts as A", "from .identity import accounts as A")


def test_long_statements_wrap(tmp_path):
    mv = mp.Moves({"accounts": "identity"})
    names = ", ".join(f"name_number_{i}" for i in range(12))
    src = f"from mantel_server.accounts import {names}\n"
    edit = mp.rewrite_file("tools/x.py", "tools/x.py", src, mv, [])
    assert edit.text.startswith("from mantel_server.identity.accounts import (\n    name_number_0,") and edit.text.endswith("\n)\n")
    assert all(len(line) <= 118 for line in edit.text.splitlines())


def test_the_real_manifests_load():
    for name in ("identity", "ha"):
        man = mp.load_manifest(name)
        assert man["package"] == name and man["modules"] and man["why"]
