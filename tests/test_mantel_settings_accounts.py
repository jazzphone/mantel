"""Mantel Settings, passwords and the Audit Log (web/shim/mantel-settings.js).

* Me → Change Password (a Mantel account; a Home Assistant user has none): the current password and the new one
  twice, sent to POST /api/account/password; the same length rule as a new account, checked before anything is sent.
* People → a person → Set a New Password… (an Owner or Admin; an Admin never for an Owner, nobody for themselves):
  POST /api/users/{id}/password, after a confirmation.
* The Audit Log names account and tablet changes in words, its Kind filter finds them (kind `config`), and the
  Decision filter marks "Needed Confirmation" as older entries only.

The page is drawn in node with a recording stub of the settings kit (no DOM), as test_mantel_settings_devices.py does.
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
                                options: o.options, href: o.href, type: o.type, autocomplete: o.autocomplete, fk: o.fk,
                                onClick: o.onClick, onChange: o.onChange, onCommit: o.onCommit, setAttribute() {} });
const asked = [];
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  check: row('check'), confirm: async (root, o) => { asked.push(o.title); return true; },
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const data = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const sent = [];
globalThis.fetch = async (u, init = {}) => {
  const path = String(u), method = init.method || 'GET';
  if (method !== 'GET') {
    sent.push({ method, path, body: init.body ? JSON.parse(init.body) : null });
    const got = data.answers[method + ' ' + path] || { status: 200, body: { ok: true } };
    return { ok: got.status < 400, status: got.status, json: async () => got.body };
  }
  const key = Object.keys(data.reads).find((k) => path === k || path.startsWith(k + '?'));
  if (key === undefined) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => data.reads[key] };
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
const owner = data.me.owner, admin = data.me.admin, linked = data.me.linked;

// Me: a Mantel account has Change Password; a Home Assistant user has none
out.me_owner = await open(owner, ['mantel', 'me']);
out.me_linked = await open(linked, ['mantel', 'me']);
out.me_linked_password = (await open(linked, ['mantel', 'me', 'password'])).title;
// Change Password: too short and not matching are refused on the page, then sent once
let g = await open(owner, ['mantel', 'me', 'password']);
out.change_page = g;
find(g, 'Current Password').onCommit('the old passphrase');
find(g, 'New Password').onCommit('short');
find(g, 'Repeat').onCommit('short');
await find(g, 'Change Password').onClick();
out.too_short = (await draw()).groups;
g = await draw();
find(g, 'Current Password').onCommit('the old passphrase');
find(g, 'New Password').onCommit('a much better passphrase');
find(g, 'Repeat').onCommit('a much better passphrase!');
await find(g, 'Change Password').onClick();
out.mismatch = (await draw()).groups;
g = await draw();
find(g, 'Current Password').onCommit('the old passphrase');
find(g, 'New Password').onCommit('a much better passphrase');
find(g, 'Repeat').onCommit('a much better passphrase');
await find(g, 'Change Password').onClick();
out.after_change = (await draw()).groups;          // the draft is gone: fields empty again
out.sent_change = sent.splice(0);
out.went_change = went.splice(0);
// People: the person's page offers Set a New Password…, not for yourself, not to an Admin for an Owner
out.person = await open(owner, ['mantel', 'people', 'u2']);
out.person_self = await open(owner, ['mantel', 'people', 'u1']);
out.person_linked = await open(owner, ['mantel', 'people', 'u4']);
out.admin_on_owner = await open(admin, ['mantel', 'people', 'u1']);
out.admin_on_owner_page = await open(admin, ['mantel', 'people', 'u1', 'password']);
g = await open(owner, ['mantel', 'people', 'u2', 'password']);
out.reset_page = g;
find(g, 'New Password').onCommit('a brand new passphrase');
find(g, 'Repeat').onCommit('a brand new passphrase');
await find(g, 'Set Password').onClick();
out.sent_reset = sent.splice(0);
out.went_reset = went.splice(0);
out.asked = asked.splice(0);
// a refusal from the server is shown on the page
g = await open(owner, ['mantel', 'people', 'u3', 'password']);
find(g, 'New Password').onCommit('a brand new passphrase');
find(g, 'Repeat').onCommit('a brand new passphrase');
await find(g, 'Set Password').onClick();
out.refused = (await draw()).groups;
out.went_refused = went.splice(0);
// the Audit Log
out.audit = await open(owner, ['mantel', 'audit']);
process.stdout.write(JSON.stringify(out));
"""


def me(uid, role, kind="hk", has_password=True, username=None):
    return {"user": {"id": uid, "name": f"Fictional {role.title()}", "username": username or role, "role": role,
                     "kind": kind, "has_password": has_password, "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False,
            "sections": ["me", "people", "devices", "roles", "audit"], "roles": ["owner", "admin", "adult", "child"],
            "device_roles": [], "actions": [], "resource_kinds": [], "features": [], "service_scopes": [],
            "connect_port": None, "ha_set_up": True}


OWNER, ADMIN = me("u1", "owner"), me("u5", "admin")
LINKED = me("u4", "adult", kind="ha_linked", username="")
LINKED["user"]["username"] = None
USERS = [{"id": "u1", "name": "Avery", "username": "avery", "role": "owner", "kind": "hk", "disabled": False,
          "has_password": True, "totp": False, "passkeys": 0, "ha_user_id": None},
         {"id": "u2", "name": "Jordan", "username": "jordan", "role": "adult", "kind": "hk", "disabled": False,
          "has_password": True, "totp": False, "passkeys": 0, "ha_user_id": None},
         {"id": "u3", "name": "Riley", "username": "riley", "role": "child", "kind": "hk", "disabled": False,
          "has_password": True, "totp": False, "passkeys": 0, "ha_user_id": None},
         {"id": "u4", "name": "Hollis", "username": None, "role": "adult", "kind": "ha_linked", "disabled": False,
          "has_password": False, "totp": False, "passkeys": 0, "ha_user_id": "ha-1"},
         {"id": "u5", "name": "Ada", "username": "ada", "role": "admin", "kind": "hk", "disabled": False,
          "has_password": True, "totp": False, "passkeys": 0, "ha_user_id": None}]
AUDIT = [
    {"id": 9, "timestamp": 0, "actor": "u1", "role": "owner", "kind": "config", "action": "account.password.reset",
     "target": {"user": "u2", "username": "jordan", "name": "Jordan", "role": "adult"}, "decision": "allowed",
     "reason": "owner", "door": "lan", "source_ip": "192.0.2.4"},
    {"id": 8, "timestamp": 0, "actor": "u1", "role": "owner", "kind": "config", "action": "account.role",
     "target": {"user": "u3", "username": "riley", "name": "Riley", "from": "child", "to": "adult"},
     "decision": "allowed", "reason": "owner"},
    {"id": 7, "timestamp": 0, "actor": "u2", "role": "adult", "kind": "config", "action": "account.password.change",
     "target": {"user": "u2", "username": "jordan", "name": "Jordan"}, "decision": "allowed", "reason": "owner"},
    {"id": 6, "timestamp": 0, "actor": None, "role": None, "device": "d1", "device_role": "wall_tablet", "kind": "config",
     "action": "device.revoke", "target": {"device": "d1", "name": "Loft Tablet", "role": "wall_tablet", "room": "loft",
                                           "by_self": True}, "decision": "allowed", "reason": "owner"},
    {"id": 5, "timestamp": 0, "actor": "u1", "role": "owner", "kind": "config", "action": "device.enroll",
     "target": {"device": "d1", "name": "Loft Tablet", "role": "wall_tablet", "room": "master_bedroom", "tablet": None},
     "decision": "allowed", "reason": "owner"},
    {"id": 4, "timestamp": 0, "actor": "u1", "role": "owner", "kind": "config", "action": "rbac.grant.add",
     "target": {"effect": "deny"}, "decision": "allowed", "reason": "owner"},
    {"id": 3, "timestamp": 0, "actor": "u2", "role": "adult", "kind": "service", "action": "light.turn_on",
     "target": ["light.kitchen"], "decision": "allowed", "reason": "granted", "result": "ok"},
]
DATA = {
    "me": {"owner": OWNER, "admin": ADMIN, "linked": LINKED},
    "reads": {"/api/users": {"users": USERS}, "/api/sessions": {"sessions": []}, "/api/default-screen": {"screen": None, "screens": []},
              "/api/default-screens": {"users": {}, "screens": [], "house": None}, "/api/phones": {"linked": False},
              "/api/auth/passkeys": {"passkeys": []}, "/api/push/targets": {"targets": []}, "/api/app/devices": {"apps": []},
              "/api/admin/overview": OWNER, "/api/devices": {"devices": []},
              "/api/audit": {"rows": AUDIT, "next": None, "retention_days": 365}},
    "answers": {"POST /api/users/u2/password": {"status": 200, "body": {"ok": True, "sessions_ended": 2}},
                "POST /api/users/u3/password": {"status": 400, "body": {"error": "password_contains_name",
                                                                        "message": "the password must not contain the user name"}}},
}


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-accounts")
    from test_mantel_settings import node_modules
    node_modules(d)
    (d / "script.mjs").write_text(SCRIPT)
    (d / "data.json").write_text(json.dumps(DATA))
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "data.json")],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def rows(page):
    groups = page["groups"] if isinstance(page, dict) else page
    return [r for g in groups for r in g.get("rows") or []]      # a flash line on the page has no rows


def labels(page):
    return [r["label"] for r in rows(page)]


def footers(page):
    groups = page["groups"] if isinstance(page, dict) else page
    return " ".join(g.get("footer") or "" for g in groups)


def test_me_offers_change_password_to_a_mantel_account_only(got):
    [nav] = [r for r in rows(got["me_owner"]) if r["label"] == "Change Password…"]
    assert nav["kind"] == "nav" and nav["href"].endswith("/mantel/me/password")
    assert not [r for r in labels(got["me_linked"]) if "Password" in (r or "")]
    assert got["me_linked_password"] != "Change Password"                 # the address alone shows Me instead


def test_change_password_asks_for_the_current_one_and_the_new_one_twice(got):
    page = got["change_page"]
    assert page["title"] == "Change Password"
    fields = {r["label"]: r for r in rows(page) if r["kind"] == "text"}
    assert list(fields) == ["Current Password", "New Password", "Repeat"]
    assert all(f["type"] == "password" for f in fields.values())
    assert fields["Current Password"]["autocomplete"] == "current-password"
    assert fields["New Password"]["autocomplete"] == "new-password"
    assert "12 characters or more" in footers(page) and "signed out" in footers(page)


def test_change_password_checks_on_the_page_then_sends_once(got):
    assert "Passwords are 12 characters or more." in json.dumps(got["too_short"])
    assert "The two passwords do not match." in json.dumps(got["mismatch"])
    assert got["sent_change"] == [{"method": "POST", "path": "/api/account/password",
                                   "body": {"current": "the old passphrase", "new": "a much better passphrase"}}]
    assert got["went_change"] == ["#/mantel/me"]


def test_a_persons_page_offers_a_new_password_within_the_rules(got):
    [nav] = [r for r in rows(got["person"]) if r["label"] == "Set a New Password…"]
    assert nav["kind"] == "nav" and nav["href"].endswith("/mantel/people/u2/password")
    assert "Set a New Password…" not in labels(got["person_self"])          # yours: Me, with the current one
    assert "Set a New Password…" not in labels(got["person_linked"])        # a Home Assistant user has none
    assert "Set a New Password…" not in labels(got["admin_on_owner"])       # an Admin never for an Owner
    assert "Only an Owner can change an Owner." in footers(got["admin_on_owner_page"])
    assert not [r for r in rows(got["admin_on_owner_page"]) if r["kind"] == "text"]


def test_setting_a_new_password_confirms_then_sends_it_once(got):
    page = got["reset_page"]
    assert page["title"] == "Set a New Password"
    assert "signed out everywhere" in footers(page)
    assert got["asked"] == ["Set a new password for Jordan?"]
    assert got["sent_reset"] == [{"method": "POST", "path": "/api/users/u2/password",
                                  "body": {"password": "a brand new passphrase"}}]
    assert got["went_reset"] == ["#/mantel/people/u2"]
    # the server's refusal is on the page, and the page stays
    assert "the password must not contain the user name" in json.dumps(got["refused"])
    assert got["went_refused"] == []


def test_the_audit_log_names_account_and_tablet_changes(got):
    page = got["audit"]
    shown = {r["label"].split(" · ")[0]: r["label"] for r in rows(page) if r["kind"] == "info" and " · " in (r["label"] or "")}
    assert shown["account.password.reset"] == "account.password.reset · Set a new password for Jordan"
    assert shown["account.role"] == "account.role · Riley: Child → Adult"
    assert shown["account.password.change"] == "account.password.change · Changed their own password"
    assert shown["device.revoke"] == "device.revoke · The tablet Loft Tablet revoked itself"
    assert shown["device.enroll"] == "device.enroll · Enrolled the tablet Loft Tablet (Master Bedroom)"
    assert shown["rbac.grant.add"] == 'rbac.grant.add · {"effect":"deny"}'      # others as they were
    assert shown["light.turn_on"] == "light.turn_on · light.kitchen"
    assert "passphrase" not in json.dumps(page)


def test_the_audit_filters_find_the_new_rows_and_mark_the_old_decision(got):
    selects = {r["label"]: r["options"] for r in rows(got["audit"]) if r["kind"] == "select"}
    assert ["config", "Settings and Accounts"] in selects["Kind"]
    assert selects["Decision"] == [["", "Any"], ["allowed", "Allowed"], ["denied", "Denied"],
                                   ["step_up", "Needed Confirmation (Older Entries)"]]
    from mantel_server.gateway import AUDIT_DECISIONS, AUDIT_KINDS
    assert {v for v, _ in selects["Kind"] if v} == set(AUDIT_KINDS)
    assert {v for v, _ in selects["Decision"] if v} == set(AUDIT_DECISIONS)
