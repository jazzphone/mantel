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


# -- a screen in Home Assistant's sidebar (ha_dashboards.py) and the HTTPS page's frame check ------------------
# The kit is a recording stub (no DOM): each row is {kind, label, sub, value, on, ...}, each group {header, footer, rows}.
HAD_SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings', ancestorOrigins: JSON.parse(process.argv[4]) };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, on: o.on, valueCls: o.valueCls,
                                options: o.options, fk: o.fk, setAttribute() {} });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
globalThis.fetch = async (u) => {
  const path = String(u);
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
const m = await import(process.argv[2]);
const out = {};
const tick = () => new Promise((r) => setTimeout(r, 0));
async function draw(me, fn) {
  m._reset(me);
  const panel = { render() {}, status() {}, shadowRoot: null };
  const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
  for (let i = 0; i < 3; i++) {                  // a draw asks the server; the next has its answer
    c.kids = [];
    fn(panel, c);
    await tick(); await tick();
  }
  return c.kids;
}
const owner = JSON.parse(process.argv[5]), adult = JSON.parse(process.argv[6]);
const screen = (me) => draw(me, (p, c) => m.host.extend('screen', c, { screen: 'dashboard-loft', title: 'Loft' }, p));
out.adult = await screen(adult);
out.owner = await screen(owner);
const proxy = await draw(owner, (p, c) => { m.host.page(['mantel', 'connections', 'proxy'], p).body(c); });
out.frames = proxy.filter((g) => g.header === 'Home Assistant’s Frame');
process.stdout.write(JSON.stringify(out));
"""

BASE_URL = "https://mantel.example.com/"


def had_run(tmp_path, dashboards, state="ok", message=None, framed=()):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    reads = {
        "/api/admin/ha-dashboards": {"ok": True, "state": state, "message": message, "base": BASE_URL,
                                     "ha_url": "https://ha.example.com",
                                     "ha_addresses": [{"kind": "internal", "url": "https://ha-home.example.com"},
                                                      {"kind": "external", "url": "https://ha.example.com"}],
                                     "dashboards": dashboards,
                                     "screens": [{"path": "dashboard-loft", "title": "Loft", "url": BASE_URL + "dashboard-loft/home"}]},
        "/api/admin/proxy-check/summary": {"mode": "own", "mode_label": "Your Proxy", "mode_detail": "", "public_url": BASE_URL,
                                           "https_seen": True, "trusted_proxies": [], "can_rotate": False,
                                           "door_key": {"required": False}, "frame_ancestors": ["https://ha.example.com"],
                                           "frame_option": "ha_frame_origins"},
    }
    (tmp_path / "base.mjs").write_text((WEB / "shim/base.js").read_text(encoding="utf-8"))
    (tmp_path / "mantel-settings.mjs").write_text(MODULE.replace("from './base.js'", "from './base.mjs'"))
    (tmp_path / "script.mjs").write_text(HAD_SCRIPT)
    (tmp_path / "reads.json").write_text(json.dumps(reads))
    got = subprocess.run(["node", str(tmp_path / "script.mjs"), str(tmp_path / "mantel-settings.mjs"),
                          str(tmp_path / "reads.json"), json.dumps(list(framed)),
                          json.dumps(overview("owner", ALL)), json.dumps(overview("adult", ["me"]))],
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


LOFT = {"id": "mantel_loft", "url_path": "mantel-loft", "title": "Upstairs", "icon": "mdi:fireplace", "require_admin": True,
        "show_in_sidebar": True, "screen": "dashboard-loft", "url": BASE_URL + "dashboard-loft/home"}


def test_a_screens_page_offers_show_in_home_assistant_to_owners_and_admins_only(tmp_path):
    got = had_run(tmp_path, [])
    assert got["adult"] == []
    [g] = got["owner"]
    assert g["header"] == "Home Assistant"
    assert [(r["kind"], r["label"], r["on"]) for r in g["rows"]] == [("toggle", "Show in Home Assistant", False)]
    assert BASE_URL + "dashboard-loft/home" in g["footer"]


def test_on_it_shows_has_own_title_icon_who_and_the_start_page_line(tmp_path):
    got = had_run(tmp_path, [LOFT, {**LOFT, "id": "other", "url_path": "by-hand"}])
    [g] = got["owner"]
    rows = {r["label"]: r for r in g["rows"]}
    assert rows["Show in Home Assistant"]["on"] is True and rows["Show in Home Assistant"]["sub"] == "In its sidebar as Upstairs"
    assert rows["Title"]["value"] == "Upstairs" and rows["Icon"]["value"] == "mdi:fireplace"     # HA's, as HA has them
    assert rows["Who Sees It"]["value"] == "admin"
    assert [o[1] for o in rows["Who Sees It"]["options"]] == ["Everyone", "Home Assistant Administrators Only"]
    assert "ha.example.com/mantel-loft" in g["footer"] and "Profile → Dashboard" in g["footer"]
    assert "2 dashboards of this screen" in g["footer"]


def test_without_direct_access_or_ha_nothing_and_a_non_admin_connection_says_how(tmp_path):
    assert had_run(tmp_path, [], state="direct_access_off", message="x")["owner"] == []
    assert had_run(tmp_path, [], state="ha_not_connected", message="x")["owner"] == []
    [g] = had_run(tmp_path, [], state="not_ha_admin", message="Add one yourself in Home Assistant: …")["owner"]
    assert g["rows"] == [] and g["footer"].startswith("Add one yourself")


def test_the_https_page_checks_has_addresses_against_the_allowed_frames(tmp_path):
    got = had_run(tmp_path, [], framed=["https://ha.example.com"])
    [g] = got["frames"]
    rows = {r["label"]: r for r in g["rows"]}
    assert rows["Allowed to Show Mantel"]["value"] == "ha.example.com"
    assert rows["Home Assistant at Home"]["value"] == "Fix" and rows["Home Assistant at Home"]["valueCls"] == "warn"
    assert rows["Home Assistant Away"]["value"] == "OK"
    assert rows["This Page"]["value"] == "OK"
    assert "Check an Address" in rows
    assert "ha_frame_origins" in g["footer"]
