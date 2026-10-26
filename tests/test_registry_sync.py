"""The page's side of registry changes (Phase 6): an area renamed in Home Assistant reaches an open page without a
reload. On the server's `registry` frame, or a snapshot (each new socket's first) naming a registry other than the
one the page holds, the page reads /api/registry again (with its ETag), puts it in hass.entities / devices / areas /
floors, and hands HK a new hass so it redraws. Run in node with a fake socket and fetch
(tests/registry_sync_harness.mjs)."""
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
    d = tmp_path_factory.mktemp("registry")
    shutil.copy(ROOT / "web/shim/mantel-host.js", d / "mantel-host.mjs")
    shutil.copy(ROOT / "web/shim/base.js", d / "base.mjs")
    shutil.copy(ROOT / "web/shim/page-health.js", d / "page-health.mjs")
    (d / "hub.mjs").write_text((ROOT / "web/shim/hub.js").read_text().replace("from './base.js'", "from './base.mjs'"))
    sync = ROOT / "web/shim/registry-sync.js"
    if sync.is_file():
        (d / "registry-sync.mjs").write_text(sync.read_text().replace("from './page-health.js'", "from './page-health.mjs'"))
    shutil.copy(ROOT / "tests/registry_sync_harness.mjs", d / "harness.mjs")
    out = subprocess.run(["node", str(d / "harness.mjs")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_page_knows_which_registry_it_loaded(observed):
    assert observed["loaded"] == {"digest": "d1", "kitchen": "Kitchen", "inm": None}
    assert observed["first"] == {"fetches": 1, "refreshes": 0}, "the first snapshot names the same one: not read twice"


def test_an_area_rename_reaches_the_open_page(observed):
    r = observed["renamed"]
    assert r["fetches"] == 2 and r["inm"] == '"d1"', "read again, with the ETag of what it holds"
    assert r["kitchen"] == "Big Kitchen" and r["newHass"] and r["published"] >= 1, "HK is handed a new hass"
    assert r["refreshes"] == 1, "counted for About -> Performance"
    assert observed["same"] == {"fetches": 2, "refreshes": 1}


def test_a_reconnect_reads_the_registry_only_when_it_changed(observed):
    assert observed["backUnchanged"] == {"reconnected": 1, "sockets": 2, "fetches": 2, "refreshes": 1}
    c = observed["backChanged"]
    assert c == {"reconnected": 2, "fetches": 3, "kitchen": "Kitchen & Dining", "refreshes": 2}


def test_a_304_redraws_nothing(observed):
    n = observed["notModified"]
    assert n["fetches"] == 4 and n["inm"] == '"d3"' and n["published"] == 0 and n["refreshes"] == 2
    assert n["kitchen"] == "Kitchen & Dining"
