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
    # (the reconnect's waits only: not the new socket's wait for its server's word on commands, CAPS_WAIT, or how long
    # a closed one keeps it, CAPS_KEEP)
    first, second = [w for w in run["waits"] if w not in (1500, 10000)][:2]
    assert 1500 <= first <= 2500 and 3000 <= second <= 5000


# A TABLET THAT SLEPT (iPad Safari, Fully Kiosk): on waking its socket can be half-open, still reading OPEN while
# nothing comes through, so the page kept the states it had when it went to sleep and never reconnected.
def test_a_silent_socket_is_replaced_after_the_tablet_wakes(run):
    w = run["wake"]
    assert w["pingsWhileHidden"] == 0, "going to sleep pings nothing"
    assert w["pinged"] == 1 and w["closed"], "woken, the page pings, hears nothing in 3 s, and closes the socket"
    assert w["newSockets"] == 1 and w["reconnected"] == 1, "even when the closing handshake never comes back"
    assert w["resent"][0] == {"type": "subscribe", "entity_ids": ["light.hall"], "areas": [], "all": False}


def test_a_healthy_socket_is_kept_and_wake_events_together_send_one_ping(run):
    h = run["healthy"]
    assert h["pinged"] == 1, "visibilitychange, pageshow, online and focus together: one ping, not a storm"
    assert not h["closed"] and h["newSockets"] == 0


def test_a_visible_page_pings_every_45_seconds_and_finds_a_dead_socket(run):
    v = run["visible"]
    assert v["timer"] == [45000]
    assert v["pingsHidden"] == 0, "a hidden page is not pinged"
    assert v["pinged"] == 1 and v["closed"] and v["newSockets"] == 1 and v["reconnected"] == 1
    assert v["openedAtOnce"] == 1, "a socket the check let go is replaced at once, not after a back-off"
    assert v["between"] == 0, "nothing is pinged meanwhile"
    assert run["unhandled"] == []


# BACK AT ONCE (2026-11-08, the iPhone app: half-loaded and unresponsive after it came back): iOS closes a suspended
# app's socket; shown again, the page reconnected only when its back-off ran out (2 s to 30 s, frozen while away)
def test_a_page_shown_again_with_its_socket_closed_reconnects_at_once(run):
    b = run["back"]
    assert b["whileAway"] == 0, "away, nothing is opened"
    assert b["atOnce"] == 1 and b["reconnected"] == 1, "shown again: a new socket now, not when the back-off ends"
    assert b["resent"] == [{"type": "subscribe", "entity_ids": ["lock.front"], "areas": [], "all": False}]
    assert b["afterBackoff"] == 1, "the back-off it replaced opens no second socket"


def test_a_page_resumed_after_a_long_freeze_reconnects_at_once(run):
    r = run["resumed"]
    assert r["closed"] and r["pinged"] == 0, "frozen a minute: the socket let go at once, nothing asked of it"
    assert r["newSockets"] == 1 and r["reconnected"] == 1
    assert r["resent"] == [{"type": "subscribe", "entity_ids": ["light.loft"], "areas": [], "all": False}]
    b = r["brief"]
    assert not b["closed"] and b["pinged"] == 1 and b["newSockets"] == 0, "a short freeze: checked, and kept"
