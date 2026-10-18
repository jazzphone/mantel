"""The page side of Mantel's features (docs/phase4/MANTEL-FEATURES.md): the real shim (hk-client.js,
mantel-client.js, mantel-host.js, hub.js) run in node with only the browser globals stubbed
(tests/shim_features_harness.mjs). The events feed reaches the page, `screen` frames move the two
switches HK's saver reads, the page's touch / black reports and Mute 1 Hour leave as the frames the
feature host accepts, and nothing here is a house command."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
HALL_BLACK, HALL_PHOTOS = "switch.mantel_hall_black_screen", "switch.mantel_hall_photo_screensaver"


@pytest.fixture(scope="module")
def observed(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("shimfeat")
    shutil.copy(ROOT / "web/client/hk-client.js", d / "hk-client.cjs")
    shutil.copy(ROOT / "web/shim/mantel-client.js", d / "mantel-client.cjs")
    shutil.copy(ROOT / "web/shim/mantel-host.js", d / "mantel-host.mjs")
    shutil.copy(ROOT / "web/shim/base.js", d / "base.mjs")
    hub = (ROOT / "web/shim/hub.js").read_text().replace("from './base.js'", "from './base.mjs'")
    (d / "hub.mjs").write_text(hub)
    shutil.copy(ROOT / "tests/shim_features_harness.mjs", d / "harness.mjs")
    out = subprocess.run(["node", str(d / "harness.mjs")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_events_feed_is_the_hubs_not_a_stand_in(observed):
    f = observed["eventsSubscribe"]
    assert f == {"type": "read_subscribe", "id": f["id"], "msg": {"type": "hk_frontend/events/subscribe"}}
    # notifications and pop-ups reach HK's page as they are; the screen frame is Mantel's own and does not
    assert observed["delivered"] == [{"type": "notification", "title": "Basement Floor Wet", "message": "Water detected."},
                                     {"type": "popup", "popup": "doorbell"}]
    assert observed["unsubscribed"]["type"] == "read_unsubscribe"


def test_screen_frames_move_the_switches_hk_reads(observed):
    # the server's initial frame for a black tablet is kept, with the brightness to come back to; the
    # tablet's photos read off once the feed has answered
    assert observed["stages"]["beforeSettings"] == {HALL_BLACK: {"state": "on", "attributes": {"brightness": 150}},
                                                    HALL_PHOTOS: {"state": "off", "attributes": {}}}
    # named by the settings feed, once the events feed answered: the missing one reads off
    after = observed["stages"]["afterSettings"]
    assert after[HALL_BLACK] == {"state": "on", "attributes": {"brightness": 150}}
    assert after[HALL_PHOTOS] == {"state": "off", "attributes": {}}
    assert observed["stages"]["afterFrames"][HALL_PHOTOS]["state"] == "on"
    assert observed["stages"]["afterFrames"][HALL_BLACK]["state"] == "off"
    # a frame for a tablet the settings never named, or a malformed id, creates nothing readable
    assert "switch.mantel_nope_x_black_screen" in observed["stages"]["afterBadFrames"]   # named by the frame itself
    assert not [k for k in observed["stages"]["afterBadFrames"] if "Bad" in k or " " in k]


def test_the_settings_feed_names_each_tablets_two_switches(observed):
    items = observed["settings"]["tablet_items"]
    assert items["hall"]["screensaver_switch"] == HALL_PHOTOS and items["hall"]["black_switch"] == HALL_BLACK
    # a switch the server did name is kept; only the missing one is filled
    assert items["den"]["screensaver_switch"] == "switch.real_one"
    assert items["den"]["black_switch"] == "switch.mantel_den_black_screen"
    assert items["Bad Id"] == {"name": "x"}                        # not a tablet id: left alone
    assert observed["settings"]["configured"] is True


@pytest.mark.parametrize("mode", ["off", "on"])
def test_reports_and_mute_leave_as_the_feature_hosts_frames(observed, mode):
    r = observed[mode]
    strip = lambda f: {k: v for k, v in f.items() if k != "id"}      # noqa: E731
    assert strip(r["touchFrame"]) == {"type": "screen_report", "tablet": "hall", "touch": True}
    assert strip(r["saverFrame"]) == {"type": "screen_report", "tablet": "hall", "touch": True, "saver": True}
    assert strip(r["blackFrame"]) == {"type": "screen_report", "tablet": "hall", "black": True}
    assert strip(r["wakeFrame"]) == {"type": "screen_report", "tablet": "hall", "black": False}
    assert r["touch"] == {"changed": False}
    assert strip(r["muteFrame"]) == {"type": "notify_mute", "key": "item1:binary_sensor.wet", "seconds": 3600}
    assert strip(r["unmuteFrame"]) == {"type": "notify_mute", "key": "item1:binary_sensor.wet", "seconds": 0}
    assert r["mute"] == {"until": 1234}
    # the page is the truth about itself: its report moves the switch at once (a tap wake must not
    # be undone by a stale "on")
    assert r["afterBlackTrue"] == "on" and r["afterWake"] == "off"
    assert r["forbidden"] == "forbidden"
    assert r["bad"] == ["not_found", "invalid"] and r["badFrames"] == 0
    assert r["muteBad"] == "invalid"


@pytest.mark.parametrize("mode", ["off", "on"])
def test_the_photo_switch_is_the_pages_own_and_is_reported_not_commanded(observed, mode):
    r = observed[mode]
    assert (r["photosOn"], r["photosOff"]) == ("on", "off")
    # HK's photo screensaver coming up / going away is told to Mantel (screen_report's `photos`), so
    # its Sleep Screen sees it: two reports, neither a command nor an HA service call
    strip = lambda f: {k: v for k, v in f.items() if k != "id"}      # noqa: E731
    assert r["photoFrames"] == 2
    assert [strip(f) for f in r["photoReports"]] == [{"type": "screen_report", "tablet": "hall", "photos": True},
                                                     {"type": "screen_report", "tablet": "hall", "photos": False}]
    assert r["photosAfterRefusal"] == "on" and r["photoReports2"] == 2, "a refusal leaves the page's own state"
    assert r["blackSwitchFrames"] == 0, "the black switch's report is screensaver/black's"


@pytest.mark.parametrize("mode", ["off", "on"])
def test_restart_all_now_is_mantels_tablets_restart(observed, mode):
    r = observed[mode]
    assert {k: v for k, v in r["restartFrame"].items() if k != "id"} == {"type": "tablets_restart"}
    assert r["restart"] == {"restarted": ["hall"]}
    if mode == "off":
        assert (r["wakeAct"], r["wakeActSent"]) == ("commands_disabled", 0)
    else:
        assert r["wakeActFrame"]["type"] == "command" and r["wakeActFrame"]["msg"]["act"] == "wake"


@pytest.mark.parametrize("mode", ["off", "on"])
def test_feature_settings_saves_go_to_mantels_store(observed, mode):
    r = observed[mode]
    assert r["featureSave"] == {"type": "settings_write", "id": r["featureSave"]["id"],
                                "msg": {"type": "hk_notify/settings/set", "changes": {"stay": 60}}}
    assert r["featureSaved"] == {"configured": True}
    assert r["energySave"]["type"] == "settings_write" and r["energyRefused"] == "forbidden"
    # Music's settings are still HA's: a gateway write (refused, nothing sent, while commands are off)
    if mode == "off":
        assert (r["music"], r["musicSent"]) == ("commands_disabled", 0)
    else:
        assert r["musicFrame"]["type"] == "command"


def test_the_feature_saves_are_exactly_the_stores():
    import re
    from mantel_server.settings_store import FEATURE_SAVES, SAVE_KINDS
    from mantel_server.feature_pages import SAVES
    src = (ROOT / "web/shim/mantel-client.js").read_text()
    page = set(re.findall(r"'([^']+)'", re.search(r"var FEATURE_SAVES = \[(.*?)\];", src, re.S).group(1)))
    assert page == set(FEATURE_SAVES) == set(SAVES)
    assert all(SAVE_KINDS[t] == "feature" for t in page)


def test_snapshot_paths_are_signed_under_the_pages_prefix(observed):
    r = observed["off"]
    sid = "0123456789abcdef0123456789abcdef"
    assert r["signFrame"]["type"] == "read" and r["signFrame"]["msg"] == {"type": "hk_notify/snap/sign", "snaps": [sid]}
    # Mantel's own route, under the page's prefix; anything else the answer named is dropped
    assert r["signed"] == {"signed": {sid: f"/api/hassio_ingress/tok/api/notify/snap/{sid}"}}


def test_no_house_command_is_made_of_any_of_this(observed):
    off = observed["off"]
    # commands off: a service call or another write is refused as before, sending nothing
    assert off["service"] == "commands_disabled" and off["serviceSent"] == 0 and off["refusedEvents"] == 1
    assert off["real"] == "commands_disabled" and off["realSent"] == 0
    assert off["hidden"] == "commands_disabled" and off["hiddenSent"] == 0
    assert off["settingsSave"] == "settings_write"                 # HK's own saves still reach the store
    # commands on: those go to the gateway exactly as they did, as `command` frames
    on = observed["on"]
    assert on["serviceFrame"]["type"] == "command" and on["serviceFrame"]["kind"] == "service"
    assert on["realFrame"]["type"] == "command" and on["hiddenFrame"]["type"] == "command"
    # and no report, mute or switch of Mantel's own is ever a command or a settings write
    for key in ("touchFrame", "saverFrame", "blackFrame", "wakeFrame", "muteFrame", "unmuteFrame"):
        for mode in ("off", "on"):
            assert observed[mode][key]["type"] in ("screen_report", "notify_mute")
    assert set(observed["kinds"]) <= {"read_subscribe", "read_unsubscribe", "screen_report", "notify_mute",
                                      "tv_watching", "command", "settings_write", "tablets_restart", "read", "music_used"}


@pytest.mark.parametrize("mode", ["off", "on"])
def test_live_tvs_viewer_heartbeat(observed, mode):
    r = observed[mode]
    # always counted by Mantel: one tv_watching frame (not a command), commands on or off, no toast
    assert r["tvFrame"] == {"type": "tv_watching", "id": r["tvFrame"]["id"], "channel": "4.1"}
    assert (r["tv"], r["tvSent"], r["tvRefusedEvents"]) == ({"viewers": ["Kitchen"]}, 1, 0)
    assert r["tvStopFrame"]["channel"] is None and r["tvBad"] == "invalid" and r["tvForbidden"] == "forbidden"
    assert r["tvLaterSent"] == 2, "the stop and the refused one were sent; the malformed one was not"
    assert r["tvInterimFrame"]["type"] == "tv_watching"
    if mode == "off":
        # HA's Live TV is the interim but commands are off: nothing goes to HA
        assert (r["tvInterim"], r["tvInterimSent"]) == ({"viewers": ["Kitchen"]}, 1)
    else:
        # ... and with commands on HA hears it too (sensor.tv_viewers is HA's there), through the gateway
        assert r["tvForward"]["type"] == "command" and r["tvForward"]["msg"]["type"] == "hk_tv/watching"
        assert (r["tvInterim"], r["tvInterimSent"]) == ({"viewers": ["x"]}, 2)


@pytest.mark.parametrize("mode", ["off", "on"])
def test_the_music_page_in_use_is_music_used_never_a_command(observed, mode):
    r = observed[mode]
    assert r["usedFrame"] == {"type": "music_used", "id": r["usedFrame"]["id"]}
    assert (r["used"], r["usedSent"], r["usedRefusedEvents"]) == (None, 1, 0)


def test_the_frames_are_what_the_servers_handlers_accept():
    # the same keys features.py validates (screen_report: tablet + bools; notify_mute: key + seconds)
    src = (ROOT / "hosts/server/mantel_server/features.py").read_text()
    assert 'set(msg) <= {"type", "id", "tablet", "touch", "saver", "black", "photos"}' in src
    assert 'set(msg) - {"type", "id", "key", "seconds"}' in src
    # tv_watching: channel only (live_tv.py), answered as tv_watching_result, which hub.js accepts
    tv = (ROOT / "hosts/server/mantel_server/live_tv.py").read_text()
    assert 'set(msg) - {"type", "id", "channel"}' in tv and '"tv_watching_result"' in tv
    assert "'tv_watching_result'" in (ROOT / "web/shim/hub.js").read_text()


def test_the_shared_frontend_is_untouched_by_this():
    # the routing lives in the adapter only; HK's saver and notifications keep sending the HA messages
    saver = (ROOT / "web/hk/modules/hk-saver.js").read_text()
    assert "screen_report" not in saver and "notify_mute" not in saver
    assert "hk_frontend/screensaver/touch" in saver and "hk_frontend/screensaver/black" in saver
    detail = (ROOT / "web/hk/cards/hk-detail.js").read_text()
    assert "notify_mute" not in detail and "screen_report" not in detail
