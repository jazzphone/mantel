"""Mantel names its entities with translation keys (black_screen, photo_screensaver, ...), so Mantel Link must
carry the English names for them. Without them HA falls back to the device name: after the house's hand-over
(2026-10-19) all four Loft entities were called just "Loft"."""
from __future__ import annotations

import json
import os

import pytest

from conftest import COMPONENT, HK

# HK Frontend beside: the staged one (HK_FRONTEND_COMPONENT), else the Mantel repository's own
HK_EN = os.path.join(HK or os.path.join(os.path.dirname(COMPONENT), "hk_frontend"), "translations", "en.json")
KEYS = {"switch": ("black_screen", "photo_screensaver", "seasonal_decorations"),
        "binary_sensor": ("screen_in_use",), "sensor": ("sleep_screen",)}


def entity_names(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f).get("entity") or {}


@pytest.mark.parametrize("name", ["strings.json", os.path.join("translations", "en.json")])
def test_every_entity_mantel_names_has_a_name(name):
    got = entity_names(os.path.join(COMPONENT, name))
    for platform, keys in KEYS.items():
        for key in keys:
            assert (got.get(platform, {}).get(key) or {}).get("name"), f"{name}: entity.{platform}.{key}.name"


@pytest.mark.skipif(not os.path.isfile(HK_EN), reason="no HK Frontend source beside (the published repository)")
def test_the_names_are_hk_frontends_so_nothing_is_renamed_at_the_hand_over():
    assert entity_names(os.path.join(COMPONENT, "translations", "en.json")) == entity_names(HK_EN)
