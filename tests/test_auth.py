"""Sign in with Home Assistant, against a fake HA (OAuth token endpoint + WebSocket auth/current_user)."""
import asyncio
from urllib.parse import parse_qs, urlparse

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from mantel_server import auth
from mantel_server.auth import make_state_cookie, read_state_cookie
from mantel_server.config import Config
from mantel_server.ha_oauth import HaOAuth, check_redirect
from mantel_server.server import build_app
from mantel_server.store import Store

USER = {"id": "u-avery", "name": "Avery", "is_owner": True, "is_admin": True}


class FakeHa:
    """Just enough of HA's auth API. Records every call so tests can assert on them."""

    def __init__(self):
        self.revoked: list[str] = []
        self.token_requests: list[dict] = []
        self.user = dict(USER)
        self.user_ws_calls: list[str] = []
        self.service_calls = 0

    def app(self):
        app = web.Application()
        app.router.add_post("/auth/token", self.token)
        app.router.add_get("/api/websocket", self.ws)
        return app

    async def token(self, request):
        form = dict(await request.post())
        self.token_requests.append(form)
        if form.get("action") == "revoke":
            self.revoked.append(form["token"])
            return web.Response(status=200)
        if form.get("grant_type") == "authorization_code" and form.get("code") == "good-code":
            return web.json_response({"access_token": "user-access", "refresh_token": "user-refresh",
                                      "token_type": "Bearer", "expires_in": 1800})
        return web.json_response({"error": "invalid_grant"}, status=400)

    async def ws(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required"})
        msg = await ws.receive_json()
        if msg.get("access_token") != "user-access":
            await ws.send_json({"type": "auth_invalid"})
            return ws
        await ws.send_json({"type": "auth_ok"})
        async for m in ws:
            req = m.json()
            self.user_ws_calls.append(req["type"])
            if req["type"] == "auth/current_user":
                await ws.send_json({"id": req["id"], "type": "result", "success": True, "result": self.user})
            else:
                self.service_calls += 1
        return ws


@pytest.fixture
async def env(tmp_path):
    fake = FakeHa()
    async with TestServer(fake.app()) as ha_server:
        cfg = Config(ha_url=str(ha_server.make_url("")).rstrip("/"), data_dir=tmp_path, port=0)
        store = Store(tmp_path / "t.db")
        now = [1_000_000.0]
        app = build_app(cfg, "mantel-own-token", store=store, connect_ha=False, clock=lambda: now[0])
        # the test client listens on a random port; HA must see the client_id's own origin
        async with TestClient(TestServer(app)) as client:
            origin = f"127.0.0.1:{client.server.port}"
            cfg.port = client.server.port
            app["oauth"] = HaOAuth(cfg.ha_url, cfg.client_id, cfg.redirect_uri)
            yield type("Env", (), dict(fake=fake, store=store, client=client, app=app, now=now, origin=origin))


async def start_login(env):
    r = await env.client.get("/login/ha", allow_redirects=False)   # the OAuth start (GET /login before the page)
    assert r.status == 302
    q = parse_qs(urlparse(r.headers["Location"]).query)
    return r, q


async def test_login_sends_browser_to_ha_with_state_and_lax_httponly_cookie(env):
    r, q = await start_login(env)
    assert r.headers["Location"].startswith(env.app["cfg"].ha_url + "/auth/authorize?")
    assert q["client_id"] == [f"http://{env.origin}/"] and q["redirect_uri"] == [f"http://{env.origin}/auth/callback"]
    cookie = r.cookies[auth.STATE_COOKIE]
    assert cookie["httponly"] and cookie["samesite"].lower() == "lax"
    assert q["state"][0] in cookie.value


async def test_state_mismatch_is_rejected_and_nothing_is_exchanged(env):
    await start_login(env)
    r = await env.client.get("/auth/callback", params={"code": "good-code", "state": "forged"}, allow_redirects=False)
    assert r.status == 400
    assert env.fake.token_requests == []


async def test_missing_state_cookie_is_rejected(env):
    r = await env.client.get("/auth/callback", params={"code": "good-code", "state": "x"}, allow_redirects=False)
    assert r.status == 400 and env.fake.token_requests == []


async def test_expired_or_tampered_state_cookie_is_rejected(env):
    secret = env.app["state_secret"]
    good = make_state_cookie(secret, "abc", 1000.0)
    assert read_state_cookie(secret, good, 1001.0) == "abc"
    assert read_state_cookie(secret, good, 1000.0 + 601) is None
    assert read_state_cookie(secret, good.replace("abc", "abd"), 1001.0) is None
    assert read_state_cookie(b"other-secret", good, 1001.0) is None
    assert read_state_cookie(secret, None, 1.0) is None and read_state_cookie(secret, "junk", 1.0) is None


def test_redirect_uri_on_another_host_is_refused():
    check_redirect("http://127.0.0.1:8765/", "http://127.0.0.1:8765/auth/callback")
    for bad in ("http://evil.example.com/auth/callback", "http://127.0.0.1:9999/auth/callback",
                "https://127.0.0.1:8765/auth/callback", "//127.0.0.1:8765/x"):
        with pytest.raises(ValueError):
            check_redirect("http://127.0.0.1:8765/", bad)
    with pytest.raises(ValueError):
        HaOAuth("http://ha", "http://127.0.0.1:8765/", "http://evil.example.com/cb")


async def complete(env, code="good-code"):
    r, q = await start_login(env)
    return await env.client.get("/auth/callback", params={"code": code, "state": q["state"][0]}, allow_redirects=False)


async def test_linked_user_signs_in_and_the_users_token_is_revoked(env):
    env.store.link("u-avery", "owner")
    r = await complete(env)
    # P3.1: a page that moves on to the default screen, no next given (SameSite=Strict cookies are not
    # sent on a redirect in a chain that started on HA's site), and Strict cookies (PLAN §7), not Lax.
    assert r.status == 200 and "url=/home" in await r.text()
    assert env.fake.revoked == ["user-refresh"]                    # revoked
    assert env.fake.user_ws_calls == ["auth/current_user"]          # the user's token did exactly one thing
    exchange = env.fake.token_requests[0]
    assert exchange["grant_type"] == "authorization_code" and exchange["client_id"] == f"http://{env.origin}/"
    c = r.cookies[auth.SESSION_COOKIE]
    assert c["httponly"] and c["samesite"].lower() == "strict"
    for name in ("mantel_refresh", "mantel_csrf"):
        assert r.cookies[name]["samesite"].lower() == "strict"
    assert r.cookies["mantel_refresh"]["httponly"] and not r.cookies["mantel_csrf"]["httponly"]
    me = await (await env.client.get("/api/me")).json()
    # and Home Assistant's address for the dashboard's "Open Home Assistant" row (a person's; Mantel's own for HA
    # here, as HA has said no internal or external URL)
    assert me == {"ha_user_id": "u-avery", "name": "Avery", "role": "owner", "ha_address": env.app["cfg"].ha_url}
    row = env.store.db.execute("SELECT s.method, s.door, u.kind FROM sessions s JOIN users u ON u.id = s.user_id").fetchone()
    assert tuple(row) == ("ha", "lan", "ha_linked")                # landed in a P3.1 session of the linked user


async def test_revoke_happens_even_if_current_user_fails(env):
    env.store.link("u-avery", "owner")
    env.fake.user = {}                                              # HA answers without an id
    r = await complete(env)
    assert r.status == 502 and env.fake.revoked == ["user-refresh"]


async def test_unlinked_user_is_denied_and_gets_no_session(env):
    r = await complete(env)
    assert r.status == 403
    body = await r.text()
    assert "Not linked yet" in body and "u-avery" in body
    assert auth.SESSION_COOKIE not in r.cookies
    assert env.fake.revoked == ["user-refresh"]                    # still revoked
    assert (await env.client.get("/api/me")).status == 401


async def test_bad_code_is_a_clean_failure(env):
    r = await complete(env, code="wrong")
    assert r.status == 502 and env.fake.revoked == []


async def test_expired_session_is_rejected(env):
    env.store.link("u-avery", "owner")
    await complete(env)
    assert (await env.client.get("/api/me")).status == 200
    env.now[0] += 12 * 3600 + 1                                     # access token long gone: refreshed on the spot
    assert (await env.client.get("/api/me")).status == 200
    env.now[0] += 30 * 86400                                        # P3.1: LAN sessions end 30 days after sign-in
    assert (await env.client.get("/api/me")).status == 401
    r = await env.client.get("/dev", allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/login?next=/dev"


async def test_unlinking_ends_the_session_at_once(env):
    env.store.link("u-avery", "owner")
    await complete(env)
    env.store.unlink("u-avery")
    assert (await env.client.get("/api/me")).status == 401


async def test_logout_clears_the_session(env):
    env.store.link("u-avery", "owner")
    await complete(env)
    assert (await env.client.get("/logout")).status == 405
    assert (await env.client.post("/logout")).status == 200
    env.client.session.cookie_jar.clear()
    assert (await env.client.get("/api/me")).status == 401


async def test_websocket_refused_without_a_session(env):
    with pytest.raises(Exception) as e:
        await env.client.ws_connect("/ws", headers={"Origin": f"http://{env.origin}"})
    assert "401" in str(e.value)


async def test_websocket_needs_origin_and_a_session(env):
    env.store.link("u-avery", "owner")
    await complete(env)
    with pytest.raises(Exception) as e:
        await env.client.ws_connect("/ws")                         # no Origin
    assert "403" in str(e.value)
    with pytest.raises(Exception):
        await env.client.ws_connect("/ws", headers={"Origin": "http://evil.example.com"})
    ws = await env.client.ws_connect("/ws", headers={"Origin": f"http://{env.origin}"})
    await ws.send_json({"type": "ping"})
    assert (await asyncio.wait_for(ws.receive_json(), 2))["type"] == "pong"
    await ws.close()


async def test_everything_but_login_is_behind_sign_in(env):
    for path in ("/api/entities", "/api/areas", "/api/stats", "/api/me"):
        assert (await env.client.get(path)).status == 401
    assert (await env.client.get("/dev", allow_redirects=False)).status == 302


# -- the sign-in page's "Sign in with Home Assistant" (/login/ha) and its next path -----------------
async def ha_round_trip(env, query=""):
    r = await env.client.get("/login/ha" + query, allow_redirects=False)
    assert r.status == 302 and r.headers["Location"].startswith(env.app["cfg"].ha_url + "/auth/authorize?")
    state = parse_qs(urlparse(r.headers["Location"]).query)["state"][0]
    cb = await env.client.get("/auth/callback", params={"code": "good-code", "state": state}, allow_redirects=False)
    return r, cb


async def test_ha_sign_in_comes_back_to_next(env):
    env.store.link("u-avery", "owner")
    r, cb = await ha_round_trip(env, "?next=/admin")
    c = r.cookies[auth.NEXT_COOKIE]
    assert c["httponly"] and c["samesite"].lower() == "lax" and c["path"] == "/auth"
    text = await cb.text()
    assert cb.status == 200 and "url=/admin'" in text and "href='/admin'" in text
    assert cb.cookies[auth.NEXT_COOKIE].value == ""                  # spent
    assert (await env.client.get("/api/me")).status == 200


async def test_ha_sign_in_never_redirects_off_site(env):
    env.store.link("u-avery", "owner")
    for bad in ("?next=//evil.example/x", "?next=https://evil.example/", "?next=/login", "?next=/%5Cevil"):
        env.client.session.cookie_jar.clear()
        r, cb = await ha_round_trip(env, bad)
        assert not r.cookies.get(auth.NEXT_COOKIE) or r.cookies[auth.NEXT_COOKIE].value == "", bad
        text = await cb.text()
        assert "url=/home'" in text and "evil" not in text, bad
    # a next cookie planted by someone else is cleaned again at the callback
    env.client.session.cookie_jar.clear()
    r = await env.client.get("/login/ha", allow_redirects=False)
    state = parse_qs(urlparse(r.headers["Location"]).query)["state"][0]
    env.client.session.cookie_jar.update_cookies({auth.NEXT_COOKIE: "https%3A%2F%2Fevil.example%2F"},
                                                 response_url=env.client.make_url("/auth/"))
    cb = await env.client.get("/auth/callback", params={"code": "good-code", "state": state}, allow_redirects=False)
    text = await cb.text()
    assert "url=/home'" in text and "evil" not in text


async def test_ha_sign_in_moves_to_the_canonical_host_keeping_next(env):
    port = env.client.server.port
    r = await env.client.get("/login/ha?next=/admin", headers={"Host": f"localhost:{port}"}, allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == f"http://{env.origin}/login/ha?next=/admin"
    assert auth.STATE_COOKIE not in r.cookies


async def test_the_page_links_to_ha_sign_in(env):
    r = await env.client.get("/login?next=/admin")
    assert r.status == 200 and 'href="login/ha?next=/admin"' in await r.text()


def test_store_session_ids_are_not_stored_raw(tmp_path):
    s = Store(tmp_path / "x.db")
    s.link("u", "adult")
    sid = s.create_session("u", 60)
    stored = [r[0] for r in s.db.execute("SELECT hash FROM access_tokens")]
    assert sid not in stored and len(stored[0]) == 64
    with pytest.raises(ValueError):
        s.link("u", "emperor")


def test_user_oauth_calls_do_not_use_haclient():
    import inspect
    from mantel_server import ha_oauth, ha_client
    assert "HaClient" not in inspect.getsource(ha_oauth)
    assert "auth/current_user" not in inspect.getsource(ha_client)
