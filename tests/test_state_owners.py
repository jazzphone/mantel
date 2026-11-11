"""docs/phase25/SAVER-STATE.md is what tools/state_owners.py writes from the screensaver today, every ST name has an
owner, and the owners already moved stay their names' only writers (phase 25, Part A)."""
from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def tool():
    spec = importlib.util.spec_from_file_location("state_owners", ROOT / "tools/state_owners.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pytestmark = pytest.mark.skipif(not shutil.which("node") or not (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file(),
                                reason="needs Node.js and the pinned TypeScript (tools/typecheck: npm ci)")


def test_the_saver_state_map_is_fresh_and_every_owner_moved_stays_alone():
    assert tool().check() == []


def test_a_write_a_mutate_and_a_read_are_told_apart(tmp_path):
    mod = tool()
    f = tmp_path / "a.js"
    f.write_text("(function () {\n  var ST = {};\n  ST.a = 1;\n  function g() { ST.b++; ST.c.d = 2; var x = ST.e; "
                 "[ST.f] = [1]; delete ST.g; // ST.h = 3\n    return 'ST.i = 4'; }\n})();\n")
    import subprocess
    r = subprocess.run([mod.node(), str(mod.HELPER)], input=json.dumps({"files": [str(f)], "object": "ST"}),
                       capture_output=True, text=True, check=True)
    got = {(u["name"], u["kind"], u["fn"], u["top"]) for u in json.loads(r.stdout)}
    assert got == {("a", "write", "", True), ("b", "write", "g", False), ("c", "mutate", "g", False),
                   ("e", "read", "g", False), ("f", "write", "g", False), ("g", "write", "g", False)}
