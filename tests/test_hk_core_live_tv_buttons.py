"""Live TV's switches for Apple's Home app, the rules (hk_core/live_tv_buttons.py): what a save keeps, what is published
and under which ids, and which cameras the linked actor may watch. A fictional house: the Den's and the Study's screens."""
import pytest

from hk_core import live_tv_buttons as LB

DEN, STUDY = "s0123456789ab", "sba9876543210"
CHANNELS = {"4.1": "NBC", "7.1": "WFAK-DT"}
SCREENS = {DEN: "Den HomeView", STUDY: "Study TV"}


def test_a_list_is_checked_and_each_switch_kept_once_in_order():
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
    # what is there now, for a new switch
    with pytest.raises(LB.Invalid):
        LB.buttons([{"screen": DEN, "channel": "9.1"}], channels=set(CHANNELS), screens=set(SCREENS))
    with pytest.raises(LB.Invalid):
        LB.buttons([{"screen": "s" + "f" * 12, "channel": "4.1"}], channels=set(CHANNELS), screens=set(SCREENS))
    old = [{"screen": DEN, "channel": "9.1"}]
    assert LB.added(old, old + [{"screen": DEN, "channel": "4.1"}]) == [{"screen": DEN, "channel": "4.1"}]


def test_the_plan_names_each_switch_with_stable_ids_and_one_is_on_while_its_channel_plays():
    saved = [{"screen": DEN, "channel": "4.1"}, {"screen": DEN, "channel": "7.1"}, {"screen": STUDY, "channel": "4.1"},
             {"screen": "s" + "e" * 12, "channel": "4.1"}, {"screen": DEN, "channel": "9.1"}]     # two away for now
    got = LB.plan("e1", saved, CHANNELS, SCREENS)
    assert [(p["name"], p["entity_id"]) for p in got] == [
        ("NBC on Den HomeView", "switch.den_homeview_live_tv_nbc"),
        ("WFAK-DT on Den HomeView", "switch.den_homeview_live_tv_wfak_dt"),
        ("NBC on Study TV", "switch.study_tv_live_tv_nbc")]       # no Stop: turning a switch off stops it
    assert got[0]["uid"] == f"e1_live_tv_{DEN}_4_1" and got[0]["channel"] == "4.1"
    assert LB.is_on({"channel": "4.1", "name": "NBC"}, "4.1") and not LB.is_on({"channel": "7.1"}, "4.1")
    assert not LB.is_on(None, "4.1")
    # a rename changes the name, never the unique id (the Home app keeps the switch where it was put)
    again = LB.plan("e1", saved, {**CHANNELS, "4.1": "Channel 4"}, {**SCREENS, DEN: "Sunroom"})
    assert [p["uid"] for p in again] == [p["uid"] for p in got] and again[0]["name"] == "Channel 4 on Sunroom"
    assert LB.plan("e1", [], CHANNELS, SCREENS) == []


def test_the_linked_actor_watches_only_the_channels_a_kept_switch_plays():
    cams = {"4.1": "camera.tv_nbc", "7.1": "camera.tv_wfak_dt", "9.1": "camera.tv_other"}
    assert LB.cameras([{"screen": DEN, "channel": "7.1"}, {"screen": STUDY, "channel": "7.1"}], cams, SCREENS) == \
        ("camera.tv_wfak_dt",)
    assert LB.cameras([{"screen": "s" + "e" * 12, "channel": "4.1"}], cams, SCREENS) == ()     # its screen is gone
    assert LB.cameras([], cams, SCREENS) == ()
    assert LB.cameras("not a list", cams, SCREENS) == ()


def test_the_carrier_counts_the_switches_and_carries_the_bridges_wish():
    got = LB.plan("e1", [{"screen": DEN, "channel": "4.1"}, {"screen": DEN, "channel": "7.1"}], CHANNELS, SCREENS)
    c = LB.carrier("e1", got, True)
    assert c["state"] == 2 and c["entity_id"] == LB.CARRIER_ID and c["name"] == LB.BRIDGE_NAME
    assert c["homekit"] == {"bridge": "live_tv", "want": True,
                            "include": [f"e1_live_tv_{DEN}_4_1", f"e1_live_tv_{DEN}_7_1"]}
    # published while there is anything to say: a switch, the bridge wanted, or the bridge still there
    assert LB.wanted([], False, "none") is False
    assert LB.wanted([], False, "paired") and LB.wanted([], True, "none") and LB.wanted([{"screen": DEN}], False, "none")
