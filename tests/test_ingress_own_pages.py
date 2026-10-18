"""Mantel's own pages (/admin, /proxy-check) work under HA's Ingress prefix, and are reachable from the dashboard's
menu (docs/phase3/HA-APP.md "The prefix"; found on the house in App 0.1.5, fixed in 0.1.6)."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from test_ingress import OWNER_HA, PAGE, PREFIX, mk  # noqa: F401  (mk is a fixture)

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hosts/server/mantel_server/static"
ADMIN_JS = (STATIC / "admin/admin.js").read_text(encoding="utf-8")


async def test_admin_page_through_ingress_has_the_base_and_prefixed_references(mk):  # noqa: F811
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    r = await m.request("GET", "/admin", {**m.ha(), **PAGE})
    html = await r.text()
    assert r.status == 200
    assert f'<meta name="mantel-base" content="{PREFIX}">' in html
    assert f'href="{PREFIX}/admin/admin.css"' in html and f'src="{PREFIX}/admin/admin.js"' in html
    assert f'href="{PREFIX}/home"' in html and "Back to the dashboard" in html
    assert not re.search(r'(?:href|src)="/(?!api/hassio_ingress/)', html)                    # nothing left that escapes the prefix
    assert "frame-ancestors 'self'" in r.headers["Content-Security-Policy"]      # HA's page frames it
    js = await m.request("GET", "/admin/admin.js", m.ha())
    assert js.status == 200 and js.content_type == "text/javascript"


async def test_admin_page_outside_ingress_is_unchanged(mk):  # noqa: F811
    m = await mk(ingress_on=False)
    m.store.link(OWNER_HA, "owner")
    cookie = m.store.create_session(OWNER_HA, 300)
    r = await m.request("GET", "/admin", {"Cookie": f"mantel_session={cookie}"}, cookies=False)
    assert r.status == 200 and await r.text() == (STATIC / "admin/index.html").read_text(encoding="utf-8")
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]


async def test_proxy_check_page_through_ingress(mk):  # noqa: F811
    m = await mk()
    m.store.link(OWNER_HA, "owner")
    r = await m.request("GET", "/proxy-check", {**m.ha(), **PAGE})
    html = await r.text()
    assert r.status == 200
    assert f"<meta name=mantel-base content='{PREFIX}'>" in html and "name=referrer content=same-origin" in html
    assert f"href='{PREFIX}/proxy-check/check.css'" in html and f"src='{PREFIX}/proxy-check/check.js'" in html
    assert f"href='{PREFIX}/admin'" in html


def test_admin_js_has_no_url_that_escapes_the_prefix():
    assert not re.search(r"""fetch\(\s*['"`]/""", ADMIN_JS)                  # every fetch goes through url()
    assert not re.search(r"""import\(\s*['"`]/""", ADMIN_JS)
    assert not re.search(r"""href:\s*['"`]/""", ADMIN_JS)
    assert "new WebSocket" not in ADMIN_JS
    # the one 401 handler never goes to /login under a prefix
    assert re.search(r"function signedOut\(\) \{\s*if \(BASE\)", ADMIN_JS)
    for ln in ADMIN_JS.splitlines():
        if "location.assign('/login" in ln and ln.strip() != "location.assign('/login?next=' + encodeURIComponent('/admin'));":
            assert "BASE" in ln, ln                                       # the others are guarded in the line itself
    assert "fetch(url(path), init)" in ADMIN_JS and "url('/proxy-check/check.js')" in ADMIN_JS


def test_proxy_check_js_is_base_aware():
    src = (STATIC / "proxy-check/check.js").read_text(encoding="utf-8")
    assert not re.search(r"""fetch\(\s*['"`]/""", src)
    assert "mantel-base" in src


SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
globalThis.dispatchEvent = () => true;
const out = {};
for (const base of ['', '/api/hassio_ingress/Fict1onal']) {
  delete globalThis.hkShell; delete globalThis.hkMantelShell;
  globalThis.__mantelBase = base;
  eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
  eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
  const r = {};
  for (const role of ['', 'guest', 'child', 'adult', 'admin', 'owner']) { hkMantelShell.setRole(role); r[role] = hkShell.hostMenu(); }
  out[base || 'root'] = r;
}
process.stdout.write(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_mantel_settings_menu_entry_is_for_owners_and_admins_only():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    for base, key in (("", "root"), ("/api/hassio_ingress/Fict1onal", "/api/hassio_ingress/Fict1onal")):
        r = got[key]
        for role in ("", "guest", "child", "adult"):
            assert r[role] == [], (key, role)
        for role in ("admin", "owner"):
            assert [(e["title"], e["href"]) for e in r[role]] == [("Mantel settings", base + "/admin")]


def test_the_menu_draws_and_opens_the_host_entry():
    menu = (ROOT / "web/hk/modules/hk-menu.js").read_text(encoding="utf-8")
    assert "hostMenu" in menu and "kind === 'hostlink'" in menu and "location.assign(it.href)" in menu
    assert "hostMenu" in (ROOT / "web/client/hk-host-shell.js").read_text(encoding="utf-8")
