"""The weather glyphs. hk-header.js draws Apple's multicolor SF Symbols from the
home's own glyph file, never from the bundle: every symbol it can draw must be
built by tools/sf_symbols (manifest.json's `weather`) and have a Material Design
stand-in for a home without the file."""
import json
import os
import re

from conftest import _UP, COMPONENT

HEADER = os.path.join(COMPONENT, "frontend", "modules", "hk-header.js")


def _block(src: str, start: str) -> str:
    body = src[src.index(start):]
    return body[:body.index("};")]


def _drawn(src: str) -> set[str]:
    pairs = re.findall(r"\[\s*'([^']+)',\s*'([^']+)'\s*\]", _block(src, "var WX_MAP = {"))
    return {s for pair in pairs for s in pair}


def test_manifest_builds_every_weather_glyph():
    src = open(HEADER, encoding="utf-8").read()
    manifest = os.path.join(_UP, "tools", "sf_symbols", "manifest.json")
    weather = json.load(open(manifest, encoding="utf-8"))["weather"]
    assert _drawn(src) and _drawn(src) == set(weather)


def test_every_weather_glyph_has_a_material_stand_in():
    src = open(HEADER, encoding="utf-8").read()
    stand_ins = set(re.findall(r"^\s+'([a-z.]+)':\s+\['", _block(src, "var WX_MDI = {"), re.M))
    assert _drawn(src) == stand_ins


def test_no_symbol_path_data_ships():
    src = open(HEADER, encoding="utf-8").read()
    assert "WX_SYMBOLS" not in src
    assert not re.search(r'"M-?\d', src)
