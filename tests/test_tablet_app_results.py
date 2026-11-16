"""A wall tablet's page, Mantel for Android's controls: what a command says when it is done (web/shim/settings/tablet-app.js).

The owner, 2026-11-16: "there appear to be a few bugs on the walltablet page with where and how it posts the last command if
Mantel for Android is being used". Each command's answer came in as a row of its own at the top of Display ("Screen off.",
"Reloading."), which pushed the switches down under the finger, sat far from the Reload button it was about, and followed
you to Advanced and back. Now a control shows its own new state and the bar says it went (Saved, or the command's own
word); a refusal is an alert named by what was tried. The page's rows are the same before and after.

Drawn in node with a recording stub of the settings kit (no DOM), as test_mantel_settings_devices.py does.
"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest
from js_modules import copy_shim

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const row = (kind) => (o) => ({ kind, label: o.label, value: o.value, on: o.on, onClick: o.onClick, onChange: o.onChange,
                                onCommit: o.onCommit, setAttribute() {} });
const alerts = [];
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  slider: row('slider'), check: row('check'), confirm: async (root, o) => { alerts.push(o.title + ': ' + o.message); return true; },
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const sent = [];
globalThis.fetch = async (u, init = {}) => {
  const path = String(u), method = init.method || 'GET';
  if (method !== 'GET') {
    const body = JSON.parse(init.body);
    sent.push(body);
    if (body.command === 'curtain') return { ok: false, status: 502, json: async () => ({ error: 'app_refused', message: 'AirPlay is on the screen.' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, answered: true, status: { ...reads['/api/devices/k1/app'].status, [body.command]: body.value } }) };
  }
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const bar = [];
const panel = { render() {}, status(kind, text) { bar.push(text ? kind + ' ' + text : kind); }, announce() {}, go() {}, shadowRoot: null };
const me = JSON.parse(process.argv[4]);
m._reset(me);
async function page() {               // the tablet's page: Mantel's rows for its groups (hk-settings-rooms.js tabCtx)
  let X = null;
  for (let i = 0; i < 3; i++) {
    X = { tablet: 'hallway', name: 'Hallway', app: 'android_app', room: 'living_room', set() {},
          rows: { place: [], display: [], access: [], reload: [], danger: [] }, status: [], onRoom: [], reload: false };
    m.host.extend('tablet', null, X, panel); await tick(); await tick();
  }
  return { display: X.rows.display.map((r) => r.label), reload: X.rows.reload.map((r) => r.label), find: (l) => X.rows.display.concat(X.rows.reload).find((r) => r.label === l) };
}
const out = {};
let p = await page();
out.before = p;
await p.find('Screen Power').onChange(false);
p = await page();
out.after_screen = p;
await p.find('Reload').onClick();
p = await page();
out.after_reload = p;
await p.find('Black Curtain').onChange(true);
p = await page();
out.after_refused = p;
out.bar = bar; out.alerts = alerts; out.sent = sent;
process.stdout.write(JSON.stringify(out));
"""

STATUS = {"version": "0.1.16", "screen": True, "brightness": 0.6, "curtain": False, "kiosk_mode": True, "keep_awake": True,
          "keep_screen_on": True, "scale": 100, "adaptive_brightness": False, "rotation": "auto", "airplay": False}


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("tablet-app-results")
    copy_shim(d)
    (d / "script.mjs").write_text(SCRIPT)
    device = {"id": "k1", "name": "Hallway Tablet", "role": "wall_tablet", "room": "living_room", "hk_tablets": ["hallway"],
              "last_seen": 0, "created": 0, "source_ip": None, "revoked": None}
    reads = {"/api/devices": {"ok": True, "devices": [device], "tablets": {}},
             "/api/devices/k1/app": {"ok": True, "connected": True, "fresh": True, "commands_on": True, "status": STATUS},
             "/api/devices/rooms": {"ok": True, "areas": [], "tablets": {}},
             "/api/people/ha": {"ok": True, "people": [], "devices": [], "users": [], "error": None},
             "/api/rbac/scopes/device/k1": {"ok": True, "areas": ["living_room"]}}
    (d / "reads.json").write_text(json.dumps(reads))
    owner = {"user": {"id": "u1", "name": "Fictional Owner", "username": "owner", "role": "owner", "kind": "mantel", "totp": False,
                      "passkeys": 0}, "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": ["me", "people", "devices"],
             "roles": [], "device_roles": ["wall_tablet"], "actions": [], "resource_kinds": [], "features": [], "service_scopes": [],
             "connect_port": None, "ha_set_up": True}
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "reads.json"), json.dumps(owner)],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def test_a_command_adds_no_row_and_the_bar_says_it_went(got):
    assert got["before"]["display"][:3] == ["Screen Power", "Brightness", "Black Curtain"]
    # the switches stay where they were: nothing comes in above them, nor anywhere else on the page
    for after in ("after_screen", "after_reload", "after_refused"):
        assert got[after]["display"] == got["before"]["display"], after
        assert got[after]["reload"] == got["before"]["reload"], after
    assert [s["command"] for s in got["sent"]] == ["screen", "reload", "curtain"]
    # Saved for a switch, the command's own word for one whose effect isn't on the page
    assert got["bar"][:4] == ["saving", "saved", "saving", "saved Reloading"]


def test_a_refusal_is_an_alert_named_by_what_was_tried(got):
    assert got["bar"][-2:] == ["saving", "error"]
    assert got["alerts"] == ["Couldn’t Change the Black Curtain: AirPlay is on the screen."]
