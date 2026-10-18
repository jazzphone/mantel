"""The page side of cameras and calendars in Mantel's host adapter (web/shim/mantel-host.js, hub.js):
camera WebRTC signaling goes to hub.read / hub.readSubscribe byte-for-byte as the card sends it to HA,
calendar events to `read_api`, and nothing else that was refused before is sent. Run in node with the
browser globals stubbed (tests/shim_reads_harness.mjs)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

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


def test_the_music_queue_is_a_read(observed):
    frames = [m for m in observed["sent"] if m["type"] == "read" and m["msg"]["type"].startswith("hk_music/")]
    assert [f["msg"] for f in frames] == [{"type": "hk_music/queue", "entity_id": "media_player.kitchen", "limit": 40}]
    assert observed["results"]["queue"] == {"ok": True, "index": 0, "items": []}


def test_everything_else_stays_refused_and_sends_nothing(observed):
    assert observed["refused"] == ["commands_disabled"] * 4
    assert observed["sentAfterRefusals"] == 0
    assert observed["calendarPath"] == ["calendars/calendar.x?start=a&end=b", None, None, None]
    assert not any(m["type"] in ("command", "settings_write") for m in observed["sent"])


def test_the_shared_frontend_is_untouched_by_this():
    # the routing lives in the adapter only; HK's cards keep calling callWS / subscribeMessage / callApi
    cams = (ROOT / "web/hk/cards/hk-cameras.js").read_text()
    assert "/api/camera/" not in cams and "read_api" not in cams and "readSubscribe" not in cams
    assert "read_api" not in (ROOT / "web/hk/cards/hk-calendar.js").read_text()
