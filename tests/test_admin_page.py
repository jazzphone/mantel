"""The admin page (`mantel_server/admin_page.py`): who is served, what the page may contain (CSP), and the
one read it adds, `GET /api/admin/overview` (who I am, and which sections this identity may use)."""
import re
import shutil
import subprocess
import tomllib
from importlib.resources import files
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from conftest import PASSWORD, Mantel
from mantel_server import admin_page
from mantel_server.rbac import Grant

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hosts/server/mantel_server/static/admin"


@pytest.fixture
async def admin(tmp_path, monkeypatch):
    """The conftest app with admin_page.register() called (as the orchestrator's server.py does)."""
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("admin page tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    admin_page.register(app, app["hub"])
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        yield Mantel(app, client, store, now, origin)
    store.db.close()


async def sections(m, tunnel=False):
    r = await m.get("/api/admin/overview", tunnel=tunnel)
    assert r.status == 200
    return (await r.json())["sections"]


# -- who is served ---------------------------------------------------------------------------------
async def test_signed_out_is_sent_to_login_and_gets_nothing_else(admin):
    r = await admin.client.get("/admin", allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/login?next=/admin"
    for path in ("/admin/admin.js", "/admin/admin.css", "/api/admin/overview"):
        assert (await admin.client.get(path, allow_redirects=False)).status == 401, path


async def test_signed_in_gets_the_page(admin):
    await admin.user("avery", "owner")
    await admin.sign_in("avery")
    r = await admin.client.get("/admin?plain=1")         # the plain fallback; /admin is Mantel Settings now
    assert r.status == 200 and r.content_type == "text/html"
    html = await r.text()
    assert "<title>Mantel admin</title>" in html and 'src="/admin/admin.js"' in html
    assert r.headers["Cache-Control"] == "no-store"
    for name, mime in (("admin.js", "text/javascript"), ("admin.css", "text/css")):
        a = await admin.client.get("/admin/" + name)
        assert a.status == 200 and a.content_type == mime and await a.text() == (STATIC / name).read_text()
    assert (await admin.client.get("/admin/index.html")).status == 404
    assert (await admin.client.get("/admin/..%2Fdev.html")).status in (404, 400)


async def test_csp_and_no_inline_script_handler_or_style(admin):
    await admin.user("avery", "owner")
    await admin.sign_in("avery")
    r = await admin.client.get("/admin?plain=1")
    csp = r.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "style-src 'self'" in csp and "default-src 'none'" in csp
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp and "frame-ancestors 'none'" in csp
    html = await r.text()
    scripts = re.findall(r"<script\b[^>]*>", html)
    assert scripts and all('src="' in s and "type=\"module\"" in s for s in scripts)
    assert not re.search(r"<script[^>]*>[^<]+</script>", html)          # no inline script body
    assert not re.search(r"\son\w+\s*=", html)                           # no inline handlers
    assert not re.search(r"\sstyle\s*=", html) and "<style" not in html   # no inline style
    assert "javascript:" not in html


def test_the_assets_do_not_use_unsafe_dom_or_inline_styles():
    js = (STATIC / "admin.js").read_text()
    for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function",
                   "setAttribute('style'", "cssText", "localStorage", "sessionStorage", "indexedDB", "javascript:"):
        assert banned not in js, banned
    assert not re.search(r"\.on[a-z]+\s*=", js)                          # handlers are added with addEventListener
    css = (STATIC / "admin.css").read_text()
    assert "@import" not in css and "url(http" not in css


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_module_parses():
    out = subprocess.run(["node", "--check", str(STATIC / "admin.js")], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr


def test_the_assets_ship_in_the_package():
    data = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert "static/admin/*" in data["tool"]["setuptools"]["package-data"]["mantel_server"]
    for name in ("index.html", "admin.js", "admin.css"):
        assert files("mantel_server").joinpath("static/admin/" + name).is_file()


async def test_admin_sends_a_signed_in_person_to_mantel_settings(admin):
    await admin.user("avery", "owner")
    await admin.sign_in("avery")
    r = await admin.client.get("/admin", allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/settings"


async def test_a_wall_tablet_alone_is_refused_the_page(admin):
    await admin.user("avery", "owner")
    await admin.sign_in("avery")
    r = await admin.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    page = await admin.client.get("/admin", allow_redirects=False)
    assert page.status == 403 and "wall tablet" in await page.text()
    assert "unsafe-inline" not in page.headers["Content-Security-Policy"]
    assert (await admin.get("/api/admin/overview")).status == 403


# -- the overview ------------------------------------------------------------------------------------
@pytest.mark.parametrize("role, expected", [
    ("owner", ["me", "connections", "general", "people", "devices", "files", "photos", "roles", "service", "audit", "about"]),
    ("admin", ["me", "connections", "general", "people", "devices", "files", "photos", "audit", "about"]),
    ("adult", ["me", "about"]), ("child", ["me", "about"]), ("guest", ["me", "about"]), ("wall_tablet", ["me", "about"]),
])
async def test_sections_by_role(admin, role, expected):
    await admin.user("someone", role)
    await admin.sign_in("someone")
    assert await sections(admin) == expected


async def test_the_overview_describes_me_and_the_forms(admin):
    uid = await admin.user("avery", "owner", name="Avery")
    await admin.sign_in("avery")
    admin.app["accounts"].totp_begin(uid, "avery")
    admin.store.db.execute("UPDATE totp_credentials SET confirmed = 1")
    body = await (await admin.get("/api/admin/overview")).json()
    assert body["user"]["id"] == uid and body["user"]["role"] == "owner" and body["user"]["totp"] is True
    assert body["user"]["passkeys"] == 0 and body["door"] == "lan" and body["at_tablet"] is False
    assert body["csrf"] == admin.cookie("mantel_csrf") and body["now"] == admin.now[0]
    assert body["roles"] == ["owner", "admin", "adult", "child", "guest", "wall_tablet"]
    assert body["device_roles"] == ["adult", "child", "guest", "wall_tablet"]
    assert body["service_scopes"] == ["linked", "linked_saves"] and "audit" in body["features"] and "*" not in body["actions"]
    assert "password_hash" not in str(body)


async def test_the_tunnel_door_loses_service_accounts(admin):
    uid = await admin.user("avery", "owner")
    issued = admin.app["sessions"].create(uid, "tunnel", "passkey")
    admin.client.session.cookie_jar.update_cookies({"mantel_session": issued.access, "mantel_csrf": issued.csrf})
    got = await sections(admin, tunnel=True)
    assert got == ["me", "connections", "general", "people", "devices", "files", "photos", "roles", "audit", "about"]


async def test_the_audit_section_follows_the_configure_grant(admin):
    await admin.user("mom", "adult")
    await admin.sign_in("mom")
    assert "audit" not in await sections(admin)
    admin.app["rbac"].add_grant(Grant(effect="allow", actions={"configure"}, resource_kind="feature",
                                      resource="audit", roles={"adult"}))
    got = await sections(admin)
    assert got == ["me", "audit", "about"]
    assert (await admin.get("/api/audit")).status == 200            # and the API agrees with the page
    assert (await admin.get("/api/users")).status == 403            # people stays hidden: its API is Owner/Admin


async def test_a_person_at_a_wall_tablet_gets_only_me(admin):
    await admin.user("avery", "owner")
    await admin.user("mom", "adult")
    await admin.sign_in("avery")
    assert (await admin.post("/api/devices/enroll", {"name": "Hall tablet", "room": "hall"})).status == 201
    r, _ = await admin.sign_in("mom")
    assert r.status == 200
    body = await (await admin.get("/api/admin/overview")).json()
    assert body["at_tablet"] is True and body["sections"] == ["me"]
    assert (await admin.client.get("/admin")).status == 200         # a person at a tablet keeps the plain page: Me only
    # an Owner at a tablet is held to the tablet's share too
    admin.forget_cookies()
    await admin.sign_in("avery")
    assert (await admin.post("/api/devices/enroll", {"name": "Hall tablet 2"})).status == 201
    await admin.sign_in("avery")
    assert (await (await admin.get("/api/admin/overview")).json())["sections"] == ["me"]


async def test_the_forms_use_the_existing_apis_with_the_overview_csrf(admin):
    """The token from the overview is the one the middleware wants for a change."""
    await admin.user("avery", "owner")
    await admin.sign_in("avery")
    body = await (await admin.get("/api/admin/overview")).json()
    ok = await admin.client.post("/api/users", json={"username": "kid", "name": "Kid", "role": "child", "password": PASSWORD},
                                 headers={"X-CSRF-Token": body["csrf"]})
    assert ok.status == 201
    no = await admin.client.post("/api/users", json={"username": "kid2", "role": "child", "password": PASSWORD},
                                 headers={"X-CSRF-Token": "wrong"})
    assert no.status == 403


async def test_the_files_section_has_its_hk_fonts_and_glyphs_slots(admin):
    await admin.user("avery", "owner")
    await admin.sign_in("avery")
    js = (STATIC / "admin.js").read_text()
    for needle in ("renderFiles", "HK fonts and glyphs", "SF-Pro.woff2", "SF-Pro.ttf", "hk-glyphs.js", "/api/user-files"):
        assert needle in js, needle
    assert "files" in await sections(admin)
