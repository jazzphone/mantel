"""Mantel Settings (docs/phase8/SETTINGS.md): HK Settings' page with Mantel's own pages in it, gated by host and role.

* Mantel's side: web/shim/mantel-settings.js is the host the panel asks (hkShell.settingsHost()). Which of its
  groups and pages exist follows GET /api/admin/overview's `sections` (admin_page.sections_for); HK's own house
  settings are an Owner's or Admin's (`house`), never read for anyone else, and not before Home Assistant is
  connected (the first run opens Connections); /admin's old addresses forward to their pages.
* Home Assistant's side: the HA build ships none of it. No Mantel file, and the settings panel it ships says
  nothing of Mantel (the panel's own host tests: hosts/ha/.../tests/test_settingshost.js).
* Every glyph Mantel's pages draw is a Material Design Icon Mantel serves (web/mdi/icons-*.json).
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from js_modules import copy_shim, settings_source

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
MODULE = settings_source()     # the entry and web/shim/settings/*.js
PHOTOS = (WEB / "shim/mantel-photos.js").read_text(encoding="utf-8")


ALL = ["me", "connections", "people", "devices", "files", "photos", "roles", "service", "connect", "audit"]
ADMIN = ["me", "connections", "people", "devices", "files", "photos", "audit"]


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
  const sent = [], client = { actions: { callWS: (msg) => { sent.push(msg); return Promise.resolve({}); } } };
  m.useCommands(() => false);
  const commandsOff = h.canRenameInHome(client);
  m.useCommands(() => true);
  const rename = { commandsOff, commandsOn: h.canRenameInHome(client), noClient: h.canRenameInHome(null) };
  await h.renameInHome('light.kitchen', 'Island Lights', client);
  rename.sent = sent;
  out[name] = { rename, house: h.house, first: h.first(), title: h.title, groups, pages,
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
    copy_shim(d)
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
    # wall tablets are each one's own page in All Screens (Devices is gone), Mantel Connect is in Connections'
    # Home Assistant, and Service Accounts is Advanced
    assert routes(o)[1:] == ["mantel/people", "mantel/roles", "mantel/audit", "mantel/connections", "mantel/files",
                             "mantel/service"]
    assert [g["header"] for g in o["groups"][1:]] == ["People & Access", "Mantel", "Advanced"]
    assert all(g["place"] == "end" for g in o["groups"][1:])
    assert o["pages"]["roles"] == "Roles & Grants" and o["pages"]["service"] == "Service Accounts"


def test_an_admin_gets_the_house_without_roles_or_service_accounts(run):
    a = run["admin"]
    assert a["house"] is True
    assert routes(a) == ["mantel/me", "mantel/people", "mantel/audit", "mantel/connections", "mantel/files"]
    # an address of a page the role may not use opens Me instead
    assert a["pages"]["roles"] == a["pages"]["me"] == "Fictional admin"
    assert a["pages"]["service"] == "Fictional admin" and a["pages"]["connect"] == "Fictional admin"
    assert "mantel/roles" not in a["search"]


def test_everyone_else_gets_me_only_and_never_the_houses_settings(run):
    p = run["adult"]
    assert p["house"] is False and p["first"] == "mantel/me"
    assert routes(p) == ["mantel/me"] and p["search"] == ["mantel/me"]
    assert set(p["pages"].values()) == {"Fictional adult"}


def test_also_rename_in_home_assistant_is_offered_to_the_house_managers_while_commands_are_on(run):
    """The accessory page's switch (2026-10-31) asks the host: an Owner or Admin, house commands on, a client to
    write with. The write is the gateway's registry command for the entity's name and nothing else."""
    for who in ("owner", "admin"):
        r = run[who]["rename"]
        assert (r["commandsOn"], r["commandsOff"], r["noClient"]) == (True, False, False), who
        assert r["sent"] == [{"type": "config/entity_registry/update", "entity_id": "light.kitchen", "name": "Island Lights"}]
    for who in ("adult", "first_run"):         # not the house's managers, or Home Assistant not read yet
        assert run[who]["rename"]["commandsOn"] is False, who


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
    names = {n for p in (WEB / "mdi").glob("icons-*.json") for n in json.loads(p.read_text())}
    used = set(re.findall(r"mdi:([a-z0-9-]+)", MODULE + PHOTOS))
    assert used and used <= names, sorted(used - names)


def test_every_glyph_hks_own_frontend_names_is_served():
    # Mantel serves every Material Design Icon (web/mdi/icons-*.json; until 2026-11-10 a subset, which blanked the
    # owner's Side Pane icon and three of its sections, 2026-10-30): a name that is not one (a typo, an icon Material
    # retired) draws blank. A name built by joining ('mdi:weather-' + its condition) is not a name.
    names = {n for p in (WEB / "mdi").glob("icons-*.json") for n in json.loads(p.read_text())}
    used = {}
    for p in (WEB / "hk").rglob("*.js"):
        for m in re.finditer(r"mdi:([a-z0-9]+(?:-[a-z0-9]+)*)(-?['\"]\s*\+)?", p.read_text(encoding="utf-8", errors="ignore")):
            if not m.group(2):
                used.setdefault(m.group(1), p.name)
    missing = {k: v for k, v in used.items() if k not in names}
    assert not missing, missing


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


# The one thing HK Frontend says of Mantel: the Intercom block on a host that has no Intercom (docs/phase17/INTERCOM.md,
# "Intercom needs Mantel"). Every other word for the host comes from hkShell.productName().
SAYS_MANTEL = ("Intercom needs Mantel", "'Needs Mantel'")


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
            if re.search(r"mantel", code, re.I) and not code.startswith(("//", "*", "/*", "#")) \
                    and not any(w in code for w in SAYS_MANTEL):
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
  check: row('check'), h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
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
// the screen's Where (screens.py) is drawn first; these tests are about Home Assistant's sidebar dashboard
const all = await screen(owner);
out.where = all.filter((g) => g.header === 'Where');
out.owner = all.filter((g) => g.header !== 'Where');
out.conflict = (await draw(owner, (p, c) => m.host.extend('screen', c, { screen: 'dashboard-loft', title: 'Loft',
  where: { where: 'mantel', text: 'Mantel, and Home Assistant has a dashboard at the same address', conflict: true } }, p)))
  .filter((g) => g.header === 'Where');
out.haScreen = (await draw(owner, (p, c) => m.host.extend('screen', c, { screen: 'dashboard-loft', title: 'Loft',
  where: { where: 'ha', text: 'Home Assistant · HK Frontend', also: true } }, p)));
out.add = await draw(owner, (p, c) => { m.host.page(['mantel', 'add-screen'], p).body(c); });
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
    copy_shim(tmp_path)
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
    [w] = got["where"]
    assert w["rows"][0]["label"] == "Where" and w["rows"][0]["value"] == "Mantel", "a screen says where it is drawn"
    assert [r["label"] for r in w["rows"][1:]] == ["Remove Screen…"]
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


def test_the_https_page_lists_the_allowed_frames_and_offers_the_missing_ones(tmp_path):
    """Home Assistant's Frame: every allowed address and where it comes from; an Owner gets an Allow button for each HA
    address that is not allowed yet (no App option to edit, no restart: frame_origins.py)."""
    got = had_run(tmp_path, [], framed=["https://ha-lan.example.com"])
    [g] = got["frames"]
    rows = {r["label"]: r for r in g["rows"]}
    assert rows["ha.example.com"]["value"] == "Automatic"                                      # allowed already
    assert rows["Allow ha-home.example.com (its internal URL)"]["kind"] == "button"            # HA's own, not yet
    assert rows["Allow ha-lan.example.com (Home Assistant is open here now)"]["kind"] == "button"
    assert "Allow ha.example.com (its external URL)" not in rows                               # allowed: not offered
    assert "blank page" in g["footer"] and "ha_frame_origins" not in g["footer"]


def test_turned_on_inside_ha_at_an_address_not_allowed_it_says_so_and_offers_to_allow_it(tmp_path):
    got = had_run(tmp_path, [LOFT], framed=["https://ha-lan.example.com"])
    [g] = got["owner"]
    labels = [r["label"] for r in g["rows"]]
    assert "Allow ha-lan.example.com to Show Mantel" in labels


PRESS_SCRIPT = r"""
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: 'mantel_csrf=fictional' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const sent = [];
let refuse = {};
globalThis.fetch = async (u, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null;
  sent.push({ method: init && init.method, path: String(u), body });
  const tid = String(u).split('/')[4];
  if (refuse[tid]) return { ok: false, status: refuse[tid][0], json: async () => ({ error: refuse[tid][1], message: refuse[tid][2] }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { tablet: tid, verb: body.verb }, audit_id: 7 }) };
};
const m = await import(process.argv[2]);
const out = {};
const panel = { tabs: () => ({ kitchen: { name: 'Kitchen' }, loft: { name: 'Loft' } }), render() {} };
m._reset(JSON.parse(process.argv[3]));
out.notMine = m.host.press(['button.kitchen_kiosk_reload_page'], panel);
await m.host.press(['mantel-tablet:kitchen:reload', 'mantel-tablet:loft:clear_cache', 'mantel-tablet:x:evalJs'], panel);
out.sent = sent.splice(0);
refuse = { loft: [503, 'commands_disabled', 'Commands are off on this Mantel, so nothing was sent to the tablet.'] };
try { await m.host.press(['mantel-tablet:loft:reload'], panel); out.one = null; } catch (e) { out.one = e.message; }
try { await m.host.press(['mantel-tablet:kitchen:reload', 'mantel-tablet:loft:reload'], panel); out.some = null; } catch (e) { out.some = e.message; }
out.sentAfter = sent.length;
m._reset(null);
out.signedOut = m.host.press(['mantel-tablet:kitchen:reload'], panel);
process.stdout.write(JSON.stringify(out));
"""


def test_the_host_presses_a_paired_tablets_reload_through_the_gateway(tmp_path):
    """HK Settings' Reload buttons (hk-settings.js press -> host.press): each mantel-tablet part is a POST to the
    tablet's command route (the gateway decides and audits); anything else is HA's; a refusal is said, by tablet."""
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    copy_shim(tmp_path)
    (tmp_path / "press.mjs").write_text(PRESS_SCRIPT)
    got = subprocess.run(["node", str(tmp_path / "press.mjs"), str(tmp_path / "mantel-settings.mjs"),
                          json.dumps(overview("owner", ALL))], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    out = json.loads(got.stdout)
    assert out["notMine"] is None and out["signedOut"] is None
    assert [(s["method"], s["path"], s["body"]) for s in out["sent"]] == [
        ("POST", "/api/connections/tablets/kitchen/command", {"verb": "reload"}),
        ("POST", "/api/connections/tablets/loft/command", {"verb": "clear_cache"})]       # never another verb
    assert out["one"] == "Commands are off on this Mantel, so nothing was sent to the tablet."
    assert out["some"] == "Loft: Commands are off on this Mantel, so nothing was sent to the tablet."
    assert out["sentAfter"] == 3


# -- Connections: the one-time import of HK's settings outside the App (settings_store.import_settings) ----------
IMPORT_SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: 'mantel_csrf=fictional-csrf' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, disabled: !!o.disabled,
                                onClick: o.onClick, fk: o.fk });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), nav: row('nav'), button: row('button'), confirm: async () => true,
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const [, , mod, readsFile, casesFile] = process.argv;
const reads = JSON.parse(readFileSync(readsFile, 'utf8'));
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
let state = {};
const sent = [];
globalThis.fetch = async (u, init) => {
  const path = String(u), method = (init && init.method) || 'GET';
  if (method !== 'GET') {
    sent.push({ method, path, csrf: init.headers['X-CSRF-Token'] });
    state['/api/settings/import'] = { import: reads.record, empty: false };
    return { ok: true, status: 200, json: async () => reads.imported };
  }
  if (!(path in state)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => state[path] };
};
const m = await import(mod);
const tick = () => new Promise((r) => setTimeout(r, 0));
const panel = { render() {}, status() {}, shadowRoot: null, reload() { panel.reloaded = true; } };
async function draw() {
  const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
  for (let i = 0; i < 3; i++) { c.kids = []; m.host.page(['mantel', 'connections', 'ha', 'moving'], panel).body(c); await tick(); await tick(); }
  return c.kids;
}
const strip = (kids) => kids.map((g) => ({ ...g, rows: (g.rows || []).map(({ onClick, ...r }) => r) }));
const out = {};
for (const [name, cs] of Object.entries(cases)) {
  m._reset(cs.me);
  state = { '/api/connections': cs.connections, '/api/linked/owners': { links: [], tablets: [] },
            '/api/settings/import': cs.status };
  const kids = await draw();
  out[name] = { groups: strip(kids) };
  if (cs.press) {
    const g = kids.find((k) => k.header === 'Import from HK Frontend');
    await g.rows.find((r) => r.kind === 'button').onClick();
    await tick(); await tick();
    out[name].sent = sent.splice(0);
    out[name].after = strip(await draw());
    out[name].reloaded = !!panel.reloaded;
  }
}
process.stdout.write(JSON.stringify(out));
"""


def connections(ha_state):
    ha = {"label": "Home Assistant", "state": ha_state, "url": "http://ha.example:8123" if ha_state == "set" else None,
          "live": {"connected": ha_state == "set"}}
    return {"can_edit": True, "needs_fresh": False,
            "connections": {"ha": ha, "ma": {"label": "Music Assistant", "state": "unset", "url": None, "live": {}}}}


RECORD = {"source": "ha:fictional-entry", "read": "hk_frontend/panel/get", "checksum": "0" * 64,
          "written": ["house/settings", "board/dashboard-kitchen"], "skipped": [], "actor": "u1", "created": 1_700_000_000}


def import_run(tmp_path, cases):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    copy_shim(tmp_path)
    (tmp_path / "import.mjs").write_text(IMPORT_SCRIPT)
    (tmp_path / "reads.json").write_text(json.dumps({"record": RECORD, "imported": {
        "imported": True, "source": "ha:fictional-entry", "written": RECORD["written"], "skipped": [],
        "replaced": ["board/dashboard-home"]}}))
    (tmp_path / "cases.json").write_text(json.dumps(cases))
    got = subprocess.run(["node", str(tmp_path / "import.mjs"), str(tmp_path / "mantel-settings.mjs"),
                          str(tmp_path / "reads.json"), str(tmp_path / "cases.json")], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


def import_group(groups):
    [g] = [g for g in groups if g.get("header") == "Import from HK Frontend"]
    return g


def test_connections_offers_an_owner_the_one_time_import_and_shows_its_record(tmp_path):
    """Outside the App there was no button for the import (only POST /api/settings/import): Home Assistant's Moving
    from HK Frontend has it, an Owner's, sent with the session's CSRF token; afterwards it shows the import's record
    and offers it no more."""
    out = import_run(tmp_path, {
        "owner": {"me": overview("owner", ALL), "connections": connections("set"),
                  "status": {"import": None, "empty": False}, "press": True},
        "owner_no_ha": {"me": overview("owner", ALL), "connections": connections("unset"), "status": {"import": None, "empty": False}},
        "admin": {"me": overview("admin", ADMIN), "connections": connections("set"), "status": {"import": None, "empty": False}},
        "admin_done": {"me": overview("admin", ADMIN), "connections": connections("set"), "status": {"import": RECORD, "empty": False}},
    })
    g = import_group(out["owner"]["groups"])
    assert [(r["kind"], r["label"], r.get("value"), r["disabled"]) for r in g["rows"]] == [
        ("info", "HK’s Settings", "Not Imported", False), ("button", "Import HK’s Settings from Home Assistant", None, False)]
    assert "once" in g["footer"] and "Nothing is written to Home Assistant" in g["footer"]
    assert "Running it again changes nothing" in g["footer"] and "generated Home screen" in g["footer"]
    assert out["owner"]["sent"] == [{"method": "POST", "path": "/api/settings/import", "csrf": "fictional-csrf"}]
    assert out["owner"]["reloaded"] is True                           # HK's own pages read the imported settings
    after = import_group(out["owner"]["after"])
    assert [r["kind"] for r in after["rows"]] == ["info"] and after["rows"][0]["value"].startswith("Imported ")
    assert after["rows"][0]["sub"] == "From ha:fictional-entry · 2 items copied"
    assert out["owner"]["after"][0]["_text"] == "Imported HK’s settings: 2 items copied."     # the page's flash line
    no_ha = import_group(out["owner_no_ha"]["groups"])
    assert no_ha["rows"][1]["disabled"] is True and "Connect Home Assistant first" in no_ha["footer"]
    admin = import_group(out["admin"]["groups"])
    assert [r["kind"] for r in admin["rows"]] == ["info"] and "Only an Owner" in admin["footer"]
    done = import_group(out["admin_done"]["groups"])
    assert done["rows"][0]["value"].startswith("Imported ") and "Running it again changes nothing" in done["footer"]


def test_add_screen_says_where_mantels_screens_come_from():
    assert "generated Home screen" in MODULE and "Import from HK Frontend" in MODULE


def test_a_screen_both_have_offers_one_place_and_add_screen_asks_where(tmp_path):
    """decision 29, one place per screen: a Mantel screen Home Assistant also has at its address offers to keep it
    Mantel's, make it Home Assistant's, or split it; one Home Assistant draws offers to draw it in Mantel instead and
    has no sidebar dashboard of Mantel's; Add Screen asks where first."""
    got = had_run(tmp_path, [])
    [w] = got["conflict"]
    assert [r["label"] for r in w["rows"][1:]] == ["Keep It Mantel’s, Remove Home Assistant’s…", "Make It Home Assistant’s…",
                                                  "Split It in Two…", "Remove Screen…"]
    assert "Each screen should be drawn in one place" in w["footer"]
    assert [g["header"] for g in got["haScreen"]] == ["Where"], "no 'Show in Home Assistant' for a screen HA draws"
    assert [r["label"] for r in got["haScreen"][0]["rows"][1:]] == ["Draw It in Mantel Instead…", "Remove Screen…"]
    headers = [g["header"] for g in got["add"]]
    assert headers[:3] == ["Name", "Where", "Start From"]
    assert [r["label"] for r in got["add"][1]["rows"]] == ["Mantel", "Home Assistant"]

