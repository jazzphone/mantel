import asyncio
from pathlib import Path

import pytest

from mantel_server.ha_client import (ALLOWED_TYPES, CommandBlocked, HaClient, TokenMissing,
                                     check_outgoing, read_token)
from mantel_server.registry import Registry
from mantel_server.state import StateStore


@pytest.mark.parametrize("bad", ["call_service", "fire_event", "config/entity_registry/update",
                                 "lovelace/config/save", "auth/delete_all_refresh_tokens", "", None])
def test_nothing_but_read_messages_can_be_sent(bad):
    with pytest.raises(CommandBlocked):
        check_outgoing({"id": 1, "type": bad, "domain": "valve", "service": "close"})


def test_allowed_set_is_only_reads():
    for t in ALLOWED_TYPES:
        assert "service" not in t and "update" not in t and "delete" not in t and "create" not in t
        check_outgoing({"type": t})


def test_missing_token_file_is_reported(tmp_path: Path):
    with pytest.raises(TokenMissing) as e:
        read_token(tmp_path / "nope")
    assert "not found" in str(e.value)


def test_token_value_never_in_error_or_repr(tmp_path: Path):
    f = tmp_path / "t"
    f.write_text("SECRET-TOKEN-VALUE\n")
    assert read_token(f) == "SECRET-TOKEN-VALUE"
    store, reg = StateStore(), Registry()
    # constructing a client must not put the token anywhere visible
    c = HaClient("http://ha.local:8123", "SECRET-TOKEN-VALUE", store, reg, lambda s: None)
    assert "SECRET-TOKEN-VALUE" not in repr(c.__dict__.get("ws_url"))
    assert c.ws_url == "ws://ha.local:8123/api/websocket"


async def test_handle_applies_recorded_events_and_counts_by_type():
    store, reg = StateStore(), Registry()
    changed: list[set[str]] = []
    c = HaClient("http://x", "t", store, reg, changed.append)
    c._sub_id = 7
    c.handle({"id": 7, "type": "event", "event": {"a": {"light.a": {"s": "on", "a": {}, "lc": 1.0}}}}, 120)
    assert c.ready.is_set() and c.initial_bytes == 120
    c.handle({"id": 7, "type": "event", "event": {"c": {"light.a": {"+": {"s": "off", "lc": 2.0}}}}}, 50)
    assert store.states["light.a"]["s"] == "off"
    assert changed == [{"light.a"}, {"light.a"}]
    assert c.rx_types["event"].msgs == 2 and c.rx_types["event"].bytes == 170


async def test_result_resolves_pending_request():
    c = HaClient("http://x", "t", StateStore(), Registry(), lambda s: None)
    fut = asyncio.get_running_loop().create_future()
    c._pending[3] = fut
    c.handle({"id": 3, "type": "result", "success": True, "result": [1, 2]})
    assert fut.result() == [1, 2]
