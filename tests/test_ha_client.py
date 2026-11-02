import asyncio
from pathlib import Path

import pytest

from mantel_server.ha_client import (ALLOWED_TYPES, READ_EVENTS, REGISTRY_EVENTS, SIGNALING_TYPES, CommandBlocked, HaClient,
                                     TokenMissing, check_outgoing, read_token)
from mantel_server.registry import Registry
from mantel_server.state import StateStore


@pytest.mark.parametrize("bad", ["call_service", "fire_event", "config/entity_registry/update",
                                 "lovelace/config/save", "auth/delete_all_refresh_tokens", "", None])
def test_nothing_but_read_messages_can_be_sent(bad):
    with pytest.raises(CommandBlocked):
        check_outgoing({"id": 1, "type": bad, "domain": "valve", "service": "close"})


VALID = {  # one well-formed frame per allowed type
    "subscribe_events": {"event_type": "area_registry_updated"},
    "camera/webrtc/get_client_config": {"entity_id": "camera.porch"},
    "camera/webrtc/offer": {"entity_id": "camera.porch", "offer": "v=0"},
    "camera/webrtc/candidate": {"entity_id": "camera.porch", "session_id": "s", "candidate": {}},
    "unsubscribe_events": {"subscription": 4},
}


def test_allowed_set_is_pinned_and_only_reads():
    assert ALLOWED_TYPES == {"auth", "subscribe_entities", "config/area_registry/list", "config/device_registry/list",
                             "config/entity_registry/list", "config/floor_registry/list", "subscribe_events", "ping",
                             "camera/webrtc/get_client_config", "camera/webrtc/offer", "camera/webrtc/candidate",
                             "unsubscribe_events"}
    for t in ALLOWED_TYPES:
        assert "service" not in t and "update" not in t and "delete" not in t and "create" not in t
        check_outgoing({"type": t, **VALID.get(t, {})})
    assert set(SIGNALING_TYPES) == {t for t in ALLOWED_TYPES if t.startswith("camera/")}


@pytest.mark.parametrize("message", [
    {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0", "service": "turn_off"},
    {"type": "camera/webrtc/offer", "entity_id": "lock.front", "offer": "v=0"},
    {"type": "camera/webrtc/get_client_config", "entity_id": "camera.porch", "domain": "camera"},
    {"type": "camera/webrtc/candidate", "entity_id": "valve.main", "session_id": "s", "candidate": {}},
    {"type": "camera/webrtc/get_client_config"},
    {"type": "unsubscribe_events", "subscription": 1, "event_type": "state_changed"},
    {"type": "camera/turn_off", "entity_id": "camera.porch"},
    {"type": "camera/stream", "entity_id": "camera.porch"},
])
def test_signaling_frames_carry_only_their_keys_for_cameras_only(message):
    with pytest.raises(CommandBlocked):
        check_outgoing(message)


@pytest.mark.parametrize("event_type", sorted(READ_EVENTS))
def test_registry_events_may_be_subscribed(event_type):
    check_outgoing({"id": 1, "type": "subscribe_events", "event_type": event_type})


@pytest.mark.parametrize("message", [
    {"type": "subscribe_events"},                                  # no event_type = every event in the house
    {"type": "subscribe_events", "event_type": None},
    {"type": "subscribe_events", "event_type": "state_changed"},
    {"type": "subscribe_events", "event_type": "call_service_x"},
    {"type": "subscribe_events", "event_type": "area_registry_updated_x"},
])
def test_any_other_event_subscription_is_blocked(message):
    with pytest.raises(CommandBlocked):
        check_outgoing(message)


async def test_registry_burst_reloads_only_what_changed_once():
    reg = Registry()
    reg.load([{"area_id": "a", "name": "A"}], [], [{"entity_id": "light.x", "area_id": "a"}])
    c = HaClient("http://x", "t", StateStore(), reg, lambda s: None, registry_debounce=0.05)
    asked: list[str] = []

    async def fake_request(type_):
        asked.append(type_)
        return [{"area_id": "a", "name": "A"}, {"area_id": "b", "name": "B"}]

    c._request = fake_request
    c._reg_subs = {2: "area_registry_updated", 3: "device_registry_updated"}
    reloaded = []
    c.on_registry = lambda: reloaded.append(1)
    watcher = asyncio.create_task(c._watch_registries())
    for _ in range(5):                                           # a burst of five area events
        c.handle({"id": 2, "type": "event", "event": {}})
    await asyncio.sleep(0.3)
    watcher.cancel()
    assert asked == ["config/area_registry/list"]               # one reload, only the area registry
    assert reloaded == [1] and set(reg.areas) == {"a", "b"}
    assert reg.entity_area["light.x"] == "a"                     # the other registries kept as they were


async def test_the_first_registries_at_a_connect_are_told_too():
    # 0.1.29's start: the Sleep engines were made before HA's registries arrived, and the connect's own
    # load told nobody, so every tablet kept an empty kiosk until some later registry event or settings save
    reg = Registry()
    c = HaClient("http://x", "t", StateStore(), reg, lambda s: None)
    asked: list[str] = []
    seen: list[int] = []

    async def fake_request(type_):
        asked.append(type_)
        return [{"entity_id": "light.loft_kiosk_screen", "device_id": "dev"}] if "entity" in type_ else []

    c._request = fake_request
    pages: list[int] = []
    c.on_registries_loaded = lambda: seen.append(len(reg.entity_entries))
    c.on_registry = lambda: pages.append(1)
    await c._first_registries()
    assert sorted(asked) == sorted(REGISTRY_EVENTS.values())     # every registry
    assert seen == [1]                                            # told once, after they are in
    assert pages == []                                            # never the pages (they redraw on it)


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


def test_every_registry_reload_call_is_an_allowed_message():
    # a reload the allowlist refuses kills the HA task silently (it did, once: floors)
    for event_type, list_call in REGISTRY_EVENTS.items():
        check_outgoing({"id": 1, "type": list_call})
        check_outgoing({"id": 1, "type": "subscribe_events", "event_type": event_type})


def test_service_events_are_target_only_and_never_commands():
    c = HaClient("http://x", "t", StateStore(), Registry(), lambda s: None)
    got = []
    c.on_service = got.append
    c._service_sub = 9
    c.handle({"id": 9, "type": "event", "event": {"data": {
        "domain": "tts", "service": "speak", "service_data": {
            "media_player_entity_id": "media_player.a", "message": "private spoken text", "cache": True}}}})
    assert got == [{"domain": "tts", "service": "speak", "service_data": {"media_player_entity_id": "media_player.a"}}]
    c.handle({"id": 9, "type": "event", "event": {"data": {"domain": "light", "service": "turn_on"}}})
    assert len(got) == 1
    with pytest.raises(CommandBlocked):
        check_outgoing({"type": "call_service", "domain": "tts", "service": "speak"})


# ---- 2026-11-01 (audit 3, LINK-2, LINK-6): a hook that raises, and a socket that drops while the registries load

class FakeHA:
    """A Home Assistant socket that greets, authenticates, answers the registry lists and subscriptions, and then
    plays `script(ws, sub_id)` after `subscribe_entities`. `drop_at_list` closes the socket on that numbered
    `config/` request (HA restarting while the registries are read)."""

    def __init__(self, script=None, drop_at_list=None):
        self.script, self.drop_at_list = script, drop_at_list
        self.connections = 0
        self.lists = 0

    async def handler(self, request):
        from aiohttp import web
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.connections += 1
        await ws.send_json({"type": "auth_required", "ha_version": "2099.1.0"})
        await ws.receive_json()
        await ws.send_json({"type": "auth_ok", "ha_version": "2099.1.0"})
        async for m in ws:
            d = m.json()
            if d["type"].startswith("config/"):
                self.lists += 1
                if self.drop_at_list is not None and self.lists >= self.drop_at_list:
                    await ws.close()
                    break
                await ws.send_json({"id": d["id"], "type": "result", "success": True, "result": []})
            elif d["type"] == "subscribe_entities":
                await ws.send_json({"id": d["id"], "type": "result", "success": True, "result": None})
                if self.script:
                    asyncio.get_running_loop().create_task(self.script(ws, d["id"]))
            elif d["type"] == "subscribe_events":
                await ws.send_json({"id": d["id"], "type": "result", "success": True, "result": None})
        return ws

    async def start(self):
        from aiohttp import web
        from aiohttp.test_utils import TestServer
        app = web.Application()
        app.router.add_get("/api/websocket", self.handler)
        self.server = TestServer(app, host="127.0.0.1")
        await self.server.start_server()
        return f"http://127.0.0.1:{self.server.port}"


async def test_a_hook_that_raises_does_not_take_the_connection_down(caplog):
    """One bad entity in a downstream hook used to end the reader, drop the HA socket and reconnect forever."""
    async def script(ws, sub):
        await ws.send_json({"id": sub, "type": "event", "event": {"a": {"sensor.odd": {"s": "1", "a": {}, "lc": 1.0}}}})
        for n in range(2, 6):
            await asyncio.sleep(0.05)
            await ws.send_json({"id": sub, "type": "event", "event": {"c": {"sensor.odd": {"+": {"s": str(n), "lc": float(n)}}}}})

    fake = FakeHA(script)
    url = await fake.start()
    seen: list[set] = []

    def hook(changed):
        seen.append(set(changed))
        if len(seen) >= 2:
            raise KeyError("a downstream hook trips on this entity")

    store = StateStore()
    c = HaClient(url, "tok", store, Registry(), hook, registry_debounce=0.05)
    task = asyncio.create_task(c.run())
    try:
        await asyncio.wait_for(c.ready.wait(), 5)
        await asyncio.sleep(0.6)
        assert fake.connections == 1, "one connection: a hook error is not a lost HA connection"
        assert c.connected.is_set()
        assert len(seen) == 5, "the later events still reach the hook"
        assert store.states["sensor.odd"]["s"] == "5"
        warned = [r for r in caplog.records if r.levelname == "WARNING" and "hook" in r.getMessage()]
        assert len(warned) == 1, "logged once per hook and exception type, not once per event"
    finally:
        task.cancel()
        await fake.server.close()


async def test_a_registry_hook_that_raises_is_called_once_and_not_retried_in_a_loop():
    c = HaClient("http://x", "t", StateStore(), Registry(), lambda s: None, registry_debounce=0.01)
    calls = []

    async def no_reload(only=None):
        pass

    def bad():
        calls.append(1)
        raise ValueError("registry hook trips")

    c._load_registries = no_reload
    c.on_registry = bad
    watcher = asyncio.create_task(c._watch_registries())
    try:
        c._reg_dirty.add("area_registry_updated")
        c._reg_wake.set()
        await asyncio.sleep(0.3)
        assert calls == [1], "the failed hook is not a failed reload: the registries are not marked dirty again"
    finally:
        watcher.cancel()


async def test_garbage_from_home_assistant_does_not_end_the_reader():
    async def script(ws, sub):
        await ws.send_str("{not json")
        await ws.send_json({"id": sub, "type": "event", "event": {"a": {"sensor.ok": {"s": "1", "a": {}, "lc": 1.0}}}})

    fake = FakeHA(script)
    url = await fake.start()
    c = HaClient(url, "tok", StateStore(), Registry(), lambda s: None)
    task = asyncio.create_task(c.run())
    try:
        await asyncio.wait_for(c.ready.wait(), 5)
        assert fake.connections == 1 and "sensor.ok" in c.store.states
    finally:
        task.cancel()
        await fake.server.close()


async def test_a_socket_that_drops_during_the_first_registry_load_reconnects_promptly():
    """The pending registry requests used to wait out their 60 s timeout after the socket was gone."""
    fake = FakeHA(drop_at_list=2)
    url = await fake.start()
    c = HaClient(url, "tok", StateStore(), Registry(), lambda s: None)
    task = asyncio.create_task(c.run())
    try:
        for _ in range(60):
            await asyncio.sleep(0.1)
            if fake.connections >= 2:
                break
        assert fake.connections >= 2, "reconnected after the 1 s backoff, not after a 60 s wait"
        assert c.last_error is not None
    finally:
        task.cancel()
        await fake.server.close()
