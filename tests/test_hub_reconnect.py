"""The page's hub (web/shim/hub.js) across a dropped socket. The server streams states only after `subscribe` and
a feed only after its `read_subscribe`, per socket, so a hub that reconnected without asking again left every
screen on the states it had when the socket dropped, with no notifications, until someone reloaded the page.
Run in node with a fake WebSocket (tests/hub_reconnect_harness.mjs)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("hub")
    shutil.copy(ROOT / "web/shim/base.js", d / "base.mjs")
    (d / "hub.mjs").write_text((ROOT / "web/shim/hub.js").read_text().replace("from './base.js'", "from './base.mjs'"))
    shutil.copy(ROOT / "tests/hub_reconnect_harness.mjs", d / "harness.mjs")
    out = subprocess.run(["node", str(d / "harness.mjs")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_new_socket_asks_for_the_same_states_and_feeds_again(run):
    sent = run["resent"]
    assert sent[0] == {"type": "subscribe", "entity_ids": ["light.kitchen"], "areas": [], "all": False}
    feeds = [f for f in sent if f["type"] == "read_subscribe"]
    assert [f["msg"]["type"] for f in feeds] == ["hk_frontend/events/subscribe"]   # the offer is not replayed
    assert run["events"] == [{"type": "notification", "n": 1}]                      # the feed's id still delivers
    assert sent[-1] == {"type": "read_unsubscribe", "id": feeds[0]["id"]}          # and its unsubscribe still works
    assert run["reconnected"] == 1


def test_what_was_waiting_is_told_and_nothing_hangs(run):
    assert run["inflight"] == ["rejected", "unavailable"]
    assert run["whileDown"] == ["rejected", "unavailable"]
    assert run["offer"] == ["rejected", "unavailable"]
    assert run["offers"] == [{"type": "error", "code": "unavailable", "message": "connection lost"}]
    assert run["unhandled"] == []


def test_retries_back_off(run):
    assert run["sockets"] == 3                      # the drop, one refused retry, then the one that opened
    first, second = run["waits"][:2]
    assert 1500 <= first <= 2500 and 3000 <= second <= 5000
