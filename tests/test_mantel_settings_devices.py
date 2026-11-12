"""Mantel Settings, wall tablets (web/shim/mantel-settings.js): a wall tablet's room is chosen, never typed, and what
Mantel has of a tablet is on its own page in All Screens, Wall Tablets.

Three of the house's wall tablets were enrolled with rooms typed as "Livingroom", "Masterbathroom" and "Masterbedroom"
(HK's tablets: living_room, master_bathroom, master_bedroom), so their touches and black screens were refused
(features.may_speak_for) and /home sent them to the Kitchen (the house, 2026-10-19). Now:

* "Make This Browser a Wall Tablet…" lists HK's wall tablets (GET /api/devices/rooms), marks the ones an enrolled device
  already serves, and picking one names the device after it; "A New Tablet" ("Not One of These" where the person can't add HK tablets) offers HA's areas, never free text, and makes that room's HK tablet with the device.
* Wall Tablets warns on a wall tablet device whose room has no HK tablet, and its own page moves it in place
  (PATCH /api/devices/{id}). Each tablet's page has the browser signed in as it, its Home Assistant user and Sign Out.

The page is drawn in node with a recording stub of the settings kit (no DOM): each row is {kind, label, sub, value, on,
...} with its handlers, each group {header, footer, rows}.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from js_modules import copy_shim

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, on: o.on, valueCls: o.valueCls,
                                options: o.options, href: o.href, disabled: o.disabled, fk: o.fk,
                                onClick: o.onClick, onChange: o.onChange, onCommit: o.onCommit, setAttribute() {} });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  check: row('check'), confirm: async () => true,
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const sent = [];
globalThis.fetch = async (u, init = {}) => {
  const path = String(u), method = init.method || 'GET';
  if (method !== 'GET') {
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, device: { id: 'new', name: 'x', role: 'wall_tablet', room: null } }) };
  }
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const panel = { render() {}, status() {}, go() {}, shadowRoot: null };
let route = null;
async function draw() {                       // a draw asks the server; the next has its answer
  let kids = [];
  for (let i = 0; i < 3; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    m.host.page(route, panel).body(c);
    kids = c.kids;
    await tick(); await tick();
  }
  return kids;
}
const rowsOf = (groups) => groups.flatMap((g) => g.rows || []);
const find = (groups, label) => rowsOf(groups).find((r) => r.label === label);
async function open(me, path) { m._reset(me); route = path; return draw(); }
const out = {};

// an Owner enrols this browser as HK's Living Room tablet
let g = await open(JSON.parse(process.argv[4]), ['mantel', 'devices', 'enroll']);
out.owner_first = g;
find(g, 'Living Room').onClick(true);
g = await draw();
out.owner_picked = g;
await find(g, 'Make This a Wall Tablet').onClick();
// none of them: a room from HA's areas
g = await open(JSON.parse(process.argv[4]), ['mantel', 'devices', 'enroll']);
await find(g, 'Make This a Wall Tablet').onClick();        // nothing chosen: refused on the page, nothing sent
out.unchosen = await draw();
find(out.unchosen, 'A New Tablet').onClick(true);
g = await draw();
out.other = g;
find(g, 'Room').onChange('garage');
find(g, 'Name').onCommit('Garage Tablet');
g = await draw();
await find(g, 'Make This a Wall Tablet').onClick();
// a Wall Tablet account starts from its own HK tablet
out.account = await open(JSON.parse(process.argv[5]), ['mantel', 'me', 'enroll']);
// Wall Tablets (HK's page, Mantel's groups on it): the lost tablet is called out; its page moves it in place
async function ext(me, where, ctx) {
  m._reset(me);
  let kids = [];
  for (let i = 0; i < 3; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    m.host.extend(where, c, ctx, panel);
    kids = c.kids;
    await tick(); await tick();
  }
  return kids;
}
out.devices = await ext(JSON.parse(process.argv[4]), 'tablets', { tablets: {} });
out.kitchen = await ext(JSON.parse(process.argv[4]), 'tablet', { tablet: 'kitchen', name: 'Kitchen', app: 'fully' });
out.master = await ext(JSON.parse(process.argv[4]), 'tablet', { tablet: 'master', name: 'Master Bedroom', app: 'fully' });
out.old = m.host.forward('mantel/devices');
g = await open(JSON.parse(process.argv[4]), ['mantel', 'devices', 'lost1']);
out.device_first = g;
find(g, 'Living Room').onClick(true);
g = await draw();
out.device_picked = g;
await find(g, 'Save').onClick();
out.sent = sent;
process.stdout.write(JSON.stringify(out));
"""


def overview(role, name, sections):
    return {"user": {"id": "u1", "name": name, "username": role, "role": role, "kind": "mantel", "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [],
            "device_roles": ["wall_tablet", "guest"], "actions": [], "resource_kinds": [], "features": [],
            "service_scopes": [], "connect_port": None, "ha_set_up": True}


TABLETS = {"kitchen": {"name": "Kitchen", "room": "kitchen", "screen": "dashboard-kitchen", "screen_title": "Kitchen"},
           "living": {"name": "Living Room", "room": "living_room", "screen": "dashboard-living", "screen_title": None},
           "master": {"name": "Master Bedroom", "room": "master_bedroom", "screen": "dashboard-master", "screen_title": "Bedroom"}}
AREAS = [{"id": "garage", "name": "Garage"}, {"id": "kitchen", "name": "Kitchen"},
         {"id": "living_room", "name": "Living Room"}, {"id": "master_bedroom", "name": "Master Bedroom"}]
DEVICES = [
    {"id": "k1", "name": "Kitchen Tablet", "role": "wall_tablet", "room": "kitchen", "hk_tablets": ["kitchen"],
     "last_seen": 0, "created": 0, "source_ip": None, "revoked": None},
    {"id": "lost1", "name": "Livingroom", "role": "wall_tablet", "room": "livingroom", "hk_tablets": [],
     "last_seen": 0, "created": 0, "source_ip": None, "revoked": None},
    {"id": "old1", "name": "Old Hall", "role": "wall_tablet", "room": "hall", "hk_tablets": [],
     "last_seen": 0, "created": 0, "source_ip": None, "revoked": 1000, "revoked_reason": "revoked"},
]
HA_USERS = {"ok": True, "people": [], "devices": [{"id": "k1", "name": "Kitchen Tablet"}], "error": None, "users": [
    {"id": "a" * 32, "name": "Fictional Owner", "admin": True, "person": {"id": "u1", "role": "owner", "kind": "mantel"}, "tablet": None},
    {"id": "b" * 32, "name": "kitchentablet", "admin": False, "tablet": None,
     "person": {"id": "u9", "name": "kitchentablet", "role": "wall_tablet", "kind": "mantel"}},
    {"id": "c" * 32, "name": "mqtt", "admin": False, "person": None, "tablet": None}]}


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-devices")
    copy_shim(d)
    (d / "script.mjs").write_text(SCRIPT)
    rooms = {"ok": True, "areas": AREAS, "tablets": {
        tid: {**t, "served_by": [{"id": "k1", "name": "Kitchen Tablet"}] if tid == "kitchen" else []} for tid, t in TABLETS.items()}}
    reads = {"/api/devices/rooms": rooms,
             "/api/devices": {"ok": True, "devices": DEVICES, "tablets": TABLETS},
             "/api/default-screens": {"ok": True, "users": {}, "devices": {}, "screens": [], "house": "dashboard-kitchen"},
             "/api/people/ha": HA_USERS}
    (d / "reads.json").write_text(json.dumps(reads))
    owner = overview("owner", "Fictional Owner", ["me", "people", "devices"])
    account = overview("wall_tablet", "Master Bedroom", ["me"])
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "reads.json"),
                          json.dumps(owner), json.dumps(account)], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def rows(groups):
    return [r for g in groups for r in g.get("rows") or []]


def row(groups, label):
    [r] = [r for r in rows(groups) if r["label"] == label]
    return r


def test_the_dialog_lists_hks_tablets_and_marks_the_ones_in_use(got):
    [pick] = [g for g in got["owner_first"] if g.get("header") == "Which HK Tablet"]
    assert [(r["kind"], r["label"]) for r in pick["rows"]] == [
        ("check", "Kitchen"), ("check", "Living Room"), ("check", "Master Bedroom"), ("check", "A New Tablet")]
    kitchen = row(got["owner_first"], "Kitchen")
    assert kitchen["value"] == "In Use" and "Already “Kitchen Tablet”" in kitchen["sub"]
    assert row(got["owner_first"], "Master Bedroom")["sub"] == "Master Bedroom · Bedroom"        # its room · its screen
    assert row(got["owner_first"], "Living Room").get("value") is None
    # the room is never typed: the only text field is the name
    assert [r["label"] for r in rows(got["owner_first"]) if r["kind"] == "text"] == ["Name"]


def test_picking_a_tablet_names_the_device_and_enrols_it_with_that_tablet(got):
    assert row(got["owner_picked"], "Living Room")["on"] is True
    assert [r["label"] for r in rows(got["owner_picked"]) if r["kind"] == "check" and r["on"]] == ["Living Room"]
    assert next(r for r in rows(got["owner_picked"]) if r["kind"] == "text")["label"] == "Name"
    enrol = [s for s in got["sent"] if s["path"].endswith("/api/devices/enroll")]
    assert enrol[0] == {"method": "POST", "path": "/api/devices/enroll",
                        "body": {"name": "Living Room", "role": "wall_tablet", "tablet": "living"}}


def test_nothing_chosen_sends_nothing_and_a_new_tablet_offers_has_areas(got):
    assert {"_text": "Choose its HK tablet, or A New Tablet and its room."} in got["unchosen"]
    room = row(got["other"], "Room")
    assert room["kind"] == "select" and [o[0] for o in room["options"]] == ["", "garage", "kitchen", "living_room", "master_bedroom"]
    enrol = [s for s in got["sent"] if s["path"].endswith("/api/devices/enroll")]
    assert len(enrol) == 2                                       # the unchosen press sent nothing
    # an Owner's new room gets its HK tablet made with the device (devices.enroll new_tablet)
    assert enrol[1]["body"] == {"name": "Garage Tablet", "role": "wall_tablet", "room": "garage", "new_tablet": True}
    assert "Mantel adds an HK wall tablet in this room" in next(g for g in got["other"] if g.get("rows") and g["rows"][0]["label"] == "Room")["footer"]


def test_a_wall_tablet_account_starts_from_its_own_hk_tablet(got):
    assert [r["label"] for r in rows(got["account"]) if r["kind"] == "check" and r["on"]] == ["Master Bedroom"]


def test_wall_tablets_calls_out_a_device_whose_room_has_no_hk_tablet(got):
    groups = {g["header"]: g for g in got["devices"]}
    lost = groups["Signed In to Mantel, Not on a Tablet"]
    assert [(r["kind"], r["label"], r["value"]) for r in lost["rows"]] == [("nav", "Livingroom", "Choose Tablet")]
    assert "their touches and black screen don’t reach Mantel" in lost["footer"]
    gone = groups["Signed Out"]
    assert [r["label"] for r in gone["rows"]] == ["Old Hall", "Clear List"] and "30 days" in gone["footer"]
    assert got["old"] == "house/tablets", "#/mantel/devices forwards to All Screens, Wall Tablets"


def test_a_tablets_page_has_what_mantel_has_of_it(got):
    [mantel] = [g for g in got["kitchen"] if g.get("header") == "Mantel"]
    labels = [r["label"] for r in mantel["rows"]]
    assert labels == ["Signed In to Mantel", "Home Assistant User", "Pair a Tablet App…", "Sign Out This Tablet…"]
    assert row(got["kitchen"], "Signed In to Mantel")["value"] == "Kitchen Tablet"
    ha = row(got["kitchen"], "Home Assistant User")
    # a free HA user, or one linked to a Wall Tablet account; never a person's or an admin
    assert [o[1] for o in ha["options"]] == ["None", "kitchentablet (now a Wall Tablet account)", "mqtt"]
    # a tablet no browser is signed in as yet offers to sign this one in, for that tablet
    nobody = row(got["master"], "Signed In to Mantel")
    assert nobody["value"] == "Not Yet"
    assert row(got["master"], "Sign In This Browser as Master Bedroom…")["href"] == "#/mantel/devices/enroll/master"
    # ...or to pair a tablet app with a one-time code, from anywhere (docs/phase26/ANDROID-APP.md)
    assert row(got["master"], "Pair a Tablet App…")["kind"] == "button"


def test_a_devices_page_moves_it_to_a_tablet_in_place(got):
    now = row(got["device_first"], "Room")
    assert now["value"] == "Livingroom" and now["valueCls"] == "warn"
    assert [r["label"] for r in rows(got["device_first"]) if r["kind"] == "check" and r["on"]] == []
    assert row(got["device_first"], "Save")["disabled"] is True                  # nothing chosen yet
    assert row(got["device_picked"], "Save")["disabled"] is False
    [move] = [s for s in got["sent"] if s["method"] == "PATCH"]
    assert move == {"method": "PATCH", "path": "/api/devices/lost1", "body": {"tablet": "living"}}
