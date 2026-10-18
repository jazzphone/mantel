"""ONE write catalog: hk_writes.json (what the gateway classifies with) is exactly hkClient.WRITES."""
import importlib.util
import json
import shutil
from pathlib import Path

import pytest

from mantel_server.gateway import load_writes

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("export_writes", ROOT / "tools/export_writes.py")
export_writes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export_writes)


def test_exported_json_matches_hk_client_js():
    committed = json.loads((ROOT / "hosts/server/mantel_server/hk_writes.json").read_text())
    parsed = export_writes.parse((ROOT / "web/client/hk-client.js").read_text())
    assert committed["writes"] == sorted(parsed)
    assert load_writes() == frozenset(parsed)
    assert export_writes.main(["--check"]) == 0


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_exported_json_matches_what_the_page_gets():
    seen = export_writes.evaluate()
    assert sorted(seen) == sorted(load_writes()) and len(seen) == len(set(seen))


def test_a_changed_catalog_is_caught(tmp_path):
    src = (ROOT / "web/client/hk-client.js").read_text()
    changed = src.replace("'call_service',", "'call_service', 'hk_frontend/new_write',", 1)
    assert "hk_frontend/new_write" in export_writes.parse(changed)
    assert set(export_writes.parse(changed)) != load_writes()


def test_the_catalog_is_writes_only():
    from mantel_server.readproxy import READ_ALLOWED
    w = load_writes()
    assert "call_service" in w and not (w & set(READ_ALLOWED))
    assert not {"get_config", "get_states", "subscribe_events", "auth", "execute_script", "fire_event"} & w


def test_the_pages_settings_saves_are_exactly_the_stores():
    """mantel-client.js sends these through hub.write (settings_write) instead of the gateway: the same
    list as settings_store.SETTINGS_SAVES, every one a catalog write, and never a house command."""
    import re

    from mantel_server.settings_store import HA_WRITES, SAVE_KINDS, SETTINGS_SAVES
    src = (ROOT / "web/shim/mantel-client.js").read_text()
    literal = re.search(r"var SETTINGS_SAVES = \[(.*?)\];", src, re.S).group(1)
    page = set(re.findall(r"'([^']+)'", literal))
    assert page == set(SETTINGS_SAVES)
    assert page <= load_writes() and all(SAVE_KINDS[t] == "settings" for t in page)
    assert not page & HA_WRITES and "call_service" not in page
