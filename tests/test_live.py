"""One lifecycle for long-lived connections (live.py): every socket, relayed context and subscription that holds a
person, a wall tablet or a link credential is in one registry. A revocation ends what it held at once (not at the
next policy tick), the tick ends what a lowered role no longer allows, and turning house commands off ends what
needed them. Fictional house, people and upstreams only."""
import asyncio
import json

import pytest
from aiohttp import WSMsgType

import gateway_fakes as GF
from gateway_fakes import gw, off, recv  # noqa: F401 -- fixtures
from https_fakes import ma_app, make_mantel, start_upstream
from mantel_server import server
from mantel_server import connections as C
from test_features import make_env  # noqa: F401 -- fixture
from test_linked_settings import READS, page
from test_ma_page import speakers
from test_music import off as music_off  # noqa: F401 -- fixture
from test_talk_live import _live, closed, ha, until  # noqa: F401 -- fixtures and helpers

HA_ADULT = "b" * 32
FEED = {"type": "hk_frontend/page_headers/subscribe"}


async def ends(ws, timeout=2.0) -> bool:
    """The socket is closed within `timeout` (frames still on their way are read past)."""
    try:
        while True:
            m = await asyncio.wait_for(ws.receive(), timeout)
            if m.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING, WSMsgType.ERROR):
                return True
    except asyncio.TimeoutError:
        return False


def uid(env, username):
    return env.app["accounts"].db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]


def principal(env):
    return next(iter(env.app["hub"].sessions)).principal


async def link_socket(env, header=READS):
    """Mantel Link (as a linked HK Frontend that relays its dashboards' reads): the socket and its credential."""
    acct, token = env.app["service_accounts"].create("home-assistant", ["linked"])
    env.m.client.session.headers.pop("Origin", None)
    try:
        ws = await env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {token}",
                                                                  "X-Mantel-Link": header})
    finally:
        env.m.client.session.headers["Origin"] = env.m.origin
    assert (await ws.receive_json(timeout=5))["type"] == "hello"
    return ws, acct


# -- the registry itself --------------------------------------------------------------------------------------
async def test_a_revocation_ends_only_what_it_names_within_one_turn_of_the_loop():
    from mantel_server.live import Live
    from mantel_server.identity.sessions import Device, Identity, User
    live = Live()
    ended = []
    a = Identity(user=User(id="u-avery", name="Avery", role="owner", kind="local"), device=None, door="lan", session_id="s-1")
    b = Identity(user=User(id="u-cody", name="Cody", role="child", kind="local"), device=Device(id="d-kitchen", name="Kitchen",
                                                                                   role="wall_tablet", room="kitchen"),
                 door="lan", session_id="s-2")
    live.add("hub", a, lambda why: ended.append(("a", why)))
    live.add("hub", b, lambda why: ended.append(("b", why)))
    live.add("talk", b, lambda why: ended.append(("b-talk", why)), needs_commands=True)
    live.notify("device:d-kitchen")                     # what a sync caller (DeviceManager.revoke) does
    await asyncio.sleep(0)                              # one turn of the loop: no tick
    assert sorted(n for n, _ in ended) == ["b", "b-talk"] and [e.kind for e in live.entries()] == ["hub"]
    live.add("talk", a, lambda why: ended.append(("a-talk", why)), needs_commands=True)
    await live.commands_off()
    assert ended[-1] == ("a-talk", "refused:commands_disabled") and [e.kind for e in live.entries()] == ["hub"]


# -- page sockets (hub) ---------------------------------------------------------------------------------------
async def test_a_page_socket_ends_at_once_when_its_person_is_disabled(off):
    await off.login("cody", "child")
    ws = await off.socket(expect_caps=False)
    await off.login("avery", "owner")                   # the open socket stays Cody's
    r = await off.m.client.patch(f"/api/users/{uid(off, 'cody')}", json={"disabled": True}, headers=off.m.headers())
    assert r.status == 200
    assert await ends(ws), "a disabled person's open page kept its socket until the next policy tick"


async def test_a_page_socket_ends_at_once_when_its_session_is_revoked(off):
    await off.login("cody", "child")
    ws = await off.socket(expect_caps=False)
    off.app["sessions"].revoke(principal(off).identity.session_id, "test")
    assert await ends(ws)


async def test_a_wall_tablets_socket_ends_at_once_when_the_tablet_is_revoked(off):
    await off.login("avery", "owner")
    r = await off.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await off.socket(expect_caps=False)
    off.app["devices"].revoke(principal(off).identity.device.id, "test")
    assert await ends(ws)


# -- Mantel Link and the dashboards' relayed reads ----------------------------------------------------------
async def test_mantel_link_ends_at_once_when_its_credential_is_revoked(make_env):
    env = await make_env()
    ws, acct = await link_socket(env)
    env.app["service_accounts"].revoke(acct.id)
    assert await ends(ws), "a revoked link credential kept its socket until its own recheck"


async def test_a_dashboards_relayed_reads_end_at_once_when_its_home_assistant_user_is_unlinked(make_env):
    env = await make_env()
    await env.login("avery", "owner")
    env.app["store"].link(HA_ADULT, "adult", "Fictional Adult")
    ws, _ = await link_socket(env)
    res, _ = await page(ws, 1, HA_ADULT, {"type": "read_subscribe", "id": 7, "msg": FEED})
    assert res["success"], res
    ctx = next(iter(env.app["linked_reads"].ctxs.values()))
    r = await env.m.client.put("/api/people/ha", json={"ha_user": HA_ADULT, "user_id": None}, headers=env.m.headers())
    assert r.status == 200, await r.text()
    assert await until(lambda: ctx.closed, timeout=1), "the unlinked user's reads went on until the policy tick"
    assert not ctx.subs and not env.app["linked_reads"].ctxs
    await ws.close()


async def test_one_link_carries_at_most_32_dashboard_users_at_once(make_env):
    env = await make_env()
    users = [f"{i:032x}" for i in range(1, 34)]
    for u in users:
        env.app["store"].link(u, "adult", "Fictional Adult")
    ws, _ = await link_socket(env)
    for i, u in enumerate(users[:32]):
        res, _ = await page(ws, i + 1, u, {"type": "read_subscribe", "id": 7, "msg": FEED})
        assert res["success"], res
    res, _ = await page(ws, 40, users[32], {"type": "read_subscribe", "id": 7, "msg": FEED})
    assert res["success"] is False and res["error"]["code"] == "too_many", res
    assert len(env.app["linked_reads"].ctxs) == 32
    # one of the 32 is still answered
    res, _ = await page(ws, 41, users[0], {"type": "read_subscribe", "id": 8, "msg": FEED})
    assert res["success"], res
    await ws.close()


# -- live talk ------------------------------------------------------------------------------------------------
async def test_a_live_talk_ends_at_once_when_its_session_is_revoked(gw, ha):
    hub, ws, aid = await _live(gw, ha)
    gw.app["sessions"].revoke_user(uid(gw, "avery"), "test")
    assert await closed(ws, timeout=1) == 1008
    await hub.close()


async def test_a_live_talk_ends_at_the_tick_when_its_person_may_no_longer_talk(gw, ha):
    hub, ws, aid = await _live(gw, ha)
    db = gw.app["store"].db
    with db:
        db.execute("UPDATE users SET role = 'guest' WHERE username = 'avery'")
    await server.tick_once(gw.app, gw.app["hub"])
    assert await closed(ws, timeout=1) == 1008
    await hub.close()


# -- Music Assistant: the page's sockets through the media proxy, and the subscriptions ------------------------
@pytest.fixture
async def ma_env(tmp_path, monkeypatch):
    ma = await start_upstream(ma_app)
    m = await make_mantel(tmp_path, monkeypatch, commands_enabled=True, ma_web_url=ma.url + "/")
    speakers(m)
    conns = m.app["connections"]
    rec = C.Record(kind="ma", url=ma.url, token="engine-admin-token", method="token", since=1.0)
    conns.files.save(rec)
    conns.own["ma"] = rec
    yield m, ma
    await m.client.close()
    await ma.server.close()
    m.store.db.close()


async def test_a_music_assistant_page_socket_ends_at_once_when_its_session_is_revoked(ma_env):
    m, _ = ma_env
    await m.as_role("adult")
    async with m.client.ws_connect("/ma/ws") as ws:
        await ws.receive(timeout=5)
        m.app["sessions"].revoke_user(uid(m, "adult"), "test")
        assert await ends(ws), "the page's Music Assistant socket stayed open until its own minute-long recheck"


async def test_a_music_assistant_page_socket_ends_at_the_tick_when_music_is_taken_away(ma_env):
    m, _ = ma_env
    await m.as_role("adult")
    async with m.client.ws_connect("/ma/ws") as ws:
        await ws.receive(timeout=5)
        with m.store.db:
            m.store.db.execute("UPDATE users SET role = 'guest' WHERE username = 'adult'")
        await server.tick_once(m.app, m.app["hub"])
        assert await ends(ws)


async def test_the_signed_music_assistant_page_ends_when_house_commands_are_turned_off(ma_env):
    m, _ = ma_env
    await m.as_role("owner")
    r = await m.client.post("/api/connections/ma/page", json={"token": "page-token-user"}, headers=m.csrf())
    assert r.status == 200
    async with m.client.ws_connect("/ma/hassio_ingress/mantel/ws") as ws:
        assert json.loads((await ws.receive(timeout=5)).data)["homeassistant_addon"] is True
        async with m.client.ws_connect("/ma/ws") as plain:          # not signed in: it needs no commands
            await plain.receive(timeout=5)
            await server.apply_commands(m.app, m.app["hub"], False)
            assert await ends(ws), "a page signed in past the gateway stayed open with house commands off"
            assert not await ends(plain, timeout=0.3)


async def test_music_subscriptions_end_at_the_tick_when_music_is_taken_away(music_off):
    env = music_off
    await env.connected()
    await env.login("jordan", "adult")
    ws = await env.socket(expect_caps=False)
    res, ev = await env.subscribe(ws, {"type": "hk_music/subscribe"})
    assert "error" not in res and ev["configured"] is True
    await ws.send_json({"type": "ma/subscribe", "id": 61})
    got = await recv(ws)
    while got.get("type") != "ma_result":
        got = await recv(ws)
    assert "error" not in got, got
    ctx = next(iter(env.app["hub"].sessions)).ctx
    assert {("read", 60), ("ma", 61)} <= set(ctx.subs)
    await server.tick_once(env.app, env.app["hub"])                     # still allowed: kept
    assert {("read", 60), ("ma", 61)} <= set(ctx.subs)
    with env.app["store"].db:
        env.app["store"].db.execute("UPDATE users SET role = 'guest' WHERE username = 'jordan'")
    await server.tick_once(env.app, env.app["hub"])
    assert ("read", 60) not in ctx.subs and ("ma", 61) not in ctx.subs
    assert not await ends(ws, timeout=0.3)                              # the page itself stays
    await ws.close()


async def test_music_assistant_subscriptions_follow_a_replaced_connection(music_off, monkeypatch):
    from mantel_server.connectors.ma import MaClient
    env = music_off
    await env.connected()
    await env.login("avery", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "ma/subscribe", "id": 5})
    got = await recv(ws)
    while got.get("type") != "ma_result":
        got = await recv(ws)
    assert "error" not in got, got
    hub, old = env.app["hub"], env.app["ma"]
    await server.apply_connection(env.app, hub, False, "ma", None)        # Music Assistant removed...
    monkeypatch.setattr(MaClient, "start", lambda self: None)            # (the new one stays offline here)
    await server.apply_connection(env.app, hub, False, "ma", C.Current("ma", "mantel", "http://ma.invalid:8095", "t"))
    new = env.app["ma"]                                                    # ...and set up again: a new client
    assert new is not None and new is not old
    new._dispatch({"event": "media_item_added", "object_id": "fictional", "data": None})
    got = await recv(ws)
    while got.get("type") != "ma_event":
        got = await recv(ws)
    assert got["id"] == 5 and got["event"]["event"] == "media_item_added"
    await ws.close()


# -- settings saves over the socket ---------------------------------------------------------------------------
async def test_a_settings_save_over_the_socket_is_refused_once_its_principal_is_no_longer_valid(off):
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    msg = {"type": "hk_frontend/settings/set", "changes": {"look.glass": "clear"}}
    await ws.send_json({"type": "settings_write", "id": 1, "msg": msg})
    got = await recv(ws)
    assert "result" in got, got
    principal(off).valid = False                       # what Authz.refresh says of a session that ended
    await ws.send_json({"type": "settings_write", "id": 2, "msg": msg})
    got = await recv(ws)
    assert got["id"] == 2 and got.get("error", {}).get("code") == "forbidden", got
