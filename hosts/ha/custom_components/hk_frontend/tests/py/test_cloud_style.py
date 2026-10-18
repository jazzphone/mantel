"""Clouds (sky.cloud_style, a screen's sky_cloud_style): Classic, the drifting
noise decks, or Realistic, the photographic cut-outs -- Classic by default."""
from __future__ import annotations


def test_classic_by_default_and_realistic_kept():
    from custom_components.hk_frontend import settings as S, settings_api as A
    assert S.merged({})["sky"]["cloud_style"] == "classic"
    updated, errors = A.apply_house({}, {"sky.cloud_style": "realistic"})
    assert not errors and S.merged(updated)["sky"]["cloud_style"] == "realistic"
    for bad in ("photo", None, 1):
        _, errors = A.apply_house({}, {"sky.cloud_style": bad})
        assert "sky.cloud_style" in errors, bad


def test_a_screen_follows_all_screens_until_it_chooses():
    from custom_components.hk_frontend import settings as S
    assert S.board({})["sky_cloud_style"] is None
    assert S.board({"sky_cloud_style": "realistic"})["sky_cloud_style"] == "realistic"
    assert S.board({"sky_cloud_style": "photo"})["sky_cloud_style"] is None, "an unknown look follows All Screens"
