"""The page side of cameras and calendars in Mantel's host adapter (web/shim/mantel-host.js, hub.js):
camera WebRTC signaling goes to hub.read / hub.readSubscribe byte-for-byte as the card sends it to HA,
calendar events to `read_api`, and nothing else that was refused before is sent. Run in node with the
browser globals stubbed (tests/shim_reads_harness.mjs)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

import web_sources

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def observed(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("shim")
    shutil.copy(ROOT / "web/shim/mantel-host.js", d / "mantel-host.mjs")
    shutil.copy(ROOT / "web/shim/base.js", d / "base.mjs")
    hub = (ROOT / "web/shim/hub.js").read_text().replace("from './base.js'", "from './base.mjs'")
    (d / "hub.mjs").write_text(hub)
    shutil.copy(ROOT / "tests/shim_reads_harness.mjs", d / "harness.mjs")
    out = subprocess.run(["node", str(d / "harness.mjs")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_camera_signaling_goes_through_the_hub_unchanged(observed):
    sent = [m for m in observed["sent"] if m["type"] in ("read", "read_subscribe", "read_unsubscribe")]
    assert sent[0] == {"type": "read", "id": sent[0]["id"],
                       "msg": {"type": "camera/webrtc/get_client_config", "entity_id": "camera.porch"}}
    assert sent[1]["type"] == "read" and sent[1]["msg"] == {
        "type": "camera/webrtc/candidate", "entity_id": "camera.porch", "session_id": "s1", "candidate": {"candidate": "c"}}
    assert sent[2]["type"] == "read_subscribe" and sent[2]["msg"] == {
        "type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0"}
    assert sent[3] == {"type": "read_unsubscribe", "id": sent[2]["id"]}
    assert observed["results"]["config"] == {"configuration": {"iceServers": []}}
    assert observed["events"] == [{"type": "session", "session_id": "s1"}, {"type": "answer", "answer": "v=0 a"}]


def test_calendar_events_are_a_read_api(observed):
    (frame,) = [m for m in observed["sent"] if m["type"] == "read_api"]
    assert frame == {"type": "read_api", "id": frame["id"], "method": "GET",
                     "path": "calendars/calendar.family?start=2026-10-18T00:00:00&end=2026-10-19T00:00:00"}
    assert observed["results"]["calendar"] == [{"summary": "Fictional event"}]


def test_a_detail_sheets_hour_and_day_history_is_the_websocket_read(observed):
    """hk-stats.js history() asks HA's REST history/period (the Hour and Day charts); on Mantel that was refused
    ("Commands are disabled", an empty chart: the house, 2026-10-18). It is the allowed WebSocket read
    history/history_during_period (RBAC `history` per id on the server), answered in the REST shape."""
    assert observed["historySent"] == {
        "type": "history/history_during_period", "start_time": "2026-10-18T12:00:00.000Z",
        "entity_ids": ["sensor.office_watts"], "minimal_response": True, "no_attributes": True,
        "significant_changes_only": True}
    assert observed["results"]["history"] == [[
        {"entity_id": "sensor.office_watts", "state": "300", "last_changed": "2026-10-18T21:46:40.000Z",
         "last_updated": "2026-10-18T21:46:40.000Z"},
        {"entity_id": "sensor.office_watts", "state": "350.5", "last_changed": "2026-10-18T21:47:40.000Z",
         "last_updated": "2026-10-18T21:47:40.000Z"}]]
    two, bad_time, bad_id, extra, post = observed["historyParse"]
    assert two["entity_ids"] == ["a.b", "c.d"] and two["end_time"] == "2026-10-18T12:00:00.000Z"
    assert bad_time is None and bad_id is None and extra is None and post is None


def test_artwork_signing_is_answered_on_the_page_never_refused(observed):
    """hk_frontend/art/sign (now-playing art) carries "sign" in its name, so it was refused as a write and the
    Music page said "Commands are disabled" even with commands on (the house, 2026-10-18). It is answered on
    the page. Until 2026-10-29 as nothing signed (HK used the art's own address, which a tablet with no internet
    can't reach); now each remote cover is Mantel's own art route -- the address encoded, the size bucket, the
    page's prefix -- and the server fetches and scales it (media_art.py, hk_core/art)."""
    import base64
    signed = observed["results"]["artSign"]["signed"]
    assert set(signed) == {"https://example.test/a.jpg?x=\u00e9&y=1", "http://192.0.2.53:8095/imageproxy/ab"}   # remote only
    for url, path in signed.items():
        pre = "/api/hassio_ingress/Fict1onal/api/media/art?e="
        assert path.startswith(pre) and path.endswith("&s=300")                      # 250 -> the 300 bucket
        e = path[len(pre):].split("&")[0]
        assert "://" not in path and "=" not in e and "+" not in e and "/" not in e
        assert base64.urlsafe_b64decode(e + "=" * (-len(e) % 4)).decode() == url     # what art_fetch.dec reads
    assert observed["artBare"] == "/api/media/art?e=" + base64.urlsafe_b64encode(b"https://example.test/a.jpg").decode().rstrip("=") + "&s=300"
    assert observed["artBuckets"] == [150, 150, 300, 300, 1000, 1000, 300, 300, 300]
    assert observed["artSent"] == 0 and observed["artRefused"] == 0


def test_the_hubs_diffs_are_applied_once_per_frame_in_order(observed):
    """Updates batched per frame (2026-10-29): three diffs in one frame are one publish, applied in the order they
    came; a page that draws no frames (hidden) is served by a timer; a snapshot is newer than any diff still waiting."""
    b = observed["batch"]
    assert b["beforeFrame"] == {"published": 0, "w": "1", "frames": 1, "timers": 1}        # nothing yet; one frame asked for
    assert b["afterFrame"] == {"published": 1, "w": "3", "light": "off", "n": 2, "added": True, "timers": 0}
    assert b["late"] == 1                                                                   # a late second frame: nothing more
    assert b["hidden"] == {"timer": 250, "still": "3"} and b["hiddenAfter"] == "4" and b["hiddenPublished"] == 2
    assert b["snapshot"] == "fresh"
    assert b["flushed"] == "now"


def test_the_hubs_diffs_wait_while_a_finger_is_down_or_a_page_moves(observed):
    """Not under a finger (2026-11-14, the Kitchen's tablet): one publish is every card looking at the house again,
    20-75 ms there, and one landing in a swipe or on a press was frames not drawn. What came waits while a finger is on
    the glass or a page swipe moves it, looked at again by a timer and never more than 1.2 s from the first of it."""
    h = observed["batch"]["hold"]
    assert h["down"] == {"published": 0, "w": "now", "timer": 80}          # the frame came: held, a timer looks again
    assert h["still"] == {"published": 0, "timers": 1}
    assert h["up"] == {"published": 1, "w": "held", "timers": 0}           # the finger lifted: applied
    assert h["moving"] == {"published": 0, "w": "held"}                    # a page on its way home holds it too
    assert h["capped"] == {"published": 1, "w": "moving", "timers": 0}     # ...1.2 s at most
    assert h["lost"] == {"published": 1, "w": "lost"}                      # a finger never lifted stops counting


def test_the_music_queue_is_a_read(observed):
    frames = [m for m in observed["sent"] if m["type"] == "read" and m["msg"]["type"].startswith("hk_music/")]
    assert [f["msg"] for f in frames] == [{"type": "hk_music/queue", "entity_id": "media_player.kitchen", "limit": 40}]
    assert observed["results"]["queue"] == {"ok": True, "index": 0, "items": []}


def test_the_screensavers_photo_is_a_read_on_mantels_own_route(observed):
    frames = [m for m in observed["sent"] if m["type"] == "read" and m["msg"]["type"] == "media_source/resolve_media"]
    assert [f["msg"]["media_content_id"] for f in frames] == ["media-source://media_source/local/p/a.jpg",
                                                              "media-source://media_source/local/p/b.jpg"]
    assert observed["results"]["photo"] == {"url": "/api/hassio_ingress/Fict1onal/api/photo/" + "0123456789abcdef" * 2,
                                            "mime_type": "image/jpeg"}
    assert observed["results"]["photoBad"] == "not_found"          # never HA's own signed address


def test_everything_else_stays_refused_and_sends_nothing(observed):
    assert observed["refused"] == ["commands_disabled"] * 4
    assert observed["sentAfterRefusals"] == 0
    assert observed["calendarPath"] == ["calendars/calendar.x?start=a&end=b", None, None, None]
    assert not any(m["type"] in ("command", "settings_write") for m in observed["sent"])


def test_the_shared_frontend_is_untouched_by_this():
    # the routing lives in the adapter only; HK's cards keep calling callWS / subscribeMessage / callApi
    cams = web_sources.read("web/hk/cards/hk-cameras.js")
    assert "/api/camera/" not in cams and "read_api" not in cams and "readSubscribe" not in cams
    assert "read_api" not in web_sources.read("web/hk/cards/hk-calendar.js")


def test_a_read_the_narrowed_states_lack_is_reported(observed):
    # home.js asks the hub again for it (web/home.js host.onMiss), so a late read is never left "unknown" -- but not one
    # made while recording, nor in a whole-house pass (the strategy's or hkShell.unrecorded's: a room tile's sort of the
    # house asked for every entity in the registry, and the Loft's narrowed screen kept all 4,602 again, 2026-11-13)
    assert observed["misses"] == ["vacuum.downstairs"]


def test_a_walk_of_the_whole_house_is_not_kept_for_the_screen(observed):
    """2026-11-14, the Kitchen's tablet: Security's device care walked every entity for a battery, each read counted as
    one the screen shows, and the narrowed page kept 4,559 of the house's 4,566 states from the first swipe past Power.
    The fifth such walk found on a tablet -- so the host tells one itself: more ids than half the house (1,000 at
    least) read for the first time in one go are not kept, and what a narrowed page asked for is given back."""
    w = observed["walk"]
    assert w["page"] == 1400                                   # a big page's reads, under half the house: kept
    assert w["walk"] == 1400 and w["warned"] == 1              # the walk added nothing, and the console said so
    assert w["after"] is True                                  # one of them read afterwards is the screen's
    assert w["recorded"] == 0                                  # the same in a recorded pass
    assert w["misses"] == 2                                    # narrowed: a card's own misses are asked for...
    assert w["walkAsked"] == w["walkBack"] == 1501 and w["same"]   # ...a walk's are given back, all of them
    assert w["unrecorded"] == 0 and w["warnedOnce"] == 1       # hkShell.unrecorded's pass asks nothing; said once


def test_a_card_is_told_only_when_something_it_read_has_changed(observed):
    """2026-11-14, the Kitchen's tablet: every update of the house was every card on the screen working out again what
    it shows, ~55 ms there. The host takes down what a card reads while it works, numbers every publish, and says
    whether anything in those reads has changed since the snapshot the card was last told with."""
    g = observed["gate"]
    assert g["reads"] == [["light.a", "light.none"], ["light.a", "light.none"]]      # its own, and the grid's around it
    assert g["same"] is True and g["other"] is True                    # nothing since; another's state
    assert g["own"] is False and g["told"] is True                     # its own changed: told, and quiet from there
    assert g["later"] is True                                          # two publishes on
    assert g["recording"] is False                                     # a narrowing pass: every card looks
    assert g["added"] is False                                         # a state come or gone
    assert g["sweep"] is False                                         # fifteen seconds since everyone looked
    assert g["registry"] is False                                      # a registry
    assert g["resnap"] == [True, False] and g["resnapGone"] is False   # the same states again: only what differs


def test_what_no_card_reads_is_kept_while_it_is_being_read(observed):
    """What is read outside any card (the Side Pane, the tab bar, the screensaver) is the screen's whatever page is up,
    for as long as it is being read: let go 20 publishes and a quarter of an hour after it last was (home.js wanted)."""
    g = observed["gate"]
    assert g["ambient"] is True and g["ambientGone"] is True
