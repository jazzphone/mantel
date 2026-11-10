"""Mantel Settings → Timeline (web/shim/settings/timeline.js; docs/phase19/HOUSE-TIMELINE.md "Mantel Settings → Timeline") and Me's
Timeline switches (settings/me.js: Keep My Arrivals Private, Morning Summary, Clear My Arrivals).

* The page parses, is registered beside Alerts (section "timeline", which admin_page.sections_for gives Owners and
  Admins), and an Owner changes what an Admin only reads (controls disabled, the note under them, no Clear Timeline).
* Its pure helpers (the families' words, the override map built from a toggle, the retention and budget choices, the
  usage line, the typed word for Clear Timeline) are run as they are, and the page is run in node with a recording stub
  for the kit (no DOM) and a stub for the server, as the other settings tests do.
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
PAGE = (SHIM / "settings" / "timeline.js").read_text(encoding="utf-8")
ME = (SHIM / "settings" / "me.js").read_text(encoding="utf-8")
NODE = shutil.which("node")

FAMILIES = ["door", "window", "lock", "garage", "alarm", "arrival", "doorbell", "detection", "motion", "safety", "system", "refused"]


def overview(role, sections):
    return {"user": {"id": "u1", "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None, "ha_set_up": True}


def page_json(edit=True, fresh=False):
    fams = {f: f != "window" for f in FAMILIES}
    return {"ok": True, "families": fams, "overrides": {"binary_sensor.shed_door": {"record": False}, "binary_sensor.old_contact": {"record": False, "label": "Old Contact"}},
            "retention_days": 30, "retentions": [7, 30, 90, 365], "pictures": {"budget_mb": 500, "frames": 2}, "frames": [1, 2, 3],
            "budgets_mb": [100, 250, 500, 1000, 2000],
            "wall": {"families": ["door", "lock"], "pictures": ["t1"]},
            "wall_families": ["door", "lock", "garage", "alarm", "doorbell", "detection"],
            "digest": {"at": "07:00", "from": "21:00"},
            "members": [{"entity": "lock.front", "family": "lock", "label": "Front Door", "area": "hall"},
                        {"entity": "binary_sensor.back_door", "family": "door", "label": "Back Door", "area": "kitchen"},
                        {"entity": "binary_sensor.side_door", "family": "door", "label": "Side Door", "area": None},
                        {"entity": "cover.garage", "family": "garage", "label": "Garage", "area": "garage"}],
            "candidates": [{"entity": "binary_sensor.mud_room", "name": "Mud Room Contact", "area": None},
                           {"entity": "binary_sensor.gate", "name": "Gate Sensor", "area": None}],
            "usage": {"kept": 4210, "bytes": 312 * 1048576, "budget_bytes": 500 * 1048576, "taken": 5000, "failed": 2, "skipped": 7},
            "rows": 12430, "tablets": [{"id": "t1", "name": "Kitchen Tablet"}, {"id": "t2", "name": "Hall Tablet"}],
            "can_edit": edit, "needs_fresh": fresh}


SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const rec = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, on: o.on, disabled: !!o.disabled, valueCls: o.valueCls,
                                options: o.options, type: o.type, href: o.href, onClick: o.onClick, onChange: o.onChange, onCommit: o.onCommit,
                                classList: { add() {} }, insertBefore() {}, firstChild: null });
const asked = [];
const answer = { value: true };
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: rec('info'), toggle: rec('toggle'), text: rec('text'), select: rec('select'), nav: rec('nav'), button: rec('button'), check: rec('check'),
  h: (tag, attrs) => ({ kind: 'h', _text: (attrs && attrs.text) || '' }), confirm: async (root, o) => { asked.push(o); return answer.value; },
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
const t = await import(process.argv[2].replace('mantel-settings.mjs', 'settings/timeline.mjs'));
const core = await import(process.argv[2].replace('mantel-settings.mjs', 'settings/core.mjs'));
const tick = () => new Promise((r) => setTimeout(r, 0));
async function draw(me, parts) {
  m._reset(me);
  const panel = { render() {}, status() {}, shadowRoot: null };
  const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
  let pg;
  for (let i = 0; i < 3; i++) { c.kids = []; pg = m.host.page(parts, panel); pg.body(c); await tick(); await tick(); }
  return { pg, kids: c.kids };
}
const rows = (kids) => kids.flatMap((g) => g.rows || []);
const find = (kids, label, kind) => rows(kids).find((r) => r.label === label && (!kind || r.kind === kind));
const puts = () => calls.filter((c) => c[0] === 'PUT' || c[0] === 'DELETE' || c[0] === 'POST');
const owner = script.owner, admin = script.admin, adult = script.adult;
const out = {};

// the pure helpers
out.pure = {
  names: t.FAMILIES.map(([id, name]) => [id, name]), unknown: t.familyName('some_new_kind'),
  retention: [7, 30, 90, 365].map(t.retentionLabel), budgets: [100, 250, 500, 1000, 2000].map(t.budgetLabel), frames: [1, 2, 3].map(t.framesLabel),
  usage: t.usageText(script.page.usage, 500), usageNone: t.usageText(null, 500), usageEmpty: t.usageText({ kept: 1, bytes: 0, budget_bytes: 100 * 1048576 }, 100),
  clock: ['07:00', '21:00', '00:30', '12:05', '13:00'].map(t.clockText), valid: ['07:00', '24:00', '7:00', '12:60', ''].map(t.clockValid),
  toggled: [t.toggled(['a', 'b'], 'c', true), t.toggled(['a', 'b'], 'a', false), t.toggled(['a'], 'a', true), t.toggled(undefined, 'a', true)],
  stop: t.stopRecording({ 'x.y': { record: true, family: 'door', label: 'Gate' }, 'a.b': { record: false } }, 'x.y'),
  stopNew: t.stopRecording(undefined, 'binary_sensor.a'),
  as: t.recordAs({ 'a.b': { record: false } }, 'x.y', 'window'), again: t.recordAgain({ 'a.b': { record: false }, 'x.y': { record: true } }, 'a.b'),
  choose: [t.choose({}, 'x.y', 'door'), t.choose({ 'x.y': { record: true, family: 'door' } }, 'x.y', '')],
  grouped: t.byFamily(script.page.members).map(([f, l]) => [f, l.map((x) => x.label)]),
  off: t.turnedOff(script.page), offNamed: t.turnedOff({ candidates: [{ entity: 'binary_sensor.shed_door' }], overrides: script.page.overrides }),
  value: [t.candidateValue({ overrides: { 'x.y': { record: true, family: 'window' } } }, 'x.y'), t.candidateValue({ overrides: { 'x.y': { record: false } } }, 'x.y'), t.candidateValue({}, 'x.y')],
  clear: ['CLEAR', 'clear', 'CLEAR ', ' CLEAR', 'CLEA', 'CLEAR CLEAR', '', null, 'Clear'].map(t.clearConfirmed),
  arrivals: [1, 12, 1204].map(t.arrivalsWord),
};
// the pure helpers don't change what they were given
const was = JSON.stringify(script.page.overrides);
t.stopRecording(script.page.overrides, 'lock.front'); t.recordAs(script.page.overrides, 'a.b', 'door'); t.recordAgain(script.page.overrides, 'binary_sensor.shed_door');
out.pure.untouched = JSON.stringify(script.page.overrides) === was;

// the sidebar and the addresses
out.sidebar = {};
for (const [name, me] of [['owner', owner], ['admin', admin], ['adult', adult]]) {
  m._reset(me);
  out.sidebar[name] = { routes: m.host.groups().flatMap((g) => g.rows.map((r) => r.route)), search: m.host.search().map((r) => r.route),
                        forward: m.host.forward('timeline'), titles: {} };
  for (const sub of [[], ['recorded'], ['not-recorded']]) out.sidebar[name].titles[sub.join('/') || 'timeline'] = m.host.page(['mantel', 'timeline', ...sub], null).title;
}

// the main page, for an Owner
const main = await draw(owner, ['mantel', 'timeline']);
out.main = { scope: main.pg.scope, top: main.pg.top,
             groups: main.kids.map((g) => ({ header: g.header, footer: g.footer, rows: g.rows.map((r) => [r.kind, r.label, r.sub, r.value, r.on, r.disabled, r.href]) })) };
out.main.selects = Object.fromEntries(rows(main.kids).filter((r) => r.kind === 'select').map((r) => [r.label, r.options]));
const sw = (label) => find(main.kids, label, 'toggle');
await sw('Windows').onChange(true);
await tick();
out.familyPut = puts().slice();
calls.length = 0;
await find(main.kids, 'Keep Rows For', 'select').onChange('90');
await find(main.kids, 'Picture Budget', 'select').onChange('1000');
await find(main.kids, 'Pictures per Detection', 'select').onChange('3');
await tick();
out.settingsPuts = puts().map((c) => c[2]);
calls.length = 0;
// the wall tablets: the families it shows, and Show Pictures for the one tablet that has none
const wall = rows(main.kids).filter((r) => r.kind === 'toggle' && ['Garage', 'Alarm'].includes(r.label));
await wall[wall.length - 1].onChange(true);        // (Garage and Alarm appear in the families first, then in the wall tablets: the last of each is the tablet's)
await find(main.kids, 'Hall Tablet', 'toggle').onChange(true);
await find(main.kids, 'Kitchen Tablet', 'toggle').onChange(false);
await tick();
out.wallPuts = puts().map((c) => c[2]);
calls.length = 0;
// the Morning Summary: a time typed, a bad one ignored, Send Test
const at = find(main.kids, 'Sent At', 'text'), from = find(main.kids, 'Covers From', 'text');
out.digestFields = [at.type, at.value, from.value];
await at.onCommit('06:30');
await from.onCommit('25:99');
await from.onCommit('20:15');
await tick();
out.digestPuts = puts().map((c) => c[2]);
calls.length = 0;
script.reads['POST /api/timeline/digest/test'] = { sent: 0 };
await find(main.kids, 'Send Test', 'button').onClick();
out.testNone = { flash: core.ui.flash, calls: puts().map((c) => c[1]) };
script.reads['POST /api/timeline/digest/test'] = { sent: 2 };
await find(main.kids, 'Send Test', 'button').onClick();
out.testSent = core.ui.flash;
calls.length = 0;
out.clearButton = (() => { const b = find(main.kids, 'Clear Timeline…', 'button'); return b ? { destructive: true } : null; })();

// a refused change is put back (the page is drawn again from what it held) and says why
calls.length = 0;
// (the step-up dialog needs a DOM: a plain 400 stands in for any refusal)
script.reads['PUT /api/timeline/settings'] = { status: 400, body: { error: 'invalid_retention' } };
await find(main.kids, 'Keep Rows For', 'select').onChange('7');
await tick();
out.refused = core.ui.flash;
script.reads['PUT /api/timeline/settings'] = script.page;

// Recorded Entities: one switched off
const rec1 = await draw(owner, ['mantel', 'timeline', 'recorded']);
out.recorded = { title: rec1.pg.title, back: rec1.pg.back, groups: rec1.kids.map((g) => [g.header, g.rows.map((r) => [r.label, r.on])]), footer: rec1.kids[rec1.kids.length - 1].footer };
calls.length = 0;
await find(rec1.kids, 'Back Door', 'toggle').onChange(false);
await find(rec1.kids, 'Garage', 'toggle').onChange(true);        // (turning one on does nothing: it already is)
await tick();
out.recordedPut = puts().map((c) => [c[0], c[1], c[2]]);

// Not Recorded: the candidates' choices, and one turned off by hand
const nr = await draw(owner, ['mantel', 'timeline', 'not-recorded']);
out.notRecorded = { title: nr.pg.title, groups: nr.kids.map((g) => [g.header, g.rows.map((r) => [r.kind, r.label, r.sub, r.value, r.on])]),
                    options: find(nr.kids, 'Gate Sensor', 'select').options };
calls.length = 0;
await find(nr.kids, 'Gate Sensor', 'select').onChange('door');
await find(nr.kids, 'Shed Door', 'toggle').onChange(true);
await find(nr.kids, 'Old Contact', 'toggle').onChange(false);        // (off stays off)
await tick();
out.notRecordedPuts = puts().map((c) => c[2]);

// an Admin reads
script.reads['GET /api/timeline/settings'] = script.readonly;
const ro = await draw(admin, ['mantel', 'timeline']);
out.readOnly = { groups: ro.kids.map((g) => [g.header, g.footer, g.rows.map((r) => [r.kind, r.label, r.value, r.disabled])]), labels: rows(ro.kids).map((r) => r.label) };
const roRec = await draw(admin, ['mantel', 'timeline', 'recorded']);
out.readOnlyRecorded = rows(roRec.kids).every((r) => r.disabled);
const roNr = await draw(admin, ['mantel', 'timeline', 'not-recorded']);
out.readOnlyNotRecorded = rows(roNr.kids).filter((r) => r.kind !== 'info').every((r) => r.disabled);
script.reads['GET /api/timeline/settings'] = script.page;
// an Owner away: told what will be asked
script.reads['GET /api/timeline/settings'] = script.fresh;
const away = await draw(owner, ['mantel', 'timeline']);
out.away = away.kids[0].footer;
script.reads['GET /api/timeline/settings'] = script.page;
// no pictures kept at all (usage null) and no tablets
script.reads['GET /api/timeline/settings'] = { ...script.page, usage: null, tablets: [], members: [], candidates: [], overrides: {} };
const bare = await draw(owner, ['mantel', 'timeline']);
out.bare = { labels: rows(bare.kids).map((r) => r.label), footers: bare.kids.map((g) => g.footer) };
const bareRec = await draw(owner, ['mantel', 'timeline', 'recorded']);
out.bareRecorded = bareRec.kids.map((g) => g.footer);
const bareNr = await draw(owner, ['mantel', 'timeline', 'not-recorded']);
out.bareNotRecorded = bareNr.kids.map((g) => [g.header, g.rows.map((r) => r.label)]);
script.reads['GET /api/timeline/settings'] = script.page;

// Me
out.me = {};
for (const [name, me] of [['owner', owner], ['admin', admin], ['adult', adult], ['child', script.child], ['wall', script.wall]]) {
  const mine = await draw(me, ['mantel', 'me']);
  const g = mine.kids.find((x) => x.header === 'Timeline');
  out.me[name] = g ? { footer: g.footer, rows: g.rows.map((r) => [r.kind, r.label, r.sub, r.value, r.on, r.disabled]) } : null;
}
const mine = await draw(adult, ['mantel', 'me']);
calls.length = 0;
// turning Keep My Arrivals Private on asks first, with the count; no deletes the switch's change
answer.value = false; asked.length = 0;
await find(mine.kids, 'Keep My Arrivals Private', 'toggle').onChange(true);
await tick();
out.privateNo = { asked: asked.map((a) => [a.title, a.message, a.ok, a.destructive]), puts: puts().length };
answer.value = true; asked.length = 0;
await find(mine.kids, 'Keep My Arrivals Private', 'toggle').onChange(true);
await tick();
out.privateYes = { asked: asked.length, puts: puts().map((c) => [c[0], c[1], c[2]]) };
calls.length = 0; asked.length = 0;
await find(mine.kids, 'Keep My Arrivals Private', 'toggle').onChange(false);      // off asks nothing
await find(mine.kids, 'Morning Summary', 'toggle').onChange(true);
await tick();
out.switches = { asked: asked.length, puts: puts().map((c) => [c[0], c[1], c[2]]) };
// with nothing recorded there is nothing to delete, so turning it on asks nothing
script.reads['GET /api/timeline/me'] = { private: false, summary: false, may_private: true, arrivals: 0, tz: 'America/Chicago' };
const none = await draw(adult, ['mantel', 'me']);
asked.length = 0; calls.length = 0;
await find(none.kids, 'Keep My Arrivals Private', 'toggle').onChange(true);
await tick();
out.privateNone = { asked: asked.length, puts: puts().map((c) => c[2]), clearDisabled: find(none.kids, 'Clear My Arrivals…', 'button').disabled };
script.reads['GET /api/timeline/me'] = script.mine;
// Clear My Arrivals asks first, then deletes
const again = await draw(adult, ['mantel', 'me']);
calls.length = 0; asked.length = 0; answer.value = false;
await find(again.kids, 'Clear My Arrivals…', 'button').onClick();
out.clearNo = { asked: asked.map((a) => [a.title, a.message, a.ok, a.destructive]), puts: puts().length };
answer.value = true; asked.length = 0;
await find(again.kids, 'Clear My Arrivals…', 'button').onClick();
await tick();
out.clearYes = { asked: asked.length, puts: puts().map((c) => [c[0], c[1]]), flash: core.ui.flash };
// someone who may not hide theirs (the Owner decides for a Child) has no switch
script.reads['GET /api/timeline/me'] = { private: false, summary: true, may_private: false, arrivals: 3, tz: null };
const kid = await draw(adult, ['mantel', 'me']);
const kg = kid.kids.find((x) => x.header === 'Timeline');
out.noPrivate = { labels: kg.rows.map((r) => r.label), footer: kg.footer };
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    if NODE is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("timeline-settings")
    copy_shim(d)
    sections = ["me", "connections", "people", "backups", "alerts", "timeline"]
    mine = {"private": False, "summary": False, "may_private": True, "arrivals": 12, "tz": "America/Chicago"}
    reads = {
        "GET /api/timeline/settings": page_json(),
        "PUT /api/timeline/settings": page_json(),
        "PUT /api/timeline/overrides": page_json(),
        "GET /api/timeline/me": mine,
        "PUT /api/timeline/me": mine,
        "DELETE /api/timeline/mine/presence": {"deleted": 12},
        "GET /api/alerts/me": {"system_alerts": True, "eligible": True},
    }
    (d / "script.mjs").write_text(SCRIPT)
    (d / "script.json").write_text(json.dumps({
        "reads": reads, "page": page_json(), "readonly": page_json(edit=False), "fresh": page_json(fresh=True), "mine": mine,
        "owner": overview("owner", sections), "admin": overview("admin", sections),
        "adult": overview("adult", ["me"]), "child": overview("child", ["me"]), "wall": overview("wall_tablet", ["me"])}))
    got = subprocess.run([NODE, str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "script.json")],
                         capture_output=True, text=True, timeout=90)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_timeline_page_and_the_files_it_changes_parse(tmp_path):
    entry = copy_shim(tmp_path)
    for rel in ("settings/timeline.mjs", "settings/me.mjs", entry.name):
        out = subprocess.run([NODE, "--check", str(tmp_path / rel)], capture_output=True, text=True)
        assert out.returncode == 0, (rel, out.stderr)


# -- the words ---------------------------------------------------------------------------------------------------
def test_each_family_has_its_plain_name_in_the_catalogs_order(run):
    names = dict(run["pure"]["names"])
    assert list(names) == FAMILIES
    assert names == {"door": "Doors", "window": "Windows", "lock": "Locks", "garage": "Garage", "alarm": "Alarm",
                     "arrival": "Arrivals & Departures", "doorbell": "Doorbell", "detection": "Camera Detections",
                     "motion": "Motion", "safety": "Safety", "system": "System", "refused": "Refused Commands"}
    assert run["pure"]["unknown"] == "Some new kind"           # a family the page doesn't know yet still reads


def test_every_family_the_server_can_record_is_a_switch():
    from hk_core.timeline import classify
    assert list(classify.FAMILIES) == FAMILIES                   # a new family needs a name here
    assert classify.WALL_FAMILIES == ("door", "lock", "garage", "alarm", "doorbell", "detection")


def test_retention_budget_and_picture_choices_read_plainly(run):
    p = run["pure"]
    assert p["retention"] == ["7 Days", "30 Days", "90 Days", "1 Year"]
    assert p["budgets"] == ["100 MB", "250 MB", "500 MB", "1 GB", "2 GB"]
    assert p["frames"] == ["1 Picture", "2 Pictures", "3 Pictures"]
    assert p["usage"] == {"value": "312 MB of 500 MB", "sub": "4,210 pictures"}
    assert p["usageNone"] is None and p["usageEmpty"] == {"value": "0 MB of 100 MB", "sub": "1 picture"}
    assert p["clock"] == ["7:00 AM", "9:00 PM", "12:30 AM", "12:05 PM", "1:00 PM"]
    assert p["valid"] == [True, False, False, False, False]
    assert p["arrivals"] == ["1 recorded arrival or departure", "12 recorded arrivals and departures", "1,204 recorded arrivals and departures"]


def test_a_toggle_builds_the_override_map_the_server_takes_and_never_changes_the_old_one(run):
    p = run["pure"]
    assert p["stop"] == {"x.y": {"record": False, "label": "Gate"}, "a.b": {"record": False}}      # off, the name kept, the others alone
    assert p["stopNew"] == {"binary_sensor.a": {"record": False}}
    assert p["as"] == {"a.b": {"record": False}, "x.y": {"record": True, "family": "window"}}
    assert p["again"] == {"x.y": {"record": True}}
    assert p["choose"] == [{"x.y": {"record": True, "family": "door"}}, {}]
    assert p["untouched"] is True
    assert p["toggled"] == [["a", "b", "c"], ["b"], ["a"], ["a"]]
    assert p["value"] == ["window", "", ""]


def test_the_recorded_entities_are_grouped_by_family_and_the_turned_off_ones_found(run):
    p = run["pure"]
    assert p["grouped"] == [["door", ["Back Door", "Side Door"]], ["lock", ["Front Door"]], ["garage", ["Garage"]]]
    assert p["off"] == [{"entity": "binary_sensor.old_contact", "name": "Old Contact"}, {"entity": "binary_sensor.shed_door", "name": "Shed Door"}]
    # one that is also a candidate is shown there, once
    assert p["offNamed"] == [{"entity": "binary_sensor.old_contact", "name": "Old Contact"}]


def test_clear_timeline_needs_the_exact_word(run):
    assert run["pure"]["clear"] == [True, False, True, True, False, False, False, False, False]


# -- the page ----------------------------------------------------------------------------------------------------
def test_timeline_sits_beside_alerts_for_owners_and_admins_only(run):
    for who in ("owner", "admin"):
        s = run["sidebar"][who]
        assert s["routes"].index("mantel/timeline") == s["routes"].index("mantel/alerts") + 1, who
        assert "mantel/timeline" in s["search"] and s["forward"] == "mantel/timeline"
        assert s["titles"] == {"timeline": "Timeline", "recorded": "Recorded Entities", "not-recorded": "Not Recorded"}
    a = run["sidebar"]["adult"]            # an address of a page the role may not use opens Me instead
    assert "mantel/timeline" not in a["routes"] and set(a["titles"].values()) == {"Fictional adult"}


def test_the_main_page_has_the_sections_in_order(run):
    m = run["main"]
    assert m["top"] is True and "doors, locks" in m["scope"]
    assert [g["header"] for g in m["groups"]] == ["What’s Recorded", "Entities", "Retention", "Pictures", "Wall Tablets: What They Show",
                                                   "Wall Tablets: Pictures", "Morning Summary", None]
    recorded = m["groups"][0]
    assert [r[1] for r in recorded["rows"]] == ["Doors", "Windows", "Locks", "Garage", "Alarm", "Arrivals & Departures", "Doorbell",
                                                "Camera Detections", "Motion", "Safety", "System", "Refused Commands"]
    assert {r[1]: r[4] for r in recorded["rows"]}["Windows"] is False and {r[1]: r[4] for r in recorded["rows"]}["Doors"] is True
    assert {r[1]: r[2] for r in recorded["rows"]}["Motion"] == "Cameras without smart detection"
    assert all(r[0] == "toggle" and r[5] is False for r in recorded["rows"])
    ents = m["groups"][1]["rows"]
    assert ents == [["nav", "Recorded Entities", None, "4", None, False, "#/mantel/timeline/recorded"],
                    ["nav", "Not Recorded", None, "4", None, False, "#/mantel/timeline/not-recorded"]]   # 2 sensors to add and 2 turned off by hand


def test_retention_pictures_and_the_usage_line(run):
    m = run["main"]
    assert m["selects"]["Keep Rows For"] == [["7", "7 Days"], ["30", "30 Days"], ["90", "90 Days"], ["365", "1 Year"]]
    assert m["selects"]["Picture Budget"][3] == ["1000", "1 GB"] and m["selects"]["Pictures per Detection"] == [["1", "1 Picture"], ["2", "2 Pictures"], ["3", "3 Pictures"]]
    retention = {r[1]: r for r in m["groups"][2]["rows"]}
    assert retention["Keep Rows For"][3] == "30" and retention["Rows Kept"][3] == "12,430"
    pictures = {r[1]: r for r in m["groups"][3]["rows"]}
    assert pictures["Used"][2:4] == ["4,210 pictures", "312 MB of 500 MB"]
    assert pictures["Picture Budget"][3] == "500" and pictures["Pictures per Detection"][3] == "2"


def test_a_switch_sends_only_what_changed_and_the_server_answers_with_the_page(run):
    assert run["familyPut"] == [["PUT", "/api/timeline/settings", {"families": {"window": True}}]]
    assert run["settingsPuts"] == [{"retention_days": 90}, {"pictures": {"budget_mb": 1000}}, {"pictures": {"frames": 3}}]


def test_wall_tablets_choose_the_families_and_show_pictures_per_tablet(run):
    wall, pics = run["main"]["groups"][4], run["main"]["groups"][5]
    assert [r[1] for r in wall["rows"]] == ["Doors", "Locks", "Garage", "Alarm", "Doorbell", "Camera Detections"]
    assert [r[4] for r in wall["rows"]] == [True, True, False, False, False, False]
    assert [(r[1], r[2], r[4]) for r in pics["rows"]] == [("Kitchen Tablet", "Show Pictures", True), ("Hall Tablet", "Show Pictures", False)]
    assert run["wallPuts"] == [{"wall": {"families": ["door", "lock", "alarm"]}}, {"wall": {"pictures": ["t1", "t2"]}}, {"wall": {"pictures": []}}]


def test_the_morning_summary_takes_a_time_and_sends_a_test(run):
    assert run["digestFields"] == ["time", "07:00", "21:00"]
    assert run["digestPuts"] == [{"digest": {"at": "06:30"}}, {"digest": {"from": "20:15"}}]        # 25:99 is not a time
    assert run["testNone"]["calls"] == ["/api/timeline/digest/test"]
    assert run["testNone"]["flash"]["err"] is True and "Nothing was sent" in run["testNone"]["flash"]["text"]
    assert run["testSent"] == {"key": "timeline", "text": "Test sent.", "err": False}
    assert run["clearButton"] == {"destructive": True}


def test_a_refused_change_says_why(run):
    assert run["refused"] == {"key": "timeline", "text": "invalid retention", "err": True}


def test_recorded_entities_turn_off_one_by_one(run):
    r = run["recorded"]
    assert r["title"] == "Recorded Entities" and r["back"] == ["Timeline", "#/mantel/timeline"]
    assert r["groups"] == [["Doors", [["Back Door", True], ["Side Door", True]]], ["Locks", [["Front Door", True]]], ["Garage", [["Garage", True]]]]
    assert "Turn it off to stop recording that one" in r["footer"]
    assert run["recordedPut"] == [["PUT", "/api/timeline/overrides", {"overrides": {
        "binary_sensor.shed_door": {"record": False}, "binary_sensor.old_contact": {"record": False, "label": "Old Contact"},
        "binary_sensor.back_door": {"record": False}}}]]                 # the whole map, as the route takes it


def test_not_recorded_lists_sensors_to_add_and_the_ones_turned_off(run):
    n = run["notRecorded"]
    assert n["title"] == "Not Recorded"
    assert [g[0] for g in n["groups"]] == ["Sensors Mantel Doesn’t Recognize", "Turned Off"]
    assert n["groups"][0][1] == [["select", "Mud Room Contact", None, "", None], ["select", "Gate Sensor", None, "", None]]
    assert n["options"] == [["", "Not Recorded"], ["door", "Record as Door"], ["window", "Record as Window"]]
    assert [r[1] for r in n["groups"][1][1]] == ["Old Contact", "Shed Door"] and all(r[4] is False for r in n["groups"][1][1])
    assert run["notRecordedPuts"][0] == {"overrides": {"binary_sensor.shed_door": {"record": False}, "binary_sensor.old_contact": {"record": False, "label": "Old Contact"},
                                                         "binary_sensor.gate": {"record": True, "family": "door"}}}
    assert run["notRecordedPuts"][1] == {"overrides": {"binary_sensor.old_contact": {"record": False, "label": "Old Contact"}}}      # Shed Door is recorded again
    assert len(run["notRecordedPuts"]) == 2                                                                                           # (Old Contact stays off)


def test_an_admin_reads_with_disabled_controls_the_note_and_no_clear_timeline(run):
    r = run["readOnly"]
    controls = [row for g in r["groups"] for row in g[2] if row[0] in ("toggle", "select")]
    assert controls and all(row[3] for row in controls)
    assert "Clear Timeline…" not in r["labels"] and "Send Test" not in r["labels"]
    assert "Only an Owner can change the Timeline." in r["groups"][0][1]
    morning = {row[1]: row for g in r["groups"] if g[0] == "Morning Summary" for row in g[2]}
    assert morning["Sent At"][:3] == ["info", "Sent At", "7:00 AM"] and morning["Covers From"][2] == "9:00 PM"          # read as words, not boxes
    assert run["readOnlyRecorded"] is True and run["readOnlyNotRecorded"] is True


def test_an_owner_from_away_is_told_what_will_be_asked(run):
    assert "confirm it is you first" in run["away"]


def test_a_house_with_nothing_to_show_still_draws(run):
    b = run["bare"]
    assert "Used" not in b["labels"] and "No wall tablets" in b["labels"]
    assert "Nothing is being recorded yet" in run["bareRecorded"][0]
    assert run["bareNotRecorded"] == [["Sensors Mantel Doesn’t Recognize", ["Nothing to add"]]]


# -- Me ----------------------------------------------------------------------------------------------------------
def test_me_has_a_timeline_group_for_owners_admins_and_adults_only(run):
    me = run["me"]
    assert me["child"] is None and me["wall"] is None
    for who in ("owner", "admin"):
        assert me[who] is not None
    # (adults' overview has "me" only, as the real one does; their Timeline group is not tied to a settings page)
    adult = me["adult"]
    assert [r[1] for r in adult["rows"]] == ["Keep My Arrivals Private", "Morning Summary", "Recorded Arrivals and Departures", "Clear My Arrivals…"]
    rows = {r[1]: r for r in adult["rows"]}
    assert rows["Morning Summary"][2] == "A summary of the night on your Mantel apps at 7:00 AM"
    assert rows["Recorded Arrivals and Departures"][3] == "12" and rows["Clear My Arrivals…"][5] is False
    assert "Doors, locks and cameras are about the house and are still recorded." in adult["footer"]


def test_keep_my_arrivals_private_asks_first_with_the_count_and_off_asks_nothing(run):
    no = run["privateNo"]
    assert no["asked"] == [["Keep Your Arrivals Private?", "Turn on and delete your 12 recorded arrivals and departures?", "Turn On and Delete", True]]
    assert no["puts"] == 0                      # "Cancel": nothing is sent
    yes = run["privateYes"]
    assert yes["asked"] == 1 and yes["puts"] == [["PUT", "/api/timeline/me", {"private": True}]]
    assert run["switches"]["asked"] == 0
    assert run["switches"]["puts"] == [["PUT", "/api/timeline/me", {"private": False}], ["PUT", "/api/timeline/me", {"summary": True}]]
    none = run["privateNone"]
    assert none["asked"] == 0 and none["puts"] == [{"private": True}] and none["clearDisabled"] is True     # nothing to delete, nothing to ask


def test_clear_my_arrivals_asks_first_then_deletes_and_says_how_many(run):
    assert run["clearNo"] == {"asked": [["Clear Your Arrivals?", "Delete your 12 recorded arrivals and departures? Nothing else in the Timeline changes.", "Clear", True]], "puts": 0}
    yes = run["clearYes"]
    assert yes["asked"] == 1 and yes["puts"] == [["DELETE", "/api/timeline/mine/presence"]]
    assert yes["flash"] == {"key": "me", "text": "Cleared 12 recorded arrivals and departures."}


def test_a_person_who_may_not_hide_theirs_has_no_switch_for_it(run):
    n = run["noPrivate"]
    assert n["labels"] == ["Morning Summary", "Recorded Arrivals and Departures", "Clear My Arrivals…"]
    assert "Keep My Arrivals Private" not in n["labels"]


# -- the source ---------------------------------------------------------------------------------------------------
def test_clear_timeline_is_a_delete_with_the_confirm_word_after_the_typed_confirmation():
    i = PAGE.index("typedConfirm({ title: 'Clear the Timeline?'")
    assert PAGE.index("'/api/timeline?confirm=clear'") > i                        # nothing is sent before the word is typed
    assert "Type CLEAR to delete every row and picture." in PAGE
    assert PAGE.count("api('DELETE'") == 1


def test_the_page_stores_nothing_in_the_browser_and_draws_no_html_of_its_own():
    for banned in ("localStorage", "sessionStorage", "innerHTML", "console.log", "cache["):
        assert banned not in PAGE, banned


def test_the_page_and_me_are_american_english_and_draw_only_served_glyphs():
    assert not re.search(r"colour|centre|\bgrey\b|favourite", PAGE + ME, re.I)
    names = {n for p in (ROOT / "web/mdi").glob("icons-*.json") for n in json.loads(p.read_text())}
    used = set(re.findall(r"mdi:([a-z0-9-]+)", PAGE))
    assert used and used <= names, sorted(used - names)


def test_the_page_is_listed_with_the_server_section():
    from mantel_server import admin_page
    assert admin_page.SECTIONS.index("timeline") == admin_page.SECTIONS.index("alerts") + 1
    assert "'timeline'" in (SHIM / "mantel-settings.js").read_text(encoding="utf-8")
