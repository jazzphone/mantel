"""Live TV in Apple's Home app as a TV a screen, the rules (hk_core/live_tv_buttons.py): what a save keeps, what is
published and under which ids, what turning a TV on plays, channel up and down, and which cameras the linked actor may
watch. A fictional house: the Den's and the Study's screens."""
import pytest

from hk_core import live_tv_buttons as LB

DEN, STUDY = "s0123456789ab", "sba9876543210"
CHANNELS = {"4.1": "NBC", "7.1": "WFAK-DT"}
SCREENS = {DEN: "Den HomeView", STUDY: "Study TV"}


def test_a_list_is_checked_and_each_channel_kept_once_in_order():
    got = LB.buttons([{"screen": STUDY, "channel": "7.1"}, {"screen": DEN, "channel": "4.1"},
                      {"screen": STUDY, "channel": "7.1"}])
    assert got == [{"screen": STUDY, "channel": "7.1"}, {"screen": DEN, "channel": "4.1"}]
    assert LB.buttons([]) == []
    for bad, code in ((None, "list"), ([{"screen": DEN}], "list"), ([{"screen": DEN, "channel": "4.1", "x": 1}], "list"),
                      ([{"screen": "kitchen", "channel": "4.1"}], "screen"), ([{"screen": DEN, "channel": "four"}], "channel"),
                      ([{"screen": DEN, "channel": "4.1"}] * (LB.MAX_BUTTONS + 1), "list")):
        with pytest.raises(LB.Invalid) as err:
            LB.buttons(bad)
        assert err.value.code == code
    # what is there now, for a new channel
    with pytest.raises(LB.Invalid):
        LB.buttons([{"screen": DEN, "channel": "9.1"}], channels=set(CHANNELS), screens=set(SCREENS))
    with pytest.raises(LB.Invalid):
        LB.buttons([{"screen": "s" + "f" * 12, "channel": "4.1"}], channels=set(CHANNELS), screens=set(SCREENS))
    old = [{"screen": DEN, "channel": "9.1"}]
    assert LB.added(old, old + [{"screen": DEN, "channel": "4.1"}]) == [{"screen": DEN, "channel": "4.1"}]


def test_the_plan_is_a_tv_a_screen_with_stable_ids_its_inputs_the_channels_in_order():
    saved = [{"screen": DEN, "channel": "7.1"}, {"screen": DEN, "channel": "4.1"}, {"screen": STUDY, "channel": "4.1"},
             {"screen": "s" + "e" * 12, "channel": "4.1"}, {"screen": DEN, "channel": "9.1"}]     # two away for now
    got = LB.plan("e1", saved, CHANNELS, SCREENS)
    assert [(p["name"], p["entity_id"], p["channels"], p["sources"]) for p in got] == [
        ("Den HomeView Live TV", "media_player.den_homeview_live_tv", ["7.1", "4.1"], ["WFAK-DT", "NBC"]),
        ("Study TV Live TV", "media_player.study_tv_live_tv", ["4.1"], ["NBC"])]
    assert got[0]["uid"] == f"e1_live_tv_tv_{DEN}" and got[0]["screen"] == DEN
    # a rename changes the names, never the unique id (the Home app keeps the TV where it was put)
    again = LB.plan("e1", saved, {**CHANNELS, "4.1": "Channel 4"}, {**SCREENS, DEN: "Sunroom"})
    assert [p["uid"] for p in again] == [p["uid"] for p in got]
    assert again[0]["name"] == "Sunroom Live TV" and again[0]["sources"] == ["WFAK-DT", "Channel 4"]
    assert LB.plan("e1", [], CHANNELS, SCREENS) == []
    # two channels of one name: HomeKit picks an input by its name, so each says its number
    assert LB.sources(["4.1", "7.1"], {"4.1": "NBC", "7.1": "NBC"}) == ["NBC (4.1)", "NBC (7.1)"]


def test_a_tv_is_on_while_its_screen_plays_and_says_which_input():
    tv = LB.plan("e1", [{"screen": DEN, "channel": "4.1"}, {"screen": DEN, "channel": "7.1"}], CHANNELS, SCREENS)[0]
    assert LB.tv_state(tv, None) == ("off", None)
    assert LB.tv_state(tv, {"channel": "7.1", "name": "WFAK-DT"}) == ("playing", "WFAK-DT")
    assert LB.tv_state(tv, {"channel": "13.1"}) == ("playing", None)      # Live TV from Mantel's own page: on, no input
    assert LB.channel_of(tv, "NBC") == "4.1" and LB.channel_of(tv, "CBS") is None


def test_turning_a_tv_on_plays_its_chosen_channel_or_the_last_watched():
    tv = {"channels": ["4.1", "7.1", "13.1"]}
    assert LB.turn_on_channel(tv, None, None) == "4.1"                     # nothing watched yet: its first
    assert LB.turn_on_channel(tv, "last", "7.1") == "7.1" and LB.turn_on_channel(tv, None, "7.1") == "7.1"
    assert LB.turn_on_channel(tv, "last", "9.1") == "4.1"                  # last watched isn't one of its channels
    assert LB.turn_on_channel(tv, "13.1", "7.1") == "13.1"
    assert LB.turn_on_channel(tv, "9.1", "7.1") == "7.1"                   # a chosen channel unchecked since
    assert LB.turn_on_channel({"channels": []}, "last", "4.1") is None
    assert LB.power_on({DEN: "last", STUDY: "4.1"}) == {DEN: "last", STUDY: "4.1"} and LB.power_on({}) == {}
    for bad in (None, {DEN: "first"}, {"den": "4.1"}, {DEN: 4.1}):
        with pytest.raises(LB.Invalid):
            LB.power_on(bad)


def test_channel_up_and_down_go_round_the_tvs_channels():
    tv = {"channels": ["4.1", "7.1", "13.1"]}
    assert [LB.stepped(tv, "4.1", 1), LB.stepped(tv, "13.1", 1), LB.stepped(tv, "4.1", -1)] == ["7.1", "4.1", "13.1"]
    assert LB.stepped(tv, None, 1) == "4.1" and LB.stepped(tv, "9.1", -1) == "13.1"
    assert LB.stepped({"channels": []}, "4.1", 1) is None


def test_the_linked_actor_watches_only_the_channels_a_kept_tv_plays():
    cams = {"4.1": "camera.tv_nbc", "7.1": "camera.tv_wfak_dt", "9.1": "camera.tv_other"}
    assert LB.cameras([{"screen": DEN, "channel": "7.1"}, {"screen": STUDY, "channel": "7.1"}], cams, SCREENS) == \
        ("camera.tv_wfak_dt",)
    assert LB.cameras([{"screen": "s" + "e" * 12, "channel": "4.1"}], cams, SCREENS) == ()     # its screen is gone
    assert LB.cameras([], cams, SCREENS) == ()
    assert LB.cameras("not a list", cams, SCREENS) == ()


def test_the_carrier_counts_the_tvs_and_carries_homekits_wish():
    got = LB.plan("e1", [{"screen": DEN, "channel": "4.1"}, {"screen": STUDY, "channel": "7.1"},
                         {"screen": DEN, "channel": "7.1"}], CHANNELS, SCREENS)
    c = LB.carrier("e1", got, True)
    assert c["state"] == 2 and c["entity_id"] == LB.CARRIER_ID and c["name"] == LB.BRIDGE_NAME
    # not the switches' "live_tv": a Mantel Link of then reads none of it and leaves its bridge alone
    assert c["homekit"] == {"bridge": "live_tv_tv", "want": True, "include": [f"e1_live_tv_tv_{DEN}", f"e1_live_tv_tv_{STUDY}"]}
    # published while there is anything to say: a channel, HomeKit wanted, or a TV still in HomeKit
    assert LB.wanted([], False, "none") is False
    assert LB.wanted([], False, "some") and LB.wanted([], True, "none") and LB.wanted([{"screen": DEN}], False, "none")
