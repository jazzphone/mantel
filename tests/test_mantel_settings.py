"""Mantel Settings (docs/phase8/SETTINGS.md): HK Settings' page with Mantel's own pages in it, gated by host and role.

* Mantel's side: web/shim/mantel-settings.js is the host the panel asks (hkShell.settingsHost()). Which of its
  groups and pages exist follows GET /api/admin/overview's `sections` (admin_page.sections_for); HK's own house
  settings are an Owner's or Admin's (`house`), never read for anyone else, and not before Home Assistant is
  connected (the first run opens Connections); /admin's old addresses forward to their pages.
* Home Assistant's side: the HA build ships none of it. No Mantel file, and the settings panel it ships says
  nothing of Mantel (the panel's own host tests: hosts/ha/.../tests/test_settingshost.js).
* Every glyph Mantel's pages draw is in the MDI subset HK serves (web/mdi/icons.json).
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
MODULE = (WEB / "shim/mantel-settings.js").read_text(encoding="utf-8")

ALL = ["me", "connections", "people", "devices", "files", "roles", "service", "connect", "audit"]
ADMIN = ["me", "connections", "people", "devices", "files", "audit"]


def overview(role, sections, ha_set_up=True):
    return {"user": {"id": "u1", "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None,
            "ha_set_up": ha_set_up}


CASES = {
    "owner": overview("owner", ALL),
    "admin": overview("admin", ADMIN),
    "adult": overview("adult", ["me"]),
    "first_run": overview("owner", ALL, ha_set_up=False),
}

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const fetched = [];
globalThis.fetch = (u) => { fetched.push(String(u)); return Promise.reject(new Error('no network in this test')); };
const m = await import(process.argv[2]);
const cases = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const out = {};
for (const [name, me] of Object.entries(cases)) {
  m._reset(me);
  const h = m.host;
  const groups = h.groups().map((g) => ({ place: g.place, header: g.header || null, routes: g.rows.map((r) => r.route) }));
  const pages = {};
  for (const s of ['me', 'people', 'devices', 'roles', 'service', 'audit', 'connections', 'connect', 'files']) {
    const pg = h.page(['mantel', s], null);
    pages[s] = pg && pg.title;
  }
  out[name] = { house: h.house, first: h.first(), title: h.title, groups, pages,
                notMine: h.page(['screens', 'x'], null), search: h.search().map((r) => r.route),
                forward: ['connections', 'people', 'me', 'screens/x', 'nope'].map((p) => h.forward(p)) };
}
out.fetched = fetched;
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings")
    # the two modules as ES modules node can load (web/ has no package.json saying so)
    (d / "base.mjs").write_text((WEB / "shim/base.js").read_text(encoding="utf-8"))
    (d / "mantel-settings.mjs").write_text(MODULE.replace("from './base.js'", "from './base.mjs'"))
    (d / "script.mjs").write_text(SCRIPT)
    (d / "cases.json").write_text(json.dumps(CASES))
    got = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "cases.json")],
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


def routes(case):
    return [r for g in case["groups"] for r in g["routes"]]


def test_an_owner_gets_the_house_and_every_mantel_page(run):
    o = run["owner"]
    assert o["title"] == "Mantel Settings" and o["house"] is True and o["first"] is None
    assert o["groups"][0] == {"place": "top", "header": None, "routes": ["mantel/me"]}
    assert routes(o)[1:] == ["mantel/people", "mantel/devices", "mantel/roles", "mantel/service", "mantel/audit",
                             "mantel/connections", "mantel/connect", "mantel/files"]
    assert [g["header"] for g in o["groups"][1:]] == ["People & Access", "Mantel"]
    assert all(g["place"] == "end" for g in o["groups"][1:])
    assert o["pages"]["roles"] == "Roles & Grants" and o["pages"]["service"] == "Service Accounts"


def test_an_admin_gets_the_house_without_roles_or_service_accounts(run):
    a = run["admin"]
    assert a["house"] is True
    assert routes(a) == ["mantel/me", "mantel/people", "mantel/devices", "mantel/audit", "mantel/connections", "mantel/files"]
    # an address of a page the role may not use opens Me instead
    assert a["pages"]["roles"] == a["pages"]["me"] == "Fictional admin"
    assert a["pages"]["service"] == "Fictional admin" and a["pages"]["connect"] == "Fictional admin"
    assert "mantel/roles" not in a["search"]


def test_everyone_else_gets_me_only_and_never_the_houses_settings(run):
    p = run["adult"]
    assert p["house"] is False and p["first"] == "mantel/me"
    assert routes(p) == ["mantel/me"] and p["search"] == ["mantel/me"]
    assert set(p["pages"].values()) == {"Fictional adult"}


def test_the_first_run_opens_connections_without_hks_settings(run):
    f = run["first_run"]
    assert f["house"] is False and f["first"] == "mantel/connections"
    assert "mantel/connections" in routes(f)


def test_only_mantels_addresses_are_its_pages_and_admins_old_ones_forward(run):
    for case in ("owner", "admin", "adult"):
        assert run[case]["notMine"] is None
    assert run["owner"]["forward"] == ["mantel/connections", "mantel/people", "mantel/me", None, None]
    assert run["fetched"] == []          # deciding what to show asks the server nothing more


def test_the_page_hands_mantels_pages_to_the_shell_and_the_panel_draws_with_the_kit():
    page = (WEB / "shim/settings-page.js").read_text(encoding="utf-8")
    assert "window.hkMantelShell.setSettings(mantelSettings.host)" in page
    assert "if (mantelSettings.manages())" in page                   # HK's settings read only for the house's managers
    shell = (WEB / "shim/mantel-shell.js").read_text(encoding="utf-8")
    assert "settingsHost: () => settings" in shell
    # drawn with HK Settings' kit only (docs/DESIGN.md: HK Settings stays iOS Settings): no stylesheet of its own
    # beyond the few rows the kit has no cell for, no admin.css
    assert "admin.css" not in MODULE and "K().group(" in MODULE


def test_every_glyph_mantels_pages_draw_is_served():
    names = set(json.loads((WEB / "mdi/icons.json").read_text()))
    used = set(re.findall(r"mdi:([a-z0-9-]+)", MODULE))
    assert used and used <= names, sorted(used - names)


def test_the_ha_build_ships_nothing_of_mantel_settings():
    spec = importlib.util.spec_from_file_location("build_ha", ROOT / "tools/build_ha.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    pairs = builder.plan()
    names = {Path(dest).name for _, dest in pairs}
    assert not names & {"mantel-settings.js", "settings-page.js", "mantel-shell.js", "settings.html", "base.js"}
    assert not any("/web/shim/" in str(src) for src, _ in pairs)
    # the settings panel HA ships: not a word of Mantel's, in code or comment
    for src, dest in pairs:
        if "/frontend/panels/" in dest:
            assert not re.search(r"mantel", Path(src).read_text(encoding="utf-8"), re.I), dest
    # and the host-shell contract it ships leaves the host's settings to the host (none in HA)
    shell = (ROOT / "hosts/ha/frontend/hk-ha-shell.js").read_text(encoding="utf-8")
    assert "settingsHost" not in shell


def test_nothing_the_ha_build_ships_says_mantel_outside_a_comment():
    # the menu's and the tab bar's host section is named by the host (hkShell.hostMenu()[0].section): in HA there
    # is no host page, so no section and no word; a developer's comment may still name Mantel
    spec = importlib.util.spec_from_file_location("build_ha", ROOT / "tools/build_ha.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    said = []
    for src, dest in builder.plan():
        if not dest.endswith((".js", ".html", ".css", ".json", ".yaml")) or "/frontend/" not in dest:
            continue
        for n, line in enumerate(Path(src).read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            code = line.strip()
            if re.search(r"mantel", code, re.I) and not code.startswith(("//", "*", "/*", "#")):
                said.append(f"{dest}:{n}: {code[:100]}")
    assert said == []
    shell = (WEB / "shim/mantel-shell.js").read_text(encoding="utf-8")
    assert "section: 'Mantel'" in shell                      # Mantel names its own section
