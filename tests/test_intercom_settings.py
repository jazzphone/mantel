"""Mantel Settings → Intercom (web/shim/settings/intercom.js; docs/phase17/INTERCOM.md "The address MA uses", "Rooms").

* The page parses, sits in the sidebar after Cameras for the people whose overview lists the section `intercom` (Owners
  and Admins), and an address of it for anyone else opens Me.
* It saves what the spec's REST contract takes (PUT /api/intercom/settings and /rooms/<entity>, POST /check and /test),
  each change at once, and shows the server's words when one is refused.
* The address is warned about as it is typed (a client-side copy of the private-address rule; the server checks again),
  Check Reach says what Music Assistant did, and Live Allowed is drawn only when the house has measured its lag.
* Run in node with a recording stub for the kit (no DOM) and a fake server that keeps the settings document, as the
  other settings tests do. Nothing here touches a network or a speaker.
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
PAGE = (ROOT / "web" / "shim" / "settings" / "intercom.js").read_text(encoding="utf-8")
NODE = shutil.which("node")


def overview(role, sections):
    return {"user": {"id": "u1", "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None, "ha_set_up": True}


def room(entity, name, floor, ma=True):
    return {"room": entity, "name": name, "floor": floor, "ma": ma, "live_fails": 0, "demoted": False}


def room_settings(**kw):
    return {"enabled": False, "live": True, "volume": None, "quiet": None, "listeners": [], "live_fails": 0, "demoted": False, **kw}


ROOMS = [room("media_player.kitchen", "Kitchen", "Downstairs"), room("media_player.office", "Office", "Downstairs"),
         room("media_player.guest_room", "Guest Room", "Upstairs"), room("media_player.den", "Den", "Upstairs", ma=False)]


def settings(**kw):
    s = {"enabled": False, "live_allowed": False, "default_mode": "message", "max_live_s": 60, "max_message_s": 30,
         "chime": {"message": True, "live": False}, "stream_base": "", "lag_ms": None, "max_volume": 70,
         "quiet_default": {"schedule": True, "from": "21:00", "to": "07:00", "while": []},
         "rooms": {"media_player.kitchen": room_settings(enabled=True, volume=40),
                   "media_player.office": room_settings(enabled=True, live=False,
                                                        quiet={"schedule": True, "from": "22:00", "to": "06:30", "while": []}),
                   "media_player.guest_room": room_settings(live_fails=3, demoted=True)}}
    s.update(kw)
    return s


def page_json(**kw):
    return {"settings": settings(**kw), "rooms": ROOMS,
            "tablets": [{"id": "t1", "name": "Hallway Tablet", "room": "media_player.kitchen"}, {"id": "t2", "name": "Den Tablet", "room": None}],
            "suggested_base": "http://10.0.0.5:8767", "stream_port": 8767, "listening": False, "ma": True}


SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const rec = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, on: o.on, valueCls: o.valueCls, placeholder: o.placeholder,
                                options: o.options, type: o.type, href: o.href, disabled: o.disabled, min: o.min, max: o.max, step: o.step, unit: o.unit,
                                onClick: o.onClick, onChange: o.onChange, onCommit: o.onCommit, classList: { add() {} }, insertBefore() {}, firstChild: null });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: rec('info'), toggle: rec('toggle'), text: rec('text'), select: rec('select'), nav: rec('nav'), button: rec('button'), check: rec('check'),
  slider: rec('slider'),
  h: (tag, attrs) => ({ kind: 'h', _text: (attrs && attrs.text) || '', cls: (attrs && attrs.class) || '' }),
  confirm: async (root, o) => { asked.push(o.title); return script.confirm; },
};
const script = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const asked = [];
const calls = [];
// a fake server that keeps the settings document, as the real one does: a PUT merges and answers the whole of it
let live = JSON.parse(JSON.stringify(script.page));
const fresh = (patch) => { live = JSON.parse(JSON.stringify(script.page)); if (patch) patch(live); };
let refuse = null, checkAnswer = { ok: true, message: 'Music Assistant fetched it.' }, testAnswer = { ok: true, message: 'Played a chime in Kitchen.' };
globalThis.fetch = async (u, init = {}) => {
  const method = init.method || 'GET', url = String(u), body = init.body ? JSON.parse(init.body) : null;
  calls.push([method, url, body]);
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)) });
  if (url === '/api/intercom/settings' && method === 'GET') return reply(200, live);
  if (method !== 'GET' && refuse) return reply(refuse.status, refuse.body);
  if (url === '/api/intercom/settings' && method === 'PUT') { Object.assign(live.settings, body); return reply(200, { settings: live.settings }); }
  const m = /^\/api\/intercom\/rooms\/([^/]+)$/.exec(url);
  if (m && method === 'PUT') {
    const id = decodeURIComponent(m[1]);
    const cur = live.settings.rooms[id] = Object.assign({ enabled: false, live: true, volume: null, quiet: null, listeners: [], live_fails: 0, demoted: false }, live.settings.rooms[id]);
    if (body.reset_live) Object.assign(cur, { live_fails: 0, demoted: false }); else Object.assign(cur, body);
    return reply(200, { settings: live.settings });
  }
  if (url === '/api/intercom/check' && method === 'POST') return reply(checkAnswer.status || 200, checkAnswer.body || checkAnswer);
  if (url === '/api/intercom/test' && method === 'POST') return reply(testAnswer.status || 200, testAnswer.body || testAnswer);
  return reply(404, { error: 'not_found' });
};
const m = await import(process.argv[2]);
const core = await import(process.argv[2].replace('mantel-settings.mjs', 'settings/core.mjs'));
const pageMod = await import(process.argv[2].replace('mantel-settings.mjs', 'settings/intercom.mjs'));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const panel = { render() {}, status() {}, shadowRoot: null };
async function draw(me, parts, reset = true) {
  if (reset) m._reset(me);
  let pg, c;
  for (let i = 0; i < 3; i++) { c = { kids: [], appendChild(k) { this.kids.push(k); return k; } }; pg = m.host.page(parts, panel); pg.body(c); await tick(); await tick(); }
  return { pg, kids: c.kids, parts, me };
}
// the page as it is drawn now (after a change): same module state, drawn again
const redraw = async (was) => draw(was.me, was.parts, false);
// the server changed behind the page's back: the page reads it again
const reread = async (was) => { core.forget('intercom'); return draw(was.me, was.parts, false); };
const rows = (kids) => kids.flatMap((g) => g.rows || []);
const find = (kids, label, kind) => rows(kids).find((r) => r.label === label && (!kind || r.kind === kind));
const notes = (kids) => rows(kids).filter((r) => r.kind === 'h').map((r) => [r.cls, r._text]);
const puts = () => calls.filter((c) => c[0] === 'PUT').map((c) => [c[1], c[2]]);
const reset = () => { calls.length = 0; asked.length = 0; };
const out = {};
const owner = script.owner, admin = script.admin, adult = script.adult;

// ---- the sidebar, search and the address, by role
out.sidebar = {};
for (const [name, me] of [['owner', owner], ['admin', admin], ['adult', adult]]) {
  m._reset(me);
  out.sidebar[name] = { routes: m.host.groups().flatMap((g) => g.rows.map((r) => r.route)), search: m.host.search().filter((r) => r.route.endsWith('/intercom')).map((r) => r.label),
                        forward: m.host.forward('intercom'), title: m.host.page(['mantel', 'intercom'], null).title,
                        room: m.host.page(['mantel', 'intercom', 'room', 'media_player.kitchen'], null).title };
}

// ---- the main page, Live not yet proven (lag_ms null)
const main = await draw(owner, ['mantel', 'intercom']);
out.main = { scope: main.pg.scope, top: main.pg.top, groups: main.kids.map((g) => ({ header: g.header, footer: g.footer, rows: g.rows.map((r) => [r.kind, r.label, r.sub, r.value, r.on, r.disabled, r.href]) })) };
out.main.noLive = !find(main.kids, 'Live Allowed');
out.main.modes = find(main.kids, 'Starts As', 'select').options.map((o) => o[0]);
out.main.sliders = rows(main.kids).filter((r) => r.kind === 'slider').map((r) => [r.label, r.min, r.max, r.step, r.unit, r.value]);

// ---- the switches and sliders, each saved at once
reset();
await find(main.kids, 'Intercom', 'toggle').onChange(true);
await find(main.kids, 'Chime Before Live', 'toggle').onChange(true);
await find(main.kids, 'Chime Before a Message', 'toggle').onChange(false);
await find(main.kids, 'Longest Message', 'slider').onChange(45);
await find(main.kids, 'Longest Live Talk', 'slider').onChange(90);
await find(main.kids, 'Volume', 'slider').onChange(50);
await find(main.kids, 'Highest Volume', 'slider').onChange(55);
await find(main.kids, 'Quiet Hours', 'toggle').onChange(false);
await settle();
out.saves = puts();
let after = await redraw(main);
out.quietOff = after.kids.flatMap((g) => g.rows).filter((r) => r.label === 'From' || r.label === 'To').length;

// ---- Live Allowed once the proof is in
fresh((l) => { l.settings.lag_ms = 4500; });
const proven = await draw(owner, ['mantel', 'intercom']);
const la = find(proven.kids, 'Live Allowed', 'toggle');
out.proven = { sub: la.sub, on: la.on, modes: find(proven.kids, 'Starts As', 'select').options.map((o) => o[0]), footer: proven.kids.find((g) => g.header === 'Talking').footer };
reset();
await la.onChange(true);
await settle();
out.proven.put = puts();
const live2 = await redraw(proven);
out.proven.modesAfter = find(live2.kids, 'Starts As', 'select').options.map((o) => o[0]);
reset();
await find(live2.kids, 'Starts As', 'select').onChange('live');
await settle();
out.proven.modePut = puts();

// ---- the address: the rule, in the module
out.rule = {};
for (const a of ['', 'http://10.0.0.5:8767', 'https://10.255.1.1', 'http://172.16.0.9:8767', 'http://172.31.255.1:8767', 'http://172.32.0.1:8767', 'http://172.15.0.1:8767',
                 'http://192.168.1.20:8767', 'http://192.169.1.20:8767', 'http://11.0.0.5:8767', 'http://mantel.local:8767', 'http://box.lan:8767', 'http://box.home.arpa:8767',
                 'http://mantel.example.com:8767', 'http://8.8.8.8', 'ftp://10.0.0.5', 'mantel.local:8767', '10.0.0.5', 'not an address', 'http://notlocal:8767', 'http://evil.local.example.com'])
  out.rule[a] = pageMod.addressProblem(a);

// ---- typing an address: a private one saves, a public one is warned about (and the server's refusal is shown)
fresh();
let addr = await draw(owner, ['mantel', 'intercom']);
reset();
await find(addr.kids, 'Address for Music Assistant', 'text').onCommit(' http://10.0.0.5:8767 ');
await settle();
out.address = { put: puts(), stored: live.settings.stream_base, flash: core.ui.flash };
addr = await redraw(addr);
out.address.value = find(addr.kids, 'Address for Music Assistant', 'text').value;
out.address.notes = notes(addr.kids);
out.address.suggestHidden = !rows(addr.kids).some((r) => String(r.label).startsWith('Use '));
// a public address: warned as typed; the server refuses it and the page says why
refuse = { status: 400, body: { error: 'not_private', message: 'That address is not on your home network.' } };
reset();
await find(addr.kids, 'Address for Music Assistant', 'text').onCommit('https://mantel.example.com:8767');
await settle();
out.public = { stored: live.settings.stream_base, flash: core.ui.flash };
addr = await redraw(addr);
out.public.value = find(addr.kids, 'Address for Music Assistant', 'text').value;
out.public.notes = notes(addr.kids);
refuse = null;
// Check Reach does not pretend it checked what was refused
reset();
await find(addr.kids, 'Check Reach', 'button').onClick();
await settle();
out.public.checkCalls = calls.filter((c) => c[1].endsWith('/check')).length;
out.public.checkNotes = notes(await redraw(addr).then((a) => a.kids));

// ---- the suggestion fills the address in one tap; a blank address is not checked
fresh();
let sug = await draw(owner, ['mantel', 'intercom']);
reset();
await find(sug.kids, 'Check Reach', 'button').onClick();
await settle();
out.blank = { calls: calls.filter((c) => c[1].endsWith('/check')).length, notes: notes((await redraw(sug)).kids) };
sug = await redraw(sug);
reset();
await find(sug.kids, 'Use http://10.0.0.5:8767', 'button').onClick();
await settle();
out.suggest = { put: puts(), stored: live.settings.stream_base };
sug = await redraw(sug);
out.suggest.gone = !rows(sug.kids).some((r) => String(r.label).startsWith('Use '));
out.suggest.field = find(sug.kids, 'Address for Music Assistant', 'text').value;
// no suggestion offered when the server has none
fresh((l) => { l.suggested_base = null; });
out.suggest.noneOffered = !rows((await draw(owner, ['mantel', 'intercom'])).kids).some((r) => String(r.label).startsWith('Use '));

// ---- Check Reach reads the address as last saved, not as the page was drawn: a button drawn before the save still checks it
fresh();
checkAnswer = { ok: true, message: 'Music Assistant fetched it.' };
const stale = await draw(owner, ['mantel', 'intercom']);          // drawn with a blank address
const staleCheck = find(stale.kids, 'Check Reach', 'button');
reset();
await find(stale.kids, 'Use http://10.0.0.5:8767', 'button').onClick();
await settle();
await staleCheck.onClick();                                      // (the old button, not redrawn)
await settle();
out.staleCheck = { posts: calls.filter((c) => c[0] === 'POST').map((c) => c[1]), notes: notes((await redraw(stale)).kids) };

// ---- Check Reach: what Music Assistant did
fresh((l) => { l.settings.stream_base = 'http://10.0.0.5:8767'; });
out.check = {};
for (const [name, answer] of [['ok', { ok: true, message: 'Music Assistant fetched it.' }],
                              ['no', { ok: false, message: 'Music Assistant could not reach this address.' }],
                              ['bare', { ok: false }],
                              ['down', { status: 503, body: { error: 'music_assistant_off', message: 'Music Assistant is not connected.' } }],
                              ['audit', { status: 503, body: { error: 'audit_unavailable' } }]]) {
  checkAnswer = answer;
  const p = await draw(owner, ['mantel', 'intercom']);
  reset();
  await find(p.kids, 'Check Reach', 'button').onClick();
  await settle();
  out.check[name] = { notes: notes((await redraw(p)).kids), post: calls.filter((c) => c[0] === 'POST').map((c) => [c[1], c[2]]) };
}

// ---- the listener row
out.listener = {};
for (const [name, patch] of [['off', { port: 8767, listening: false, enabled: false }], ['up', { port: 8767, listening: true, enabled: true }],
                             ['down', { port: 8767, listening: false, enabled: true }], ['none', { port: 0, listening: false, enabled: true }]]) {
  fresh((l) => { l.stream_port = patch.port; l.listening = patch.listening; l.settings.enabled = patch.enabled; });
  const r = find((await draw(owner, ['mantel', 'intercom'])).kids, 'Listener', 'info');
  out.listener[name] = [r.sub, r.value, r.valueCls];
}

// ---- the rooms list and Enable All
fresh();
let rl = await draw(owner, ['mantel', 'intercom']);
const roomsGroup = rl.kids.find((g) => g.header === 'Rooms');
out.rooms = roomsGroup.rows.map((r) => [r.kind, r.label, r.sub, r.value, r.href, r.disabled]);
reset();
await find(rl.kids, 'Enable All', 'button').onClick();
await settle();
out.enableAll = { asked: asked.slice(), puts: puts(), enabled: Object.fromEntries(Object.entries(live.settings.rooms).map(([k, v]) => [k, v.enabled])) };
rl = await redraw(rl);
out.enableAll.disabledAfter = find(rl.kids, 'Enable All', 'button').disabled;
// declined: nothing is sent
live.settings.rooms['media_player.office'].enabled = false;
rl = await reread(rl);
reset(); script.confirm = false;
await find(rl.kids, 'Enable All', 'button').onClick();
await settle();
out.enableAll.declinedPuts = puts();
script.confirm = true;
// one refused: the rest are not tried, the page says why
refuse = { status: 503, body: { error: 'audit_unavailable' } };
reset();
await find(rl.kids, 'Enable All', 'button').onClick();
await settle();
out.enableAll.refused = { puts: puts().length, flash: core.ui.flash };
refuse = null;
// a house with no rooms
fresh((l) => { l.rooms = []; });
out.noRooms = (await draw(owner, ['mantel', 'intercom'])).kids.find((g) => g.header === 'Rooms').footer;

// ---- one room: Kitchen (on, volume 40, house quiet hours, a tablet listens)
fresh();
const kit = await draw(owner, ['mantel', 'intercom', 'room', 'media_player.kitchen']);
out.kitchen = { title: kit.pg.title, back: kit.pg.back, headers: kit.kids.map((g) => g.header),
                rows: rows(kit.kids).map((r) => [r.kind, r.label, r.on, r.value, r.sub, r.disabled]),
                volume: find(kit.kids, 'Volume', 'select').options, quiet: find(kit.kids, 'Quiet Hours', 'select').value,
                quietFooter: kit.kids.find((g) => /Follows the house/.test(g.footer || '')).footer };
reset();
await find(kit.kids, 'On', 'toggle').onChange(false);
await find(kit.kids, 'Live', 'toggle').onChange(false);
await find(kit.kids, 'Volume', 'select').onChange('60');
await find(kit.kids, 'Volume', 'select').onChange('');
await find(kit.kids, 'Hallway Tablet', 'check').onClick();
await settle();
await find((await redraw(kit)).kids, 'Den Tablet', 'check').onClick();
await settle();
out.kitchen.puts = puts();
// quiet hours: its own, then none, then the house's again
const k2 = await redraw(kit);
reset();
await find(k2.kids, 'Quiet Hours', 'select').onChange('own');
await settle();
out.kitchen.ownPut = puts();
const k3 = await redraw(k2);
out.kitchen.ownRows = rows(k3.kids).filter((r) => r.label === 'From' || r.label === 'To').map((r) => [r.label, r.type, r.value]);
reset();
await find(k3.kids, 'From', 'text').onCommit('20:15');
await find(k3.kids, 'To', 'text').onCommit('bad');
await settle();
out.kitchen.timePuts = puts();
const k4 = await redraw(k3);
await find(k4.kids, 'Quiet Hours', 'select').onChange('none');
await settle();
await find((await redraw(k4)).kids, 'Quiet Hours', 'select').onChange('house');
await settle();
out.kitchen.nonePuts = puts().slice(-2);

// ---- Office: Message only, its own hours, no tablets; Guest Room: demoted; Den: not in Music Assistant
fresh();
const off = await draw(owner, ['mantel', 'intercom', 'room', 'media_player.office']);
out.office = { live: find(off.kids, 'Live', 'toggle').on, quiet: find(off.kids, 'Quiet Hours', 'select').value,
               times: rows(off.kids).filter((r) => r.label === 'From' || r.label === 'To').map((r) => r.value),
               footer: off.kids.find((g) => /only gets Messages/.test(g.footer || '')).footer };
const guest = await draw(owner, ['mantel', 'intercom', 'room', 'media_player.guest_room']);
out.guest = { rows: rows(guest.kids).map((r) => [r.kind, r.label, r.sub, r.value]), on: find(guest.kids, 'On', 'toggle').on, hasLiveSwitch: !!find(guest.kids, 'Live', 'toggle') };
reset();
await find(guest.kids, 'Try Live Again', 'button').onClick();
await settle();
out.guest.put = puts();
const guest2 = await redraw(guest);
out.guest.after = { hasLiveSwitch: !!find(guest2.kids, 'Live', 'toggle'), reset: !find(guest2.kids, 'Try Live Again') };
// the main list says so too
const den = await draw(owner, ['mantel', 'intercom', 'room', 'media_player.den']);
out.den = { headers: den.kids.map((g) => g.footer).filter(Boolean), test: find(den.kids, 'Send Test', 'button').disabled };
const gone = await draw(owner, ['mantel', 'intercom', 'room', 'media_player.attic']);
out.gone = gone.kids.map((g) => g.footer);

// ---- Send Test
fresh();
reset();
const t1 = await draw(owner, ['mantel', 'intercom', 'room', 'media_player.kitchen']);
await find(t1.kids, 'Send Test', 'button').onClick();
await settle();
out.test = { asked: asked.slice(), post: calls.filter((c) => c[0] === 'POST').map((c) => [c[1], c[2]]), notes: notes((await redraw(t1)).kids) };
testAnswer = { ok: false, message: 'Music Assistant could not play it: the speaker is off.' };
reset();
await find(t1.kids, 'Send Test', 'button').onClick();
await settle();
out.test.failed = notes((await redraw(t1)).kids);
testAnswer = { status: 403, body: { error: 'forbidden' } };
await find(t1.kids, 'Send Test', 'button').onClick();
await settle();
out.test.forbidden = notes((await redraw(t1)).kids);
script.confirm = false;
reset();
await find(t1.kids, 'Send Test', 'button').onClick();
await settle();
out.test.declined = calls.length;
script.confirm = true;

// ---- a refused change: the server's words, and the page goes back to what is saved
refuse = { status: 400, body: { error: 'bad_value', message: 'Live talks run 15 to 120 seconds.' } };
fresh();
const bad = await draw(owner, ['mantel', 'intercom']);
await find(bad.kids, 'Longest Live Talk', 'slider').onChange(5);
await settle();
out.refused = { flash: core.ui.flash, value: live.settings.max_live_s, shown: find((await redraw(bad)).kids, 'Longest Live Talk', 'slider').value };
refuse = { status: 503, body: { error: 'audit_unavailable' } };
await find(bad.kids, 'Intercom', 'toggle').onChange(true);
await settle();
out.refused.audit = core.ui.flash;
refuse = null;

// ---- a read that fails
const keep = live;
live = null;
globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom', message: 'The server is having trouble.' }) });
const broke = await draw(owner, ['mantel', 'intercom']);
out.broke = broke.kids.map((g) => g.footer);
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    if NODE is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("intercom-settings")
    copy_shim(d)
    sections = ["me", "connections", "cameras", "people", "intercom", "backups", "alerts"]
    (d / "script.mjs").write_text(SCRIPT)
    (d / "script.json").write_text(json.dumps({
        "page": page_json(), "confirm": True,
        "owner": overview("owner", sections), "admin": overview("admin", sections), "adult": overview("adult", ["me"])}))
    got = subprocess.run([NODE, str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "script.json")],
                         capture_output=True, text=True, timeout=90)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_intercom_page_and_the_entry_that_lists_it_parse(tmp_path):
    entry = copy_shim(tmp_path)
    for rel in ("settings/intercom.mjs", entry.name):
        out = subprocess.run([NODE, "--check", str(tmp_path / rel)], capture_output=True, text=True)
        assert out.returncode == 0, (rel, out.stderr)


def test_intercom_sits_after_cameras_for_owners_and_admins_only(run):
    for who in ("owner", "admin"):
        s = run["sidebar"][who]
        assert s["routes"].index("mantel/intercom") == s["routes"].index("mantel/cameras") + 1, who
        assert s["search"] == ["Intercom"] and s["forward"] == "mantel/intercom"
        assert (s["title"], s["room"]) == ("Intercom", "Room")      # (a room's title is its name once the page is read)
    a = run["sidebar"]["adult"]
    assert "mantel/intercom" not in a["routes"] and a["search"] == []
    assert a["title"] == a["room"] == "Fictional adult"          # an address of a page the role may not use opens Me instead


def test_the_main_page_has_the_switch_the_address_the_rooms_and_the_settings(run):
    m = run["main"]
    assert m["top"] is True and "Music Assistant" in m["scope"]
    assert [g["header"] for g in m["groups"]] == [None, "Music Assistant", "Rooms", "Talking", "Sound", None, "Quiet Hours"]
    flat = {r[1]: r for g in m["groups"] for r in g["rows"] if r[1]}
    assert flat["Intercom"][0] == "toggle" and flat["Intercom"][4] is False
    assert flat["Address for Music Assistant"][0] == "text" and flat["Check Reach"][0] == "button"
    assert "Chime Before a Message" in flat and "Chime Before Live" in flat and flat["Quiet Hours"][4] is True
    assert flat["Listener"][3] == "Off" and flat["Listener"][2] == "Port 8767"


def test_live_allowed_is_drawn_only_when_the_house_has_measured_its_lag(run):
    assert run["main"]["noLive"] is True and run["main"]["modes"] == ["message"]
    assert "one-time test" in next(g["footer"] for g in run["main"]["groups"] if g["header"] == "Talking")
    p = run["proven"]
    assert p["sub"] == "About 4.5 seconds behind" and p["on"] is False
    assert p["modes"] == ["message"]                     # Live is offered as the way a talk starts only once it is allowed
    assert p["put"] == [["/api/intercom/settings", {"live_allowed": True}]]
    assert p["modesAfter"] == ["message", "live"]
    assert p["modePut"] == [["/api/intercom/settings", {"default_mode": "live"}]]
    assert "Live plays as you speak" in p["footer"]


def test_each_change_is_saved_at_once_with_the_bodies_the_routes_take(run):
    assert run["saves"] == [
        ["/api/intercom/settings", {"enabled": True}],
        ["/api/intercom/settings", {"chime": {"message": True, "live": True}}],
        ["/api/intercom/settings", {"chime": {"message": False, "live": True}}],       # (the page's copy follows each answer)
        ["/api/intercom/settings", {"max_message_s": 45}],
        ["/api/intercom/settings", {"max_live_s": 90}],
        ["/api/intercom/settings", {"volume": 50}],
        ["/api/intercom/settings", {"max_volume": 55}],
        ["/api/intercom/settings", {"quiet_default": {"schedule": False, "from": "21:00", "to": "07:00", "while": []}}]]
    assert run["quietOff"] == 0                        # with quiet hours off there are no From and To to set
    assert run["main"]["sliders"] == [["Longest Message", 10, 60, 5, " s", 30], ["Longest Live Talk", 15, 120, 5, " s", 60],
                                      ["Volume", 10, 100, 5, "%", 40], ["Highest Volume", 10, 100, 5, "%", 70]]


def test_the_address_rule_is_the_servers_private_address_rule(run):
    rule = run["rule"]
    for ok in ("", "http://10.0.0.5:8767", "https://10.255.1.1", "http://172.16.0.9:8767", "http://172.31.255.1:8767", "http://192.168.1.20:8767",
               "http://mantel.local:8767", "http://box.lan:8767", "http://box.home.arpa:8767"):
        assert rule[ok] is None, ok
    for bad in ("http://172.32.0.1:8767", "http://172.15.0.1:8767", "http://192.169.1.20:8767", "http://11.0.0.5:8767", "http://mantel.example.com:8767",
                "http://8.8.8.8", "http://notlocal:8767", "http://evil.local.example.com"):
        assert "private address" in rule[bad], bad
    assert "http:// or https://" in rule["ftp://10.0.0.5"]
    for odd in ("not an address", "10.0.0.5", "mantel.local:8767"):
        assert rule[odd], odd                           # not a URL, or a scheme that is not http(s)


def test_a_private_address_is_saved_trimmed_and_a_public_one_is_warned_about_and_refused(run):
    a = run["address"]
    assert a["put"] == [["/api/intercom/settings", {"stream_base": "http://10.0.0.5:8767"}]] and a["stored"] == "http://10.0.0.5:8767"
    assert a["flash"] is None and a["notes"] == [] and a["value"] == "http://10.0.0.5:8767"
    p = run["public"]
    assert p["stored"] == "http://10.0.0.5:8767"                              # the server refused; what was saved stays
    assert p["flash"] == {"key": "intercom", "text": "That address is not on your home network.", "err": True}
    assert p["value"] == "https://mantel.example.com:8767"                    # the box keeps what was typed...
    assert p["notes"] and p["notes"][0][0] == "mxflash err" and "private address" in p["notes"][0][1]       # ...and warns
    assert p["checkCalls"] == 0 and p["checkNotes"][-1] == ["mxflash err", "That address was not saved. Fix it first."]


def test_the_suggested_address_fills_the_box_in_one_tap(run):
    s = run["suggest"]
    assert run["address"]["suggestHidden"] is True            # (not offered when the address is already it)
    assert s["put"] == [["/api/intercom/settings", {"stream_base": "http://10.0.0.5:8767"}]] and s["stored"] == "http://10.0.0.5:8767"
    assert s["gone"] is True and s["field"] == "http://10.0.0.5:8767" and s["noneOffered"] is True


def test_check_reach_says_what_music_assistant_did(run):
    c = run["check"]
    assert c["ok"]["notes"] == [["mxflash", "Music Assistant fetched it."]]
    assert c["ok"]["post"] == [["/api/intercom/check", {}]]
    assert c["no"]["notes"] == [["mxflash err", "Music Assistant could not reach this address."]]
    assert c["bare"]["notes"] == [["mxflash err", "Music Assistant could not reach this address."]]      # (no message from the server)
    assert c["down"]["notes"] == [["mxflash err", "Music Assistant is not connected."]]
    assert c["audit"]["notes"] == [["mxflash err", "The audit log is unavailable, so nothing was changed."]]
    assert run["blank"] == {"calls": 0, "notes": [["mxflash err", "Enter the address first."]]}      # nothing to check, nothing asked


def test_check_reach_uses_the_address_saved_since_the_page_was_drawn(run):
    c = run["staleCheck"]
    assert c["posts"] == ["/api/intercom/check"]
    assert c["notes"] == [["mxflash", "Music Assistant fetched it."]]


def test_the_listener_row_says_whether_music_assistant_has_somewhere_to_go(run):
    li = run["listener"]
    assert li["off"] == ["Port 8767", "Off", ""]
    assert li["up"] == ["Port 8767", "Listening", ""]
    assert li["down"] == ["Port 8767", "Not Listening", "warn"]
    assert li["none"][1] == "Not Set Up" and li["none"][2] == "warn" and "stream port" in li["none"][0]


def test_the_rooms_list_shows_each_room_and_enable_all_turns_on_the_ones_that_are_off(run):
    rows = run["rooms"]
    assert rows[0][:2] == ["button", "Enable All"]
    by = {r[1]: r for r in rows[1:]}
    assert list(by) == ["Kitchen", "Office", "Guest Room", "Den"]
    assert by["Kitchen"][2:5] == ["Downstairs · Live and Message", "On", "#/mantel/intercom/room/media_player.kitchen"]
    assert by["Office"][2:4] == ["Downstairs · Message only", "On"]
    assert by["Guest Room"][2:4] == ["Upstairs", "Off"]
    assert by["Den"][2:4] == ["Upstairs · Not in Music Assistant", "Off"]
    e = run["enableAll"]
    assert e["asked"] == ["Turn on all rooms?"]
    assert [p[0] for p in e["puts"]] == ["/api/intercom/rooms/media_player.guest_room", "/api/intercom/rooms/media_player.den"]    # only those that were off, one at a time
    assert all(p[1] == {"enabled": True} for p in e["puts"])
    assert all(e["enabled"].values()) and e["disabledAfter"] is True
    assert e["declinedPuts"] == []                       # a no on the question sends nothing
    assert e["refused"]["puts"] == 1 and e["refused"]["flash"]["err"] is True       # one refusal stops the rest
    assert "audit log is unavailable" in e["refused"]["flash"]["text"]
    assert "No rooms yet" in run["noRooms"]


def test_a_room_page_has_on_live_volume_quiet_hours_tablets_and_send_test(run):
    k = run["kitchen"]
    assert k["title"] == "Kitchen" and k["back"] == ["Intercom", "#/mantel/intercom"]
    assert k["headers"] == [None, None, None, None, "Tablets", None]
    labels = [r[1] for r in k["rows"]]
    assert labels == ["On", "Live", "Volume", "Quiet Hours", "Hallway Tablet", "Den Tablet", "Send Test"]
    assert k["volume"][0] == ["", "Automatic"] and k["volume"][1] == ["10", "10%"] and k["volume"][-1] == ["100", "100%"]
    assert k["quiet"] == "house" and "21:00 to 07:00" in k["quietFooter"]
    tablets = {r[1]: r for r in k["rows"] if r[0] == "check"}
    assert tablets["Hallway Tablet"][2:5] == [False, None, "Kitchen"] and tablets["Den Tablet"][4] is None


def test_a_room_page_saves_its_own_changes(run):
    k = run["kitchen"]
    room = "/api/intercom/rooms/media_player.kitchen"
    assert k["puts"] == [[room, {"enabled": False}], [room, {"live": False}], [room, {"volume": 60}], [room, {"volume": None}],
                         [room, {"listeners": ["t1"]}], [room, {"listeners": ["t1", "t2"]}]]
    assert k["ownPut"] == [[room, {"quiet": {"schedule": True, "from": "21:00", "to": "07:00", "while": []}}]]       # starts from the house's hours
    assert k["ownRows"] == [["From", "time", "21:00"], ["To", "time", "07:00"]]
    assert k["timePuts"] == [[room, {"quiet": {"schedule": True, "from": "20:15", "to": "07:00", "while": []}}]]        # (a bad time is not sent)
    assert k["nonePuts"] == [[room, {"quiet": {"schedule": False, "from": "20:15", "to": "07:00", "while": []}}], [room, {"quiet": None}]]


def test_a_room_can_be_message_only_and_have_hours_of_its_own(run):
    o = run["office"]
    assert o["live"] is False and o["quiet"] == "own" and o["times"] == ["22:00", "06:30"]
    assert "only gets Messages" in o["footer"] and "Live is also off for the house" in o["footer"]


def test_a_demoted_room_says_so_and_try_live_again_resets_it(run):
    g = run["guest"]
    assert ["info", "Live Paused", "Live didn’t work here three times. Using Message.", "Message Only"] in g["rows"]
    assert g["hasLiveSwitch"] is False and g["on"] is False
    assert g["put"] == [["/api/intercom/rooms/media_player.guest_room", {"reset_live": True}]]
    assert g["after"] == {"hasLiveSwitch": True, "reset": True}


def test_a_speaker_music_assistant_does_not_list_cannot_be_tested(run):
    assert run["den"]["test"] is True and any("does not list this speaker" in f for f in run["den"]["headers"])
    assert run["gone"] == ["That room is no longer here."]


def test_send_test_asks_first_then_says_what_happened(run):
    t = run["test"]
    assert t["asked"] == ["Play a chime in Kitchen?"]
    assert t["post"] == [["/api/intercom/test", {"room": "media_player.kitchen"}]]
    assert t["notes"] == [["mxflash", "Played a chime in Kitchen."]]
    assert t["failed"] == [["mxflash err", "Music Assistant could not play it: the speaker is off."]]
    assert t["forbidden"] == [["mxflash err", "You are not allowed to do that."]]
    assert t["declined"] == 0                              # a no on the question plays nothing


def test_a_refused_change_shows_the_servers_words_and_the_page_keeps_what_is_saved(run):
    r = run["refused"]
    assert r["flash"] == {"key": "intercom", "text": "Live talks run 15 to 120 seconds.", "err": True}
    assert r["value"] == 60 and r["shown"] == 60
    assert r["audit"] == {"key": "intercom", "text": "The audit log is unavailable, so nothing was changed.", "err": True}
    assert run["broke"] == ["The server is having trouble."]


# -- the source ---------------------------------------------------------------------------------------------------
def test_the_page_keeps_its_state_out_of_the_browser_and_draws_only_served_glyphs():
    for banned in ("localStorage", "sessionStorage", "innerHTML", "console.log"):
        assert banned not in PAGE, banned
    names = set(json.loads((ROOT / "web/mdi/icons.json").read_text()))
    used = set(re.findall(r"mdi:([a-z0-9-]+)", (ROOT / "web/shim/mantel-settings.js").read_text() + PAGE))
    assert "microphone" in used and used <= names, sorted(used - names)


def test_the_page_is_american_english_and_names_no_one():
    assert not re.search(r"colour|centre|\bgrey\b|favourite", PAGE, re.I)
    assert not re.search(r"192\.168\.50\.|https?://[a-z0-9.-]*\.[a-z]{2,}", PAGE.replace("http://10.0.0.5:8767", ""), re.I)
