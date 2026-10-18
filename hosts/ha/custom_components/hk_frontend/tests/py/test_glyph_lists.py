"""tools/sf_symbols/symbols.txt and docs/Glyph-Names.md are generated from the
glyph manifest (names.py) for people exporting the symbols another way. They
must name exactly what build_glyphs.py builds."""
import os
import sys

from conftest import _UP, DOCS

TOOLS = os.path.join(_UP, "tools", "sf_symbols")
sys.path.insert(0, TOOLS)
import names  # noqa: E402

FIX = "run tools/sf_symbols/names.py after changing manifest.json"


def test_symbols_txt_matches_the_manifest():
    have = open(os.path.join(TOOLS, "symbols.txt"), encoding="utf-8").read()
    assert have == names.symbols_txt(names.manifest()), FIX


def test_glyph_names_page_matches_the_manifest():
    have = open(os.path.join(DOCS, "Glyph-Names.md"), encoding="utf-8").read()
    assert have == names.docs(names.manifest()), FIX


def test_every_symbol_the_builder_exports_is_listed():
    m = names.manifest()
    listed = set(names.symbols(m))
    assert set(m["weather"]) <= listed
    assert {v["symbol"] for v in m["twotone"].values()} <= listed
    assert all(v.get("symbol") in listed for v in m["icons"].values() if "path" not in v)
