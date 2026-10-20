"""A wall tablet's Direct Connection (mantel_server/tablet_links.py; docs/phase8/KIOSK.md slice 1): paired from the
tablet's page, tested live, sealed, audited, listed, read, and never a command sent. Against fake tablets
(tests/kiosk_satellite_fakes.py, tests/fully_fakes.py); the fictional tablet addresses are mapped to them on
loopback. Nothing here reads ~/.config/mantel or contacts a real house or tablet."""
from __future__ import annotations

import logging

import pytest
from aiohttp.test_utils import TestServer

import fully_fakes
from kiosk_satellite_fakes import PASSWORD as KS_PASSWORD, FakeKioskSatellite
from mantel_server import tablet_links as TL
from mantel_server.connectors import kiosk
from mantel_server.settings_store import Actor
from test_connections import envs, owner  # noqa: F401 -- the fixture and helper

KS_ADDR, FULLY_ADDR = "192.0.2.168", "192.0.2.31"
KITCHEN_DEVICE = "d" * 32
TABLETS = [
    ("tablet", "kitchen", {"name": "Kitchen", "screen": "dashboard-kitchen", "room": "kitchen", "app": "kiosk_satellite",
                           "device": KITCHEN_DEVICE}),
    ("tablet", "den", {"name": "Den", "screen": "dashboard-den", "room": "den", "app": "fully", "device": ""}),
    ("tablet", "hall", {"name": "Hall", "screen": "dashboard-hall", "room": "hall", "app": "browser", "device": ""}),
]
API = TL.API


@pytest.fixture
async def tablets(monkeypatch):
    ks, fu = FakeKioskSatellite(), fully_fakes.FakeFully()
    servers = [TestServer(ks.app()), TestServer(fu.app())]
    for s in servers:
        await s.start_server()
    to = {KS_ADDR: servers[0].port, FULLY_ADDR: servers[1].port}
    monkeypatch.setattr(kiosk, "route", lambda host, port: ("127.0.0.1", to[host]) if host in to else (host, port))
    yield ks, fu, servers
    for s in servers:
        await s.close()


async def house(envs):  # noqa: F811
    env = await envs()
    env.app["settings"].store.write(TABLETS, actor=Actor(label="test"))
    return env


def secrets_in(env, *also) -> list[str]:
    text = "\n".join(env.bodies)
    return [s for s in (KS_PASSWORD, fully_fakes.PASSWORD, *also) if s and s in text]


def _mantel_log(caplog) -> str:
    return "\n".join(r.getMessage() for r in caplog.records if not r.name.startswith("aiohttp.access"))


# -- who ---------------------------------------------------------------------------------------------------------
async def test_who_may_see_and_who_may_pair(envs, tablets):  # noqa: F811
    ks, *_ = tablets
    env = await house(envs)
    for name, role in (("kid", "child"), ("mom", "adult"), ("boss", "admin")):
        await env.user(name, role)
    for name in ("kid", "mom"):
        await env.sign_in(name)
        assert (await env.call("GET", API))[0] == 403
        assert (await env.call("POST", API + "/kitchen/test", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 403
    await env.sign_in("boss")
    status, body = await env.call("GET", API)
    assert status == 200 and body["can_edit"] is False
    for method, path, payload in (("POST", API + "/kitchen/test", {"address": KS_ADDR, "password": KS_PASSWORD}),
                                  ("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}),
                                  ("DELETE", API + "/kitchen", None)):
        status, body = await env.call(method, path, payload)
        assert status == 403 and body["error"] == "owner_only", (path, body)
    assert ks.calls == []                                     # nothing reached the tablet


async def test_a_wall_tablet_gets_nothing(envs, tablets):  # noqa: F811
    env = await house(envs)
    await owner(env)
    assert (await env.call("POST", "/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"}))[0] == 201
    assert (await env.call("GET", API))[0] == 403


# -- the list ------------------------------------------------------------------------------------------------------
async def test_the_list_is_hk_s_tablets_with_their_entries(envs, tablets):  # noqa: F811
    env = await house(envs)
    await owner(env)
    status, body = await env.call("GET", API)
    assert status == 200 and body["can_edit"] is True
    rows = {t["id"]: t for t in body["tablets"]}
    assert [t["id"] for t in body["tablets"]] == ["den", "hall", "kitchen"]           # by name
    assert rows["kitchen"]["app_label"] == "Kiosk Satellite" and rows["kitchen"]["state"] == "not_set_up"
    assert rows["den"]["app_label"] == "Fully Kiosk" and rows["den"]["supported"] is True
    assert rows["hall"]["supported"] is False
    status, body = await env.call("POST", API + "/hall/test", {"address": KS_ADDR, "password": "x"})
    assert status == 409 and body["error"] == "no_direct_connection"
    assert (await env.call("POST", API + "/attic/test", {"address": KS_ADDR, "password": "x"}))[0] == 404
    assert (await env.call("POST", API + "/Bad!/test", {"address": KS_ADDR, "password": "x"}))[0] == 404


async def test_the_address_is_suggested_from_kiosk_satellites_own_sensor(envs, tablets):  # noqa: F811
    env = await house(envs)
    await owner(env)
    hub = env.app["hub"]
    hub.registry.load([{"area_id": "kitchen", "name": "Kitchen"}],
                      [{"id": KITCHEN_DEVICE, "name": "Kitchen Kiosk", "area_id": "kitchen"}],
                      [{"entity_id": "sensor.kitchen_kiosk_ipv4_address", "device_id": KITCHEN_DEVICE, "platform": "esphome"},
                       {"entity_id": "sensor.kitchen_kiosk_ipv4_addresses_by_interface", "device_id": KITCHEN_DEVICE,
                        "platform": "esphome"}])
    hub.store.apply_event({"a": {"sensor.kitchen_kiosk_ipv4_address": {"s": "192.0.2.168", "a": {}, "lc": 1.0},
                                 "sensor.kitchen_kiosk_ipv4_addresses_by_interface": {"s": "wlan0: 192.0.2.168",
                                                                                      "a": {}, "lc": 1.0}}})
    _, body = await env.call("GET", API)
    rows = {t["id"]: t for t in body["tablets"]}
    assert rows["kitchen"]["suggested_url"] == "http://192.0.2.168:2324"
    assert rows["den"]["suggested_url"] is None


# -- pairing Kiosk Satellite ---------------------------------------------------------------------------------------
async def test_test_tries_the_pairing_and_saves_nothing(envs, tablets):  # noqa: F811
    ks, *_ = tablets
    env = await house(envs)
    await owner(env)
    status, body = await env.call("POST", API + "/kitchen/test", {"address": KS_ADDR, "password": KS_PASSWORD})
    assert status == 200, body
    assert body["result"]["info"]["name"] == "Kitchen Kiosk (fake)" and body["result"]["missing"] == []
    assert ks.logins == [{"ok": True, "ttl_days": 1}]                     # a test token lapses tomorrow
    assert env.app["tablet_links"].get("kitchen") is None
    assert not list(env.cfg.connections_dir.glob("tablet-*")) if env.cfg.connections_dir.exists() else True
    assert env.app["audit"].rows(kind="config") == []
    assert secrets_in(env) == [] and "token" not in body["result"]


async def test_save_pairs_seals_audits_and_never_shows_a_secret(envs, tablets, caplog):  # noqa: F811
    ks, *_ = tablets
    caplog.set_level(logging.DEBUG)
    env = await house(envs)
    await owner(env)
    status, body = await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD})
    assert status == 200, body
    assert ks.logins == [{"ok": True, "ttl_days": 3650}]
    t = body["tablet"]
    assert t["state"] == "set" and t["url"] == "http://192.0.2.168:2324"
    assert t["saved"]["device"] == {"name": "Kitchen Kiosk (fake)", "model": "Fake Tablet 11", "version": "2026.10.6"}
    assert t["saved"]["by_name"] == "Avery" and t["saved"]["expires"] > env.now[0]
    rec = env.app["tablet_links"].get("kitchen")
    assert ks.valid(rec.token)
    # sealed: neither the password nor the token is readable in the file
    raw = (env.cfg.connections_dir / "tablet-kitchen.connection").read_bytes()
    assert KS_PASSWORD.encode() not in raw and rec.token.encode() not in raw
    # never in a response, the audit or Mantel's log
    assert secrets_in(env, rec.token) == []
    rows = env.app["audit"].rows(kind="config")
    assert [r["action"] for r in rows] == ["connection.tablet-kitchen.saved"]
    assert rec.token not in rows[0]["target"] and KS_PASSWORD not in rows[0]["target"]
    assert '"app": "kiosk_satellite"' in rows[0]["target"] and "192.0.2.168:2324" in rows[0]["target"]
    assert KS_PASSWORD not in _mantel_log(caplog) and rec.token not in _mantel_log(caplog)
    assert "token" not in repr(rec) or rec.token not in repr(rec)
    # reads only, ever: the login, the info and the command list
    assert ks.commands_posted == []
    assert {p for _m, p in ks.calls} <= {"/api/login", "/api/info", "/api/commands"}


async def test_the_list_and_live_read_the_tablet_now(envs, tablets):  # noqa: F811
    ks, *_ = tablets
    env = await house(envs)
    await owner(env)
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    ks.state.update(screenOn=False, brightness=0.0)
    _, body = await env.call("GET", API + "?live=1")
    rows = {t["id"]: t for t in body["tablets"]}
    assert rows["kitchen"]["live"] == {"ok": True, "info": {**rows["kitchen"]["live"]["info"], "screen_on": False,
                                                           "brightness": 0}}
    assert rows["den"]["live"] is None
    status, body = await env.call("GET", API + "/kitchen/live")
    assert status == 200 and body["live"]["info"]["name"] == "Kitchen Kiosk (fake)"
    ks.rotate_secret()                                          # the app's reset: Mantel's token no longer works
    _, body = await env.call("GET", API + "/kitchen/live")
    assert body["live"]["ok"] is False and body["live"]["error"]["code"] == "token_refused"
    assert (await env.call("GET", API + "/den/live"))[0] == 404
    assert ks.commands_posted == []


async def test_a_wrong_password_saves_nothing_and_says_so(envs, tablets):  # noqa: F811
    env = await house(envs)
    await owner(env)
    status, body = await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": "wrong-one"})
    assert status == 422 and body["error"] == "bad_password" and "wrong-one" not in body["message"]
    assert env.app["tablet_links"].get("kitchen") is None and env.app["audit"].rows(kind="config") == []
    status, body = await env.call("POST", API + "/kitchen", {"address": "8.8.8.8", "password": KS_PASSWORD})
    assert status == 422 and body["error"] == "address_not_home"


async def test_disconnect_audits_and_forgets_and_a_restart_keeps_a_saved_entry(envs, tablets):  # noqa: F811
    env = await house(envs)
    await owner(env)
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    again = TL.TabletLinks(env.cfg, env.app["tablet_links"].files.box)          # as at the next start
    assert again.get("kitchen").url == "http://192.0.2.168:2324" and again.unreadable == {}
    status, body = await env.call("DELETE", API + "/kitchen")
    assert status == 200 and body["tablet"]["state"] == "not_set_up"
    assert not (env.cfg.connections_dir / "tablet-kitchen.connection").exists()
    assert [r["action"] for r in env.app["audit"].rows(kind="config")] == ["connection.tablet-kitchen.saved",
                                                                           "connection.tablet-kitchen.disconnected"]
    assert (await env.call("DELETE", API + "/kitchen"))[0] == 404


async def test_a_damaged_file_is_reported_not_fatal(envs, tablets):  # noqa: F811
    env = await house(envs)
    env.cfg.connections_dir.mkdir(parents=True, exist_ok=True)
    (env.cfg.connections_dir / "tablet-kitchen.connection").write_bytes(b"not sealed")
    links = TL.TabletLinks(env.cfg, env.app["tablet_links"].files.box)
    assert links.get("kitchen") is None and "kitchen" in links.unreadable


async def test_the_audit_must_be_written_first(envs, tablets):  # noqa: F811
    env = await house(envs)
    await owner(env)

    def broken(event):
        raise RuntimeError("disk full")
    env.app["audit"].config_event = broken
    status, body = await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD})
    assert status == 503 and body["error"] == "audit_unavailable"
    assert env.app["tablet_links"].get("kitchen") is None


# -- Fully ---------------------------------------------------------------------------------------------------------
async def test_a_fully_tablet_keeps_its_password_sealed(envs, tablets):  # noqa: F811
    _ks, fu, _ = tablets
    env = await house(envs)
    await owner(env)
    status, body = await env.call("POST", API + "/den", {"address": FULLY_ADDR, "password": fully_fakes.PASSWORD})
    assert status == 200, body
    assert body["tablet"]["url"] == "http://192.0.2.31:2323" and body["tablet"]["saved"]["expires"] is None
    raw = (env.cfg.connections_dir / "tablet-den.connection").read_bytes()
    assert fully_fakes.PASSWORD.encode() not in raw
    assert secrets_in(env) == []
    assert fu.cmds() == ["deviceInfo"]                          # a read, nothing else


# -- Setup Check ---------------------------------------------------------------------------------------------------
async def test_setup_check_reaches_every_paired_tablet(envs, tablets):  # noqa: F811
    ks, fu, servers = tablets
    env = await house(envs)
    await owner(env)
    assert await TL.setup_lines(env.app) == []                  # none paired: no line
    await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD})
    await env.call("POST", API + "/den", {"address": FULLY_ADDR, "password": fully_fakes.PASSWORD})
    lines = await TL.setup_lines(env.app)
    assert lines == [{"ok": True, "title": "Wall Tablets", "detail": "2 reachable directly: Den, Kitchen."}]
    assert ks.calls[-1] == ("GET", "/api/health")               # no token needed for it
    await servers[0].close()                                    # the kitchen tablet goes away
    lines = await TL.setup_lines(env.app)
    assert lines[0]["ok"] is False and lines[0]["detail"].startswith("1 of 2 reachable directly. Kitchen: ")
    assert ks.commands_posted == []


# -- Reload and Clear Cache, through the command gateway -----------------------------------------------------------
async def commanding(envs, *, commands=True):  # noqa: F811
    env = await envs(commands=commands, connect_ha=False)
    env.app["settings"].store.write(TABLETS, actor=Actor(label="test"))
    return env


def tablet_rows(env):
    return env.app["audit"].rows(kind="tablet")


async def test_reload_and_clear_cache_reach_each_app_through_the_gateway(envs, tablets, caplog):  # noqa: F811
    ks, fu, _ = tablets
    caplog.set_level(logging.DEBUG)
    env = await commanding(envs)
    await owner(env)
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    assert (await env.call("POST", API + "/den", {"address": FULLY_ADDR, "password": fully_fakes.PASSWORD}))[0] == 200
    for tid, verb in (("kitchen", "reload"), ("kitchen", "clear_cache"), ("den", "reload"), ("den", "clear_cache")):
        status, body = await env.call("POST", API + f"/{tid}/command", {"verb": verb})
        assert status == 200 and body["result"] == {"tablet": tid, "verb": verb}, body
        assert isinstance(body["audit_id"], int)
    assert ks.commands_posted == ["reload", "clearWebCache"]
    assert fu.cmds()[-2:] == ["loadStartUrl", "clearCache"]
    rows = tablet_rows(env)
    assert [(r["action"], r["target"], r["decision"], r["result"]) for r in rows] == [
        ("tablet.reload", '["tablet:kitchen"]', "allowed", "ok"), ("tablet.clear_cache", '["tablet:kitchen"]', "allowed", "ok"),
        ("tablet.reload", '["tablet:den"]', "allowed", "ok"), ("tablet.clear_cache", '["tablet:den"]', "allowed", "ok")]
    assert all(r["actor_name"] == "Avery" and r["role"] == "owner" for r in rows)
    token = env.app["tablet_links"].get("kitchen").token
    assert secrets_in(env, token) == []
    assert token not in _mantel_log(caplog) and KS_PASSWORD not in _mantel_log(caplog)
    assert fully_fakes.PASSWORD not in _mantel_log(caplog)


async def test_commands_off_refuse_cleanly_and_send_nothing(envs, tablets):  # noqa: F811
    ks, *_ = tablets
    env = await commanding(envs, commands=False)
    await owner(env)
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    status, body = await env.call("POST", API + "/kitchen/command", {"verb": "reload"})
    assert status == 503 and body["error"] == "commands_disabled" and "Commands are off" in body["message"]
    assert ks.commands_posted == [] and tablet_rows(env) == []


async def test_who_may_reload(envs, tablets):  # noqa: F811
    ks, *_ = tablets
    env = await commanding(envs)
    await owner(env)
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    for name, role in (("kid", "child"), ("mom", "adult"), ("boss", "admin")):
        await env.user(name, role)
    for name in ("kid", "mom"):
        await env.sign_in(name)
        status, body = await env.call("POST", API + "/kitchen/command", {"verb": "reload"})
        assert status == 403 and body["error"] == "forbidden" and "Owner or an Admin" in body["message"], body
    assert ks.commands_posted == []
    denied = tablet_rows(env)
    assert [(r["role"], r["decision"], r["result"]) for r in denied] == [("child", "denied", "not_sent"),
                                                                         ("adult", "denied", "not_sent")]
    await env.sign_in("boss")
    assert (await env.call("POST", API + "/kitchen/command", {"verb": "reload"}))[0] == 200
    assert ks.commands_posted == ["reload"]
    # signed out: nothing
    env.client.session.cookie_jar.clear()
    status, body = await env.call("POST", API + "/kitchen/command", {"verb": "reload"})
    assert status in (401, 403) and ks.commands_posted == ["reload"]


async def test_a_wall_tablet_cannot_reload(envs, tablets):  # noqa: F811
    ks, *_ = tablets
    env = await commanding(envs)
    await owner(env)
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    assert (await env.call("POST", "/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"}))[0] == 201
    status, body = await env.call("POST", API + "/kitchen/command", {"verb": "reload"})
    assert (status, body["error"]) in ((401, "unauthenticated"), (403, "forbidden"))     # the browser is the tablet now
    assert ks.commands_posted == [] and tablet_rows(env) == []


async def test_an_unpaired_tablet_a_bad_verb_and_a_refusing_tablet(envs, tablets):  # noqa: F811
    ks, *_ = tablets
    env = await commanding(envs)
    await owner(env)
    for tid in ("kitchen", "hall"):
        status, body = await env.call("POST", API + f"/{tid}/command", {"verb": "reload"})
        assert status == 409 and body["error"] == "tablet_not_paired" and "pairs it on its page" in body["message"]
    assert [(r["decision"], r["reason"]) for r in tablet_rows(env)] == [("denied", "tablet_not_paired")] * 2
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    for payload in ({"verb": "restart_app"}, {"verb": "reload", "extra": 1}, {}, {"verb": "evalJs"}):
        status, body = await env.call("POST", API + "/kitchen/command", payload)
        assert status == 400 and body["error"] == "invalid_command", payload
    assert (await env.call("POST", API + "/Bad!/command", {"verb": "reload"}))[0] == 404
    assert ks.commands_posted == []
    ks.rotate_secret()                                     # the app's reset: Mantel's token is no longer taken
    status, body = await env.call("POST", API + "/kitchen/command", {"verb": "reload"})
    assert status == 502 and body["error"] == "tablet_token_refused" and "Pair it again" in body["message"]
    assert tablet_rows(env)[-1]["result"] == "error:tablet_token_refused"


async def test_hk_settings_finds_a_paired_tablets_reload_parts(envs, tablets):  # noqa: F811
    env = await commanding(envs)
    await owner(env)
    assert TL.panel_parts(env.app) == {}
    assert (await env.call("POST", API + "/kitchen", {"address": KS_ADDR, "password": KS_PASSWORD}))[0] == 200
    assert TL.panel_parts(env.app) == {"kitchen": {"reload": "mantel-tablet:kitchen:reload",
                                                   "clear_cache": "mantel-tablet:kitchen:clear_cache"}}
    ws = await env.client.ws_connect("/ws")
    await ws.send_json({"type": "read", "id": 3, "msg": {"type": "hk_frontend/panel/get"}})
    while True:
        msg = await ws.receive_json(timeout=5)
        if msg.get("id") == 3:
            break
    tabs = msg["result"]["tablets"]
    assert tabs["kitchen"]["parts"] == TL.panel_parts(env.app)["kitchen"]
    assert tabs["den"]["parts"] == {} and tabs["hall"]["parts"] == {}
    await ws.close()
