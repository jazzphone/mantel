"""The apps' copy of the house's icon names (apple/Common/HKGlyphs.swift) is the manifest's, regenerated."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_the_apps_glyphs_are_the_houses():
    spec = importlib.util.spec_from_file_location("make_glyphs", ROOT / "apple" / "make_glyphs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT.read_text() == mod.render(), "run: python3 apple/make_glyphs.py"
