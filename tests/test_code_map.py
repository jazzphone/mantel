"""docs/development/Code-map.md is what tools/code_map.py writes from the tree today (phase 24, A5)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_the_code_map_is_fresh():
    spec = importlib.util.spec_from_file_location("code_map", ROOT / "tools/code_map.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.read_text() == mod.render(), "docs/development/Code-map.md is out of date: run tools/code_map.py"
