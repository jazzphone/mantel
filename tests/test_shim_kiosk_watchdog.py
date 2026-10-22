"""A kiosk app's watchdog on Mantel's page (web/shim/mantel-host.js's stand-in connection over web/shim/hub.js).
Kiosk Satellite takes the page's `hass.connection` for Home Assistant's own: healthy only with `connected` and
`socket.readyState === 1`, checked with a `ping`, nudged with `reconnect(true)` or `socket.close()`, and the page
reloaded after 15 minutes "down". The stand-in had no `connected`, so every wall tablet reloaded every 15 or 16
minutes (2026-10-22). It now tells the truth about Mantel's own socket. Run in node with a fake socket
(tests/shim_kiosk_watchdog_harness.mjs)."""
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
    d = tmp_path_factory.mktemp("kiosk")
    shutil.copy(ROOT / "web/shim/mantel-host.js", d / "mantel-host.mjs")
    shutil.copy(ROOT / "web/shim/base.js", d / "base.mjs")
    hub = (ROOT / "web/shim/hub.js").read_text().replace("from './base.js'", "from './base.mjs'")
    (d / "hub.mjs").write_text(hub)
    shutil.copy(ROOT / "tests/shim_kiosk_watchdog_harness.mjs", d / "harness.mjs")
    out = subprocess.run(["node", str(d / "harness.mjs")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_a_live_page_reads_as_connected(observed):
    assert observed["up"] == "connected", "a page with Mantel's socket up is never reloaded for a dead connection"
    assert observed["upPing"] == "alive" and observed["pingSent"] == 1, "the ping is the server's, not made up"


def test_a_dead_socket_reads_as_dead(observed):
    assert observed["silentPing"] == "dead", "a socket that stopped answering fails the ping"
    assert observed["down"] == "stale" and observed["downPing"] == "dead"
    assert observed["back"] == "connected" and observed["socketsAfterDrop"] == 2, "the hub came back by itself"


def test_the_nudges_cycle_mantel_s_socket(observed):
    assert observed["duringNudge"] == "stale"
    assert observed["afterNudge"] == "connected" and observed["afterClose"] == "connected"
    assert observed["sockets"] == 4, "each nudge made one new socket"
