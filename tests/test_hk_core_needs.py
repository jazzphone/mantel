"""hk_core.needs: whether each feature that may turn on by itself has what it needs (phase 16).

Pure: plain facts in, words out. The host that gathers the facts and makes the change is tests/test_features_auto.py.
"""
import ast
from pathlib import Path

import pytest

from hk_core import needs as N

ROOT = Path(__file__).resolve().parents[1]
GRID = {"energy_sources": [{"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_in"}]}]}
GRID_NEW = {"energy_sources": [{"type": "grid", "stat_energy_from": "sensor.grid_in"}]}
DEVICES = {"energy_sources": [], "device_consumption": [{"stat_consumption": "sensor.dryer_energy"}]}
MAP = [{"vacuum": "vacuum.rover", "taking_part": True, "how": "map", "areas": ["kitchen", "hall"]}]


def facts(**kw):
    base = dict(ready=True, ma_connected=None, vacuums=[], energy_prefs={}, tuner="", tuner_from="",
                tuner_seen=False, tuner_answers=None, tv_serves="none")
    return N.Facts(**{**base, **kw})


def test_a_house_with_nothing_meets_nothing_and_says_nothing():
    got = N.look(facts())
    assert set(got) == set(N.PIECES)
    assert all(n.met is False for n in got.values())
    assert all(n.note == "" and not n.write for n in got.values())


# -- Music ------------------------------------------------------------------------------------------------
def test_music_met_when_music_assistant_is_connected():
    n = N.look(facts(ma_connected=True))["music"]
    assert n.met is True and n.why == "Music Assistant is connected." and n.write == {}


def test_music_set_up_but_not_connected_is_a_no_with_a_note():
    n = N.look(facts(ma_connected=False))["music"]
    assert n.met is False and "isn't connected" in n.note


def test_music_does_not_wait_for_home_assistant():
    assert N.look(facts(ready=False, ma_connected=True))["music"].met is True


# -- Clean Areas ------------------------------------------------------------------------------------------
def test_clean_areas_met_by_a_vacuum_with_a_room_map():
    n = N.look(facts(vacuums=MAP))["clean_areas"]
    assert n.met is True and n.write == {} and "room" in n.why


def test_clean_areas_a_robot_that_only_starts_in_its_room_is_not_enough():
    rows = [{"vacuum": "vacuum.mini", "taking_part": True, "how": "start", "areas": ["den"]}]
    assert N.look(facts(vacuums=rows))["clean_areas"].met is False


def test_clean_areas_a_map_with_no_known_area_is_not_enough():
    rows = [{"vacuum": "vacuum.rover", "taking_part": True, "how": "map", "areas": []}]
    n = N.look(facts(vacuums=rows))["clean_areas"]
    assert n.met is False and n.note


def test_clean_areas_no_map_has_a_note():
    rows = [{"vacuum": "vacuum.rover", "taking_part": True, "how": "no_map", "areas": []}]
    n = N.look(facts(vacuums=rows))["clean_areas"]
    assert n.met is False and "no room map" in n.note


@pytest.mark.parametrize("kw", [dict(ready=False, vacuums=MAP), dict(vacuums=None)])
def test_clean_areas_cant_tell_before_the_registries_load(kw):
    assert N.look(facts(**kw))["clean_areas"].met is None


# -- Energy -----------------------------------------------------------------------------------------------
@pytest.mark.parametrize("prefs", [GRID, GRID_NEW])
def test_energy_met_by_a_grid_meter(prefs):
    n = N.look(facts(energy_prefs=prefs))["energy"]
    assert n.met is True and "grid meter" in n.why


def test_energy_met_by_devices():
    n = N.look(facts(energy_prefs=DEVICES))["energy"]
    assert n.met is True and "devices" in n.why


def test_energy_settings_with_neither_are_a_no():
    assert N.look(facts(energy_prefs={"energy_sources": [{"type": "solar", "stat_energy_from": "sensor.pv"}],
                                      "device_consumption": []}))["energy"].met is False


@pytest.mark.parametrize("kw", [dict(energy_prefs=None), dict(ready=False, energy_prefs=GRID)])
def test_energy_cant_tell_when_unread_or_unready(kw):
    assert N.look(facts(**kw))["energy"].met is None


# -- Live TV ----------------------------------------------------------------------------------------------
def tv(**kw):
    base = dict(tuner="192.168.40.20", tuner_from="registry", tuner_seen=True, tuner_answers=True, tv_serves="mantel")
    return N.look(facts(**{**base, **kw}))["live_tv"]


def test_live_tv_met_with_an_address_found_in_the_registry_writes_it():
    n = tv()
    assert n.met is True and n.write == {"tuner": "192.168.40.20"} and "192.168.40.20" in n.why


def test_live_tv_a_saved_address_is_not_written_again():
    assert tv(tuner="http://192.168.40.20/lineup.json", tuner_from="saved").write == {}
    assert tv(tuner_from="saved").met is True


def test_live_tv_through_mantel_link():
    assert tv(tv_serves="link").met is True


def test_live_tv_through_mantel_link_read_only_is_a_no():
    n = tv(tv_serves="link", read_only=True)
    assert n.met is False and "read-only" in n.note
    assert tv(tv_serves="mantel", read_only=True).met is True     # Mantel's own go2rtc shows nothing in HA


def test_live_tv_hk_frontend_running_it_is_left_alone():
    n = tv(tv_serves="ha")
    assert n.met is False and "HK Frontend" in n.note


def test_live_tv_no_way_to_serve_it():
    n = tv(tv_serves="none")
    assert n.met is False and "go2rtc" in n.note


def test_live_tv_a_tuner_that_doesnt_answer():
    n = tv(tuner_answers=False)
    assert n.met is False and "didn't answer" in n.note


def test_live_tv_not_asked_yet_cant_tell():
    assert tv(tuner_answers=None).met is None


def test_live_tv_unready_cant_tell():
    assert tv(ready=False).met is None


def test_live_tv_a_tuner_seen_without_an_address_has_a_note():
    n = tv(tuner="", tuner_from="")
    assert n.met is False and "address" in n.note
    assert tv(tuner="", tuner_from="", tuner_seen=False).note == ""


def test_live_tv_a_public_address_is_refused_before_anything_else():
    n = tv(tuner="203.0.113.9")
    assert n.met is False and "home network" in n.note


# -- lan_host ---------------------------------------------------------------------------------------------
@pytest.mark.parametrize("value, host", [
    ("192.168.40.20", "192.168.40.20"),
    ("10.1.2.3", "10.1.2.3"),
    ("172.20.0.5:5004", "172.20.0.5:5004"),
    ("hdhomerun.local", "hdhomerun.local"),
    ("HDHR-1234ABCD", "HDHR-1234ABCD"),
    ("tuner.home.arpa", "tuner.home.arpa"),
    ("tuner.lan", "tuner.lan"),
    ("http://192.168.40.20", "192.168.40.20"),
    ("http://192.168.40.20/", "192.168.40.20"),
    ("http://192.168.40.20:80/lineup.json", "192.168.40.20:80"),
    ("https://tuner.local/", "tuner.local"),
    ("[fd12:3456::20]", "[fd12:3456::20]"),
    ("http://[fd12:3456::20]:5004/", "[fd12:3456::20]:5004"),
    ("  192.168.40.20  ", "192.168.40.20"),
])
def test_lan_host_takes_the_home_network(value, host):
    assert N.lan_host(value) == host


@pytest.mark.parametrize("value", [
    "", None, 42, "127.0.0.1", "localhost", "tuner.localhost", "http://127.0.0.1/", "[::1]", "169.254.10.20",
    "http://169.254.169.254/", "fe80::1", "224.0.0.251", "0.0.0.0", "8.8.8.8", "203.0.113.9", "http://203.0.113.9/",
    "example.com", "tuner.example.com", "2001:db8::1", "::ffff:127.0.0.1", "192.168.40.20/lineup.json",
    "192.168.40.20/admin", "http://192.168.40.20/admin", "http://192.168.40.20/?x=1", "http://user@192.168.40.20/",
    "ftp://192.168.40.20/", "192.168.40.20:99999", "192.168.40.20:http", "tuner .local", "-bad-.local", "3232235777",
    "10.1", "100.64.0.1",
])
def test_lan_host_refuses_everything_else(value):
    assert N.lan_host(value) is None


def test_lineup_url():
    assert N.lineup_url("192.168.40.20:5004") == "http://192.168.40.20:5004/lineup.json"


def test_needs_imports_only_itself_and_the_standard_library():
    tree = ast.parse((ROOT / "hk_core" / "needs.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert node.level > 0 or node.module in ("__future__", "dataclasses", "typing", "urllib.parse"), node.module
        elif isinstance(node, ast.Import):
            assert all(a.name in ("ipaddress", "re") for a in node.names), [a.name for a in node.names]
