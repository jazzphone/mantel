"""P3.1 sessions: access + rotating refresh tokens, reuse revokes the family, CSRF, doors, identity."""
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from conftest import PASSWORD
from mantel_server.sessions import (REFRESH_REUSE_GRACE, SessionManager, cookie_secure, door_of, identity,
                                    token_hash)


def mgr(mantel) -> SessionManager:
    return mantel.app["sessions"]


async def test_only_hashes_are_stored(mantel):
    await mantel.user("jordan", "adult")
    r, _ = await mantel.sign_in("jordan")
    access, refresh = r.cookies["mantel_session"].value, r.cookies["mantel_refresh"].value
    db = mantel.store.db
    assert db.execute("SELECT COUNT(*) FROM access_tokens WHERE hash = ?", (token_hash(access),)).fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM refresh_tokens WHERE hash = ?", (token_hash(refresh),)).fetchone()[0] == 1
    dump = "\n".join(db.iterdump())
    assert access not in dump and refresh not in dump


async def test_access_expires_then_refresh_rotates_transparently(mantel):
    await mantel.user("jordan", "adult")
    r, _ = await mantel.sign_in("jordan")
    old_refresh = r.cookies["mantel_refresh"].value
    assert r.cookies["mantel_session"]["max-age"] == "900"
    mantel.now[0] += 16 * 60
    r = await mantel.get("/api/session")
    assert r.status == 200
    assert r.cookies["mantel_refresh"].value != old_refresh                # rotated
    assert r.cookies["mantel_session"].value
    used = mantel.store.db.execute("SELECT used FROM refresh_tokens WHERE hash = ?", (token_hash(old_refresh),)).fetchone()
    assert used[0] == mantel.now[0]


async def test_refresh_reuse_revokes_the_whole_family(mantel):
    uid = await mantel.user("jordan", "adult")
    issued = mgr(mantel).create(uid, "lan", "password")
    status, (second, _) = mgr(mantel).rotate(issued.refresh)
    assert status == "ok"
    # a parallel request with the old token right after the rotation is tolerated, without new tokens
    assert mgr(mantel).rotate(issued.refresh)[0] == "grace"
    mantel.now[0] += REFRESH_REUSE_GRACE + 1
    assert mgr(mantel).rotate(issued.refresh) == ("reuse", None)            # theft: family revoked
    row = mantel.store.db.execute("SELECT revoked, revoked_reason FROM sessions WHERE id = ?",
                                  (issued.session_id,)).fetchone()
    assert row["revoked"] and row["revoked_reason"] == "refresh_reuse"
    assert mgr(mantel).rotate(second.refresh)[0] == "invalid"               # the thief's copy is dead too
    assert mgr(mantel).from_access(second.access) is None


async def test_refresh_reuse_over_http_signs_out_both_holders(mantel):
    await mantel.user("jordan", "adult")
    r, _ = await mantel.sign_in("jordan")
    stolen = r.cookies["mantel_refresh"].value
    mantel.now[0] += 16 * 60
    assert (await mantel.get("/api/session")).status == 200                 # the browser rotates
    mantel.now[0] += 60
    mantel.forget_cookies()
    mantel.client.session.cookie_jar.update_cookies({"mantel_refresh": stolen})
    r = await mantel.get("/api/session")                                    # the thief replays the old one
    assert r.status == 401
    assert mantel.store.db.execute("SELECT revoked_reason FROM sessions").fetchone()[0] == "refresh_reuse"


async def test_csrf_is_required_on_state_changing_api_requests(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    assert (await mantel.post("/api/session/refresh", csrf=False)).status == 403
    r = await mantel.post("/api/session/refresh", headers={"X-CSRF-Token": "forged"}, csrf=False)
    assert r.status == 403
    assert (await mantel.post("/api/session/refresh")).status == 200
    r = await mantel.client.delete("/api/sessions/whatever")
    assert r.status == 403
    assert (await mantel.get("/api/session")).status == 200                 # reads need none


async def test_logout_revokes_and_clears(mantel):
    await mantel.user("jordan", "adult")
    r, _ = await mantel.sign_in("jordan")
    refresh = r.cookies["mantel_refresh"].value
    r = await mantel.post("/api/session/logout")
    assert r.status == 200 and r.cookies["mantel_session"].value == ""
    mantel.client.session.cookie_jar.update_cookies({"mantel_refresh": refresh})
    assert (await mantel.get("/api/session")).status == 401


async def test_list_and_revoke_sessions(mantel):
    uid = await mantel.user("jordan", "adult")
    other = mgr(mantel).create(uid, "lan", "password", user_agent="Fictional Phone")
    await mantel.sign_in("jordan")
    listed = (await (await mantel.get("/api/sessions")).json())["sessions"]
    assert len(listed) == 2 and sum(s["current"] for s in listed) == 1
    assert {s["user_agent"] for s in listed} >= {"Fictional Phone"}
    r = await mantel.client.delete(f"/api/sessions/{other.session_id}", headers=mantel.headers())
    assert r.status == 200 and mgr(mantel).from_access(other.access) is None
    # someone else's session: only an Owner/Admin may revoke it
    victim = await mantel.user("riley", "child")
    theirs = mgr(mantel).create(victim, "lan", "password")
    r = await mantel.client.delete(f"/api/sessions/{theirs.session_id}", headers=mantel.headers())
    assert r.status == 403
    assert (await mantel.get(f"/api/sessions?user_id={victim}")).status == 403


async def test_tunnel_sessions_are_short_and_bound_to_their_door(mantel):
    uid = await mantel.user("jordan", "adult")
    lan = mgr(mantel).create(uid, "lan", "password")
    tunnel = mgr(mantel).create(uid, "tunnel", "passkey")
    assert lan.expires - mantel.now[0] == 30 * 86400
    assert tunnel.expires - mantel.now[0] == 12 * 3600
    mantel.client.session.cookie_jar.update_cookies({"mantel_session": lan.access})
    assert (await mantel.get("/api/session")).status == 200
    assert (await mantel.get("/api/session", tunnel=True)).status == 401   # a LAN session off-site: no
    mantel.forget_cookies()
    mantel.client.session.cookie_jar.update_cookies({"mantel_session": tunnel.access})
    body = await (await mantel.get("/api/session", tunnel=True)).json()
    assert body["door"] == "tunnel"
    mantel.now[0] += 12 * 3600 + 1
    assert mgr(mantel).rotate(tunnel.refresh, door="tunnel")[0] == "invalid"


async def test_disabled_user_is_signed_out_at_once(mantel):
    uid = await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    with mantel.store.db:
        mantel.store.db.execute("UPDATE users SET disabled = 1 WHERE id = ?", (uid,))
    assert (await mantel.get("/api/session")).status == 401


async def test_identity_for_other_slices(mantel):
    uid = await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    seen = {}

    async def probe(request):
        ident = identity(request)
        seen["ident"] = ident
        assert identity(request) is ident                                   # resolved once per request
        from aiohttp import web
        return web.json_response({})

    # a route added the way a slice's register() would
    mantel.app.router._frozen = False
    mantel.app.router.add_get("/api/probe", probe)
    mantel.app.router._frozen = True
    assert (await mantel.get("/api/probe")).status == 200
    ident = seen["ident"]
    assert ident.user.id == uid and ident.user.role == "adult" and ident.device is None
    assert ident.door == "lan" and ident.fresh_within(60, mantel.now[0]) and ident.authenticated
    mantel.now[0] += 600
    assert not ident.fresh_within(300, mantel.now[0])


async def test_websocket_still_needs_origin_and_commands_stay_disabled(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    ws = await mantel.client.ws_connect("/ws")
    await ws.send_json({"type": "call_service", "domain": "light", "service": "turn_on"})
    assert (await asyncio.wait_for(ws.receive_json(), 2))["code"] == "commands_disabled"
    await ws.close()
    del mantel.client.session.headers["Origin"]
    with pytest.raises(Exception) as e:
        await mantel.client.ws_connect("/ws")
    assert "403" in str(e.value)


def test_door_and_cookie_policy():
    def req(headers):
        return make_mocked_request("GET", "/", headers=headers, app=web.Application())
    assert door_of(req({"Host": "127.0.0.1:8765"})) == "lan"
    assert door_of(req({"X-Mantel-Door": "lan"})) == "lan"
    assert door_of(req({"X-Mantel-Door": "tunnel"})) == "tunnel"
    assert door_of(req({"X-Mantel-Door": "something-else"})) == "tunnel"   # unknown fails closed
    assert door_of(req({"X-Mantel-Door": "lan", "Cf-Connecting-Ip": "203.0.113.9"})) == "tunnel"
    assert not cookie_secure(req({"Host": "127.0.0.1:8765"}))
    assert not cookie_secure(req({"Host": "localhost:8765"}))
    assert not cookie_secure(req({"Host": "[::1]:8765"}))
    assert cookie_secure(req({"Host": "mantel.example.org"}))
    assert cookie_secure(req({"Host": "mantel.lan:443"}))


async def test_cookies_over_a_real_hostname_are_secure(mantel):
    # what a browser behind Caddy gets (the Host allowlist is P3.6's; set the policy hook directly)
    from mantel_server.sessions import set_session_cookies
    from aiohttp import web
    uid = await mantel.user("jordan", "adult")
    issued = mgr(mantel).create(uid, "lan", "password")
    request = make_mocked_request("GET", "/", headers={"Host": "mantel.example.org"}, app=mantel.app)
    resp = web.Response()
    set_session_cookies(request, resp, issued)
    for name in ("mantel_session", "mantel_refresh", "mantel_csrf"):
        c = resp.cookies[name]
        assert c["secure"] and c["samesite"] == "Strict" and c["path"] == "/"
    assert resp.cookies["mantel_session"]["httponly"] and not resp.cookies["mantel_csrf"]["httponly"]


async def test_phase0_api_me_and_legacy_cookie_still_work(mantel):
    mantel.store.link("ha-fictional", "owner", "Fictional")
    sid = mantel.store.create_session("ha-fictional", 60, mantel.now[0])
    mantel.client.session.cookie_jar.update_cookies({"mantel_session": sid})
    assert await (await mantel.get("/api/me")).json() == {"ha_user_id": "ha-fictional", "name": "Fictional",
                                                          "role": "owner"}
    mantel.now[0] += 61
    assert (await mantel.get("/api/me")).status == 401
