"""HA App mode: identity from HA's Ingress (ingress.py), the 'ha' door, the first-Owner bootstrap, the people
page, the prefix (redirects, cookies, served files) and the App's entrypoint/config. docs/phase3/HA-APP.md.

The aiohttp test client connects from 127.0.0.1, so "the Ingress proxy" is 127.0.0.1 where a test needs
one and 172.30.32.2 (the real Supervisor address, which the test client is not) where a test needs the
headers to come from someone else. Cookies are handled by hand: through Ingress they are scoped to the
browser's prefix, which the paths the server sees (the prefix stripped, as the Supervisor does) never carry.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from http.cookies import SimpleCookie
from pathlib import Path

import aiohttp
import pytest
from aiohttp.test_utils import TestClient, TestServer
from multidict import CIMultiDict

from mantel_server import ingress, sessions

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "/api/hassio_ingress/Fict1onal-Ingress_Token"
OWNER_HA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
ADULT_HA = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f"
STRANGER_HA = "99999999999999999999999999999999"
PAGE = {"Sec-Fetch-Dest": "document", "Accept": "text/html"}


class FakeDirectory:
    """HA's user list as config/auth/list answers it (fictional people)."""
    def __init__(self, users=None, fail=False):
        self.fail = fail
        self.list = users if users is not None else [
            {"id": OWNER_HA, "name": "Fictional Owner", "username": "owner", "group_ids": ["system-admin"],
             "is_active": True, "system_generated": False},
            {"id": ADULT_HA, "name": "Fictional Adult", "username": "adult", "group_ids": ["system-users"],
             "is_active": True, "system_generated": False},
            {"id": STRANGER_HA, "name": "Fictional Stranger", "username": "stranger", "group_ids": ["system-users"],
             "is_active": True, "system_generated": False},
            {"id": "5" * 32, "name": "Supervisor", "group_ids": ["system-admin"], "is_active": True,
             "system_generated": True},
        ]

    async def users(self):
        if self.fail:
            raise RuntimeError("fictional HA unreachable")
        return self.list

    async def user(self, ha_user_id):
        return next((u for u in await self.users() if u["id"] == ha_user_id), None)


class App:
    def __init__(self, app, client, store, now):
        self.app, self.client, self.store, self.now = app, client, store, now
        self.jar: dict[str, str] = {}

    @property
    def cfg(self):
        return self.app["cfg"]

    def ha(self, ha_user=OWNER_HA, display="Fictional Owner", **extra):
        h = {"X-Ingress-Path": PREFIX, ingress.USER_ID: ha_user, ingress.USER_NAME: "fictional",
             ingress.USER_DISPLAY: display, "X-Forwarded-For": "192.0.2.10, 172.30.32.1",
             "X-Forwarded-Proto": "http"}
        h.update(extra)
        return h

    def _cookie_header(self):
        return "; ".join(f"{k}={v}" for k, v in self.jar.items())

    def _keep(self, resp):
        for raw in resp.headers.getall("Set-Cookie", []):
            c = SimpleCookie()
            c.load(raw)
            for name, m in c.items():
                if m["max-age"] == "0" or not m.value:
                    self.jar.pop(name, None)
                else:
                    self.jar[name] = m.value
        return resp

    async def request(self, method, path, headers=None, cookies=True, **kw):
        h = dict(headers or {})
        if cookies and self.jar:
            h["Cookie"] = self._cookie_header()
        r = await self.client.request(method, path, headers=h, allow_redirects=False, **kw)
        return self._keep(r)

    async def page(self, path="/dashboard-kitchen/home", **headers):
        return await self.request("GET", path, {**self.ha(), **PAGE, **headers})


async def make(tmp_path, monkeypatch, *, peers=("127.0.0.1",), ingress_on=True, only=False, rules="tunnel",
               directory=None):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("ingress tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    web_dir = tmp_path / "web"
    (web_dir / "hk/modules").mkdir(parents=True)
    (web_dir / "hk/fonts").mkdir(parents=True)
    (web_dir / "home.html").write_text((ROOT / "web/home.html").read_text())
    (web_dir / "hk/modules/hk-probe.js").write_text(
        "var A = '/hk/modules/hk-x.js'; import('/hk/cards/y.js');\n"
        "var seg = String(location.pathname).split('/')[1];\nvar m = fetch(\"/static/mdi/icons.json\");\n"
        "var api = '/api/hk_frontend/talk';\n")
    (web_dir / "hk/fonts/sf-pro.css").write_text('src: url("/hk/fonts/SF-Pro.woff2")')
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, web=web_dir,
                 hk_frontend=web_dir / "hk", hk_files=tmp_path / "none", fixtures=tmp_path / "none",
                 ingress=ingress_on, ingress_peers=tuple(peers), ingress_only=only, ha_door_rules=rules)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["ha_directory"] = directory or FakeDirectory()
    client = TestClient(TestServer(app), cookie_jar=aiohttp.DummyCookieJar())
    await client.start_server()
    return App(app, client, store, now)


@pytest.fixture
async def mk(tmp_path, monkeypatch):
    made = []

    async def factory(**kw):
        a = await make(tmp_path / f"m{len(made)}", monkeypatch, **kw)
        made.append(a)
        return a
    yield factory
    for a in made:
        await a.client.close()
        a.store.db.close()


# -- identity: only from the Ingress peer --------------------------------------------------------------
async def test_linked_user_signed_in_through_ingress(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner", "Fictional Owner")
    r = await m.page()
    assert r.status == 200
    text = await r.text()
    assert f'<meta name="mantel-base" content="{PREFIX}">' in text
    cookies = r.headers.getall("Set-Cookie")
    names = {c.split("=", 1)[0] for c in cookies}
    assert {"mantel_session", "mantel_refresh", "mantel_csrf"} <= names
    assert all(f"Path={PREFIX}/" in c for c in cookies), cookies       # scoped to Mantel's own pages
    assert not any("Secure" in c for c in cookies)                      # HA was reached over http here
    me = await m.request("GET", "/api/me", m.ha())
    assert me.status == 200 and (await me.json())["role"] == "owner"
    s = await (await m.request("GET", "/api/session", m.ha())).json()
    assert s["door"] == "ha" and s["user"]["ha_user_id"] == OWNER_HA and s["csrf"]
    row = m.store.db.execute("SELECT door, method, fresh_factor_at, source_ip FROM sessions").fetchone()
    # stored as the stricter door, never a fresh factor, the browser's address as HA saw it
    assert tuple(row) == ("tunnel", "ingress", None, "192.0.2.10")


async def test_cookies_are_secure_when_ha_was_reached_over_https(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    r = await m.page(**{"X-Forwarded-Proto": "https"})
    assert all("Secure" in c for c in r.headers.getall("Set-Cookie"))


async def test_one_session_per_browser_and_requests_reuse_it(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    for _ in range(3):
        assert (await m.request("GET", "/api/me", m.ha())).status == 200
    await m.page()
    assert m.store.db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
    # a request that is not a page, with no cookie yet: the user, but no session is started for it
    m.jar.clear()
    s = await (await m.request("GET", "/api/session", m.ha())).json()
    assert s["user"]["role"] == "owner" and s["session_id"] is None and s["csrf"] is None
    assert m.store.db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1


async def test_forged_headers_from_any_other_peer_are_ignored_and_logged(mk, caplog):
    m = await mk(peers=("172.30.32.2",))           # the test client (127.0.0.1) is not the Supervisor
    m.store.link(OWNER_HA, "owner")
    ingress._warned.clear()
    with caplog.at_level(logging.WARNING, logger="mantel.ingress"):
        r = await m.request("GET", "/api/me", m.ha())
    assert r.status == 401
    assert "ignored HA identity headers" in caplog.text and "127.0.0.1" in caplog.text
    r = await m.page()                               # signed out: sent to Mantel's own sign-in page
    assert r.status == 302 and r.headers["Location"] == "/login?next=/dashboard-kitchen/home"
    assert not any(c.startswith("mantel_session=") for c in r.headers.getall("Set-Cookie", []))
    assert m.store.db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


async def test_ingress_only_refuses_every_other_peer_but_health(mk):
    m = await mk(peers=("172.30.32.2",), only=True)
    assert (await m.request("GET", "/api/me", m.ha())).status == 403
    assert (await m.request("GET", "/dev")).status == 403
    assert (await m.request("GET", "/healthz")).status == 200


async def test_headers_are_never_read_when_ingress_is_off(mk):
    m = await mk(ingress_on=False)
    m.store.link(OWNER_HA, "owner")
    assert (await m.request("GET", "/api/me", m.ha())).status == 401
    r = await m.request("GET", "/dashboard-kitchen/home", {**m.ha(), **PAGE})
    assert r.status == 302 and r.headers["Location"] == "/login?next=/dashboard-kitchen/home"
    assert "mantel-base" not in await r.text()


async def test_an_ingress_session_cookie_is_no_one_outside_ingress(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    assert (await m.request("GET", "/api/me", m.ha())).status == 200
    m.cfg.ingress_peers = ("172.30.32.2",)          # the same cookies, now from someone who is not Ingress
    r = await m.request("GET", "/api/me", {})
    assert r.status == 401


async def test_a_cookie_of_another_ha_user_is_not_borrowed(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    m.store.link(ADULT_HA, "adult", "Fictional Adult")
    await m.page()                                   # the owner's cookies in this browser
    me = await (await m.request("GET", "/api/me", m.ha(ADULT_HA, "Fictional Adult"))).json()
    assert me["role"] == "adult"
    s = await (await m.request("GET", "/api/session", m.ha(ADULT_HA))).json()
    assert s["session_id"] is None                   # not the owner's session
    await m.request("GET", "/dashboard-kitchen/home", {**m.ha(ADULT_HA), **PAGE})
    s = await (await m.request("GET", "/api/session", m.ha(ADULT_HA))).json()
    assert s["user"]["role"] == "adult" and s["session_id"]


async def test_missing_or_bad_user_header_is_no_one(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    h = m.ha()
    del h[ingress.USER_ID]
    assert (await m.request("GET", "/api/me", h)).status == 401
    assert (await m.request("GET", "/api/me", m.ha("bad id; drop"))).status == 401


async def test_disabled_or_unlinked_user_gets_nothing(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    uid = m.store.link(ADULT_HA, "adult")
    r = await m.request("GET", "/api/me", m.ha(STRANGER_HA))
    assert r.status == 401 and (await r.json())["error"] == "not_linked"
    r = await m.request("GET", "/dashboard-kitchen/home", {**m.ha(STRANGER_HA, "Fictional Stranger"), **PAGE})
    text = await r.text()
    assert r.status == 403 and "Not linked yet" in text and "Fictional Stranger" in text
    assert "Make me" not in text
    with m.store.db:
        m.store.db.execute("UPDATE users SET disabled = 1 WHERE id = ?", (uid,))
    assert (await m.request("GET", "/api/me", m.ha(ADULT_HA))).status == 401


async def test_display_name_is_escaped_on_the_page(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    r = await m.request("GET", "/x-y/home", {**m.ha(STRANGER_HA, "<script>x</script>"), **PAGE})
    assert "<script>x</script>" not in await r.text()


# -- first Owner ---------------------------------------------------------------------------------------
def _nonce(text):
    return re.search(r"name=nonce value='([^']+)'", text).group(1)


async def test_first_owner_bootstrap_for_an_ha_admin_after_confirm(mk):
    m = await mk()
    r = await m.page()
    text = await r.text()
    assert r.status == 403 and "Make me Mantel's Owner" in text
    assert f"action='{PREFIX}/ingress/bootstrap'" in text
    # HA's no-referrer header would make the browser send Origin: null on this form; the page's meta wins
    assert '<meta name="referrer" content="same-origin">' in text
    assert m.store.get_link(OWNER_HA) is None        # nothing happens until the confirm
    nonce = _nonce(text)
    # the form must come from the page (Origin), carry the nonce, and be the same HA user
    r = await m.request("POST", "/ingress/bootstrap", m.ha(), data={"nonce": nonce})
    assert r.status == 403 and m.store.get_link(OWNER_HA) is None
    r = await m.request("POST", "/ingress/bootstrap", {**m.ha(), "Origin": "null"}, data={"nonce": nonce})
    assert r.status == 403 and m.store.get_link(OWNER_HA) is None
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    r = await m.request("POST", "/ingress/bootstrap", {**m.ha(ADULT_HA), **origin}, data={"nonce": nonce})
    assert r.status in (400, 403) and m.store.get_link(ADULT_HA) is None
    r = await m.request("POST", "/ingress/bootstrap", {**m.ha(), **origin}, data={"nonce": nonce})
    assert r.status == 200 and "You are Mantel" in await r.text()
    link = m.store.get_link(OWNER_HA)
    assert link["role"] == "owner" and link["name"] == "Fictional Owner"
    audit = m.app["audit"].rows(kind="config")
    assert audit[-1]["action"] == "ingress.bootstrap_owner" and audit[-1]["actor"] == link["user_id"]
    # closed afterwards: for anyone, including a second administrator
    r = await m.request("POST", "/ingress/bootstrap", {**m.ha(), **origin}, data={"nonce": nonce})
    assert r.status == 410
    page = await (await m.page()).text()
    assert "Make me" not in page
    assert (await m.request("GET", "/api/me", m.ha())).status == 200


async def test_bootstrap_refused_for_a_non_admin(mk):
    m = await mk()
    r = await m.request("GET", "/x-y/home", {**m.ha(ADULT_HA, "Fictional Adult"), **PAGE})
    text = await r.text()
    assert r.status == 403 and "administrator needs to open Mantel first" in text and "nonce" not in text
    # a nonce minted for this user cannot make them Owner either
    nonce = ingress.bootstrap_nonce(m.app, ADULT_HA, m.now[0])
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    r = await m.request("POST", "/ingress/bootstrap", {**m.ha(ADULT_HA), **origin}, data={"nonce": nonce})
    assert r.status == 403 and m.store.get_link(ADULT_HA) is None


async def test_bootstrap_fails_closed_when_ha_cannot_be_asked(mk):
    m = await mk(directory=FakeDirectory(fail=True))
    r = await m.page()
    assert r.status == 503 and "could not ask" in await r.text()
    nonce = ingress.bootstrap_nonce(m.app, OWNER_HA, m.now[0])
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    r = await m.request("POST", "/ingress/bootstrap", {**m.ha(), **origin}, data={"nonce": nonce})
    assert r.status == 503 and m.store.get_link(OWNER_HA) is None


async def test_bootstrap_nonce_expires(mk):
    m = await mk()
    nonce = ingress.bootstrap_nonce(m.app, OWNER_HA, m.now[0])
    m.now[0] += ingress.BOOTSTRAP_TTL + 1
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    r = await m.request("POST", "/ingress/bootstrap", {**m.ha(), **origin}, data={"nonce": nonce})
    assert r.status == 400 and m.store.get_link(OWNER_HA) is None


async def test_bootstrap_page_is_not_reachable_outside_ingress(mk):
    m = await mk(peers=("172.30.32.2",))
    assert (await m.request("GET", "/ingress/bootstrap", m.ha())).status == 404
    assert (await m.request("POST", "/ingress/bootstrap", m.ha(), data={"nonce": "x"})).status == 404


async def test_an_existing_hk_owner_closes_the_bootstrap(mk):
    m = await mk()
    with m.store.db:
        m.store.db.execute("INSERT INTO users (id, username, name, role, kind, created, updated) "
                           "VALUES ('u1', 'hkowner', 'HK Owner', 'owner', 'hk', 0, 0)")
    text = await (await m.page()).text()
    assert "Not linked yet" in text and "Make me" not in text


# -- the people page -----------------------------------------------------------------------------------
async def test_owner_links_and_unlinks_household_members(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner", "Fictional Owner")
    await m.page()
    r = await m.request("GET", "/ingress/people", {**m.ha(), **PAGE})
    text = await r.text()
    assert r.status == 200 and "Fictional Adult" in text and "Supervisor" not in text
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    form = {"csrf": m.jar["mantel_csrf"], "ha_user_id": ADULT_HA, "role": "adult", "action": "link"}
    r = await m.request("POST", "/ingress/people", {**m.ha(), **origin}, data=form)
    assert r.status == 303 and r.headers["Location"] == PREFIX + "/ingress/people"
    assert m.store.get_link(ADULT_HA)["role"] == "adult"
    assert (await m.request("GET", "/api/me", m.ha(ADULT_HA))).status == 200
    # a stale form (no CSRF token) changes nothing
    r = await m.request("POST", "/ingress/people", {**m.ha(), **origin}, data={**form, "csrf": "x", "action": "unlink"})
    assert r.status == 403 and m.store.get_link(ADULT_HA) is not None
    r = await m.request("POST", "/ingress/people", {**m.ha(), **origin}, data={**form, "action": "unlink"})
    assert r.status == 303 and m.store.get_link(ADULT_HA) is None
    # Mantel always keeps an Owner
    r = await m.request("POST", "/ingress/people", {**m.ha(), **origin},
                        data={**form, "ha_user_id": OWNER_HA, "action": "unlink"})
    assert r.status == 409 and m.store.get_link(OWNER_HA)["role"] == "owner"
    rows = [r["action"] for r in m.app["audit"].rows(kind="config")]
    assert rows.count("ingress.link") == 1 and rows.count("ingress.unlink") == 1


async def test_people_page_is_for_owners_and_admins_and_admins_never_touch_owners(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    m.store.link(ADULT_HA, "admin", "Fictional Admin")
    m.store.link(STRANGER_HA, "adult")
    r = await m.request("GET", "/ingress/people", {**m.ha(STRANGER_HA), **PAGE})
    assert r.status == 403
    await m.request("GET", "/x-y/home", {**m.ha(ADULT_HA), **PAGE})
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    form = {"csrf": m.jar["mantel_csrf"], "ha_user_id": STRANGER_HA, "role": "owner", "action": "link"}
    r = await m.request("POST", "/ingress/people", {**m.ha(ADULT_HA), **origin}, data=form)
    assert r.status == 403 and m.store.get_link(STRANGER_HA)["role"] == "adult"
    r = await m.request("POST", "/ingress/people", {**m.ha(ADULT_HA), **origin},
                        data={**form, "ha_user_id": OWNER_HA, "role": "adult"})
    assert r.status == 403 and m.store.get_link(OWNER_HA)["role"] == "owner"
    r = await m.request("POST", "/ingress/people", {**m.ha(ADULT_HA), **origin}, data={**form, "role": "child"})
    assert r.status == 303 and m.store.get_link(STRANGER_HA)["role"] == "child"


# -- the 'ha' door ---------------------------------------------------------------------------------------
async def test_ha_door_gets_the_tunnel_rules_unless_the_owner_opts_in(mk):
    m = await mk()
    authz = m.app["authz"]
    assert authz.rules_door("ha") == "tunnel" and authz.rules_door("lan") == "lan"
    assert authz.rules_door("nonsense") == "tunnel"
    ident = sessions.Identity(sessions.User("u", "U", "child", "ha_linked"), None, "ha")
    assert authz.subject_of(ident).door == "tunnel"
    m2 = await mk(rules="lan")
    assert m2.app["authz"].rules_door("ha") == "lan"


async def test_a_trusted_sidebar_is_home_rules_and_ha_sign_in_is_the_factor(mk):
    """ha_door_rules=trusted (the HA App's default, Avery 2026-10-18): HA's sign-in is enough, as HK in HA
    always was -- no Mantel step-up for cameras, locks or the alarm -- but each role still decides."""
    m = await mk(rules="trusted")
    authz = m.app["authz"]
    assert authz.rules_door("ha") == "lan" and authz.ha_door_mode() == "trusted"
    adult = sessions.Identity(sessions.User("a", "A", "adult", "ha_linked"), None, "ha")
    subj = authz.subject_of(adult)
    assert subj.door == "lan" and subj.fresh_factor_at == m.now[0] and authz.ha_trusted(adult)
    # a lock: allowed outright (no step-up asked); the camera's live view too
    lock = authz.decide(subj, "control.sensitive", "lock.front_door")
    assert lock.allowed is True and not lock.needs_step_up
    assert authz.decide(subj, "camera.live", "camera.doorbell").allowed is True
    # a child is still a child: no lock, no camera
    child = authz.subject_of(sessions.Identity(sessions.User("c", "C", "child", "ha_linked"), None, "ha"))
    assert authz.decide(child, "control.sensitive", "lock.front_door").allowed is not True
    assert authz.decide(child, "camera.live", "camera.doorbell").allowed is not True
    # only the sidebar: the same person on the tunnel door still needs a fresh factor
    tun = authz.subject_of(sessions.Identity(sessions.User("a", "A", "adult", "password"), None, "tunnel"))
    assert tun.fresh_factor_at is None and authz.decide(tun, "control.sensitive", "lock.front_door").allowed is not True
    # and the other modes are unchanged: tunnel asks for a step-up on the sidebar
    m2 = await mk(rules="tunnel")
    s2 = m2.app["authz"].subject_of(adult)
    assert s2.door == "tunnel" and s2.fresh_factor_at is None and not m2.app["authz"].ha_trusted(adult)


async def test_sign_in_routes_and_tablet_enrolment_are_refused_through_ingress(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    for path in ("/api/auth/password", "/api/auth/passkey/options", "/api/bootstrap"):
        r = await m.request("POST", path, {**m.ha(), "X-CSRF-Token": m.jar["mantel_csrf"]}, json={})
        assert r.status == 403 and (await r.json())["error"] == "ingress_sign_in", path
    r = await m.request("GET", "/login", {**m.ha(), **PAGE})
    assert r.status == 403
    # the sign-in page's other paths too: HA has signed the person in, and nothing starts a session here
    for path in ("/login/ha", "/login/ha?next=/admin", "/login/login.js", "/login/login.css"):
        r = await m.request("GET", path, {**m.ha(), **PAGE})
        assert r.status == 403 and "Set-Cookie" not in r.headers, path
        assert "Signed in by Home Assistant" in await r.text() and PREFIX + "/home" in await r.text(), path
    r = await m.request("POST", "/api/devices/enroll", {**m.ha(), "X-CSRF-Token": m.jar["mantel_csrf"],
                                                        "Origin": str(m.client.make_url("")).rstrip("/")},
                        json={"name": "x", "room": "kitchen"})
    assert r.status == 403 and (await r.json())["error"] == "lan_only"


async def test_the_sign_in_page_still_works_outside_ingress_unless_ingress_only(mk):
    m = await mk(peers=("172.30.32.2",))              # this client is not the Supervisor
    r = await m.request("GET", "/login", PAGE)
    assert r.status == 200 and '<meta name="mantel-base" content="">' in await r.text()
    m2 = await mk(peers=("172.30.32.2",), only=True)
    assert (await m2.request("GET", "/login", PAGE)).status == 403


async def test_csrf_is_still_required_for_state_changing_api_calls(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    origin = str(m.client.make_url("")).rstrip("/")
    r = await m.request("POST", "/api/session/refresh", {**m.ha(), "Origin": origin})
    assert r.status == 403
    r = await m.request("POST", "/api/session/refresh", {**m.ha(), "Origin": origin, "X-CSRF-Token": m.jar["mantel_csrf"]})
    assert r.status == 200


async def test_audit_rows_record_the_ha_door(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    req_ident = sessions.Identity(sessions.User("u", "U", "owner", "ha_linked"), None, "ha")
    from mantel_server.authz import Principal
    p = Principal(req_ident, m.app["authz"].subject_of(req_ident), "192.0.2.10")
    aid = m.app["audit"].record(principal=p, kind="service", action="light.turn_on", targets=["light.x"],
                                decision="denied", reason="commands_disabled", result="not_sent")
    row = m.app["audit"].rows(id=aid)[0]
    assert row["door"] == "ha"


async def test_websocket_through_ingress(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    origin = str(m.client.make_url("")).rstrip("/")
    # the browser's host may arrive as X-Forwarded-Host: accepted for the Ingress proxy only
    headers = {**m.ha(), "Origin": "http://ha.example:8123", "X-Forwarded-Host": "ha.example:8123",
               "Cookie": m._cookie_header()}
    ws = await m.client.ws_connect("/ws", headers=headers)
    await ws.send_json({"type": "subscribe", "entity_ids": [], "all": True})
    msg = await ws.receive_json()
    assert msg["type"] == "snapshot"
    await ws.send_json({"type": "call_service", "domain": "light", "service": "turn_on"})
    assert (await ws.receive_json())["code"] == "commands_disabled"
    await ws.close()
    with pytest.raises(aiohttp.WSServerHandshakeError):
        await m.client.ws_connect("/ws", headers={**headers, "X-Forwarded-Host": "evil.example"})
    m.cfg.ingress_peers = ("172.30.32.2",)
    with pytest.raises(aiohttp.WSServerHandshakeError):
        await m.client.ws_connect("/ws", headers={**headers, "Origin": origin})


async def test_mantel_answered_reads_through_ingress(mk):
    """config/entity_registry/get and hk_frontend/hidden/get through the sidebar door, wired as the server
    wires them (authz's RBAC, the settings store): answered from Mantel's copies, with ReadProxy.request
    patched to fail the test if anything tried Home Assistant; commands still disabled."""
    from mantel_server.settings_store import Actor
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    hub = m.app["hub"]
    hub.registry.load([{"area_id": "den", "name": "Den"}], [],
                      [{"entity_id": "light.lamp", "area_id": "den", "device_id": None,
                        "options": {"light": {"favorite_colors": [{"hs_color": [30, 80]}]},
                                    "switch_as_x": {"entity_id": "light.wrapper"}}}])
    hub.store.states["light.lamp"] = {"s": "on", "a": {}, "lc": 1.0, "lu": 1.0}
    m.app["settings"].store.write([("house", "settings", {"generated": {"exclude_entities": ["light.lamp"]}})],
                                  actor=Actor(label="test"))
    await m.page()
    ws = await m.client.ws_connect("/ws", headers={**m.ha(), "Origin": "http://ha.example:8123",
                                                   "X-Forwarded-Host": "ha.example:8123",
                                                   "Cookie": m._cookie_header()})

    async def answer(rid, msg):
        await ws.send_json({"type": "read", "id": rid, "msg": msg})
        while True:
            got = await ws.receive_json()
            if got.get("type") == "read_result" and got.get("id") == rid:
                return got
    reg = await answer(1, {"type": "config/entity_registry/get", "entity_id": "light.lamp"})
    assert reg["result"] == {"entity_id": "light.lamp", "options": {"light": {"favorite_colors": [{"hs_color": [30, 80]}]}}}
    missing = await answer(2, {"type": "config/entity_registry/get", "entity_id": "light.nonexistent"})
    assert missing["error"]["code"] == "not_found"
    hidden = await answer(3, {"type": "hk_frontend/hidden/get", "entity_ids": ["light.lamp"]})
    assert hidden["result"]["everywhere"] == ["light.lamp"] and hidden["result"]["can"]["light.lamp"] == ["home", "room", "lights"]
    await ws.send_json({"type": "call_service", "domain": "light", "service": "turn_on"})
    while (got := await ws.receive_json()).get("code") != "commands_disabled":
        pass
    await ws.close()


# -- the prefix ----------------------------------------------------------------------------------------
async def test_redirects_stay_under_the_prefix(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    r = await m.request("GET", "/", {**m.ha(), **PAGE})
    assert r.status == 302 and r.headers["Location"] == PREFIX + "/home"
    r = await m.request("GET", "/home", {**m.ha(), **PAGE})
    assert r.status == 302 and r.headers["Location"] == PREFIX + "/dashboard-kitchen/home"


async def test_hk_files_are_served_for_the_prefix(mk):
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    r = await m.request("GET", "/hk/modules/hk-probe.js", m.ha())
    text = await r.text()
    assert r.status == 200 and r.content_type == "text/javascript"
    assert f"'{PREFIX}/hk/modules/hk-x.js'" in text and f"import('{PREFIX}/hk/cards/y.js')" in text
    assert f'fetch("{PREFIX}/static/mdi/icons.json")' in text
    assert f"String(location.pathname.slice({len(PREFIX)})).split('/')[1]" in text
    assert "'/api/hk_frontend/talk'" in text            # an HA API path for the action port: left alone
    etag = r.headers["ETag"]
    again = await m.request("GET", "/hk/modules/hk-probe.js", {**m.ha(), "If-None-Match": etag})
    assert again.status == 304
    css = await (await m.request("GET", "/hk/fonts/sf-pro.css", m.ha())).text()
    assert f'url("{PREFIX}/hk/fonts/SF-Pro.woff2")' in css
    page = await (await m.page()).text()
    assert f'href="{PREFIX}/hk/css/hk-responsive.css"' in page and f'src="{PREFIX}/web/home.js"' in page


async def test_uploaded_licensed_assets_are_served_for_the_prefix_with_etags(mk):
    """The fonts and the glyph file come from Your files at the URLs the (rewritten) CSS and JS ask for."""
    from mantel_server import user_files as uf
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    await m.page()
    for path in ("/hk/fonts/SF-Pro.woff2", "/hk/fonts/SF-Pro.ttf", "/hk/iconset/hk-glyphs.js"):
        assert (await m.request("GET", path, m.ha())).status == 404, path                   # not supplied yet
    import struct
    font = struct.pack(">4sIIHH", b"wOF2", 0x10000, 112, 1, 0) + b"\x00" * 32 + b"\x01" * 64
    glyphs = {"icons": {"light-on": "M 1 1 L 5 5 Z"}, "twotone": {}, "weather": {}}
    store = m.app["user_files"]
    store.add_font("SF-Pro.woff2", font)
    store.add_glyphs(uf.render_glyphs(glyphs))
    r = await m.request("GET", "/hk/fonts/SF-Pro.woff2", m.ha())
    assert r.status == 200 and r.content_type == "font/woff2" and await r.read() == font
    etag = r.headers["ETag"]
    assert (await m.request("GET", "/hk/fonts/SF-Pro.woff2", {**m.ha(), "If-None-Match": etag})).status == 304
    r = await m.request("GET", "/hk/iconset/hk-glyphs.js", m.ha())
    body = await r.text()
    assert r.status == 200 and r.content_type == "text/javascript" and "hkGlyphs" in body
    assert '"/hk/' not in body and "'/hk/" not in body and "/web/" not in body        # no absolute path to rewrite
    assert (await m.request("GET", "/hk/fonts/SF-Pro.ttf", m.ha())).status == 404            # still not supplied


async def test_files_are_untouched_outside_ingress(mk):
    m = await mk(ingress_on=False)
    m.store.link(OWNER_HA, "owner")
    cookie = m.store.create_session(OWNER_HA, 300)
    r = await m.request("GET", "/hk/modules/hk-probe.js", {"Cookie": f"mantel_session={cookie}"}, cookies=False)
    assert await r.text() == (Path(m.cfg.web) / "hk/modules/hk-probe.js").read_text()


def test_rewrite_is_a_pure_function_of_text_and_prefix():
    src = "a='/hk/x';b=\"/web/y\";c=`/static/mdi/z`;d=url(/hk/f);e='/hkx/no';f='/api/a';g=location.pathname;" \
          "h=location.pathname==='/x';i=window.location.pathname.split('/')"
    out = ingress.rewrite(src, PREFIX)
    n = len(PREFIX)
    assert out == (f"a='{PREFIX}/hk/x';b=\"{PREFIX}/web/y\";c=`{PREFIX}/static/mdi/z`;d=url({PREFIX}/hk/f);"
                   f"e='/hkx/no';f='/api/a';g=location.pathname.slice({n});h=location.pathname.slice({n})==='/x';"
                   f"i=window.location.pathname.slice({n}).split('/')")
    assert ingress.rewrite(src, "") == src
    assert ingress.rewrite("location.pathname = '/x'", PREFIX) == "location.pathname = '/x'"   # never an assignment


def test_client_ip_is_the_browser_as_ha_saw_it():
    class R(dict):
        def __init__(self, xff):
            super().__init__()
            self.headers = CIMultiDict({"X-Forwarded-For": xff} if xff else {})
            self.remote = "172.30.32.2"
    assert ingress._client_ip(R("203.0.113.9, 192.0.2.10, 172.30.32.1")) == "192.0.2.10"
    assert ingress._client_ip(R("192.0.2.10")) == "192.0.2.10"
    assert ingress._client_ip(R("")) == "172.30.32.2"
    assert ingress._client_ip(R("nonsense, 172.30.32.1")) == "172.30.32.2"


# -- the migration -------------------------------------------------------------------------------------
def test_migration_0008_keeps_the_audit_and_allows_the_ha_door(tmp_path):
    from mantel_server import db
    folder = tmp_path / "migs"
    folder.mkdir()
    src = Path(db.MIGRATIONS)
    for p in src.glob("*.sql"):
        if int(p.name[:4]) < 8:
            (folder / p.name).write_text(p.read_text())
    conn = db.connect(tmp_path / "x.db")
    db.migrate(conn, folder)
    with conn:
        for i in range(3):
            conn.execute("INSERT INTO action_audit (timestamp, kind, decision, reason, door) VALUES (?,?,?,?,?)",
                         (1e9 + i, "service", "denied", "no_grant", "lan"))
        conn.execute("DELETE FROM sqlite_sequence")          # make the sequence differ from max(id)
        conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('action_audit', 41)")
    with pytest.raises(sqlite3.IntegrityError):
        with conn:
            conn.execute("INSERT INTO action_audit (timestamp, kind, decision, reason, door) VALUES (1,'service','denied','x','ha')")
    (folder / "0008_ha_door.sql").write_text((src / "0008_ha_door.sql").read_text())
    assert db.migrate(conn, folder) == [8]
    assert conn.execute("SELECT COUNT(*) FROM action_audit").fetchone()[0] == 3
    with conn:
        cur = conn.execute("INSERT INTO action_audit (timestamp, kind, decision, reason, door) VALUES (?,?,?,?,?)",
                           (2e9, "service", "allowed", "granted", "ha"))
    assert cur.lastrowid == 42                                # AUTOINCREMENT position kept
    with pytest.raises(sqlite3.IntegrityError):
        with conn:
            conn.execute("INSERT INTO action_audit (timestamp, kind, decision, reason, door) VALUES (1,'service','denied','x','moon')")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        with conn:
            conn.execute("DELETE FROM action_audit WHERE id = 1")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        with conn:
            conn.execute("UPDATE action_audit SET reason = 'x' WHERE id = 1")
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE tbl_name = 'action_audit'")}
    assert {"action_audit", "action_audit_time", "action_audit_actor", "action_audit_no_delete",
            "action_audit_write_once"} <= names
    conn.close()


# -- config and the App's entrypoint ----------------------------------------------------------------------
def test_config_flags():
    from mantel_server.config import parse_args
    cfg = parse_args(["--ingress", "--ingress-peer", "::1", "--ha-door-rules", "lan",
                      "--ha-ws-url", "ws://supervisor/core/websocket"])
    assert cfg.ingress and cfg.ingress_peers == ("::1",) and cfg.ha_door_rules == "lan"
    assert cfg.ws_url == "ws://supervisor/core/websocket"
    assert parse_args(["--ingress"]).ingress_peers == ("172.30.32.2",)
    assert parse_args([]).ws_url.endswith("/api/websocket") and not parse_args([]).ingress
    for bad in (["--ingress-peer", "1.2.3.4"], ["--ingress", "--ingress-peer", "supervisor"],
                ["--ha-ws-url", "http://x"], ["--ingress-only"]):
        with pytest.raises(SystemExit):
            parse_args(bad)


def _entrypoint():
    import importlib.util
    spec = importlib.util.spec_from_file_location("mantel_entrypoint_ingress", ROOT / "packaging/docker/entrypoint.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_entrypoint_app_mode_turns_on_ingress_and_keeps_commands_off(tmp_path):
    ep = _entrypoint()
    from mantel_server.config import parse_args
    options = tmp_path / "options.json"
    options.write_text(json.dumps({"commands_enabled": False, "log_level": "debug", "default_screen": "dashboard-hall",
                                   "ha_door_rules": "tunnel"}))
    env = {"SUPERVISOR_TOKEN": "fictional-supervisor-credential"}
    args, out_env = ep.plan([], env, options_path=options, token_file=tmp_path / "t")
    cfg = parse_args(args)
    assert cfg.ingress and cfg.ingress_only and cfg.ingress_peers == ("172.30.32.2",)
    assert cfg.ha_url == "http://supervisor/core" and cfg.ws_url == "ws://supervisor/core/websocket"
    assert not cfg.commands_enabled and cfg.log_level == "debug" and cfg.default_screen == "dashboard-hall"
    assert str(cfg.secrets_dir) == "/data/secrets" and cfg.port == 8099 and cfg.host == "0.0.0.0"
    assert "SUPERVISOR_TOKEN" not in out_env and "fictional-supervisor-credential" not in " ".join(args)
    for value in ("true", 1, "yes"):                  # only a real true turns commands on
        options.write_text(json.dumps({"commands_enabled": value}))
        assert "--commands-enabled" not in ep.plan([], dict(env), options_path=options, token_file=tmp_path / "t")[0]
    options.write_text(json.dumps({"commands_enabled": True}))
    assert parse_args(ep.plan([], dict(env), options_path=options, token_file=tmp_path / "t")[0]).commands_enabled
    options.write_text(json.dumps({}))                 # the App's default: the sidebar is trusted
    assert parse_args(ep.plan([], dict(env), options_path=options, token_file=tmp_path / "t")[0]).ha_door_rules == "trusted"
    options.write_text(json.dumps({"ha_door_rules": "anything"}))
    with pytest.raises(ep.ConfigError):
        ep.plan([], dict(env), options_path=options, token_file=tmp_path / "t")


def test_entrypoint_test_overrides_for_a_scratch_ha(tmp_path):
    ep = _entrypoint()
    from mantel_server.config import parse_args
    options = tmp_path / "options.json"
    options.write_text("{}")
    env = {"SUPERVISOR_TOKEN": "fictional", "MANTEL_APP_OPTIONS": str(options),
           "MANTEL_APP_TOKEN_FILE": str(tmp_path / "tok"), "MANTEL_SUPERVISOR_CORE_URL": "http://127.0.0.1:8124",
           "MANTEL_SUPERVISOR_WS_URL": "ws://127.0.0.1:8124/api/websocket", "MANTEL_INGRESS_PEER": "::1",
           "MANTEL_LISTEN": "127.0.0.1", "MANTEL_PORT": "18099", "MANTEL_DATA_DIR": str(tmp_path / "d")}
    args, _ = ep.plan([], env, options_path=tmp_path / "absent", token_file=tmp_path / "unused")
    cfg = parse_args(args)
    assert (tmp_path / "tok").read_text() == "fictional" and not (tmp_path / "unused").exists()
    assert cfg.host == "127.0.0.1" and cfg.port == 18099 and cfg.ingress_peers == ("::1",)
    assert cfg.ws_url == "ws://127.0.0.1:8124/api/websocket" and not cfg.commands_enabled


def test_ha_app_config_declares_what_the_app_needs():
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    import package_check as pc
    doc = pc.parse_yaml((ROOT / "packaging/ha-app/config.yaml").read_text())
    assert doc["slug"] == "mantel" and doc["ingress"] is True and doc["ingress_port"] == 8099
    # panel_admin false (decision 21): wall tablets and household members are not HA administrators
    assert doc["panel_admin"] is False and doc["homeassistant_api"] is True and "image" not in doc
    assert set(doc["arch"]) == {"amd64", "aarch64"} and doc["options"]["commands_enabled"] is False
    assert set(doc["options"]) == set(doc["schema"])
    assert pc.check_ha_app(ROOT / "packaging/ha-app/config.yaml") == []


async def test_owner_imports_hks_settings_once_from_the_people_page(mk):
    import importlib.util
    import sys
    sys.path.insert(0, str(ROOT / "tools/headless"))
    spec = importlib.util.spec_from_file_location("client_smoke_for_ingress", ROOT / "tools/headless/client_smoke.py")
    smoke = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smoke)

    class Reads:
        calls = 0

        async def read_hk_settings(self):
            Reads.calls += 1
            return json.loads(json.dumps(smoke.FICTIONAL_HA_SETTINGS))

        async def close(self):
            pass

    m = await mk()
    m.store.link(OWNER_HA, "owner")
    m.store.link(ADULT_HA, "admin")
    m.app["hub"].readproxy = Reads()
    await m.page()
    page = await (await m.request("GET", "/ingress/people", {**m.ha(), **PAGE})).text()
    assert "not imported yet" in page and "import-settings" in page
    origin = {"Origin": str(m.client.make_url("")).rstrip("/")}
    r = await m.request("POST", "/ingress/import-settings", {**m.ha(), **origin}, data={"csrf": "stale"})
    assert r.status == 403 and Reads.calls == 0
    r = await m.request("POST", "/ingress/import-settings", {**m.ha(), **origin}, data={"csrf": m.jar["mantel_csrf"]})
    assert r.status == 303 and Reads.calls == 1
    assert m.app["settings"].store.import_record()["source"] == "ha:fictional-entry"
    page = await (await m.request("GET", "/ingress/people", {**m.ha(), **PAGE})).text()
    assert "imported from ha:fictional-entry" in page
    # an Admin sees the people page but not the import
    m.jar.clear()
    await m.request("GET", "/x-y/home", {**m.ha(ADULT_HA), **PAGE})
    page = await (await m.request("GET", "/ingress/people", {**m.ha(ADULT_HA), **PAGE})).text()
    assert "import-settings" not in page
    r = await m.request("POST", "/ingress/import-settings", {**m.ha(ADULT_HA), **origin}, data={"csrf": m.jar["mantel_csrf"]})
    assert r.status == 403
