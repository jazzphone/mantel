"""Mantel Settings → Alerts (web/shim/settings/alerts.js; docs/phase14/SYSTEM-ALERTS.md "Mantel Settings → Alerts") and Me's
System Alerts switch (settings/me.js).

* The page parses, is registered beside Connections and Backups (section "alerts", which admin_page.sections_for gives
  Owners and Admins), and keeps secrets out of the page's state: a secret is typed into a draft, sent once, and the draft
  is cleared; a saved one is shown only as "…" and its last four characters, and a box left blank keeps it.
* Run in node with a recording stub for the kit (no DOM) and a stub for the server, as the other settings tests do.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from js_modules import copy_shim

ROOT = Path(__file__).resolve().parents[1]
SHIM = ROOT / "web" / "shim"
PAGE = (SHIM / "settings" / "alerts.js").read_text(encoding="utf-8")
NODE = shutil.which("node")
SECRET = "SECRETSECRETSECRET1234"
WEBHOOK = f"https://discord.com/api/webhooks/123456789/{SECRET}"


def overview(role, sections):
    return {"user": {"id": "u1", "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None, "ha_set_up": True}


CHANNEL = {"id": "c1", "kind": "discord", "name": "House Chat", "enabled": True, "events": ["ha.lost", "backup.failed"],
           "min_level": "warning", "quiet": {"on": True, "from": "22:00", "to": "07:00", "critical": True}, "config": {},
           "hint": "1234", "has_secret": True, "needs_secret": False, "created": 1.0, "last_ok": 1000.0, "last_error": None,
           "last_error_at": None, "fails": 0}
BROKEN = {**CHANNEL, "id": "c2", "name": "Alerts Channel", "kind": "telegram", "config": {"chat_id": -100, "chat_name": "Family"},
          "last_ok": 500.0, "last_error": "Telegram said 401: the bot token was revoked", "last_error_at": 900.0, "hint": "abcd"}
LOST = {**CHANNEL, "id": "c3", "name": "Mail", "kind": "email", "needs_secret": True, "hint": None, "last_ok": None,
        "config": {"host": "smtp.example.com", "port": 587, "security": "starttls", "user": "me", "from": "mantel@example.com", "to": ["me@example.com"]}}
CATALOG = [{"id": "ha.lost", "group": "connections", "level": "critical", "title": "Home Assistant disconnected", "default": True, "clears": True, "hold": 300.0},
           {"id": "backup.ok", "group": "backups", "level": "info", "title": "Backup finished", "default": False, "clears": False, "hold": 0.0},
           {"id": "backup.failed", "group": "backups", "level": "critical", "title": "Backup failed", "default": True, "clears": True, "hold": 0.0},
           {"id": "tablet.offline", "group": "tablets", "level": "warning", "title": "{name} tablet is offline", "default": True, "clears": True, "hold": 0.0}]
GROUPS = [{"id": g, "name": n} for g, n in (("connections", "Connections"), ("backups", "Backups"), ("tablets", "Tablets"),
                                            ("mantel", "Mantel"), ("updates", "Updates"), ("security", "Security"))]


def page_json(edit=True, apprise=True, channels=(CHANNEL, BROKEN, LOST)):
    senders = [{"kind": k, "name": n, "advanced": False, "available": True} for k, n in
               (("discord", "Discord"), ("telegram", "Telegram"), ("notifiarr", "Notifiarr"), ("email", "Email"))]
    senders.append({"kind": "apprise", "name": "Apprise", "advanced": True, "available": apprise})
    return {"channels": list(channels), "catalog": CATALOG, "groups": GROUPS, "levels": ["info", "warning", "critical"],
            "senders": senders, "active": [], "holds": {g["id"]: None for g in GROUPS},
            "default_holds": {"connections": 300, "backups": 600, "tablets": 0, "mantel": 600, "updates": 0, "security": 0},
            "heartbeat": {"on": False, "hint": None, "every": 300, "needs_url": False},
            "app": {"people": [{"id": "u1", "name": "Avery", "role": "owner"}], "devices": 2},
            "can_edit": edit, "needs_fresh": False}


SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const rec = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, on: o.on, valueCls: o.valueCls, placeholder: o.placeholder,
                                options: o.options, type: o.type, href: o.href, onClick: o.onClick, onChange: o.onChange, onCommit: o.onCommit,
                                classList: { add() {} }, insertBefore() {}, firstChild: null });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: rec('info'), toggle: rec('toggle'), text: rec('text'), select: rec('select'), nav: rec('nav'), button: rec('button'), check: rec('check'),
  h: (tag, attrs) => ({ kind: 'h', _text: (attrs && attrs.text) || '' }), confirm: async () => true,
};
const script = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const calls = [];
globalThis.fetch = async (u, init = {}) => {
  const key = (init.method || 'GET') + ' ' + String(u);
  calls.push([init.method || 'GET', String(u), init.body ? JSON.parse(init.body) : null]);
  const got = script.reads[key];
  const status = got && got.status ? got.status : got ? 200 : 404;
  const body = got ? (got.body !== undefined ? got.body : got) : { error: 'not_found' };
  return { ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(body)) };
};
const m = await import(process.argv[2]);
const core = await import(process.argv[2].replace('mantel-settings.mjs', 'settings/core.mjs'));
const tick = () => new Promise((r) => setTimeout(r, 0));
const state = () => JSON.stringify([core.cache, core.drafts, core.shown, core.ui]);
async function draw(me, parts) {
  m._reset(me);
  const panel = { render() {}, status() {}, shadowRoot: null };
  const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
  let pg;
  for (let i = 0; i < 3; i++) { c.kids = []; pg = m.host.page(parts, panel); pg.body(c); await tick(); await tick(); }   // (the panel asks again at each render)
  return { pg, kids: c.kids, panel };
}
const rows = (kids) => kids.flatMap((g) => g.rows || []);
const find = (kids, label, kind) => rows(kids).find((r) => r.label === label && (!kind || r.kind === kind));
const out = {};
const owner = script.owner, admin = script.admin, adult = script.adult;

// the sidebar and the addresses
out.sidebar = {};
for (const [name, me] of [['owner', owner], ['admin', admin], ['adult', adult]]) {
  m._reset(me);
  out.sidebar[name] = { routes: m.host.groups().flatMap((g) => g.rows.map((r) => r.route)), search: m.host.search().map((r) => r.route),
                        forward: m.host.forward('alerts'), titles: {} };
  for (const sub of [[], ['add'], ['add', 'apprise'], ['channel', 'c1'], ['apps'], ['history'], ['advanced']]) {
    out.sidebar[name].titles[sub.join('/') || 'alerts'] = m.host.page(['mantel', 'alerts', ...sub], null).title;
  }
}

// the main page
const main = await draw(owner, ['mantel', 'alerts']);
out.main = { scope: main.pg.scope, groups: main.kids.map((g) => ({ header: g.header, footer: g.footer, rows: g.rows.map((r) => [r.label, r.sub, r.value, r.href]) })) };

// a channel's page, for an Owner: change a switch, type a secret, save it, send a test
const ch = await draw(owner, ['mantel', 'alerts', 'channel', 'c1']);
out.channel = { title: ch.pg.title, headers: ch.kids.map((g) => g.header), setup: ch.kids.find((g) => g.header === 'Setup').rows.map((r) => [r.kind, r.label, r.placeholder, r.type]) };
const toggle = find(ch.kids, 'Backup Finished', 'toggle');
out.channel.toggleSub = toggle.sub;
await toggle.onChange(true);
await tick();
out.channel.eventPut = calls.filter((c) => c[0] === 'PUT');
calls.length = 0;
// a save with nothing typed keeps the secret
let setup = ch.kids.find((g) => g.header === 'Setup');
await setup.rows.find((r) => r.label === 'Save').onClick();
await tick();
out.channel.blankSave = calls.filter((c) => c[0] === 'PUT').map((c) => c[2]);
calls.length = 0;
// a save with the secret typed sends it once and leaves it nowhere (the page is drawn again, as the panel does after a save)
const ch2 = await draw(owner, ['mantel', 'alerts', 'channel', 'c1']);
setup = ch2.kids.find((g) => g.header === 'Setup');
setup.rows.find((r) => r.label === 'Webhook URL').onCommit(script.webhook);
const before = state();
await setup.rows.find((r) => r.label === 'Save').onClick();
await tick();
out.channel.typedSave = calls.filter((c) => c[0] === 'PUT').map((c) => c[2]);
out.channel.typedStateBefore = before.includes(script.secret);
out.channel.stateAfter = state().includes(script.secret);
// Send Test: the server's words when it fails
await find(ch2.kids, 'Send Test', 'button').onClick();
await tick();
out.channel.test = { flash: core.ui.flash, calls: calls.filter((c) => /test$/.test(c[1])).length };

// the other states of a channel row, and a read-only channel
const lost = await draw(owner, ['mantel', 'alerts', 'channel', 'c3']);
out.lost = { setup: lost.kids.find((g) => g.header === 'Setup').rows.map((r) => [r.kind, r.label, r.value, r.placeholder]) };
script.reads['GET /api/alerts'] = script.readonly;               // an Admin's read: can_edit is false
const readOnly = await draw(admin, ['mantel', 'alerts', 'channel', 'c1']);
out.readOnly = { headers: readOnly.kids.map((g) => g.header), labels: rows(readOnly.kids).map((r) => r.label),
                 footers: readOnly.kids.map((g) => g.footer) };
script.reads['GET /api/alerts'] = script.page;

// Add Channel and Advanced
const add = await draw(owner, ['mantel', 'alerts', 'add']);
out.add = { types: find(add.kids, 'Type', 'select').options, headers: add.kids.map((g) => g.header) };
const adv = await draw(owner, ['mantel', 'alerts', 'advanced']);
out.advanced = { headers: adv.kids.map((g) => g.header), holds: adv.kids[0].rows.map((r) => [r.label, r.sub, r.value]) };
await adv.kids[0].rows[0].onChange('600');
await tick();
out.advanced.holdPut = calls.filter((c) => c[0] === 'PUT' && c[1].endsWith('/settings'));
// the history
const hist = await draw(owner, ['mantel', 'alerts', 'history']);
out.history = hist.kids.flatMap((g) => g.rows).filter((r) => r.kind === 'info').map((r) => [r.label, r.sub, r.value]);
// Mantel Apps
const apps = await draw(owner, ['mantel', 'alerts', 'apps']);
out.apps = apps.kids.map((g) => g.rows.map((r) => [r.label, r.value]));

// Me
out.me = {};
for (const [name, me] of [['owner', owner], ['admin', admin], ['adult', adult]]) {
  const mine = await draw(me, ['mantel', 'me']);
  const t = find(mine.kids, 'System Alerts', 'toggle');
  out.me[name] = !!t;
  if (name === 'owner') {
    calls.length = 0;
    await t.onChange(false);
    await tick();
    out.me.put = calls.filter((c) => c[0] === 'PUT');
  }
}
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    if NODE is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("alerts-settings")
    copy_shim(d)
    sections = ["me", "connections", "people", "backups", "alerts"]
    reads = {
        "GET /api/alerts": page_json(),
        "GET /api/alerts/me": {"system_alerts": True, "eligible": True},
        "PUT /api/alerts/me": {"system_alerts": False},
        "PUT /api/alerts/channels/c1": {"channel": {**CHANNEL, "events": ["ha.lost", "backup.failed", "backup.ok"]}},
        "POST /api/alerts/channels/c1/test": {"status": 502, "body": {"error": "send_failed", "message": "Discord said 401: the webhook was deleted"}},
        "PUT /api/alerts/settings": page_json(),
        "GET /api/alerts/log": {"log": [
            {"id": 2, "at": 2000.0, "kind": "ha.lost", "key": "", "level": "critical", "up": False, "title": "Home Assistant is back", "body": "", "sent_to": ["c1", "app"], "group": "connections"},
            {"id": 1, "at": 1000.0, "kind": "ha.lost", "key": "", "level": "critical", "up": True, "title": "Home Assistant disconnected", "body": "", "sent_to": [], "group": "connections"}]},
    }
    (d / "script.mjs").write_text(SCRIPT)
    (d / "script.json").write_text(json.dumps({
        "reads": reads, "page": page_json(), "readonly": page_json(edit=False), "secret": SECRET, "webhook": WEBHOOK,
        "owner": overview("owner", sections), "admin": overview("admin", sections),
        "adult": overview("adult", ["me"])}))
    got = subprocess.run([NODE, str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "script.json")],
                         capture_output=True, text=True, timeout=90)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_alerts_page_and_the_files_it_changes_parse(tmp_path):
    entry = copy_shim(tmp_path)
    for rel in ("settings/alerts.mjs", "settings/me.mjs", "settings/kit.mjs", entry.name):
        out = subprocess.run([NODE, "--check", str(tmp_path / rel)], capture_output=True, text=True)
        assert out.returncode == 0, (rel, out.stderr)


def test_alerts_sits_beside_connections_and_backups_for_owners_and_admins_only(run):
    for who in ("owner", "admin"):
        s = run["sidebar"][who]
        assert s["routes"].index("mantel/alerts") == s["routes"].index("mantel/backups") + 1, who
        assert "mantel/alerts" in s["search"] and s["forward"] == "mantel/alerts"
        assert s["titles"]["alerts"] == "Alerts" and s["titles"]["add"] == "Add Channel"
        assert s["titles"]["add/apprise"] == "Add Channel" and s["titles"]["channel/c1"] == "Channel"
        assert [s["titles"][k] for k in ("apps", "history", "advanced")] == ["Mantel Apps", "History", "Advanced"]
    a = run["sidebar"]["adult"]            # an address of a page the role may not use opens Me instead
    assert "mantel/alerts" not in a["routes"] and set(a["titles"].values()) == {"Fictional adult"}


def test_the_channels_list_shows_status_type_name_and_last_sent_or_the_last_error(run):
    m = run["main"]
    assert "sealed end to end" in m["scope"] and "Discord, Telegram, Notifiarr" in m["scope"]
    channels = m["groups"][0]
    assert channels["header"] == "Channels"
    rows = {r[0]: r for r in channels["rows"]}
    assert rows["House Chat"][2] == "Discord" and rows["House Chat"][1].startswith("Last sent ")
    assert rows["Alerts Channel"][2] == "Telegram" and "Telegram said 401: the bot token was revoked" in rows["Alerts Channel"][1]
    assert "Enter its secret again" in rows["Mail"][1] and rows["Mail"][2] == "Email"
    assert rows["House Chat"][3] == "#/mantel/alerts/channel/c1"
    assert channels["rows"][-1][0] == "Add Channel"
    assert [r[0] for r in m["groups"][1]["rows"]] == ["Mantel Apps", "History", "Advanced"]


def test_a_channels_page_has_events_by_group_the_level_quiet_hours_a_test_and_delete(run):
    c = run["channel"]
    assert c["title"] == "House Chat"
    assert c["headers"] == [None, None, "Events: Connections", "Events: Backups", "Events: Tablets", "Minimum Level",
                            "Quiet Hours", "Setup", None, None]
    assert c["toggleSub"] == "Info · Off for a new channel"          # the default is shown as the new-channel state
    assert c["eventPut"] and c["eventPut"][0][1].endswith("/api/alerts/channels/c1")
    assert c["eventPut"][0][2] == {"events": ["ha.lost", "backup.failed", "backup.ok"]}


def test_a_saved_secret_shows_only_its_last_four_characters_and_blank_keeps_it(run):
    c = run["channel"]
    assert ["text", "Webhook URL", "…1234", "password"] in c["setup"]
    assert c["blankSave"] == [{"config": {}}]                            # no `secret` key: the saved one is kept
    lost = run["lost"]
    assert ["info", "Secret", "Needed", None] in lost["setup"]            # needs_secret: asked for again
    assert any(r[1] == "Password" and r[3] == "Required" for r in lost["setup"])


def test_a_typed_secret_is_sent_once_and_never_stays_in_the_pages_state(run):
    c = run["channel"]
    assert c["typedSave"] == [{"config": {}, "secret": {"url": WEBHOOK}}]
    assert c["typedStateBefore"] is True            # typed into its draft...
    assert c["stateAfter"] is False                 # ...and gone from the cache, the drafts, what is shown and the flash


def test_send_test_shows_what_the_service_said(run):
    t = run["channel"]["test"]
    assert t["calls"] == 1
    assert t["flash"] == {"key": "alert:c1", "text": "Discord said 401: the webhook was deleted", "err": True}


def test_an_admin_sees_a_channel_but_cannot_change_it(run):
    r = run["readOnly"]
    assert "Setup" not in r["headers"] and not {"Name", "Send Test", "Save", "Delete Channel…"} & set(r["labels"])
    assert {"Status", "Type", "Minimum Level", "Events", "Quiet Hours"} <= set(r["labels"])
    assert "Only an Owner can change alerts." in r["footers"]


def test_add_channel_offers_the_types_but_apprise_only_under_advanced(run):
    assert [t[0] for t in run["add"]["types"]] == ["discord", "telegram", "notifiarr", "email"]
    assert run["add"]["headers"] == [None, "Setup", None]
    adv = run["advanced"]
    assert adv["headers"] == ["Holds", "Heartbeat", "Apprise"]
    assert [h[0] for h in adv["holds"]] == ["Connections", "Backups", "Mantel"]       # a group with no hold has none to set
    assert adv["holds"][0][1] == "Usually 5 Minutes"
    assert adv["holdPut"][0][2] == {"holds": {"connections": 600}}


def test_history_names_the_channels_that_took_an_alert(run):
    assert run["history"][0][0] == "Home Assistant is back"
    assert "Back" in run["history"][0][1] and "Sent to House Chat, Mantel Apps" in run["history"][0][1]
    assert "Raised" in run["history"][1][1] and "Not sent" in run["history"][1][1]


def test_mantel_apps_lists_who_gets_system_alerts(run):
    people, link = run["apps"]
    assert people[0] == ["Avery", "Owner"] and ["Devices", "2"] in people
    assert link == [["Me", None]]


def test_me_has_a_system_alerts_switch_for_owners_and_admins_only(run):
    me = run["me"]
    assert (me["owner"], me["admin"], me["adult"]) == (True, True, False)
    assert [p[2] for p in me["put"] if p[1].endswith("/api/alerts/me")] == [{"system_alerts": False}]


# -- the source ---------------------------------------------------------------------------------------------------
def test_the_alerts_page_keeps_secrets_out_of_the_page_state():
    assert PAGE.count("type: 'password'") >= 6 and "autocomplete: 'off'" not in PAGE      # field() sets autocomplete off
    assert "clearDraft(form)" in PAGE                  # cleared after a save and after an add
    for banned in ("localStorage", "sessionStorage", "innerHTML", "console.log", "cache["):
        assert banned not in PAGE, banned


def test_the_alerts_page_is_american_english_and_draws_only_served_glyphs():
    assert not re.search(r"colour|centre|\bgrey\b|favourite", PAGE, re.I)
    names = {n for p in (ROOT / "web/mdi").glob("icons-*.json") for n in json.loads(p.read_text())}
    used = set(re.findall(r"mdi:([a-z0-9-]+)", PAGE))
    assert used and used <= names, sorted(used - names)
