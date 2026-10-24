"""The Glass looks' Image Look (2026-10-24): Flat's photo treatment for the other looks' Photo and Landscapes,
stored apart from Flat's -- All Screens' sky.image_look and a screen's sky_image_look -- checked, patched field by
field, and cleared by the sky's reset."""
import pytest

from hk_core.settings import changes as C
from hk_core.settings import model as S


def test_all_screens_patch_one_field_at_a_time_and_keep_flats_apart():
    out, err = C.apply_house({}, {"sky.image_look.patch": {"mode": "tinted", "color": "#AA88CC", "depth": 30}})
    assert err == {}
    sky = S.merged(out)["sky"]
    assert sky["image_look"] == {"mode": "tinted", "color": "#aa88cc", "depth": 30}
    assert sky["flat_image_look"] == {}                       # Flat's own is untouched
    out, err = C.apply_house(out, {"sky.image_look.patch": {"strength": 85, "depth": None}})
    assert err == {} and S.merged(out)["sky"]["image_look"] == {"mode": "tinted", "color": "#aa88cc", "strength": 85}
    out, err = C.apply_house(out, {"sky.image_look.patch": None})
    assert err == {} and S.merged(out)["sky"]["image_look"] == {}


@pytest.mark.parametrize("bad", [{"mode": "sepia"}, {"strength": 101}, {"brightness": -51}, {"color": "red"}, {"blur": 3}, "tinted"])
def test_a_bad_image_look_is_refused(bad):
    _, err = C.apply_house({}, {"sky.image_look.patch": bad})
    assert err
    _, err = C.apply_board({}, {"sky_image_look": bad})
    assert err


def test_a_screen_has_its_own_and_the_reset_clears_both():
    b, err = C.apply_board({}, {"sky_image_look.patch": {"mode": "original", "fade": 20}})
    assert err == {} and b["sky_image_look"] == {"mode": "original", "fade": 20}
    assert S.board({})["sky_image_look"] == {}                # none: follows All Screens
    assert "sky_image_look" in S.SKY_RESET_BOARD and "image_look" in S.SKY_RESET
    out, _ = C.apply_house({}, {"sky.image_look.patch": {"mode": "original"}})
    out, err = C.apply_house(out, {"sky.reset": True})
    assert err == {} and S.merged(out)["sky"]["image_look"] == {}


def test_mantels_store_hands_the_patch_to_the_model():
    from mantel_server.settings_store import NEEDS_MODEL
    assert NEEDS_MODEL.match("sky.image_look.patch") and NEEDS_MODEL.match("sky.flat_image_look.patch")
