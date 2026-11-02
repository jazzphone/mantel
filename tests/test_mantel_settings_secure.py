"""Mantel Settings, About -> Secure Connection (web/shim/settings/secure.js over about.py's /api/about and
/api/about/secure): talking at the door needs HTTPS, because a browser gives the microphone only to a secure page.

Everyone signed in gets the row in About and its page: whether THIS screen is a secure context (the browser's word,
`window.isSecureContext`), how Mantel is reached, the address in use against the public one. An Owner or Admin (the
`performance` section) also reads /api/about/secure and sees each wall tablet whose page said it is not secure, with the
fix; anyone else never asks for it. Drawn in node with the recording kit stub of the other pages' tests.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time

import pytest
from js_modules import copy_shim

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, valueCls: o.valueCls, href: o.href, icon: o.icon, fk: o.fk });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), nav: row('nav'), button: row('button'), toggle: row('toggle'), text: row('text'), select: row('select'),
  check: row('check'), confirm: async () => true, h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const asked = [];
globalThis.fetch = async (u) => {
  const path = String(u);
  asked.push(path);
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const panel = { render() {}, status() {}, go() {}, shadowRoot: null };
async function draw(me, route) {
  m._reset(me);
  let kids = [], page = null;
  for (let i = 0; i < 3; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    page = m.host.page(route, panel);
    page.body(c);
    kids = c.kids;
    await tick(); await tick();
  }
  return { title: page.title, back: page.back || null, groups: kids };
}
const cases = JSON.parse(process.argv[4]);
const out = {};
for (const [name, c] of Object.entries(cases)) {
  globalThis.isSecureContext = c.secure;
  globalThis.location = { origin: c.origin, hostname: new URL(c.origin).hostname, hash: '', search: '', pathname: '/settings' };
  asked.length = 0;
  out[name] = { about: await draw(c.me, ['mantel', 'about']), secure: await draw(c.me, ['mantel', 'about', 'secure']), asked: asked.slice() };
}
// the address against the public one, in words
const { addressNote } = await import(process.argv[5]);
out._notes = [['https://mantel.example.com', 'https://mantel.example.com/'], ['http://mantel.example.com', 'https://mantel.example.com/'],
  ['https://192.168.1.20', 'https://mantel.example.com/'], ['https://[fe80::1]:8123', 'https://mantel.example.com/'],
  ['https://other.example.com', 'https://mantel.example.com/'], ['http://192.168.1.20:8123', ''], ['nonsense', 'https://mantel.example.com/']]
  .map(([here, pub]) => addressNote(here, pub));
process.stdout.write(JSON.stringify(out));
"""


def overview(role, sections):
    return {"user": {"id": "u1", "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None, "ha_set_up": True}


def about(mode, public_url):
    return {"product": "Mantel", "version": "1.2.3", "commit": "dev", "build": "x", "staged": None, "install": "Container",
            "started": 1000, "uptime_s": 5, "python": "3.13", "home_assistant": {"version": "2026.10", "connected": True},
            "music_assistant": {"version": None, "configured": False}, "linked": [], "commands": False, "docs": "/docs",
            "access": {"mode": mode, "public_url": public_url}}


NAME = "https://mantel.example.com"
LAN = "http://192.168.1.20:8080"
OWNER = overview("owner", ["me", "about", "performance"])
ADULT = overview("adult", ["me", "about"])


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-secure")
    copy_shim(d)
    (d / "script.mjs").write_text(SCRIPT)
    now = time.time()
    reads = {"/api/about": about("proxy", NAME + "/"),
             "/api/about/secure": {"now": now, "tablets": [
                 {"name": "Kitchen Tablet", "origin": LAN, "last_seen": now - 120},
                 {"name": "Hall Tablet", "origin": None, "last_seen": now - 7200}]}}
    (d / "reads.json").write_text(json.dumps(reads))
    cases = {"owner_on_ip": {"me": OWNER, "secure": False, "origin": LAN},
             "owner_on_name": {"me": OWNER, "secure": True, "origin": NAME},
             "adult_on_name": {"me": ADULT, "secure": True, "origin": NAME},
             "adult_on_ip": {"me": ADULT, "secure": False, "origin": LAN}}
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "reads.json"), json.dumps(cases), str(d / "settings/secure.mjs")],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def rows(groups):
    return [r for g in groups for r in g.get("rows") or []]


def group(groups, header):
    return next(g for g in groups if g["header"] == header)


def test_everyone_signed_in_has_the_row_in_about_with_this_screens_word(got):
    nav = next(r for r in rows(got["adult_on_name"]["about"]["groups"]) if r["label"] == "Secure Connection")
    assert nav["kind"] == "nav" and nav["href"] == "#/mantel/about/secure" and nav["value"] == "Behind Your Own Proxy"
    assert nav["sub"] == "This screen is secure" and nav["icon"] == "mdi:lock"
    nav = next(r for r in rows(got["adult_on_ip"]["about"]["groups"]) if r["label"] == "Secure Connection")
    assert nav["sub"] == "This screen is not secure" and nav["icon"] == "mdi:lock-open-variant"


def test_a_manager_s_row_counts_the_tablets_that_are_not_secure(got):
    nav = next(r for r in rows(got["owner_on_name"]["about"]["groups"]) if r["label"] == "Secure Connection")
    assert nav["sub"] == "This screen is secure · 2 wall tablets are not" and nav["icon"] == "mdi:lock-open-variant"


def test_the_page_says_whether_this_screen_is_secure_and_by_what_address(got):
    page = got["adult_on_ip"]["secure"]
    assert page["title"] == "Secure Connection" and page["back"] == ["About", "#/mantel/about"]
    here = group(page["groups"], "This Screen")
    by = {r["label"]: r for r in here["rows"]}
    assert by["Secure Page"]["value"] == "No" and by["Secure Page"]["valueCls"] == "warn"
    assert "talk button is left out" in by["Secure Page"]["sub"]
    assert by["Address"]["value"] == LAN
    assert by["Address"]["sub"] == "This screen is on http, but Mantel’s public address is " + NAME + ". Open that instead."
    assert "https:// name, not its IP address" in here["footer"]
    ok = group(got["adult_on_name"]["secure"]["groups"], "This Screen")
    by = {r["label"]: r for r in ok["rows"]}
    assert by["Secure Page"]["value"] == "Yes" and by["Address"]["sub"] is None and ok["footer"] is None


def test_the_page_says_how_mantel_is_reached(got):
    mantel = group(got["adult_on_name"]["secure"]["groups"], "Mantel")
    by = {r["label"]: r for r in mantel["rows"]}
    assert by["Reached By"]["value"] == "Behind Your Own Proxy" and by["Public Address"]["value"] == NAME + "/"


def test_a_manager_sees_each_tablet_that_is_not_secure_with_its_address_and_the_fix(got):
    page = got["owner_on_ip"]["secure"]
    tablets = group(page["groups"], "Wall Tablets")
    assert [r["label"] for r in tablets["rows"]] == ["Kitchen Tablet", "Hall Tablet"]
    kitchen, hall = tablets["rows"]
    assert kitchen["value"] == "Not Secure" and kitchen["valueCls"] == "warn"
    assert kitchen["sub"].startswith("Opened " + LAN + " · heard ") and "2 min ago" in kitchen["sub"]
    assert hall["sub"].startswith("heard ") and "Opened" not in hall["sub"], "a tablet that gave no usable address is listed without one"
    assert tablets["footer"] == "Open Mantel by its https:// name, not its IP address, in Fully Kiosk’s Start URL."


def test_anyone_else_never_asks_for_the_tablets_and_sees_no_list(got):
    for who in ("adult_on_name", "adult_on_ip"):
        assert "/api/about/secure" not in got[who]["asked"]
        assert not any(g["header"] == "Wall Tablets" for g in got[who]["secure"]["groups"])
    assert "/api/about/secure" in got["owner_on_name"]["asked"]


def test_the_address_against_the_public_one(got):
    note = got["_notes"]
    assert note[0] is None, "the public address itself needs no note"
    assert "http" in note[1] and "Open that instead" in note[1]
    assert "IP address" in note[2] and "IP address" in note[3]
    assert "not Mantel’s public address" in note[4]
    assert note[5] is None, "with no public address there is nothing to compare against"
    assert note[6] is None, "an address it cannot read says nothing"
