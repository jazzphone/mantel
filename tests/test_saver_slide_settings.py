"""The slides' own settings (2026-11-02, the owner: "some configuration to the slide pages... I wouldn't mind the clock
being bigger"): the slide corner's time size and what it leaves out, and what Music Full Screen leaves out -- kept by
the screensaver's options as the Weather slide's parts are."""
from hk_core.settings import model as S


def test_by_default_the_corner_is_as_it_was_and_the_music_shows_everything():
    d = S.saver_options({})
    assert (d["corner_time_size"], d["corner_hide"], d["music_hide"]) == (100, [], [])


def test_the_corner_time_size_is_100_to_250_percent():
    assert S.saver_options({"corner_time_size": 200})["corner_time_size"] == 200
    for bad in (99, 260, "200", True):
        assert S.saver_options({"corner_time_size": bad}) is None


def test_the_parts_left_out_are_kept_in_their_own_order_and_only_known_ones():
    o = S.saver_options({"corner_hide": ["status", "time"], "music_hide": ["next", "album"]})
    assert o["corner_hide"] == ["time", "status"] and o["music_hide"] == ["album", "next"]
    for bad in ({"corner_hide": "time"}, {"corner_hide": ["clock"]}, {"music_hide": ["art"]}):
        assert S.saver_options(bad) is None
