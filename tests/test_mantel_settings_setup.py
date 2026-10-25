"""Mantel Settings, Set Up Mantel (web/shim/mantel-settings.js over setup_guide.py's GET /api/setup).

While setup is open, Mantel Settings opens on the guide and lists it at the top; each step shows what the house says
and the page that does it; Later and Looks Right go to PUT /api/setup/steps/{id}; once closed, the usual first page.
Drawn in node with the recording kit stub of test_mantel_settings_devices.py.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

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

// Set Up Mantel: the list, a step, and the page's first choice
const me = JSON.parse(process.argv[4]);
m._reset(me);
out.first = m.host.first();
out.groups = m.host.groups().map((g) => g.rows.map((r) => r.route));
out.list = await open(me, ['mantel', 'setup']);
out.step = await open(me, ['mantel', 'setup', 'step', 'people']);
await find(out.step, 'Later').onClick();
out.commands = await open(me, ['mantel', 'setup', 'step', 'commands']);
out.screens = await open(me, ['mantel', 'setup', 'screens']);
await find(out.screens, 'It Looks Right').onClick();
out.closed = (() => { const x = { ...me, setup: { dismissed: true, open: false } }; m._reset(x); return { first: m.host.first() }; })();
out.sent = sent;
process.stdout.write(JSON.stringify(out));
"""


def overview():
    return {"user": {"id": "u1", "name": "Fictional Owner", "username": "owner", "role": "owner", "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": ["me", "people", "devices", "connections"],
            "roles": [], "device_roles": ["wall_tablet"], "actions": [], "resource_kinds": [], "features": [],
            "service_scopes": [], "connect_port": None, "ha_set_up": True, "setup": {"dismissed": False, "open": True}}


def step(sid, title, state, optional=False, **kw):
    return {"id": sid, "title": title, "state": state, "optional": optional, "detail": title + " detail",
            "route": kw.pop("route", "#/mantel/" + sid), "can_skip": kw.pop("can_skip", True),
            "can_confirm": kw.pop("can_confirm", False), **kw}


SETUP = {"ok": True, "complete": False, "dismissed": False, "can_edit": True, "install": "container", "house": None,
         "done": 1, "total": 5, "steps": [
             step("ha", "Connect Home Assistant", "done", can_skip=False),
             step("screens", "Screens", "todo", can_skip=False, can_confirm=True, route="#/mantel/setup/screens",
                  hk_frontend=False, imported=False),
             step("people", "The Household", "todo"),
             step("commands", "House Commands", "todo", route=None, how="add --commands-enabled"),
             step("music", "Music Assistant", "todo", optional=True)]}


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-setup")
    (d / "base.mjs").write_text((WEB / "shim/base.js").read_text(encoding="utf-8"))
    (d / "mantel-photos.mjs").write_text((WEB / "shim/mantel-photos.js").read_text(encoding="utf-8"))
    module = (WEB / "shim/mantel-settings.js").read_text(encoding="utf-8")
    (d / "mantel-settings.mjs").write_text(module.replace("from './base.js'", "from './base.mjs'")
                                           .replace("from './mantel-photos.js'", "from './mantel-photos.mjs'"))
    (d / "script.mjs").write_text(SCRIPT)
    reads = {"/api/setup": SETUP, "/api/admin/overview": overview()}
    (d / "reads.json").write_text(json.dumps(reads))
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "reads.json"),
                          json.dumps(overview())], capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def rows(groups):
    return [r for g in groups for r in g.get("rows") or []]


def test_open_setup_comes_first_and_leads_the_list(got):
    assert got["first"] == "mantel/setup"
    assert ["mantel/setup"] in got["groups"]
    assert got["closed"]["first"] is None             # closed: the usual first page


def test_the_list_splits_needed_from_optional_and_says_each_state(got):
    needed = next(g for g in got["list"] if g.get("header") == "Needed")
    optional = next(g for g in got["list"] if g.get("header") == "Optional")
    assert [(r["label"], r["value"]) for r in needed["rows"]] == [
        ("Connect Home Assistant", "Done"), ("Screens", "To Do"), ("The Household", "To Do"), ("House Commands", "To Do")]
    assert [r["label"] for r in optional["rows"]] == ["Music Assistant"]
    assert "3 steps need doing" in needed["footer"]
    assert any(r["label"] == "Close the Guide" for r in rows(got["list"]))


def test_a_step_opens_its_page_and_can_wait(got):
    labels = [r["label"] for r in rows(got["step"])]
    assert "Do It Now" in labels and "Later" in labels
    assert next(r for r in rows(got["step"]) if r["label"] == "Do It Now")["href"] == "#/mantel/people"
    sent = [s for s in got["sent"] if s["path"].endswith("/api/setup/steps/people")]
    assert sent == [{"method": "PUT", "path": "/api/setup/steps/people", "body": {"state": "skipped"}}]


def test_commands_show_how_and_no_button_turns_them_on(got):
    """The page sends the Owner to General's switch (Allow Control of the House, 0.1.52); it said no page could."""
    how = next(g for g in got["commands"] if g.get("header") == "How")
    assert "Allow Control of the House" in how["footer"] and "never from a page" not in how["footer"]
    assert not any(r.get("label") in ("Do It Now", "Turn On") for r in rows(got["commands"]))


def test_the_generated_home_screen_is_opened_and_judged(got):
    assert any(r["label"] == "Open the Home Screen" for r in rows(got["screens"]))
    sent = [s for s in got["sent"] if s["path"].endswith("/api/setup/steps/screens")]
    assert sent == [{"method": "PUT", "path": "/api/setup/steps/screens", "body": {"state": "confirmed"}}]
