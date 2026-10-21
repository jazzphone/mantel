"""The defaults a house has not chosen follow its place (latitude, country); a saved choice never changes."""
import pytest

from hk_core.settings import model as M
from hk_core.settings.changes import apply_house


@pytest.fixture(autouse=True)
def _place():
    M.set_house_place()
    yield
    M.set_house_place()


def sky(options=None):
    return M.merged(options)["sky"]


def test_an_unknown_place_keeps_today_s_defaults():
    assert sky()["hemisphere"] == "north"
    assert sky()["themes"] == list(M.THEMES)
    assert sky()["themes"] == M.DEFAULTS["sky"]["themes"]


def test_a_us_house_keeps_every_theme_and_the_north():
    M.set_house_place(40.7, "us")
    assert sky()["hemisphere"] == "north"
    assert sky()["themes"] == list(M.THEMES)


@pytest.mark.parametrize("lat,country", [(51.5, "GB"), (52.5, "DE")])
def test_a_northern_house_outside_the_us_loses_the_us_only_themes(lat, country):
    M.set_house_place(lat, country)
    s = sky()
    assert s["hemisphere"] == "north"
    assert "thanksgiving" not in s["themes"] and "fourth-of-july" not in s["themes"]
    assert "christmas" in s["themes"] and "halloween" in s["themes"]


def test_a_southern_house_is_south_whatever_its_country():
    M.set_house_place(-33.9, "AU")
    assert sky()["hemisphere"] == "south"
    assert "fourth-of-july" not in sky()["themes"]
    M.set_house_place(-33.9, None)               # latitude known, country not
    assert sky()["hemisphere"] == "south"
    assert sky()["themes"] == list(M.THEMES)


def test_junk_from_home_assistant_is_ignored():
    M.set_house_place("south", 7)
    assert sky()["hemisphere"] == "north" and sky()["themes"] == list(M.THEMES)
    M.set_house_place(True, "  ")
    assert sky()["hemisphere"] == "north"


def test_saved_choices_never_change():
    M.set_house_place(-33.9, "AU")
    saved = {"dashboard": {"sky": {"hemisphere": "north", "themes": list(M.THEMES)}}}
    s = sky(saved)
    assert s["hemisphere"] == "north" and s["themes"] == list(M.THEMES)
    only = {"dashboard": {"sky": {"themes": ["christmas"]}}}
    assert sky(only)["themes"] == ["christmas"] and sky(only)["hemisphere"] == "south"


def test_a_choice_equal_to_the_old_default_is_stored_in_a_house_where_it_differs():
    M.set_house_place(-33.9, "AU")
    opts, errors = apply_house({"dashboard": {}}, {"sky.hemisphere": "north"})
    assert not errors
    assert opts["dashboard"]["sky"]["hemisphere"] == "north"
    assert sky(opts)["hemisphere"] == "north"
    # choosing what the house would have anyway stores nothing, and keeps following the place
    opts, _ = apply_house({"dashboard": {}}, {"sky.hemisphere": "south"})
    assert "hemisphere" not in opts["dashboard"].get("sky", {})
    M.set_house_place(52.5, "DE")
    assert sky(opts)["hemisphere"] == "north"


def test_the_southern_windows_follow_the_derived_hemisphere():
    M.set_house_place(-33.9, "AU")
    assert M.sky_built_in("spring", sky()["hemisphere"]) == M.SKY_SOUTH["spring"]
