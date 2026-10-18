"""Doorbell talk-back on the page side (web/shim/mantel-client.js): the card's recorded clip, sent exactly
as HK's doorbell card sends it to HA (client.actions.request with a Blob), becomes ONE gateway command
that the server's classify() accepts byte for byte; nothing else binary is read or sent; live talk is
refused quietly so the card falls back to the clip. Run in node (tests/shim_talk_harness.mjs)."""
import base64
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from mantel_server.gateway import classify, load_writes

ROOT = Path(__file__).resolve().parent.parent
SPEAKER = "media_player.doorbell_speaker"
PATH = f"/api/hk_frontend/talk?entity_id={SPEAKER}"


@pytest.fixture(scope="module")
def observed():
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    out = subprocess.run(["node", str(ROOT / "tests/shim_talk_harness.mjs"), str(ROOT / "web/client/hk-client.js"),
                          str(ROOT / "web/shim/mantel-client.js")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_clip_is_one_gateway_command_the_server_accepts(observed):
    (cmd,) = observed["okSent"]
    assert cmd == {"kind": "http", "method": "POST", "path": PATH, "content_type": "audio/webm",
                   "body_b64": observed["clipB64"]}
    c = classify(cmd, load_writes())                     # what the gateway makes of it
    assert c.upload == (PATH, "audio/webm", base64.b64decode(observed["clipB64"]))
    assert len(c.upload[2]) == 70000
    assert observed["ok"] == {"status": 200, "ok": True, "body": json.dumps({"ok": True, "bytes": 70000}, separators=(",", ":"))}


def test_a_step_up_resends_the_same_clip(observed):
    first, again = observed["stepUpSent"]
    assert first == again and first["content_type"] == "audio/mp4"
    assert observed["stepUp"]["ok"] is True


def test_refusals_answer_as_the_card_expects(observed):
    assert observed["refusedByHa"] == {"status": 415, "ok": False, "body": '{"message":"not an audio clip"}'}
    assert observed["forbidden"] == {"error": "forbidden"}


def test_nothing_else_binary_is_read_or_sent(observed):
    assert observed["local"] == [{"error": "unsupported_body"}] * 4 + [{"error": "body_too_large"}] + \
        [{"error": "unsupported_body"}] * 2
    assert observed["localSent"] == 0


def test_live_talk_is_refused_quietly_so_the_clip_goes(observed):
    assert observed["live"] == {"error": "live_unavailable"}
    assert observed["liveEvents"] == [] and observed["liveSent"] == 0


def test_with_commands_off_talk_back_is_refused_and_nothing_sent(observed):
    assert observed["off"] == {"error": "commands_disabled"}
    assert observed["offEvents"] == ["hk-command-refused"] and observed["offSent"] == 0


def test_the_shared_card_is_unchanged():
    cams = (ROOT / "web/hk/cards/hk-cameras.js").read_text()
    assert "var url = '/api/hk_frontend/talk?entity_id=' + encodeURIComponent(c.speaker);" in cams
    assert "body_b64" not in cams and "content_type" not in cams
