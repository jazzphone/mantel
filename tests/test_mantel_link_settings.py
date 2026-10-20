"""Mantel Settings, Connections -> Home Assistant Link (web/shim/mantel-settings.js `pLink`; docs/phase9/MANTEL-LINK.md):
which integration is linked and what it reported, who holds the bridge (an Owner hands it over or gives it back),
and who runs each wall tablet (an Owner's toggles; everyone else reads). Drawn with a recording stand-in for HK
Settings' kit, as test_mantel_settings.py draws its pages."""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from test_mantel_settings import ALL, WEB, overview

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, on: o.on, fk: o.fk });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
globalThis.fetch = async (u) => {
  const path = String(u);
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
async function draw(me) {
  m._reset(me);
  const panel = { render() {}, status() {}, shadowRoot: null };
  const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
  for (let i = 0; i < 3; i++) { c.kids = []; m.host.page(['mantel', 'connections', 'link'], panel).body(c); await tick(); await tick(); }
  return c.kids;
}
process.stdout.write(JSON.stringify({ owner: await draw(JSON.parse(process.argv[4])), admin: await draw(JSON.parse(process.argv[5])) }));
"""


def owners(holder="hk_frontend"):
    return {"house": {"unit": "house", "name": "The rest of the entry", "owner": "ha", "changed": None},
            "tablets": [{"unit": "loft", "name": "Loft", "owner": "mantel", "changed": 1760900000},
                        {"unit": "hall", "name": "Hall", "owner": "ha", "changed": None}],
            "wire": {"house": "ha", "tablets": ["loft"], "bridge": holder},
            "bridge": {"holder": holder, "changed": None, "changed_by": None}, "linked_clients": 2,
            "links": [{"domain": "hk_frontend", "protocol": 1, "features": ["bridge"], "since": 1760900000, "report": {}},
                      {"domain": "mantel", "protocol": 2, "features": ["bridge"], "since": 1760900000,
                       "report": {"hk_frontend": {"installed": True, "loaded": True, "linked": True}}}]}


def run(tmp_path, data):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    (tmp_path / "base.mjs").write_text((WEB / "shim/base.js").read_text(encoding="utf-8"))
    (tmp_path / "mantel-photos.mjs").write_text((WEB / "shim/mantel-photos.js").read_text(encoding="utf-8"))
    (tmp_path / "m.mjs").write_text((WEB / "shim/mantel-settings.js").read_text(encoding="utf-8")
                                    .replace("from './base.js'", "from './base.mjs'")
                                    .replace("from './mantel-photos.js'", "from './mantel-photos.mjs'"))
    (tmp_path / "s.mjs").write_text(SCRIPT)
    (tmp_path / "reads.json").write_text(json.dumps({"/api/linked/owners": data}))
    got = subprocess.run(["node", str(tmp_path / "s.mjs"), str(tmp_path / "m.mjs"), str(tmp_path / "reads.json"),
                          json.dumps(overview("owner", ALL)), json.dumps(overview("admin", ["me", "connections"]))],
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


def groups(page):
    return {g["header"]: g for g in page}


def test_an_owner_sees_both_links_and_hands_the_bridge_over(tmp_path):
    got = groups(run(tmp_path, owners())["owner"])
    links = got["Linked Now"]["rows"]
    assert [r["label"] for r in links] == ["HK Frontend", "Mantel Link"]
    assert "can hand over" in links[0]["sub"] and "HK Frontend is also in Home Assistant, linked" in links[1]["sub"]
    assert [r["label"] for r in got["Pair Mantel Link"]["rows"]] == ["Make a Pairing Code"]
    bridge = got["The Bridge"]["rows"]
    assert bridge[0]["value"] == "HK Frontend"
    assert [r["label"] for r in bridge[1:]] == ["Hand the Bridge to Mantel Link…"]
    tablets = got["Who Runs Each Wall Tablet"]["rows"]
    assert [(r["kind"], r["label"], r["on"]) for r in tablets] == [
        ("toggle", "The Rest of the House", False), ("toggle", "Loft", True), ("toggle", "Hall", False)]


def test_with_mantel_link_holding_it_the_owner_can_give_it_back(tmp_path):
    got = groups(run(tmp_path, owners("mantel"))["owner"])
    assert got["The Bridge"]["rows"][0]["value"] == "Mantel Link"
    assert [r["label"] for r in got["The Bridge"]["rows"][1:]] == ["Give the Bridge Back to HK Frontend…"]


def test_an_admin_reads_and_changes_nothing(tmp_path):
    got = groups(run(tmp_path, owners())["admin"])
    assert "Pair Mantel Link" not in got
    assert [r["kind"] for r in got["The Bridge"]["rows"]] == ["info"]
    assert all(r["kind"] == "info" for r in got["Who Runs Each Wall Tablet"]["rows"])
    assert "Only an Owner" in got["The Bridge"]["footer"]


def test_nothing_linked_says_how_to_add_mantel_link(tmp_path):
    got = groups(run(tmp_path, {**owners(), "links": []})["owner"])
    assert got["Linked Now"]["rows"] == [] and "Add Integration, Mantel Link" in got["Linked Now"]["footer"]


def test_without_hk_frontend_mantel_link_shows_them(tmp_path):
    d = owners()
    d["links"] = [{"domain": "mantel", "protocol": 2, "features": ["bridge"], "since": 1,
                   "report": {"hk_frontend": {"installed": False, "loaded": False, "linked": False}}}]
    got = groups(run(tmp_path, d)["owner"])
    shown = got["The Bridge"]["rows"][0]
    assert shown["value"] == "Mantel Link" and shown["sub"] == "Home Assistant has no HK Frontend"


# -- People -> a person -> Phones (phones.py; 9.7) -------------------------------------------------------------------
PERSON_SCRIPT = SCRIPT.replace(
    "m.host.page(['mantel', 'connections', 'link'], panel).body(c)",
    "m.host.page(['mantel', 'people', 'u2'], panel).body(c)")


def person(tmp_path, phones):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    reads = {"/api/users": {"users": [{"id": "u2", "name": "Fictional Adult", "username": "adult", "role": "adult",
                                       "has_password": True}]},
             "/api/default-screens": {"users": {}, "devices": {}, "screens": [], "house": "dashboard-kitchen"},
             "/api/phones": phones}
    (tmp_path / "base.mjs").write_text((WEB / "shim/base.js").read_text(encoding="utf-8"))
    (tmp_path / "mantel-photos.mjs").write_text((WEB / "shim/mantel-photos.js").read_text(encoding="utf-8"))
    (tmp_path / "m.mjs").write_text((WEB / "shim/mantel-settings.js").read_text(encoding="utf-8")
                                    .replace("from './base.js'", "from './base.mjs'")
                                    .replace("from './mantel-photos.js'", "from './mantel-photos.mjs'"))
    (tmp_path / "s.mjs").write_text(PERSON_SCRIPT)
    (tmp_path / "reads.json").write_text(json.dumps(reads))
    got = subprocess.run(["node", str(tmp_path / "s.mjs"), str(tmp_path / "m.mjs"), str(tmp_path / "reads.json"),
                          json.dumps(overview("owner", ALL)), json.dumps(overview("admin", ["me", "people"]))],
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return groups(json.loads(got.stdout)["owner"])


def test_a_person_s_phones_are_picked_on_their_page(tmp_path):
    got = person(tmp_path, {"linked": True, "available": [{"service": "mobile_app_pixel", "name": "Pixel"},
                                                          {"service": "mobile_app_ipad", "name": "iPad"}],
                            "people": {"u2": {"services": ["mobile_app_pixel", "mobile_app_old"], "send": "all"}}})
    rows = got["Phones"]["rows"]
    assert [(r["kind"], r["label"], r.get("on")) for r in rows[:2]] == [("toggle", "Pixel", True), ("toggle", "iPad", False)]
    assert rows[2]["label"] == "mobile_app_old" and rows[2]["value"] == "Gone"
    assert rows[3]["label"] == "Send" and rows[3]["value"] == "all"
    assert "Companion app" in got["Phones"]["footer"]


def test_without_mantel_link_it_says_so(tmp_path):
    got = person(tmp_path, {"linked": False, "available": [], "people": {}})
    assert got["Phones"]["rows"] == [] and "It isn’t linked yet" in got["Phones"]["footer"]
