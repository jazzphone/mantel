"""Woodland Between Occasions (sky.woodland): New Decorations' seasonal
woodland, season by season, apart from the holidays' own Show."""
from __future__ import annotations


def test_every_season_by_default_and_a_choice_kept():
    from custom_components.hk_frontend import settings as S, settings_api as A
    assert S.merged({})["sky"]["woodland"] == ["spring", "summer", "fall", "winter"]
    updated, errors = A.apply_house({}, {"sky.woodland": ["winter", "summer"]})
    assert not errors and S.merged(updated)["sky"]["woodland"] == ["summer", "winter"], "in the year's order"
    updated, errors = A.apply_house(updated, {"sky.woodland": []})
    assert not errors and S.merged(updated)["sky"]["woodland"] == []
    for bad in (["autumn"], "summer", [None]):
        _, errors = A.apply_house({}, {"sky.woodland": bad})
        assert "sky.woodland" in errors, bad
