"""P3.7 wiring in server.py: the per-socket principal and RBAC read filter, the door rule, the handler
dispatch, the policy tick, the house time zone, and the registered slices. Commands stay off here."""
import asyncio
from unittest import mock

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from gateway_fakes import gw, off, recv  # noqa: F401 -- fixtures
from mantel_server import server
from mantel_server.authz import resolve_door
from mantel_server.config import Config


def uid(env, username):
    return env.app["store"].db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()[0]


def principal_of(env):
    (s,) = list(env.app["hub"].sessions)
    return s.principal


async def subscribe_all(ws):
    await ws.send_json({"type": "subscribe", "all": True})
    snap = await recv(ws)
    assert snap["type"] == "snapshot"
    return snap


# -- the read filter on each socket ------------------------------------------------------------------
async def test_a_child_socket_never_receives_a_lock(off):
    await off.login("cody", "child")
    off.app["rbac"].set_scopes("user", uid(off, "cody"), ["cody_room"])
    ws = await off.socket(expect_caps=False)
    snap = await subscribe_all(ws)
    assert set(snap["entities"]) == {"light.cody"}
    hub = off.app["hub"]
    hub.store.apply_event({"c": {"lock.front_door": {"+": {"s": "unlocked", "lc": 5.0}}}})
    hub.on_change({"lock.front_door"})
    hub.store.apply_event({"a": {"lock.garden": {"s": "locked", "a": {}, "lc": 6.0, "lu": 6.0}}})
    hub.on_change({"lock.garden"})
    hub.store.apply_event({"c": {"light.cody": {"+": {"s": "on", "lc": 7.0}}}})
    hub.on_change({"light.cody"})
    diff = await recv(ws)
    assert diff == {"type": "diff", "changes": {"light.cody": {"+": {"s": "on", "lc": 7.0, "lu": 7.0}}}}
    await ws.send_json({"type": "subscribe", "entity_ids": ["lock.front_door", "light.cody"]})
    snap = await recv(ws)
    assert set(snap["entities"]) == {"light.cody"} and snap["missing"] == ["lock.front_door"]
    await ws.close()
    reg = await (await off.m.get("/api/registry")).json()
    assert set(reg["entities"]) <= {"light.cody"}
    ents = await (await off.m.get("/api/entities")).json()
    assert [e["id"] for e in ents] == ["light.cody"]


async def test_a_tablet_devices_subject(off):
    await off.login("avery", "owner")
    r = await off.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await off.socket(expect_caps=False)
    snap = await subscribe_all(ws)
    p = principal_of(off)
    s = p.subject
    assert (s.user_role, s.user_id, s.device_role, s.door) == (None, None, "wall_tablet", "lan")
    assert s.device_id == p.identity.device.id and s.device_areas == frozenset({"kitchen"}) and s.fresh_factor_at is None
    # its room, plus every camera (the doorbell pop-up: a house grant), nothing else
    assert set(snap["entities"]) == {"light.kitchen", "lock.kitchen_door", "camera.doorbell"}
    authz = off.app["authz"]
    assert authz.may_view(p, "camera.doorbell") is True                       # no PIN on the LAN door
    # a stored scope replaces the enrolled room
    off.app["rbac"].set_scopes("device", s.device_id, ["cody_room"])
    assert authz.refresh(p) and p.subject.device_areas == frozenset({"cody_room"})
    await ws.close()


async def test_a_person_at_a_tablet_gets_the_intersection(off):
    # the device credential and a person's session on the same browser
    await off.login("avery", "owner")
    await off.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    await off.m.user("cody", "child")
    r, _ = await off.m.sign_in("cody")
    assert r.status == 200
    ws = await off.socket(expect_caps=False)
    snap = await subscribe_all(ws)
    s = principal_of(off).subject
    assert s.user_role == "child" and s.device_role == "wall_tablet"
    assert "lock.kitchen_door" not in snap["entities"] and "camera.doorbell" not in snap["entities"]
    await ws.close()


# -- the door -------------------------------------------------------------------------------------------
def door(peer, headers=None, trusted=()):
    app = web.Application()
    app["cfg"] = Config(trusted_proxies=tuple(trusted))
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda name, default=None: (peer, 4321) if name == "peername" else default
    return resolve_door(make_mocked_request("GET", "/ws", headers=headers or {}, app=app, transport=transport))


def test_the_door_comes_from_a_trusted_proxy_only():
    caddy = "172.30.0.2"
    assert door(caddy, {"X-Mantel-Door": "lan"}, trusted=[caddy]) == "lan"
    assert door(caddy, {"X-Mantel-Door": "tunnel"}, trusted=[caddy]) == "tunnel"
    assert door(caddy, {}, trusted=[caddy]) == "tunnel"                          # Caddy always stamps: missing fails closed
    assert door(caddy, {"X-Mantel-Door": "LAN "}, trusted=[caddy]) == "lan"
    assert door(caddy, {"X-Mantel-Door": "lan", "Cf-Ray": "x"}, trusted=[caddy]) == "tunnel"
    # an untrusted peer cannot claim the LAN door
    assert door("172.30.0.9", {"X-Mantel-Door": "lan"}, trusted=[caddy]) == "tunnel"
    assert door("203.0.113.7", {"X-Mantel-Door": "lan"}) == "tunnel"
    assert door("203.0.113.7", {}) == "tunnel"
    # loopback (the prototype) is the LAN door; a stricter claim is honoured from anyone
    assert door("127.0.0.1", {}) == "lan" and door("::1", {}) == "lan"
    assert door("127.0.0.1", {"X-Mantel-Door": "tunnel"}) == "tunnel"
    assert door("127.0.0.1", {"Cf-Connecting-Ip": "203.0.113.7"}) == "tunnel"
    assert door("127.0.0.1", {"X-Mantel-Door": "something"}) == "tunnel"


def test_build_app_installs_the_door_rule(tmp_path):
    from mantel_server.store import Store
    app = server.build_app(Config(data_dir=tmp_path, secrets_dir=tmp_path / "s"), "fictional",
                           store=Store(tmp_path / "m.db"), connect_ha=False)
    assert app["door_resolver"] is resolve_door
    assert {"read", "read_subscribe", "read_unsubscribe", "read_api", "ma/read", "ma/subscribe", "ma/unsubscribe",
            "settings_write"} \
        == set(app["ws_handlers"])
    assert app["gateway"] is None and app["commander"] is None and app["ma"] is None
    paths = {r.resource.canonical for r in app.router.routes() if r.resource is not None}
    assert {"/healthz", "/api/version", "/api/rbac/grants", "/api/rbac/scopes/{kind}/{id}"} <= paths
    app["store"].db.close()


def test_commands_on_builds_the_gateway_and_the_command_path(tmp_path):
    from mantel_server.ha_client import HaCommander
    from mantel_server.store import Store
    app = server.build_app(Config(data_dir=tmp_path, secrets_dir=tmp_path / "s", commands_enabled=True), "fictional",
                           store=Store(tmp_path / "m.db"), connect_ha=False)
    assert isinstance(app["commander"], HaCommander) and app["gateway"].commander is app["commander"]
    assert app["camera_signaling"] is not None
    app["store"].db.close()


# -- dispatch, reads, hooks -----------------------------------------------------------------------------
class FakeReads:
    def __init__(self, config=None):
        self.config = config or {"time_zone": "America/New_York", "latitude": 40.0, "unit_system": {}}
        self.asked = []

    async def request(self, msg):
        self.asked.append(msg["type"])
        if msg["type"] == "get_config":
            return dict(self.config)
        return {"light.kitchen": [{"s": "on"}], "lock.front_door": [{"s": "locked"}]}

    async def subscribe(self, msg, cb):
        return 1

    async def unsubscribe(self, mid):
        pass

    async def close(self):
        pass


async def test_reads_go_through_the_filtered_handlers(off):
    off.app["hub"].readproxy = FakeReads()
    await off.login("gwen", "guest")
    off.app["rbac"].set_scopes("user", uid(off, "gwen"), ["kitchen"])
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "read", "id": 1, "msg": {"type": "get_config"}})
    got = await recv(ws)
    assert got["type"] == "read_result" and "latitude" not in got["result"]            # no locations for a guest
    await ws.send_json({"type": "read", "id": 2, "msg": {"type": "history/history_during_period",
                                                         "start_time": "2026-10-01T00:00:00Z",
                                                         "entity_ids": ["light.kitchen", "lock.front_door"]}})
    got = await recv(ws)
    assert got["result"] == {}                          # a guest reads no history at all
    await ws.send_json({"type": "read", "id": 3, "msg": {"type": "call_service", "domain": "lock", "service": "unlock"}})
    assert (await recv(ws))["error"]["code"] == "not_allowed"
    await ws.close()
    assert off.app["hub"].readproxy.asked == ["get_config"]


async def test_may_read_and_may_view_hooks(off):
    await off.login("jordan", "adult")
    ws = await off.socket(expect_caps=False)
    p = principal_of(off)
    authz = off.app["authz"]
    assert authz.may_read(p, "history", ["light.kitchen", "person.jamie", "feature:media", "feature:energy",
                                          "sensor:external", "feature:nonsense", 3]) == \
        ["light.kitchen", "person.jamie", "feature:media", "feature:energy"]
    assert authz.may_read(p, "configure", ["light.kitchen"]) == [] and authz.may_read("adult", "view", ["light.kitchen"]) == []
    assert authz.may_view(p, "camera.doorbell") is True                        # LAN: live view needs no step-up
    await ws.close()
    # on the tunnel the §7 rules are unchanged: a live view needs a fresh factor
    p.identity = p.identity.__class__(**{**p.identity.__dict__, "door": "tunnel", "fresh_factor_at": None})
    p.subject = authz.subject_of(p.identity)
    assert authz.may_view(p, "camera.doorbell") is False
    await off.login("cody", "child")
    ws = await off.socket(expect_caps=False)
    assert authz.may_view(principal_of(off), "camera.doorbell") is False
    await ws.close()


# -- the tick -----------------------------------------------------------------------------------------
async def test_the_policy_tick_applies_role_changes_and_closes_revoked_sockets(off):
    await off.login("cody", "child")
    off.app["rbac"].set_scopes("user", uid(off, "cody"), ["cody_room"])
    ws = await off.socket(expect_caps=False)
    await subscribe_all(ws)
    db = off.app["store"].db
    with db:
        db.execute("UPDATE users SET role = 'adult' WHERE username = 'cody'")
    await server.tick_once(off.app, off.app["hub"])
    diff = await recv(ws)
    assert "lock.front_door" in diff["added"] and "person.jamie" in diff["added"]
    off.app["sessions"].revoke_user(uid(off, "cody"), "test")
    await server.tick_once(off.app, off.app["hub"])
    msg = await asyncio.wait_for(ws.receive(), 3)
    assert msg.type.name in ("CLOSE", "CLOSED", "CLOSING")


async def test_house_time_zone_from_home_assistant_with_a_fallback(off):
    hub, authz = off.app["hub"], off.app["authz"]
    assert authz.tz == "UTC" and authz.tz_source == "config"
    hub.readproxy = FakeReads({"time_zone": "Mars/Olympus_Mons"})
    await server.house_tz(off.app, hub, attempts=1)
    assert authz.tz == "UTC"                                                   # unknown zone: the fallback stays
    hub.readproxy = FakeReads()
    await server.house_tz(off.app, hub, attempts=1)
    assert authz.tz == "America/New_York" and authz.tz_source == "home_assistant"
    assert authz.context().tz == "America/New_York"


async def test_the_context_always_has_the_exact_time(off):
    # regression (found by the e2e): a context cached within a second made a step-up stamped later in
    # that second look like a factor from the future, so the retried unlock asked again
    authz = off.app["authz"]
    off.now[0] = 1_000_000.2
    assert authz.context().now == 1_000_000.2
    off.now[0] = 1_000_000.7
    ctx = authz.context()
    assert ctx.now == 1_000_000.7 and ctx.tz == authz.tz
    from mantel_server.rbac import Subject
    adult = Subject(user_role="adult", user_id="u1", fresh_factor_at=1_000_000.6)
    assert authz.decide(adult, "lock.unlock", "lock.front_door").allowed


async def test_health_is_public_and_rbac_rest_is_owner_only(off):
    off.m.forget_cookies()
    r = await off.m.get("/healthz")
    assert r.status == 200 and (await r.json())["status"] in ("ok", "degraded")
    assert (await off.m.get("/api/rbac/grants")).status == 401
    await off.login("jordan", "adult")
    assert (await off.m.get("/api/rbac/grants")).status == 403
    await off.login("avery", "owner")
    r = await off.m.post("/api/rbac/grants", {"effect": "deny", "actions": ["view"], "resource_kind": "entity",
                                              "resource": "light.kitchen", "roles": ["adult"]})
    assert r.status == 201
    (row,) = off.audit(kind="config")
    assert row["action"] == "rbac.grant.add" and row["role"] == "owner"


def test_classify_still_refuses_every_command_shape():
    for msg in ({"type": "command"}, {"type": "call_service"}, {"cmd": "x"}, {"type": "x", "service": "y"},
                {"type": "ma/read", "service": "y"}):
        assert server.classify(msg) == "command"
    assert server.classify({"type": "read"}) == "read"         # a read handler refuses any extra key itself


# -- P3.5's settings store, wired --------------------------------------------------------------------
async def test_settings_saves_reach_the_store_by_role(off):
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "settings_write", "id": 1,
                        "msg": {"type": "hk_frontend/settings/set", "changes": {"sky.decorations": False}}})
    got = await recv(ws)
    assert got["type"] == "settings_result" and "error" not in got, got
    await ws.close()
    assert off.app["settings"].store is not None
    off.m.forget_cookies()
    await off.login("cody", "child")
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "settings_write", "id": 2,
                        "msg": {"type": "hk_frontend/settings/set", "changes": {"sky.decorations": True}}})
    got = await recv(ws)
    assert got["type"] == "settings_result" and got.get("error"), got      # a Child changes no house setting
    await ws.close()
