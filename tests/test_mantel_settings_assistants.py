"""Mantel Settings → Advanced → Assistants (MCP) (web/shim/settings/assistants.js, mcp/admin.py).

* An Owner's page: the house's switches (Allow Assistants, from away, may control the house, changes per minute, key
  lifetime), each one PUT /api/mcp/settings after a confirmation where it matters; the address to connect to;
  everyone's assistants with Revoke (DELETE /api/mcp/grants/{id}, after a confirmation).
* An Admin's page: the switches read-only ("Only an Owner can change these"), their own assistants.
* New Personal Key: a name and the scopes (never "commands"), POST /api/mcp/keys, then the key and the Claude Code
  command shown once on the page, until I Have Saved It.
* The Audit Log's Through filter asks /api/audit for an assistant's rows (via=mcp) or nobody's (via=-).

Drawn in node with a recording stub of the settings kit (no DOM), as test_mantel_settings_accounts.py does.
"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, on: o.on, valueCls: o.valueCls,
                                options: o.options, href: o.href, disabled: o.disabled, fk: o.fk,
                                onClick: o.onClick, onChange: o.onChange, onCommit: o.onCommit, setAttribute() {} });
const asked = [];
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  check: row('check'), confirm: async (root, o) => { asked.push(o.title); return true; },
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const data = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const sent = [], gets = [];
let reads = data.owner_reads;
globalThis.fetch = async (u, init = {}) => {
  const path = String(u), method = init.method || 'GET';
  if (method !== 'GET') {
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
    const got = data.answers[method + ' ' + path] || { status: 200, body: { ok: true } };
    return { ok: got.status < 400, status: got.status, json: async () => got.body };
  }
  gets.push(path);
  const key = Object.keys(reads).find((k) => path === k || path.startsWith(k + '?'));
  if (key === undefined) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[key] };
};
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const went = [];
const panel = { render() {}, status() {}, go(h) { went.push(h); }, shadowRoot: null };
let route = null;
async function draw() {
  let kids = [], page = null;
  for (let i = 0; i < 3; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    page = m.host.page(route, panel);
    page.body(c);
    kids = c.kids;
    await tick(); await tick();
  }
  return { title: page.title, groups: kids };
}
const rowsOf = (g) => g.groups.flatMap((x) => x.rows || []);
const find = (g, label) => rowsOf(g).find((r) => r.label === label);
async function open(me, path) { m._reset(me); route = path; return draw(); }
const out = {};
out.groups = m.host.groups.call ? (m._reset(data.me.owner), m.host.groups()) : null;
let g = await open(data.me.owner, ['mantel', 'assistants']);
out.owner = g;
await find(g, 'Allow Assistants').onChange(true);
await find(g, 'Changes per Minute').onChange('120');
await find(g, 'Revoke Claude Code…').onClick();
out.sent_owner = sent.splice(0);
out.asked = asked.splice(0);
// a new key
g = await open(data.me.owner, ['mantel', 'assistants', 'add']);
out.add = g;
find(g, 'Name').onCommit('Claude Code on the office Mac');
find(g, 'Audit Log').onClick();
await find(g, 'Make Key').onClick();
out.sent_add = sent.splice(0);
out.went = went.splice(0);
route = ['mantel', 'assistants'];
out.after_key = await draw();
// an Admin
reads = data.admin_reads;
out.admin = await open(data.me.admin, ['mantel', 'assistants']);
// the Audit Log's Through filter
reads = data.owner_reads;
g = await open(data.me.owner, ['mantel', 'audit']);
gets.splice(0);
find(g, 'Through').onChange('mcp');
await draw();
out.audit_gets = gets.splice(0);
process.stdout.write(JSON.stringify(out));
"""


def me(uid, role):
    return {"user": {"id": uid, "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": True, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False,
            "sections": ["me", "people", "service", "assistants", "audit"] if role == "owner" else ["me", "people", "assistants", "audit"],
            "roles": [], "device_roles": [], "actions": [], "resource_kinds": [], "features": [], "service_scopes": [],
            "connect_port": None, "ha_set_up": True}


SETTINGS = {"mcp_enabled": False, "mcp_away": False, "mcp_commands": False, "mcp_write_rate": 60, "mcp_key_days": 30}
GRANTS = [{"id": "g1", "kind": "key", "user_id": "u1", "name": "Claude Code", "person": "Fictional owner",
           "scopes": ["read", "settings", "screens"], "away": False, "created": 0, "expires": 1e9, "last_used": None,
           "last_ip": None, "revoked": None, "state": "live"},
          {"id": "g2", "kind": "oauth", "user_id": "u2", "name": "Claude Desktop", "person": "Fictional admin",
           "scopes": ["read"], "away": True, "created": 0, "expires": 1e9, "last_used": 5, "last_ip": "192.0.2.4",
           "revoked": None, "state": "live"}]


def state(may, grants):
    return {"settings": SETTINGS, "may_configure": may, "endpoint": "http://mantel.example:8100/mcp",
            "scopes": ["read", "settings", "screens", "audit", "commands", "restore"],
            "key_scopes": ["read", "settings", "screens", "audit", "restore"], "default_scopes": ["read", "settings", "screens"],
            "commands_on": False, "me": "u1" if may else "u2", "assistants": grants}


DATA = {
    "me": {"owner": me("u1", "owner"), "admin": me("u2", "admin")},
    "owner_reads": {"/api/mcp": state(True, GRANTS), "/api/admin/overview": me("u1", "owner"),
                    "/api/users": {"users": []}, "/api/devices": {"devices": []},
                    "/api/audit": {"rows": [], "next": None, "retention_days": 90}},
    "admin_reads": {"/api/mcp": state(False, GRANTS[1:]), "/api/admin/overview": me("u2", "admin")},
    "answers": {"POST /api/mcp/keys": {"status": 201, "body": {
        "assistant": {"id": "g3", "name": "Claude Code on the office Mac", "scopes": ["read", "settings", "screens", "audit"],
                      "expires": 1e9},
        "token": "mmcp_0123456789abcdef_" + "F" * 43, "endpoint": "http://mantel.example:8100/mcp"}}},
}


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-assistants")
    from js_modules import copy_shim
    copy_shim(d)
    (d / "script.mjs").write_text(SCRIPT)
    (d / "data.json").write_text(json.dumps(DATA))
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "data.json")],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def rows(page):
    return [r for g in page["groups"] for r in g.get("rows") or []]


def labels(page):
    return [r["label"] for r in rows(page)]


def test_it_is_under_advanced(got):
    adv = [g for g in got["groups"] if g.get("header") == "Advanced"]
    assert adv and [r["label"] for r in adv[0]["rows"]] == ["Service Accounts", "Assistants (MCP)"]


def test_an_owner_sets_the_switches_and_revokes(got):
    page = got["owner"]
    assert page["title"] == "Assistants (MCP)"
    names = labels(page)
    for want in ("Allow Assistants", "Signed-In Assistants from Away", "Assistants May Control the House",
                 "Changes per Minute", "New Keys Last", "Address", "Revoke Claude Code…", "Revoke Claude Desktop…"):
        assert want in names, want
    assert not [r for r in rows(page) if r["kind"] == "toggle" and r.get("disabled")]
    assert got["sent_owner"] == [
        {"method": "PUT", "path": "/api/mcp/settings", "body": {"mcp_enabled": True}},
        {"method": "PUT", "path": "/api/mcp/settings", "body": {"mcp_write_rate": 120}},
        {"method": "DELETE", "path": "/api/mcp/grants/g1", "body": None}]
    assert got["asked"] == ["Allow assistants?", "Revoke Claude Code?"]
    desktop = next(r for r in rows(page) if r["label"] == "Claude Desktop")
    assert "Signed in" in desktop["sub"] and "for Fictional admin" in desktop["sub"] and "from away too" in desktop["sub"]


def test_a_new_key_is_shown_once_with_its_command(got):
    assert "Control the House" not in labels(got["add"]), "a key never controls the house"
    [sent] = got["sent_add"]
    assert sent["path"] == "/api/mcp/keys" and sent["body"] == {
        "name": "Claude Code on the office Mac", "scopes": ["read", "settings", "screens", "audit"]}
    assert got["went"] == ["#/mantel/assistants"]
    shown = [g for g in got["after_key"]["groups"] if (g.get("header") or "").startswith("Key for")]
    assert shown and "only time" in shown[0]["footer"]
    assert "I Have Saved It" in [r.get("label") for r in shown[0]["rows"]]


def test_an_admin_sees_the_switches_but_cannot_change_them(got):
    page = got["admin"]
    assert all(r.get("disabled") for r in rows(page) if r["kind"] in ("toggle", "select"))
    assert "Only an Owner can change these." in " ".join(g.get("footer") or "" for g in page["groups"])
    assert "Your Assistants" in [g.get("header") for g in page["groups"]]


def test_the_audit_log_filters_by_assistant(got):
    assert any("via=mcp" in p for p in got["audit_gets"])
