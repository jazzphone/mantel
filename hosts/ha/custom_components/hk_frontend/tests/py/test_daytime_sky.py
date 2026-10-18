"""Daytime Sky (sky.daytime, a screen's sky_daytime): how bright the midday blue
runs -- Natural (the default), Balanced or Deep."""
from __future__ import annotations


def test_natural_by_default_and_the_others_kept():
    from custom_components.hk_frontend import settings as S, settings_api as A
    assert S.merged({})["sky"]["daytime"] == "natural"
    for v in ("balanced", "deep", "natural"):
        updated, errors = A.apply_house({}, {"sky.daytime": v})
        assert not errors and S.merged(updated)["sky"]["daytime"] == v
    for bad in ("bright", None, 1):
        _, errors = A.apply_house({}, {"sky.daytime": bad})
        assert "sky.daytime" in errors, bad


def test_a_screen_follows_all_screens_until_it_chooses():
    from custom_components.hk_frontend import settings as S
    assert S.board({})["sky_daytime"] is None
    assert S.board({"sky_daytime": "deep"})["sky_daytime"] == "deep"
    assert S.board({"sky_daytime": "bright"})["sky_daytime"] is None, "an unknown choice follows All Screens"
