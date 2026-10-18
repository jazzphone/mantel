"""The HK Kiosk theme's glass keys equal the design table (design consolidation 5.2).

hkCards.T (frontend/cards/hk-base.js) is the one place a design value lives;
tools/gen_theme.py writes the theme's hk-* keys from it. A hand edit to either
side that the other doesn't follow fails here.
"""
from __future__ import annotations

import importlib.util
import os
import re

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
_UP = os.path.abspath(os.path.join(HERE, "..", ".."))
COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
             if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)


def _gen():
    path = os.path.join(COMPONENT, "tools", "gen_theme.py")
    if not os.path.exists(path):
        path = os.path.join(_UP, "tools", "gen_theme.py")
    spec = importlib.util.spec_from_file_location("gen_theme", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _flat(v):
    return re.sub(r"\s+", "", str(v))


def test_theme_glass_equals_the_table():
    gen = _gen()
    t, _light = gen.read_table()
    theme = yaml.safe_load(open(os.path.join(COMPONENT, "theme", "hk_kiosk_theme.yaml"), encoding="utf-8"))
    root = theme["HK Kiosk"]
    for key in gen.THEME_KEYS:
        assert "hk-" + key in root, key
        assert _flat(root["hk-" + key]) == _flat(t[key]), key


def test_generating_changes_nothing():
    gen = _gen()
    t, _light = gen.read_table()
    text = open(os.path.join(COMPONENT, "theme", "hk_kiosk_theme.yaml"), encoding="utf-8").read()
    assert gen.render(text, t) == text


def test_tokens_export_is_the_design_system_shape():
    gen = _gen()
    t, light = gen.read_table()
    out = gen.tokens(t, light)
    names = [x["name"] for fam in ("color", "shadow", "radius") for x in out[fam]["tokens"]]
    assert len(names) == len(set(names))
    assert {"id": "dark", "name": "Dark"} in out["color"]["themes"]
    ink = [x for x in out["color"]["tokens"] if x["name"] == "hk-ink"][0]
    assert ink["value"]["dark"] == t["ink"] and "light" in ink["value"]
