"""Phase 5 linked mode, Mantel's side (mantel_server/linked.py), with a fake linked client (an aiohttp
WebSocket playing Home Assistant's hk_frontend in linked mode) against the real app: who may connect
(a Service credential with the `linked` scope, LAN door, no browser), the forwarded calls and their
checks, the in-memory handler and the confirmed handshake, entity pushes, and that Mantel never sends
anything but its five frame types."""
import asyncio
import json

import pytest
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from mantel_server import linked, service_accounts
from mantel_server.linked import LinkedError, LinkedHooks, LinkedRegistry, MemoryHandler, check_entity

ENTRY = "01JFICTIONALHOUSE000000000"
BLACK_UID = f"{ENTRY}_hall_black_screen"
PHOTOS_UID = f"{ENTRY}_hall_photo_screensaver"
SLEEP_UID = f"{ENTRY}_hall_sleep_screen"
ALARM_UID = "01JFICTIONALALARMITEM00000"
DEVICE = {"identifier": f"{ENTRY}_hall", "name": "Hall", "manufacturer": "HK Frontend", "model": "Wall Tablet"}
ENTITIES = [
    {"unique_id": BLACK_UID, "platform": "switch", "entity_id": "switch.hall_black_screen",
     "translation_key": "black_screen", "device": DEVICE, "state": "off",
     "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": None, "confirmed": False}},
    {"unique_id": PHOTOS_UID, "platform": "switch", "entity_id": "switch.hall_photo_screensaver",
     "translation_key": "photo_screensaver", "device": DEVICE, "state": "off", "attributes": {}},
    {"unique_id": SLEEP_UID, "platform": "sensor", "entity_id": "sensor.hall_sleep_screen",
     "translation_key": "sleep_screen", "device": DEVICE, "state": "dashboard", "attributes": {}},
    {"unique_id": ALARM_UID, "platform": "alarm_control_panel", "entity_id": "alarm_control_panel.house_alarm_pin",
     "name": None, "state": "disarmed", "features": {"supported_features": 3, "code_format": "number"}},
]


class Env:
    def __init__(self, app, client, token, account):
        self.app, self.client, self.token, self.account = app, client, token, account
        self.linked = app["linked"]
        self.frames = []          # every frame any fake client received

    async def connect(self, token=None, headers=None):
        h = {"Authorization": f"Bearer {token or self.token}", **(headers or {})}
        ws = await self.client.ws_connect(linked.PATH, headers=h)
        hello = await ws.receive_json(timeout=5)
        self.frames.append(hello)
        return ws, hello

    async def recv(self, ws, timeout=5):
        msg = await ws.receive(timeout=timeout)
        assert msg.type == WSMsgType.TEXT, msg
        frame = json.loads(msg.data)
        self.frames.append(frame)
        return frame

    async def call(self, ws, mid, type_="call_service", **body):
        await ws.send_json({"id": mid, "type": type_, **body})
        frames = []
        while True:
            f = await self.recv(ws)
            frames.append(f)
            if f.get("type") == "result" and f.get("id") == mid:
                return f, frames[:-1]


async def _env(tmp_path, monkeypatch, hooks=None):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("linked mode tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    service_accounts.register(app, app["hub"])
    linked.register(app, app["hub"], hooks)
    for d in ENTITIES:
        await app["linked"].registry.publish(d)
    account, token = app["service_accounts"].create("home-assistant", ["linked"])
    return app, store, token, account


@pytest.fixture
async def env(tmp_path, monkeypatch):
    app, store, token, account = await _env(tmp_path, monkeypatch, LinkedHooks(recheck=0.05))
    async with TestClient(TestServer(app)) as client:
        e = Env(app, client, token, account)
        yield e
        assert all(f.get("type") in linked.SERVER_TYPES for f in e.frames), "Mantel sends only its six frame types"
    store.db.close()


# -- who may connect ----------------------------------------------------------------------------------
async def test_the_endpoint_is_public_to_sessions_and_checks_its_own_credential(env):
    assert linked.PATH in env.app["public_paths"]
    ws, hello = await env.connect()
    assert hello["type"] == "hello" and hello["protocol"] == 1
    assert hello["services"] == ["set_black_screen", "show_popup", "close_popup", "notify"]
    assert hello["owners"] == {"house": "ha", "tablets": [], "bridge": "hk_frontend"}, "every tablet HA's until an Owner moves one"
    assert {e["unique_id"] for e in hello["entities"]} == {d["unique_id"] for d in ENTITIES}
    black = next(e for e in hello["entities"] if e["unique_id"] == BLACK_UID)
    assert black["entity_id"] == "switch.hall_black_screen" and black["device"] == DEVICE
    await ws.close()


@pytest.mark.parametrize("headers,status", [
    ({}, 401),
    ({"Authorization": "Bearer msvc_0011223344556677_" + "A" * 43}, 401),
    ({"Authorization": "Basic Zm9vOmJhcg=="}, 401),
    ({"X-Mantel-Door": "tunnel"}, 403),
    ({"Cf-Ray": "8f00000000000000-SJC"}, 403),
    ({"Origin": "SAME-SITE"}, 403),            # a page on Mantel's own origin, carrying a credential
])
async def test_refused_without_a_live_credential_on_the_lan_door_or_from_a_browser(env, headers, status):
    h = dict(headers)
    if "Authorization" not in h and status == 403:
        h["Authorization"] = f"Bearer {env.token}"      # a good credential, the wrong door or a browser
    if h.get("Origin") == "SAME-SITE":
        h["Origin"] = str(env.client.make_url("")).rstrip("/")   # passes the loopback check; linked.py refuses
    r = await env.client.get(linked.PATH, headers={"Connection": "Upgrade", "Upgrade": "websocket",
                                                   "Sec-WebSocket-Version": "13",
                                                   "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", **h})
    assert r.status == status
    if status == 403:   # refused by linked.py itself, for the reason it says
        assert await r.text() == ("not for browsers" if "Origin" in h else "lan_only")


async def test_a_revoked_or_wrongly_scoped_credential_is_refused(env):
    db = env.app["service_accounts"].db
    other, other_token = env.app["service_accounts"].create("script", ["linked"])
    db.execute("UPDATE service_accounts SET scopes='[\"gateway\"]' WHERE id=?", (other.id,))
    r = await env.client.get(linked.PATH, headers={"Authorization": f"Bearer {other_token}"})
    assert r.status == 401
    ws, _ = await env.connect()
    env.app["service_accounts"].revoke(env.account.id)
    msg = await ws.receive(timeout=5)                   # the recheck closes it
    assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING)
    assert ws.close_code == 1008
    r = await env.client.get(linked.PATH, headers={"Authorization": f"Bearer {env.token}"})
    assert r.status == 401


async def test_a_session_cookie_is_not_a_service_credential(env):
    await env.app["accounts"].create_user("olive", "Olive", "owner", "correct horse battery staple")
    origin = str(env.client.make_url("")).rstrip("/")
    r = await env.client.post("/api/auth/password", json={"username": "olive", "password": "correct horse battery staple"},
                              headers={"Origin": origin})
    assert r.status == 200
    r = await env.client.get(linked.PATH)
    assert r.status == 401


# -- forwarded calls ----------------------------------------------------------------------------------
async def test_set_black_screen_state_comes_before_the_answer_and_the_page_confirms(env):
    ws, _ = await env.connect()
    target = [{"entity_id": "switch.hall_black_screen", "unique_id": BLACK_UID}]
    res, before = await env.call(ws, 1, service="set_black_screen", data={"black": True, "brightness": 174},
                                 targets=target)
    assert res["success"] and res["result"] == {"switch.hall_black_screen": {"on": True}}
    assert [f["type"] for f in before] == ["state"], "the state is pushed BEFORE the result"
    assert before[0]["unique_id"] == BLACK_UID and before[0]["state"] == "on"
    assert before[0]["attributes"] == {"tablet": "hall", "black_screen": "hk", "brightness": 174, "confirmed": False}
    handler: MemoryHandler = env.linked.handler
    assert handler.calls[-1] == {"service": "set_black_screen", "data": {"black": True, "brightness": 174},
                                 "targets": target}
    # the page says it went black: confirmed
    assert await handler.page_says(BLACK_UID, True)
    f = await env.recv(ws)
    assert f["type"] == "state" and f["attributes"]["confirmed"] is True
    assert not await handler.page_says(BLACK_UID, True), "once"
    # brightness only: stays on and confirmed
    res, before = await env.call(ws, 2, service="set_black_screen", data={"brightness": 40}, targets=target)
    assert before[0]["state"] == "on" and before[0]["attributes"]["confirmed"] is True
    assert before[0]["attributes"]["brightness"] == 40
    # the wake: off, and a later black waits for the page again
    await env.call(ws, 3, service="set_black_screen", data={"black": False}, targets=target)
    res, before = await env.call(ws, 4, service="set_black_screen", data={"black": True}, targets=target)
    assert before[0]["attributes"]["confirmed"] is False
    await ws.close()


async def test_popups_are_recorded_for_the_real_wiring(env):
    ws, _ = await env.connect()
    res, _ = await env.call(ws, 1, service="show_popup",
                            data={"popup": "doorbell", "dashboards": ["dashboard-hall"], "users": ["u1"]})
    assert res["success"]
    res, _ = await env.call(ws, 2, service="close_popup", data={"popup": "doorbell"})
    assert env.linked.handler.popups == [
        {"service": "show_popup", "popup": "doorbell", "dashboards": ["dashboard-hall"], "users": ["u1"]},
        {"service": "close_popup", "popup": "doorbell"}]
    await ws.close()


@pytest.mark.parametrize("body,code", [
    ({"service": "notify", "data": {}}, "invalid"),
    ({"service": "notify", "data": {"title": "x", "stay": 9999}}, "invalid"),
    ({"service": "notify", "data": {"title": "x", "camera": "lock.front_door"}}, "invalid"),
    ({"service": "notify", "data": {"title": "x", "service_data": {}}}, "invalid"),
    ({"service": "notify", "data": {"title": "x"},
      "targets": [{"entity_id": "switch.hall_black_screen", "unique_id": BLACK_UID}]}, "invalid"),
    ({"service": "music_play", "data": {}}, "unknown_service"),
    ({"service": "show_popup", "data": {}}, "invalid"),
    ({"service": "show_popup", "data": {"popup": "x", "entity_id": "lock.front"}}, "invalid"),
    ({"service": "show_popup", "data": {"popup": "x", "users": "u1"}}, "invalid"),
    ({"service": "show_popup", "data": {"popup": "x"},
      "targets": [{"entity_id": "switch.hall_black_screen", "unique_id": BLACK_UID}]}, "invalid"),
    ({"service": "set_black_screen", "data": {"black": True}}, "invalid"),
    ({"service": "set_black_screen", "data": {"brightness": 300},
      "targets": [{"entity_id": "switch.hall_black_screen", "unique_id": BLACK_UID}]}, "invalid"),
    ({"service": "set_black_screen", "data": {"black": "yes"},
      "targets": [{"entity_id": "switch.hall_black_screen", "unique_id": BLACK_UID}]}, "invalid"),
    ({"service": "set_black_screen", "data": {"black": True},
      "targets": [{"entity_id": "lock.front_door", "unique_id": "lock-front"}]}, "unknown_target"),
    ({"service": "set_black_screen", "data": {"black": True},
      "targets": [{"entity_id": "sensor.hall_sleep_screen", "unique_id": SLEEP_UID}]}, "unknown_target"),
    ({"service": "set_black_screen", "data": {"black": True},
      "targets": [{"entity_id": "switch.hall_photo_screensaver", "unique_id": PHOTOS_UID}]}, "not_a_black_screen"),
])
async def test_calls_are_checked(env, body, code):
    ws, _ = await env.connect()
    res, _ = await env.call(ws, 7, **body)
    assert not res["success"] and res["error"]["code"] == code, res
    await ws.close()


async def test_bad_frames_are_answered_not_fatal(env):
    ws, _ = await env.connect()
    for frame in ("not json", "[1]", json.dumps({"type": "ping"}), json.dumps({"id": True, "type": "ping"}),
                  json.dumps({"id": 1, "type": "subscribe_events"}),
                  json.dumps({"id": 2, "type": "ping", "cmd": "x"})):
        await ws.send_str(frame)
        f = await env.recv(ws)
        assert f["type"] == "result" and not f["success"] and f["error"]["code"] == "bad_request"
    res, _ = await env.call(ws, 3, "ping")
    assert res["success"] and res["result"] == {"pong": True}
    await ws.close()


async def test_entity_commands(env):
    ws, _ = await env.connect()
    res, before = await env.call(ws, 1, "entity_command", unique_id=PHOTOS_UID, command="turn_on", data={})
    assert res["success"] and before[0]["state"] == "on"
    res, before = await env.call(ws, 2, "entity_command", unique_id=BLACK_UID, command="turn_on", data={})
    assert before[0]["state"] == "on" and before[0]["attributes"]["confirmed"] is False
    for mid, body, code in (
            (3, {"unique_id": ALARM_UID, "command": "alarm_disarm", "data": {"code": "1234"}}, "not_supported"),
            (4, {"unique_id": PHOTOS_UID, "command": "alarm_disarm", "data": {}}, "unknown_command"),
            (5, {"unique_id": PHOTOS_UID, "command": "turn_on", "data": {"code": "1"}}, "invalid"),
            (6, {"unique_id": "nope", "command": "turn_on", "data": {}}, "unknown_entity"),
            (7, {"unique_id": SLEEP_UID, "command": "turn_on", "data": {}}, "unknown_command")):
        res, _ = await env.call(ws, mid, "entity_command", **body)
        assert not res["success"] and res["error"]["code"] == code, (body, res)
    # the PIN is never kept by the in-memory handler
    assert "1234" not in json.dumps(env.linked.handler.commands)
    await ws.close()


async def test_pushes_reach_every_linked_client(env):
    a, _ = await env.connect()
    b, _ = await env.connect()
    reg: LinkedRegistry = env.linked.registry
    await reg.update(SLEEP_UID, state="dark", attributes={"why": "quiet hours"})
    for ws in (a, b):
        f = await env.recv(ws)
        assert f == {"type": "state", "unique_id": SLEEP_UID, "state": "dark",
                     "attributes": {"why": "quiet hours"}, "available": True}
    await reg.publish({"unique_id": f"{ENTRY}_loft_black_screen", "platform": "switch", "state": "off"})
    assert (await env.recv(a))["type"] == "entity" and (await env.recv(b))["type"] == "entity"
    await reg.remove(f"{ENTRY}_loft_black_screen")
    assert (await env.recv(a)) == {"type": "removed", "unique_id": f"{ENTRY}_loft_black_screen"}
    await env.recv(b)
    await a.close()
    await asyncio.sleep(0.05)
    await reg.update(SLEEP_UID, available=False)          # a closed client is simply dropped
    assert (await env.recv(b))["available"] is False
    await b.close()
    with pytest.raises(LinkedError):
        await reg.update("nope", state="x")


def test_descriptors_are_checked():
    ok = check_entity({"unique_id": "u", "platform": "sensor", "state": 3.5})
    assert ok["has_entity_name"] is True and ok["attributes"] == {} and ok["available"] is True
    for bad in ({"platform": "sensor"}, {"unique_id": "", "platform": "sensor"},
                {"unique_id": "u", "platform": "light"},
                {"unique_id": "u", "platform": "switch", "entity_id": "light.x"},
                {"unique_id": "u", "platform": "switch", "entity_id": "switch.Bad Id"},
                {"unique_id": "u", "platform": "switch", "state": {"a": 1}},
                {"unique_id": "u", "platform": "switch", "state": float("nan")},
                {"unique_id": "u", "platform": "switch", "attributes": {"x": object()}},
                {"unique_id": "u", "platform": "switch", "device": {"name": "no id"}},
                {"unique_id": "u", "platform": "switch", "translation_key": "Black Screen"}):
        with pytest.raises(ValueError):
            check_entity(bad)


def test_mantel_never_sends_a_command_frame():
    # `settings` and `page_frame` are data for HK Frontend's dashboards, to a client that asked (linked_settings.py,
    # linked_reads.py: the answers to its own reads), never a command; `files` is a notice of which of the home's
    # files Mantel has (linked_files.py): HK Frontend decides what it fetches
    assert linked.SERVER_TYPES == {"hello", "result", "entity", "state", "removed", "owners", "settings", "page_frame",
                                   "files"}
    assert linked.CLIENT_TYPES == {"call_service", "entity_command", "ping"}
    assert linked.SERVICES == ("set_black_screen", "show_popup", "close_popup", "notify")


# -- a handler of the orchestrator's own ---------------------------------------------------------------
class SlowAndBroken:
    async def call_service(self, service, data, targets, ctx):
        if data.get("popup") == "slow":
            await asyncio.sleep(5)
        if data.get("popup") == "boom":
            raise RuntimeError("bug")
        if data.get("popup") == "refuse":
            raise LinkedError("unknown_popup", "No pop-up #refuse")
        return {"by": ctx.account.name}

    async def entity_command(self, unique_id, command, data, ctx):
        return {"ok": True}


async def test_a_custom_handler_its_refusals_timeouts_and_bugs(tmp_path, monkeypatch):
    app, store, token, account = await _env(tmp_path, monkeypatch, {"handler": SlowAndBroken(), "timeout": 0.2})
    async with TestClient(TestServer(app)) as client:
        env = Env(app, client, token, account)
        ws, _ = await env.connect()
        res, _ = await env.call(ws, 1, service="show_popup", data={"popup": "doorbell"})
        assert res["result"] == {"by": "home-assistant"}
        res, _ = await env.call(ws, 2, service="show_popup", data={"popup": "refuse"})
        assert res["error"] == {"code": "unknown_popup", "message": "No pop-up #refuse"}
        res, _ = await env.call(ws, 3, service="show_popup", data={"popup": "slow"})
        assert res["error"]["code"] == "timeout"
        res, _ = await env.call(ws, 4, service="show_popup", data={"popup": "boom"})
        assert res["error"]["code"] == "internal" and "bug" not in res["error"]["message"]
        res, _ = await env.call(ws, 5, "ping")
        assert res["success"], "still linked"
        await ws.close()
    store.db.close()


def test_hooks_coerce():
    from mantel_server.connectors import Hooks
    assert LinkedHooks.coerce(None) == LinkedHooks()
    assert LinkedHooks.coerce({"timeout": 1.0, "unrelated": 1}).timeout == 1.0
    assert LinkedHooks.coerce(Hooks()).handler is None


# -- notify, ownership frames, a withdrawn entity (2026-10-18, per-tablet ownership) --------------------
async def test_notify_is_forwarded_and_checked(env):
    ws, _ = await env.connect()
    data = {"title": "Laundry", "message": "The washer is done.", "important": False, "wake": True, "stay": 60,
            "icon": "mdi:washing-machine", "entity": "sensor.washer", "tap": "sheet", "dashboards": [], "users": []}
    res, _ = await env.call(ws, 1, service="notify", data=data)
    assert res["success"] and env.linked.handler.popups[-1] == {"service": "notify", **data}
    await ws.close()


async def test_owners_are_told_at_once_and_a_withdrawn_entity_is_not_forgotten(env):
    ws, hello = await env.connect()
    reg: LinkedRegistry = env.linked.registry
    await reg.set_owners({"house": "nonsense", "tablets": ["loft", "hall", "loft"]})
    assert (await env.recv(ws)) == {"type": "owners", "owners": {"house": "ha", "tablets": ["hall", "loft"], "bridge": "hk_frontend"}}
    # only no longer Mantel's (its tablet moved back to HA): HA keeps its registry entry
    await reg.remove(PHOTOS_UID, forget=False)
    assert (await env.recv(ws)) == {"type": "removed", "unique_id": PHOTOS_UID, "forget": False}
    # a descriptor names its tablet (the unit of ownership); the house's own name none
    assert check_entity({"unique_id": "u", "platform": "switch", "tablet": "hall"})["tablet"] == "hall"
    assert check_entity({"unique_id": "u", "platform": "switch"})["tablet"] is None
    with pytest.raises(ValueError):
        check_entity({"unique_id": "u", "platform": "switch", "tablet": 7})
    await ws.close()
